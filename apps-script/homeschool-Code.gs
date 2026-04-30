/**
 * River Tech — Homeschool Enrollment 2026-27 Backend
 * Google Apps Script web app.
 *
 * Deploy with:
 *   Deploy > New deployment > Type: Web app
 *   Execute as: Me (learn@rivertech.me)
 *   Who has access: Anyone
 *
 * Per submission:
 *   1. Upload each child's photo (if any) to Drive folder DRIVE_FOLDER_ID.
 *   2. Append a row to the Sheet (SHEET_ID) with photo URLs embedded.
 *   3. Create a Stripe Checkout Session for the Annual Family Setup Fee.
 *   4. Email the parent + notify admin.
 *   5. Return { ok, checkoutUrl, registrationId } to the browser.
 *
 * Script Properties required:
 *   SHEET_ID           — Google Sheet ID (folder: My Drive / RTS Website Forms /)
 *   STRIPE_SECRET_KEY  — sk_test_... for testing, sk_live_... for launch
 *   DRIVE_FOLDER_ID    — Drive folder for uploaded child photos
 */

// ---- Config helpers -----------------------------------------------------
function cfg(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

const NOTIFY_EMAILS = ["learn@rivertech.me", "dhegelund@gmail.com"];
const SCHOOL_NAME = "River Tech School of Performing Arts & Technology";
const FORM_PAGE_URL = "https://www.rivertechschool.com/pages/register-homeschool-2026-27.html";
const SUCCESS_URL = "https://www.rivertechschool.com/pages/register-homeschool-2026-27-success.html?session_id={CHECKOUT_SESSION_ID}";
const CANCEL_URL = "https://www.rivertechschool.com/pages/register-homeschool-2026-27.html";

// Sheet columns: 16 family + (14 per child × 6) = 100 columns.
const MAX_CHILDREN = 6;
const CHILD_COLS = 14;

// ---- Pipeline (Enrollment-Review app) constants ------------------------
const PIPELINE_SOURCE = "homeschool";
const SHEET_TAB_NAME = "Enrollments";
const PIPELINE_STAGES = ["Inbox", "Decided", "Confirmed", "Committed", "Declined"];
const PIPELINE_DATE_COL_FOR = {
  "Decided":   "Decided Date",
  "Confirmed": "Confirmed Date",
  "Committed": "Committed Date",
  "Declined":  "Declined Date"
};
const PIPELINE_NEW_HEADERS = ["Decided Date", "Confirmed Date", "Committed Date", "Declined Date"];

// ---- Web-app entrypoints -----------------------------------------------
function doPost(e) {
  try {
    const params = (e && e.parameter) || {};
    if (params.action === "migrate") return json_(pipelineMigrate_(params.token));
    if (params.action === "advance") {
      let body = {};
      if (e.postData && e.postData.contents) {
        try { body = JSON.parse(e.postData.contents); } catch (_) {}
      }
      return json_(pipelineAdvance_(
        params.token  || body.token,
        params.regId  || body.regId,
        params.toStage || body.toStage
      ));
    }
    if (params.action === "import") {
      let body = {};
      if (e.postData && e.postData.contents) {
        try { body = JSON.parse(e.postData.contents); } catch (_) {}
      }
      return json_(pipelineImport_(
        params.token || body.token,
        body.rows || [],
        body.dryRun === true
      ));
    }
    if (params.action === "uploadphoto") {
      let body = {};
      if (e.postData && e.postData.contents) {
        try { body = JSON.parse(e.postData.contents); } catch (_) {}
      }
      return json_(pipelineUploadPhoto_(
        params.token || body.token,
        body.regId,
        body.childIdx,
        body.filename,
        body.mimeType,
        body.base64
      ));
    }
    if (params.action === "fixphotosharing") {
      let body = {};
      if (e.postData && e.postData.contents) {
        try { body = JSON.parse(e.postData.contents); } catch (_) {}
      }
      return json_(pipelineFixPhotoSharing_(params.token || body.token));
    }
    if (params.action === "stripeWebhook") return json_(pipelineStripeWebhook_(e));
    const payload = JSON.parse(e.postData.contents);
    const result = handleRegistration(payload);
    return json_(result);
  } catch (err) {
    Logger.log("doPost error: " + err + "\n" + (err.stack || ""));
    return json_({ ok: false, error: "Server error: " + err.message });
  }
}

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.action === "list") return json_(pipelineList_(params.token));
  return json_({ ok: true, message: "Homeschool 2026-27 backend is alive." });
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---- Core handler -------------------------------------------------------
function handleRegistration(p) {
  if (!p || !p.parent || !Array.isArray(p.children) || p.children.length === 0) {
    return { ok: false, error: "Registration data was incomplete." };
  }
  if (!p.releaseAgreed) {
    return { ok: false, error: "Release must be agreed to before submitting." };
  }
  if (p.children.length > MAX_CHILDREN) {
    return { ok: false, error: "Too many children in one submission (max " + MAX_CHILDREN + ")." };
  }

  const registrationId = "HS-" + Utilities.formatDate(new Date(), "America/Los_Angeles", "yyyyMMdd-HHmmss")
    + "-" + Math.floor(Math.random() * 1000).toString().padStart(3, "0");

  // 1. Upload photos to Drive first — collect URLs to embed in the sheet row.
  const photoUrls = p.children.map(function (c, i) {
    return uploadPhotoToDrive_(c.photo, registrationId, i + 1, c.firstName, c.lastName);
  });

  // 2. Write to Sheet (photos already uploaded → URL in each row)
  writeToSheet_(registrationId, p, photoUrls);

  // 3. Create Stripe Checkout session
  const checkoutUrl = createStripeSession_(registrationId, p);

  // 4. Emails — parent gets a receipt-of-registration note, admin gets full detail.
  sendParentEmail_(registrationId, p);
  sendNotificationEmail_(registrationId, p, photoUrls);

  return { ok: true, registrationId: registrationId, checkoutUrl: checkoutUrl };
}

// ---- Drive photo upload -------------------------------------------------
function uploadPhotoToDrive_(photo, registrationId, childIdx, firstName, lastName) {
  if (!photo || !photo.base64) return "";
  const folderId = cfg("DRIVE_FOLDER_ID");
  if (!folderId) {
    Logger.log("DRIVE_FOLDER_ID not configured — skipping photo upload.");
    return "";
  }
  try {
    const folder = DriveApp.getFolderById(folderId);
    const ext = extFromMime_(photo.type) || extFromName_(photo.name) || "jpg";
    const cleanFirst = (firstName || "Child" + childIdx).replace(/[^A-Za-z0-9_-]/g, "");
    const cleanLast = (lastName || "").replace(/[^A-Za-z0-9_-]/g, "");
    const filename = [registrationId, "c" + childIdx, cleanFirst, cleanLast].filter(String).join("_") + "." + ext;
    const bytes = Utilities.base64Decode(photo.base64);
    const blob = Utilities.newBlob(bytes, photo.type || "image/jpeg", filename);
    const file = folder.createFile(blob);
    return file.getUrl();
  } catch (err) {
    Logger.log("Photo upload failed for child " + childIdx + ": " + err);
    return "";
  }
}

function extFromMime_(mime) {
  if (!mime) return "";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/heic") return "heic";
  if (mime === "image/webp") return "webp";
  return "";
}

function extFromName_(name) {
  if (!name) return "";
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : "";
}

// ---- Sheet write --------------------------------------------------------
function writeToSheet_(registrationId, p, photoUrls) {
  const sheetId = cfg("SHEET_ID");
  if (!sheetId) throw new Error("SHEET_ID is not configured in Script Properties.");
  const ss = SpreadsheetApp.openById(sheetId);
  const sh = ss.getSheetByName("Enrollments") || ss.getSheets()[0];

  // Auto-header on first write.
  if (sh.getLastRow() === 0) {
    const header = [
      "Registration ID", "Submitted (UTC)", "Pipeline Stage",
      "Parent 1 First", "Parent 1 Last", "Parent 1 Email", "Parent 1 Phone", "Parent 1 Address",
      "Parent 2 First", "Parent 2 Last", "Parent 2 Email", "Parent 2 Phone",
      "Children Count", "Max Days", "Family Fee (USD)",
      "Signature", "Signature Date"
    ];
    for (let n = 1; n <= MAX_CHILDREN; n++) {
      header.push(
        "Child " + n + " Name",
        "Child " + n + " DOB",
        "Child " + n + " Gender",
        "Child " + n + " Grade",
        "Child " + n + " Reading",
        "Child " + n + " Tablet",
        "Child " + n + " Programs",
        "Child " + n + " Previous Schooling",
        "Child " + n + " Prev Schooling Other",
        "Child " + n + " Attitude",
        "Child " + n + " Health",
        "Child " + n + " Hopes",
        "Child " + n + " Notes",
        "Child " + n + " Photo URL"
      );
    }
    sh.appendRow(header);
    sh.getRange(1, 1, 1, header.length).setFontWeight("bold");
    sh.setFrozenRows(1);
  }

  const children = p.children;
  const p2 = p.parent2 || {};

  const row = [
    registrationId,
    p.submittedAt || new Date().toISOString(),
    "Inbox",
    p.parent.firstName || "",
    p.parent.lastName  || "",
    p.parent.email     || "",
    p.parent.phone     || "",
    p.parent.address   || "",
    p2.firstName || "",
    p2.lastName  || "",
    p2.email     || "",
    p2.phone     || "",
    children.length,
    p.maxDays || 0,
    p.familyFee || 0,
    p.signature || "",
    p.signatureDate || ""
  ];

  for (let i = 0; i < MAX_CHILDREN; i++) {
    const c = children[i];
    if (c) {
      row.push(
        ((c.firstName || "") + " " + (c.lastName || "")).trim(),
        c.dob || "",
        c.gender || "",
        c.grade || "",
        c.readingLevel || "",
        c.tabletLevel || "",
        (c.programs || []).join(", "),
        (c.previousSchooling || []).join(", "),
        c.previousSchoolingOther || "",
        c.attitude || "",
        c.health || "",
        c.hopes || "",
        c.notes || "",
        photoUrls[i] || ""
      );
    } else {
      for (let k = 0; k < CHILD_COLS; k++) row.push("");
    }
  }

  sh.appendRow(row);
}

// ---- Stripe Checkout ----------------------------------------------------
function createStripeSession_(registrationId, p) {
  const secretKey = cfg("STRIPE_SECRET_KEY");
  if (!secretKey) {
    Logger.log("No Stripe key configured — returning null checkout URL.");
    return null;
  }

  const amount = Math.round((p.familyFee || p.totalAmount || 0) * 100); // cents
  if (amount <= 0) throw new Error("Amount must be greater than zero. Please select at least one program day.");

  const parentName = ((p.parent.firstName || "") + " " + (p.parent.lastName || "")).trim();
  const childNames = (p.children || [])
    .map(function (c) { return (c.firstName || "").trim(); })
    .filter(String).join(", ");
  const childWord = p.children.length === 1 ? "child" : "children";
  const description = "River Tech Homeschool 2026-27 enrollment — " + childNames +
    " (" + p.children.length + " " + childWord + ", " + p.maxDays + "-day rate)";

  const params = {
    "mode": "payment",
    "success_url": SUCCESS_URL,
    "cancel_url": CANCEL_URL,
    "customer_email": p.parent.email,
    "client_reference_id": registrationId,
    "metadata[registrationId]": registrationId,
    "metadata[parentName]": parentName,
    "metadata[parentEmail]": p.parent.email || "",
    "metadata[parentPhone]": p.parent.phone || "",
    "metadata[childCount]": String(p.children.length),
    "metadata[maxDays]": String(p.maxDays || 0),
    "metadata[schoolYear]": p.schoolYear || "2026-27",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][product_data][name]": "Homeschool Annual Family Setup Fee (" + (p.maxDays || 0) + "-day rate)",
    "line_items[0][price_data][product_data][description]": description,
    "line_items[0][price_data][unit_amount]": String(amount),
    "line_items[0][quantity]": "1"
  };

  const response = UrlFetchApp.fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "post",
    headers: { "Authorization": "Bearer " + secretKey },
    payload: params,
    muteHttpExceptions: true
  });

  const body = response.getContentText();
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    Logger.log("Stripe error (" + status + "): " + body);
    throw new Error("Payment system error. Please try again or email learn@rivertech.me.");
  }

  const session = JSON.parse(body);
  return session.url;
}

// ---- Emails -------------------------------------------------------------
function sendParentEmail_(registrationId, p) {
  const kidNames = (p.children || [])
    .map(function (c) { return (c.firstName || "").trim(); })
    .filter(String);
  const kidsStr = kidNames.length === 0 ? "your child" :
                  kidNames.length === 1 ? kidNames[0] :
                  kidNames.length === 2 ? kidNames[0] + " and " + kidNames[1] :
                  kidNames.slice(0, -1).join(", ") + ", and " + kidNames[kidNames.length - 1];

  const subject = "River Tech Homeschool 2026-27 — we received your enrollment";
  const body = [
    "Hi " + (p.parent.firstName || "") + ",",
    "",
    "Thanks for enrolling " + kidsStr + " in River Tech's homeschool program for the 2026-27 school year. We have your details.",
    "",
    "Your confirmation reference: " + registrationId,
    "Annual Family Setup Fee: $" + (p.familyFee || 0) + " (" + (p.maxDays || 0) + "-day rate)",
    "",
    "What happens next:",
    "• Once your Stripe payment is complete, your enrollment is locked in.",
    "• We'll follow up before the school year starts (Tuesday, September 2, 2026) with class details, supply lists, and any logistics.",
    "• Tuition for the program days you selected will be billed separately.",
    "",
    "If you need to change anything — add a day, adjust an answer, or ask a question — reply to this email or write learn@rivertech.me.",
    "",
    "Welcome to River Tech.",
    "",
    SCHOOL_NAME,
    "927 E Polston Ave, Post Falls, ID 83854",
    FORM_PAGE_URL
  ].join("\n");

  try {
    MailApp.sendEmail({
      to: p.parent.email,
      replyTo: "learn@rivertech.me",
      subject: subject,
      body: body,
      name: "River Tech School"
    });
  } catch (err) {
    Logger.log("Parent email failed: " + err);
  }
}

function sendNotificationEmail_(registrationId, p, photoUrls) {
  const subject = "[Homeschool 26-27] " + (p.parent.firstName || "") + " " + (p.parent.lastName || "") +
    " — " + p.children.length + " child" + (p.children.length === 1 ? "" : "ren") + " — $" + (p.familyFee || 0);

  const childSummary = (p.children || []).map(function (c, i) {
    const lines = [
      "Child " + (i + 1) + ": " + (c.firstName || "") + " " + (c.lastName || ""),
      "  DOB: " + (c.dob || "(not given)") + (c.gender ? " · Gender: " + c.gender : ""),
      "  Grade: " + (c.grade || "") +
        (c.readingLevel ? " · Reading: " + c.readingLevel : "") +
        (c.tabletLevel  ? " · Tablet: "  + c.tabletLevel  : ""),
      "  Programs: " + ((c.programs || []).join(", ") || "(none)"),
      "  Previous: " + ((c.previousSchooling || []).join(", ") || "(none)") +
        (c.previousSchoolingOther ? " (" + c.previousSchoolingOther + ")" : ""),
      "  Photo: " + (photoUrls[i] || "(none uploaded)")
    ];
    if (c.attitude) lines.push("  Attitude/style: " + c.attitude);
    if (c.health)   lines.push("  Health: " + c.health);
    if (c.hopes)    lines.push("  Hopes: " + c.hopes);
    if (c.notes)    lines.push("  Notes: " + c.notes);
    return lines.join("\n");
  }).join("\n\n");

  const p2 = p.parent2 || null;
  const parent2Lines = p2 ? [
    "Parent 2: " + (p2.firstName || "") + " " + (p2.lastName || ""),
    "  Email: " + (p2.email || "") + " · Phone: " + (p2.phone || "")
  ] : ["Parent 2: (not added)"];

  const body = [
    "New homeschool enrollment for 2026-27.",
    "",
    "Reference: " + registrationId,
    "Submitted: " + (p.submittedAt || new Date().toISOString()),
    "Max days: " + (p.maxDays || 0),
    "Family Setup Fee: $" + (p.familyFee || 0),
    "",
    "Parent 1: " + (p.parent.firstName || "") + " " + (p.parent.lastName || ""),
    "  Email: " + (p.parent.email || "") + " · Phone: " + (p.parent.phone || ""),
    "  Address: " + (p.parent.address || ""),
    "",
    parent2Lines.join("\n"),
    "",
    childSummary,
    "",
    "Signature: " + (p.signature || "") + " · Date: " + (p.signatureDate || ""),
    "",
    "Row appended to enrollment sheet. Payment status will remain 'Submitted (awaiting payment)' until the Stripe session completes."
  ].join("\n");

  try {
    MailApp.sendEmail({
      to: NOTIFY_EMAILS.join(","),
      subject: subject,
      body: body,
      name: "River Tech Enrollments"
    });
  } catch (err) {
    Logger.log("Notification email failed: " + err);
  }
}

// ---- One-time setup helpers (run from the editor) ----------------------
/**
 * Run this once to create the enrollment Sheet + photos folder.
 * Stores the new IDs in Script Properties. Safe to re-run (idempotent
 * by folder/file name — rename the existing ones first if you want to
 * start fresh).
 */
function setupHomeschoolBackend_ONCE() {
  const props = PropertiesService.getScriptProperties();

  // Sheet
  let sheetId = props.getProperty("SHEET_ID");
  if (!sheetId) {
    const ss = SpreadsheetApp.create("Homeschool Enrollment 2026-27");
    ss.getSheets()[0].setName("Enrollments");
    sheetId = ss.getId();
    props.setProperty("SHEET_ID", sheetId);
    Logger.log("Created Sheet. ID: " + sheetId + " — URL: " + ss.getUrl());
    Logger.log("Move it into 'My Drive / RTS Website Forms /' manually.");
  } else {
    Logger.log("SHEET_ID already set: " + sheetId);
  }

  // Photos folder
  let folderId = props.getProperty("DRIVE_FOLDER_ID");
  if (!folderId) {
    const folder = DriveApp.createFolder("Homeschool 2026-27 — Child Photos");
    folderId = folder.getId();
    props.setProperty("DRIVE_FOLDER_ID", folderId);
    Logger.log("Created photos folder. ID: " + folderId + " — URL: " + folder.getUrl());
    Logger.log("Move it into 'My Drive / RTS Website Forms /' manually and share with Dan.");
  } else {
    Logger.log("DRIVE_FOLDER_ID already set: " + folderId);
  }

  if (!props.getProperty("STRIPE_SECRET_KEY")) {
    Logger.log("⚠ STRIPE_SECRET_KEY not yet set — add it in Project Settings > Script Properties.");
  }
}

/**
 * Pretend-submit a registration to exercise the sheet, photos (skipped —
 * no base64 here), emails, and Stripe session. Check Logger output and
 * your inbox.
 */
function selfTest() {
  const fake = {
    submittedAt: new Date().toISOString(),
    schoolYear: "2026-27",
    parent: {
      firstName: "Test", lastName: "Parent",
      email: Session.getActiveUser().getEmail() || "dhegelund@gmail.com",
      phone: "555-0100",
      address: "927 E Polston Ave, Post Falls, ID 83854"
    },
    parent2: null,
    children: [
      {
        firstName: "Ada", lastName: "Parent",
        dob: "2018-05-12", gender: "female",
        grade: "elementary", readingLevel: "independent", tabletLevel: "independent",
        programs: ["monday", "tuesday"],
        previousSchooling: ["homeschool"], previousSchoolingOther: "",
        attitude: "Curious and focused.",
        health: "No known allergies.",
        hopes: "Wants to learn piano and make friends.",
        notes: "",
        photo: null
      }
    ],
    maxDays: 2,
    familyFee: 100,
    totalAmount: 100,
    signature: "Test Parent",
    signatureDate: Utilities.formatDate(new Date(), "America/Los_Angeles", "yyyy-MM-dd"),
    releaseAgreed: true
  };
  const r = handleRegistration(fake);
  Logger.log(JSON.stringify(r, null, 2));
}


/** Utility: wipe all non-header rows. Only run manually for test cleanup. */
function deleteAllDataRows_TESTONLY() {
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty("SHEET_ID"));
  const sheet = ss.getSheetByName("Enrollments");
  const last = sheet.getLastRow();
  if (last > 1) sheet.deleteRows(2, last - 1);
  Logger.log("Deleted data rows. Rows now: " + sheet.getLastRow());
}

// ==== Pipeline (Enrollment-Review app) ===================================
// Endpoints used by the Enrollment-Review Cowork artifact:
//   GET  ?action=list&token=XXX                      → list rows + headers
//   POST ?action=advance + body{token,regId,toStage} → write stage transition
//   POST ?action=migrate&token=XXX                   → one-shot schema migration
//
// Shared secret in Script Property PIPELINE_TOKEN. Same value across all 3 backends in v1.

function pipelineSheet_() {
  const ss = SpreadsheetApp.openById(cfg("SHEET_ID"));
  return ss.getSheetByName(SHEET_TAB_NAME) || ss.getSheets()[0];
}

function pipelineCheckToken_(token) {
  const expected = cfg("PIPELINE_TOKEN");
  return expected && token && token === expected;
}

function pipelineList_(token) {
  if (!pipelineCheckToken_(token)) return { ok: false, error: "Bad token" };
  const sh = pipelineSheet_();
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) return { ok: true, source: PIPELINE_SOURCE, headers: [], rows: [] };
  const all = sh.getRange(1, 1, lastRow, lastCol).getValues();
  return { ok: true, source: PIPELINE_SOURCE, headers: all[0], rows: all.slice(1) };
}

function pipelineAdvance_(token, regId, toStage) {
  if (!pipelineCheckToken_(token)) return { ok: false, error: "Bad token" };
  if (!regId || !toStage) return { ok: false, error: "regId and toStage required" };
  if (PIPELINE_STAGES.indexOf(toStage) === -1) return { ok: false, error: "Unknown stage: " + toStage };
  const sh = pipelineSheet_();
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) return { ok: false, error: "Sheet empty" };
  const all = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = all[0];
  const stageCol = headers.indexOf("Pipeline Stage") >= 0 ? headers.indexOf("Pipeline Stage") : headers.indexOf("Status");
  if (stageCol < 0) return { ok: false, error: "Pipeline Stage column not found — run migrate first" };
  const dateColName = PIPELINE_DATE_COL_FOR[toStage];
  const dateCol = dateColName ? headers.indexOf(dateColName) : -1;
  for (let r = 1; r < all.length; r++) {
    if (String(all[r][0]) === String(regId)) {
      sh.getRange(r + 1, stageCol + 1).setValue(toStage);
      if (dateCol >= 0) {
        const stamp = Utilities.formatDate(new Date(), "America/Los_Angeles", "yyyy-MM-dd");
        sh.getRange(r + 1, dateCol + 1).setValue(stamp);
      }
      return { ok: true, regId: regId, newStage: toStage, stamped: dateColName || null };
    }
  }
  return { ok: false, error: "regId not found: " + regId };
}

/**
 * One-shot historical import. Accepts rows keyed by sheet header name.
 * Dedups by Parent 1 Email. Idempotent.
 *
 * Body: { token, rows: [{<header>: <value>}, ...], dryRun?: true }
 */
function pipelineImport_(token, rows, dryRun) {
  if (!pipelineCheckToken_(token)) return { ok: false, error: "Bad token" };
  if (!Array.isArray(rows)) return { ok: false, error: "rows array required" };
  if (rows.length === 0) return { ok: true, source: PIPELINE_SOURCE, imported: 0, skippedDupes: 0, skippedNoEmail: 0, errors: [], totalProvided: 0, dryRun: !!dryRun };

  const sh = pipelineSheet_();
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow === 0 || lastCol === 0) {
    return { ok: false, error: "Sheet has no headers — submit at least one form first" };
  }
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];

  const emailColIdx = headers.indexOf("Parent 1 Email");
  const existingEmails = {};
  if (emailColIdx >= 0 && lastRow >= 2) {
    const emailValues = sh.getRange(2, emailColIdx + 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < emailValues.length; i++) {
      const e = String(emailValues[i][0] || "").trim().toLowerCase();
      if (e) existingEmails[e] = true;
    }
  }

  let imported = 0, skippedDupes = 0, skippedNoEmail = 0;
  const errors = [];
  const newRows = [];
  const acceptedRegIds = [];

  for (let i = 0; i < rows.length; i++) {
    const obj = rows[i];
    if (!obj || typeof obj !== "object") {
      errors.push({ index: i, error: "row is not an object" });
      continue;
    }
    const email = String(obj["Parent 1 Email"] || "").trim().toLowerCase();
    if (!email) {
      skippedNoEmail++;
    } else if (existingEmails[email]) {
      skippedDupes++;
      continue;
    } else {
      existingEmails[email] = true;
    }
    const row = headers.map(function (h) {
      const v = obj[h];
      if (v === undefined || v === null) return "";
      if (h === "Pipeline Stage" && (v === "" || v === undefined)) return "Inbox";
      return v;
    });
    const stageIdx = headers.indexOf("Pipeline Stage");
    if (stageIdx >= 0 && (row[stageIdx] === "" || row[stageIdx] === undefined || row[stageIdx] === null)) {
      row[stageIdx] = "Inbox";
    }
    newRows.push(row);
    imported++;
    if (obj["Registration ID"]) acceptedRegIds.push(obj["Registration ID"]);
  }

  if (!dryRun && newRows.length > 0) {
    sh.getRange(sh.getLastRow() + 1, 1, newRows.length, headers.length).setValues(newRows);
  }

  return {
    ok: true,
    source: PIPELINE_SOURCE,
    imported: imported,
    skippedDupes: skippedDupes,
    skippedNoEmail: skippedNoEmail,
    errors: errors,
    totalProvided: rows.length,
    dryRun: !!dryRun,
    sampleAcceptedRegIds: acceptedRegIds.slice(0, 5)
  };
}

/**
 * Upload a photo for a specific child on an existing row. Used by the
 * Cognito-photo backfill driver.
 *
 * Body: { token, regId, childIdx, filename, mimeType, base64 }
 *
 * - Decodes base64 → blob → uploads to DRIVE_FOLDER_ID.
 * - Sets file sharing to ANYONE_WITH_LINK / VIEW.
 * - Locates row by regId, writes the file URL into "Child N Photo URL".
 * - Returns the URL.
 */
function pipelineUploadPhoto_(token, regId, childIdx, filename, mimeType, b64) {
  if (!pipelineCheckToken_(token)) return { ok: false, error: "Bad token" };
  if (!regId)    return { ok: false, error: "regId required" };
  if (!childIdx) return { ok: false, error: "childIdx required" };
  if (!b64)      return { ok: false, error: "base64 required" };

  const folderId = cfg("DRIVE_FOLDER_ID");
  if (!folderId) return { ok: false, error: "DRIVE_FOLDER_ID not set" };

  const cleanName = (filename || ("c" + childIdx + ".jpg")).replace(/[^A-Za-z0-9._-]/g, "_");
  const finalName = regId + "_c" + childIdx + "_" + cleanName;
  const bytes = Utilities.base64Decode(b64);
  const blob = Utilities.newBlob(bytes, mimeType || "image/jpeg", finalName);
  const folder = DriveApp.getFolderById(folderId);
  const file = folder.createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    Logger.log("setSharing failed: " + err);
  }
  const url = file.getUrl();

  const sh = pipelineSheet_();
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) return { ok: false, error: "Sheet empty" };
  const all = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = all[0];
  const colName = "Child " + childIdx + " Photo URL";
  const colIdx = headers.indexOf(colName);
  if (colIdx < 0) return { ok: false, error: "Column not found: " + colName };
  for (let r = 1; r < all.length; r++) {
    if (String(all[r][0]) === String(regId)) {
      sh.getRange(r + 1, colIdx + 1).setValue(url);
      return { ok: true, regId: regId, childIdx: childIdx, url: url, fileId: file.getId() };
    }
  }
  return { ok: false, error: "regId not found in sheet" };
}

/**
 * One-time helper: walk every "Child N Photo URL" cell in the sheet and
 * flip the underlying Drive file to ANYONE_WITH_LINK / VIEW.
 */
function pipelineFixPhotoSharing_(token) {
  if (!pipelineCheckToken_(token)) return { ok: false, error: "Bad token" };
  const sh = pipelineSheet_();
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) return { ok: true, fixed: 0, errors: [] };
  const all = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = all[0];
  const photoColIdxs = [];
  for (let n = 1; n <= MAX_CHILDREN; n++) {
    const idx = headers.indexOf("Child " + n + " Photo URL");
    if (idx >= 0) photoColIdxs.push(idx);
  }
  let fixed = 0;
  const errors = [];
  for (let r = 1; r < all.length; r++) {
    for (const idx of photoColIdxs) {
      const url = String(all[r][idx] || "");
      if (!url) continue;
      const m = /\/file\/d\/([^\/?]+)/.exec(url);
      if (!m) continue;
      const fileId = m[1];
      try {
        const file = DriveApp.getFileById(fileId);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        fixed++;
      } catch (err) {
        errors.push({ row: r + 1, fileId: fileId, error: String(err) });
      }
    }
  }
  return { ok: true, source: PIPELINE_SOURCE, fixed: fixed, errors: errors };
}

/**
 * Stripe webhook handler — same pattern as RTD/school. URL secret + out-of-band
 * Stripe event verification. On checkout.session.completed flip Pipeline Stage
 * to "Paid" if the row is still at Inbox.
 */
function pipelineStripeWebhook_(e) {
  const params = (e && e.parameter) || {};
  const expectedSecret = cfg("STRIPE_WEBHOOK_SECRET");
  if (!expectedSecret) return { ok: false, error: "Webhook secret not configured" };
  if (!params.secret || params.secret !== expectedSecret) return { ok: false, error: "Forbidden" };

  let event;
  try { event = JSON.parse(e.postData.contents); }
  catch (err) { return { ok: false, error: "Invalid body" }; }
  if (!event || !event.id || !event.type) return { ok: false, error: "Event missing id/type" };

  const stripeKey = cfg("STRIPE_SECRET_KEY");
  if (!stripeKey) return { ok: false, error: "STRIPE_SECRET_KEY not configured" };

  let verifiedEvent;
  try {
    const verifyRes = UrlFetchApp.fetch(
      "https://api.stripe.com/v1/events/" + encodeURIComponent(event.id),
      { method: "get", headers: { "Authorization": "Bearer " + stripeKey }, muteHttpExceptions: true }
    );
    if (verifyRes.getResponseCode() !== 200) return { ok: false, error: "Event verification failed" };
    verifiedEvent = JSON.parse(verifyRes.getContentText());
  } catch (err) {
    return { ok: false, error: "Event verification network error" };
  }
  if (verifiedEvent.id !== event.id) return { ok: false, error: "Verified event ID mismatch" };
  if (verifiedEvent.type !== "checkout.session.completed") {
    return { ok: true, message: "Event ignored: " + verifiedEvent.type };
  }

  const session = verifiedEvent.data && verifiedEvent.data.object;
  if (!session) return { ok: false, error: "Event data.object missing" };
  const regId = session.client_reference_id;
  if (!regId) return { ok: false, error: "No client_reference_id on session" };

  const sh = pipelineSheet_();
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) return { ok: false, error: "Sheet empty" };
  const all = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = all[0];
  const stageIdx = headers.indexOf("Pipeline Stage") >= 0
    ? headers.indexOf("Pipeline Stage")
    : headers.indexOf("Status");
  if (stageIdx < 0) return { ok: false, error: "Pipeline Stage / Status column not found" };

  for (let r = 1; r < all.length; r++) {
    if (String(all[r][0]) === String(regId)) {
      const currentStage = String(all[r][stageIdx] || "");
      if (/^paid$/i.test(currentStage)) {
        return { ok: true, message: "Already Paid (idempotent)", regId: regId };
      }
      if (currentStage !== "Inbox" && !/awaiting/i.test(currentStage) && currentStage !== "") {
        return { ok: true, message: "Stage already advanced: " + currentStage, regId: regId };
      }
      sh.getRange(r + 1, stageIdx + 1).setValue("Paid");
      Logger.log("stripeWebhook: marked " + regId + " Paid (event " + event.id + ")");
      return { ok: true, regId: regId, newStage: "Paid", eventId: event.id };
    }
  }
  return { ok: false, error: "regId not found: " + regId };
}

function pipelineMigrate_(token) {
  // Trust-on-first-use bootstrap: if PIPELINE_TOKEN isn't set yet, the first
  // caller establishes it. Web App URL is hard to guess; acceptable for v1.
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty("PIPELINE_TOKEN")) {
    if (!token) return { ok: false, error: "Token required for first migrate" };
    props.setProperty("PIPELINE_TOKEN", token);
  }
  if (!pipelineCheckToken_(token)) return { ok: false, error: "Bad token" };
  const sh = pipelineSheet_();
  const lastCol = sh.getLastColumn();
  if (lastCol === 0) return { ok: true, message: "Sheet empty — nothing to migrate" };
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  let renamed = false;
  let rewrittenInbox = 0;
  const addedColumns = [];
  const statusIdx = headers.indexOf("Status");
  if (statusIdx >= 0) {
    sh.getRange(1, statusIdx + 1).setValue("Pipeline Stage");
    headers[statusIdx] = "Pipeline Stage";
    renamed = true;
  }
  const stageColIdx = headers.indexOf("Pipeline Stage");
  if (stageColIdx >= 0) {
    const lastRow = sh.getLastRow();
    if (lastRow >= 2) {
      const range = sh.getRange(2, stageColIdx + 1, lastRow - 1, 1);
      const data = range.getValues();
      const updated = data.map(function (r) {
        if (r[0] === "Submitted (awaiting payment)") { rewrittenInbox++; return ["Inbox"]; }
        return r;
      });
      range.setValues(updated);
    }
  }
  let nextCol = sh.getLastColumn() + 1;
  for (let i = 0; i < PIPELINE_NEW_HEADERS.length; i++) {
    const colName = PIPELINE_NEW_HEADERS[i];
    if (headers.indexOf(colName) === -1) {
      sh.getRange(1, nextCol).setValue(colName);
      sh.getRange(1, nextCol).setFontWeight("bold");
      addedColumns.push(colName);
      nextCol++;
    }
  }
  return { ok: true, source: PIPELINE_SOURCE, renamed: renamed, rewrittenInbox: rewrittenInbox, addedColumns: addedColumns };
}
