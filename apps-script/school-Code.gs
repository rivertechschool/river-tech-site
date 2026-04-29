/**
 * River Tech — Full-Time Enrollment 2026-27 Backend
 * Google Apps Script web app.
 *
 * Deploy with:
 *   Deploy > New deployment > Type: Web app
 *   Execute as: Me (learn@rivertech.me)
 *   Who has access: Anyone
 *
 * Per submission:
 *   1. Upload each child's photo + report card (if any) to Drive folders.
 *   2. Append a row to the Sheet (SHEET_ID) with file URLs embedded.
 *   3. Create a Stripe Checkout Session for the flat $250 Household
 *      Registration Fee.
 *   4. Email the parent + notify admin.
 *   5. Return { ok, checkoutUrl, registrationId } to the browser.
 *
 * Script Properties required:
 *   SHEET_ID           — Google Sheet ID (My Drive / RTS Website Forms /)
 *   STRIPE_SECRET_KEY  — sk_test_... for testing, sk_live_... for launch
 *   DRIVE_PHOTO_FOLDER_ID   — Drive folder for child photos
 *   DRIVE_REPORT_FOLDER_ID  — Drive folder for uploaded report cards
 */

// ---- Config helpers -----------------------------------------------------
function cfg(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

const NOTIFY_EMAILS = ["learn@rivertech.me", "dhegelund@gmail.com"];
const SCHOOL_NAME = "River Tech School of Performing Arts & Technology";
const FORM_PAGE_URL = "https://www.rivertechschool.com/pages/register-school-2026-27.html";
const SUCCESS_URL = "https://www.rivertechschool.com/pages/register-school-2026-27-success.html?session_id={CHECKOUT_SESSION_ID}";
const CANCEL_URL = "https://www.rivertechschool.com/pages/register-school-2026-27.html";

const HOUSEHOLD_FEE_USD = 250;

// Sheet columns: 35 family + (21 per child × 6) = 161 columns.
const MAX_CHILDREN = 6;
const CHILD_COLS = 21;

// ---- Pipeline (Enrollment-Review app) constants ------------------------
// Used by doGet?action=list / doPost?action=advance|migrate.
const PIPELINE_SOURCE = "full-time";
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
    // Default: form submission.
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
  return json_({ ok: true, message: "Full-Time 2026-27 backend is alive." });
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
  if (!p.cultureAgreed) {
    return { ok: false, error: "School culture acknowledgment must be agreed to before submitting." };
  }
  if (p.children.length > MAX_CHILDREN) {
    return { ok: false, error: "Too many children in one submission (max " + MAX_CHILDREN + ")." };
  }

  const registrationId = "RT-" + Utilities.formatDate(new Date(), "America/Los_Angeles", "yyyyMMdd-HHmmss")
    + "-" + Math.floor(Math.random() * 1000).toString().padStart(3, "0");

  // 1. Upload files to Drive first — collect URLs to embed in the sheet row.
  const photoUrls  = p.children.map(function (c, i) {
    return uploadFileToDrive_(c.photo, registrationId, i + 1, c.firstName, c.lastName, "photo");
  });
  const reportUrls = p.children.map(function (c, i) {
    return uploadFileToDrive_(c.reportCard, registrationId, i + 1, c.firstName, c.lastName, "report");
  });

  // 2. Write to Sheet
  writeToSheet_(registrationId, p, photoUrls, reportUrls);

  // 3. Create Stripe Checkout session
  const checkoutUrl = createStripeSession_(registrationId, p);

  // 4. Emails
  sendParentEmail_(registrationId, p);
  sendNotificationEmail_(registrationId, p, photoUrls, reportUrls);

  return { ok: true, registrationId: registrationId, checkoutUrl: checkoutUrl };
}

// ---- Drive file upload --------------------------------------------------
function uploadFileToDrive_(file, registrationId, childIdx, firstName, lastName, kind) {
  if (!file || !file.base64) return "";
  const folderKey = kind === "report" ? "DRIVE_REPORT_FOLDER_ID" : "DRIVE_PHOTO_FOLDER_ID";
  const folderId = cfg(folderKey);
  if (!folderId) {
    Logger.log(folderKey + " not configured — skipping " + kind + " upload.");
    return "";
  }
  try {
    const folder = DriveApp.getFolderById(folderId);
    const ext = extFromMime_(file.type) || extFromName_(file.name) || (kind === "report" ? "pdf" : "jpg");
    const cleanFirst = (firstName || "Child" + childIdx).replace(/[^A-Za-z0-9_-]/g, "");
    const cleanLast = (lastName || "").replace(/[^A-Za-z0-9_-]/g, "");
    const suffix = kind === "report" ? "_report" : "_photo";
    const filename = [registrationId, "c" + childIdx, cleanFirst, cleanLast]
      .filter(String).join("_") + suffix + "." + ext;
    const bytes = Utilities.base64Decode(file.base64);
    const mime = file.type || (kind === "report" ? "application/pdf" : "image/jpeg");
    const blob = Utilities.newBlob(bytes, mime, filename);
    const created = folder.createFile(blob);
    return created.getUrl();
  } catch (err) {
    Logger.log(kind + " upload failed for child " + childIdx + ": " + err);
    return "";
  }
}

function extFromMime_(mime) {
  if (!mime) return "";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/heic") return "heic";
  if (mime === "image/webp") return "webp";
  if (mime === "application/pdf") return "pdf";
  return "";
}

function extFromName_(name) {
  if (!name) return "";
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : "";
}

// ---- Sheet write --------------------------------------------------------
function writeToSheet_(registrationId, p, photoUrls, reportUrls) {
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
      "Emergency Name", "Emergency Relationship", "Emergency Phone", "Emergency Alt Phone",
      "Insurance Provider", "Insurance Primary Insured", "Insurance Policy", "Insurance Group",
      "Pickup 1 Name", "Pickup 1 Relationship", "Pickup 1 Phone",
      "Pickup 2 Name", "Pickup 2 Relationship", "Pickup 2 Phone",
      "Pickup 3 Name", "Pickup 3 Relationship", "Pickup 3 Phone",
      "Children Count", "Household Fee (USD)",
      "Signature", "Signature Date",
      "Release Agreed", "Culture Agreed"
    ];
    for (let n = 1; n <= MAX_CHILDREN; n++) {
      header.push(
        "Child " + n + " Name",
        "Child " + n + " Preferred Name",
        "Child " + n + " DOB",
        "Child " + n + " Gender",
        "Child " + n + " Grade",
        "Child " + n + " Schedule",
        "Child " + n + " Lives With",
        "Child " + n + " Lives With Notes",
        "Child " + n + " Interests — Academic",
        "Child " + n + " Interests — Arts",
        "Child " + n + " Interests — Technology",
        "Child " + n + " Interests — Sports",
        "Child " + n + " Interests — Other",
        "Child " + n + " Previous Schooling",
        "Child " + n + " Prev Schooling Other",
        "Child " + n + " Attitude",
        "Child " + n + " Health",
        "Child " + n + " Hopes",
        "Child " + n + " Notes",
        "Child " + n + " Photo URL",
        "Child " + n + " Report Card URL"
      );
    }
    sh.appendRow(header);
    sh.getRange(1, 1, 1, header.length).setFontWeight("bold");
    sh.setFrozenRows(1);
  }

  const children = p.children;
  const p2 = p.parent2 || {};
  const emer = p.emergency || {};
  const ins = p.insurance || {};
  const pickup = p.pickup || [];
  const pk = function (i) { return pickup[i] || {}; };

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
    emer.name || "",
    emer.relationship || "",
    emer.phone || "",
    emer.altPhone || "",
    ins.provider || "",
    ins.primary || "",
    ins.policy || "",
    ins.group || "",
    pk(0).name || "", pk(0).relationship || "", pk(0).phone || "",
    pk(1).name || "", pk(1).relationship || "", pk(1).phone || "",
    pk(2).name || "", pk(2).relationship || "", pk(2).phone || "",
    children.length,
    p.householdFee || HOUSEHOLD_FEE_USD,
    p.signature || "",
    p.signatureDate || "",
    p.releaseAgreed ? "Yes" : "No",
    p.cultureAgreed ? "Yes" : "No"
  ];

  for (let i = 0; i < MAX_CHILDREN; i++) {
    const c = children[i];
    if (c) {
      const interests = c.interests || {};
      row.push(
        ((c.firstName || "") + " " + (c.lastName || "")).trim(),
        c.preferredName || "",
        c.dob || "",
        c.gender || "",
        c.grade || "",
        c.schedule || "",
        c.livesWith || "",
        c.livesWithNotes || "",
        (interests.academic   || []).join(", "),
        (interests.arts       || []).join(", "),
        (interests.technology || []).join(", "),
        (interests.sports     || []).join(", "),
        (interests.other      || []).join(", "),
        (c.previousSchooling || []).join(", "),
        c.previousSchoolingOther || "",
        c.attitude || "",
        c.health || "",
        c.hopes || "",
        c.notes || "",
        photoUrls[i]  || "",
        reportUrls[i] || ""
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

  const amount = Math.round((p.householdFee || HOUSEHOLD_FEE_USD) * 100); // cents
  if (amount <= 0) throw new Error("Amount must be greater than zero.");

  const parentName = ((p.parent.firstName || "") + " " + (p.parent.lastName || "")).trim();
  const childNames = (p.children || [])
    .map(function (c) { return (c.preferredName || c.firstName || "").trim(); })
    .filter(String).join(", ");
  const childWord = p.children.length === 1 ? "child" : "children";
  const description = "River Tech Full-Time 2026-27 enrollment — " + childNames +
    " (" + p.children.length + " " + childWord + ")";

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
    "metadata[schoolYear]": p.schoolYear || "2026-27",
    "metadata[enrollmentType]": "full-time",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][product_data][name]": "River Tech Full-Time Household Registration Fee",
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
    .map(function (c) { return (c.preferredName || c.firstName || "").trim(); })
    .filter(String);
  const kidsStr = kidNames.length === 0 ? "your child" :
                  kidNames.length === 1 ? kidNames[0] :
                  kidNames.length === 2 ? kidNames[0] + " and " + kidNames[1] :
                  kidNames.slice(0, -1).join(", ") + ", and " + kidNames[kidNames.length - 1];

  const subject = "River Tech Full-Time 2026-27 — we received your enrollment";
  const body = [
    "Hi " + (p.parent.firstName || "") + ",",
    "",
    "Thanks for enrolling " + kidsStr + " full-time at River Tech for the 2026-27 school year. We have your details.",
    "",
    "Your confirmation reference: " + registrationId,
    "Household Registration Fee: $" + (p.householdFee || HOUSEHOLD_FEE_USD),
    "",
    "What happens next:",
    "• Once your Stripe payment is complete, your application is logged and locked in for review.",
    "• We will schedule a short welcome call with you within two weeks to walk through next steps.",
    "• We'll follow up before the school year starts (Tuesday, September 1, 2026) with class details, supply lists, and logistics.",
    "• Tuition is billed separately based on the schedule you chose.",
    "",
    "If you need to change anything — adjust an answer, add or drop a child, ask a question — reply to this email or write learn@rivertech.me.",
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

function sendNotificationEmail_(registrationId, p, photoUrls, reportUrls) {
  const subject = "[Full-Time 26-27] " + (p.parent.firstName || "") + " " + (p.parent.lastName || "") +
    " — " + p.children.length + " child" + (p.children.length === 1 ? "" : "ren") + " — $" + (p.householdFee || HOUSEHOLD_FEE_USD);

  const childSummary = (p.children || []).map(function (c, i) {
    const interests = c.interests || {};
    const allInt = [].concat(
      interests.academic || [], interests.arts || [], interests.technology || [],
      interests.sports || [], interests.other || []
    );
    const lines = [
      "Child " + (i + 1) + ": " + (c.firstName || "") + " " + (c.lastName || "") +
        (c.preferredName ? " (goes by: " + c.preferredName + ")" : ""),
      "  DOB: " + (c.dob || "(not given)") + (c.gender ? " · Gender: " + c.gender : ""),
      "  Grade: " + (c.grade || "") + " · Schedule: " + (c.schedule || ""),
      "  Lives with: " + (c.livesWith || "") +
        (c.livesWithNotes ? " (" + c.livesWithNotes + ")" : ""),
      "  Interests: " + (allInt.length ? allInt.join(", ") : "(none checked)"),
      "  Previous: " + ((c.previousSchooling || []).join(", ") || "(none)") +
        (c.previousSchoolingOther ? " (" + c.previousSchoolingOther + ")" : ""),
      "  Photo: " + (photoUrls[i] || "(none)"),
      "  Report card: " + (reportUrls[i] || "(none)")
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

  const emer = p.emergency || {};
  const ins = p.insurance || {};
  const pickup = p.pickup || [];
  const pickupLines = pickup
    .map(function (pk, i) {
      if (!pk || !pk.name) return null;
      return "  " + (i + 1) + ". " + pk.name +
             (pk.relationship ? " (" + pk.relationship + ")" : "") +
             (pk.phone ? " · " + pk.phone : "");
    })
    .filter(Boolean);

  const body = [
    "New full-time enrollment for 2026-27.",
    "",
    "Reference: " + registrationId,
    "Submitted: " + (p.submittedAt || new Date().toISOString()),
    "Household Registration Fee: $" + (p.householdFee || HOUSEHOLD_FEE_USD),
    "",
    "Parent 1: " + (p.parent.firstName || "") + " " + (p.parent.lastName || ""),
    "  Email: " + (p.parent.email || "") + " · Phone: " + (p.parent.phone || ""),
    "  Address: " + (p.parent.address || ""),
    "",
    parent2Lines.join("\n"),
    "",
    "Emergency: " + (emer.name || "") +
      (emer.relationship ? " (" + emer.relationship + ")" : "") +
      (emer.phone ? " · " + emer.phone : "") +
      (emer.altPhone ? " / alt: " + emer.altPhone : ""),
    "",
    "Insurance: " + (ins.provider || "") +
      (ins.policy ? " · Policy " + ins.policy : "") +
      (ins.group ? " · Group " + ins.group : "") +
      (ins.primary ? " · Primary insured: " + ins.primary : ""),
    "",
    "Authorized pickup:",
    pickupLines.length ? pickupLines.join("\n") : "  (none added)",
    "",
    childSummary,
    "",
    "Signature: " + (p.signature || "") + " · Date: " + (p.signatureDate || ""),
    "Release agreed: " + (p.releaseAgreed ? "Yes" : "No") +
      " · Culture agreed: " + (p.cultureAgreed ? "Yes" : "No"),
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
 * Run this once to create the enrollment Sheet + photo & report-card folders.
 * Stores the new IDs in Script Properties. Safe to re-run (idempotent
 * by folder/file name — rename the existing ones first if you want to
 * start fresh).
 */
function setupSchoolBackend_ONCE() {
  const props = PropertiesService.getScriptProperties();

  // Sheet
  let sheetId = props.getProperty("SHEET_ID");
  if (!sheetId) {
    const ss = SpreadsheetApp.create("Full-Time Enrollment 2026-27");
    ss.getSheets()[0].setName("Enrollments");
    sheetId = ss.getId();
    props.setProperty("SHEET_ID", sheetId);
    Logger.log("Created Sheet. ID: " + sheetId + " — URL: " + ss.getUrl());
    Logger.log("Move it into 'My Drive / RTS Website Forms /' manually.");
  } else {
    Logger.log("SHEET_ID already set: " + sheetId);
  }

  // Photos folder
  let photoId = props.getProperty("DRIVE_PHOTO_FOLDER_ID");
  if (!photoId) {
    const folder = DriveApp.createFolder("Full-Time 2026-27 — Child Photos");
    photoId = folder.getId();
    props.setProperty("DRIVE_PHOTO_FOLDER_ID", photoId);
    Logger.log("Created photos folder. ID: " + photoId + " — URL: " + folder.getUrl());
    Logger.log("Move it into 'My Drive / RTS Website Forms /' manually.");
  } else {
    Logger.log("DRIVE_PHOTO_FOLDER_ID already set: " + photoId);
  }

  // Report-card folder
  let reportId = props.getProperty("DRIVE_REPORT_FOLDER_ID");
  if (!reportId) {
    const folder = DriveApp.createFolder("Full-Time 2026-27 — Report Cards");
    reportId = folder.getId();
    props.setProperty("DRIVE_REPORT_FOLDER_ID", reportId);
    Logger.log("Created report-cards folder. ID: " + reportId + " — URL: " + folder.getUrl());
    Logger.log("Move it into 'My Drive / RTS Website Forms /' manually.");
  } else {
    Logger.log("DRIVE_REPORT_FOLDER_ID already set: " + reportId);
  }

  if (!props.getProperty("STRIPE_SECRET_KEY")) {
    Logger.log("⚠ STRIPE_SECRET_KEY not yet set — add it in Project Settings > Script Properties.");
  }
}

/**
 * Pretend-submit a registration to exercise the sheet, files (skipped —
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
    emergency: {
      name: "Grandma Test", relationship: "Grandmother",
      phone: "555-0101", altPhone: "555-0102"
    },
    insurance: {
      provider: "Blue Cross", primary: "Test Parent",
      policy: "BC12345678", group: "GRP001"
    },
    pickup: [
      { name: "Uncle Test", relationship: "Uncle", phone: "555-0103" },
      { name: "", relationship: "", phone: "" },
      { name: "", relationship: "", phone: "" }
    ],
    children: [
      {
        firstName: "Ada", lastName: "Parent", preferredName: "Ada",
        dob: "2018-05-12", gender: "female",
        grade: "3", schedule: "double-major",
        livesWith: "both", livesWithNotes: "",
        interests: {
          academic: ["math", "science"],
          arts: ["piano"],
          technology: ["coding"],
          sports: [],
          other: []
        },
        previousSchooling: ["homeschool"], previousSchoolingOther: "",
        attitude: "Curious and focused.",
        health: "No known allergies.",
        hopes: "Wants to learn piano and make friends.",
        notes: "",
        photo: null,
        reportCard: null
      }
    ],
    householdFee: HOUSEHOLD_FEE_USD,
    totalAmount: HOUSEHOLD_FEE_USD,
    signature: "Test Parent",
    signatureDate: Utilities.formatDate(new Date(), "America/Los_Angeles", "yyyy-MM-dd"),
    releaseAgreed: true,
    cultureAgreed: true
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
  // Locate Pipeline Stage column. Pre-migration fallback: "Status".
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
  // Step 1: rename "Status" → "Pipeline Stage"
  const statusIdx = headers.indexOf("Status");
  if (statusIdx >= 0) {
    sh.getRange(1, statusIdx + 1).setValue("Pipeline Stage");
    headers[statusIdx] = "Pipeline Stage";
    renamed = true;
  }
  // Step 2: rewrite "Submitted (awaiting payment)" → "Inbox" in Pipeline Stage column
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
  // Step 3: append new column headers if missing
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
