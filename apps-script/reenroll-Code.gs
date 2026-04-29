/**
 * River Tech — Re-Enrollment 2026-27 Backend
 * Google Apps Script web app for currently-enrolled families re-enrolling
 * for 2026-27. Stripped-down cousin of school-Code.gs: no Drive uploads
 * (photo + report card dropped), no intake/discovery fields.
 *
 * Deploy with:
 *   Deploy > New deployment > Type: Web app
 *   Execute as: Me (learn@rivertech.me)
 *   Who has access: Anyone
 *
 * Per submission:
 *   1. Append a row to the "Re-Enrollments" sheet.
 *   2. Create a Stripe Checkout Session for the Household Re-Enrollment Fee.
 *   3. Email the parent + notify admin.
 *   4. Return { ok, checkoutUrl, registrationId } to the browser.
 *
 * Script Properties required:
 *   SHEET_ID           — Google Sheet ID (My Drive / RTS Website Forms /)
 *   STRIPE_SECRET_KEY  — sk_live_... (same key as Full-Time; see SECRETS.md)
 *
 * Fee swap:
 *   Flipped 200 → 250 on 2026-04-29 (early-bird window closed Saturday
 *   2026-04-25 at 3:00 PM Pacific). HOUSEHOLD_FEE_USD here, HOUSEHOLD_FEE in
 *   the JS, hero banner copy, and meta description all moved together.
 *   No auto-swap by design — keeps the audit trail clean.
 */

// ---- Config helpers -----------------------------------------------------
function cfg(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

const NOTIFY_EMAILS = ["learn@rivertech.me", "dhegelund@gmail.com"];
const SCHOOL_NAME = "River Tech School of Performing Arts & Technology";
const FORM_PAGE_URL = "https://www.rivertechschool.com/pages/register-school-reenroll-2026-27.html";
const SUCCESS_URL = "https://www.rivertechschool.com/pages/register-school-reenroll-2026-27-success.html?session_id={CHECKOUT_SESSION_ID}";
const CANCEL_URL = "https://www.rivertechschool.com/pages/register-school-reenroll-2026-27.html";

// Household Re-Enrollment Fee. Flipped 200 → 250 on 2026-04-29 after the
// early-bird window closed. See header comment on "Fee swap".
const HOUSEHOLD_FEE_USD = 250;

// Sheet columns: 34 family + (10 per child × 6) = 94 columns.
const MAX_CHILDREN = 6;
const CHILD_COLS = 10;

// ---- Web-app entrypoints -----------------------------------------------
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const result = handleReenrollment(payload);
    return json_(result);
  } catch (err) {
    Logger.log("doPost error: " + err + "\n" + (err.stack || ""));
    return json_({ ok: false, error: "Server error: " + err.message });
  }
}

function doGet() {
  return json_({ ok: true, message: "Re-Enrollment 2026-27 backend is alive." });
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---- Core handler -------------------------------------------------------
function handleReenrollment(p) {
  if (!p || !p.parent || !Array.isArray(p.children) || p.children.length === 0) {
    return { ok: false, error: "Re-enrollment data was incomplete." };
  }
  if (!p.releaseAgreed) {
    return { ok: false, error: "Release must be agreed to before submitting." };
  }
  if (p.children.length > MAX_CHILDREN) {
    return { ok: false, error: "Too many children in one submission (max " + MAX_CHILDREN + ")." };
  }

  const registrationId = "RE-" + Utilities.formatDate(new Date(), "America/Los_Angeles", "yyyyMMdd-HHmmss")
    + "-" + Math.floor(Math.random() * 1000).toString().padStart(3, "0");

  // 1. Write to Sheet
  writeToSheet_(registrationId, p);

  // 2. Create Stripe Checkout session
  const checkoutUrl = createStripeSession_(registrationId, p);

  // 3. Emails
  sendParentEmail_(registrationId, p);
  sendNotificationEmail_(registrationId, p);

  return { ok: true, registrationId: registrationId, checkoutUrl: checkoutUrl };
}

// ---- Sheet write --------------------------------------------------------
function writeToSheet_(registrationId, p) {
  const sheetId = cfg("SHEET_ID");
  if (!sheetId) throw new Error("SHEET_ID is not configured in Script Properties.");
  const ss = SpreadsheetApp.openById(sheetId);
  const sh = ss.getSheetByName("Re-Enrollments") || ss.getSheets()[0];

  // Auto-header on first write.
  if (sh.getLastRow() === 0) {
    const header = [
      "Registration ID", "Submitted (UTC)", "Status",
      "Parent 1 First", "Parent 1 Last", "Parent 1 Email", "Parent 1 Phone", "Parent 1 Address",
      "Parent 2 First", "Parent 2 Last", "Parent 2 Email", "Parent 2 Phone",
      "Emergency Name", "Emergency Relationship", "Emergency Phone", "Emergency Alt Phone",
      "Insurance Provider", "Insurance Primary Insured", "Insurance Policy", "Insurance Group",
      "Pickup 1 Name", "Pickup 1 Relationship", "Pickup 1 Phone",
      "Pickup 2 Name", "Pickup 2 Relationship", "Pickup 2 Phone",
      "Pickup 3 Name", "Pickup 3 Relationship", "Pickup 3 Phone",
      "Children Count", "Household Fee (USD)",
      "Signature", "Signature Date",
      "Release Agreed"
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
        "Child " + n + " Health",
        "Child " + n + " Notes for New Year"
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
    "Submitted (awaiting payment)",
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
    p.releaseAgreed ? "Yes" : "No"
  ];

  for (let i = 0; i < MAX_CHILDREN; i++) {
    const c = children[i];
    if (c) {
      row.push(
        ((c.firstName || "") + " " + (c.lastName || "")).trim(),
        c.preferredName || "",
        c.dob || "",
        c.gender || "",
        c.grade || "",
        c.schedule || "",
        c.livesWith || "",
        c.livesWithNotes || "",
        c.health || "",
        c.notesNewYear || ""
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
  const description = "River Tech Re-Enrollment 2026-27 — " + childNames +
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
    "metadata[enrollmentType]": "re-enrollment",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][product_data][name]": "River Tech Household Re-Enrollment Fee",
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

  const fee = p.householdFee || HOUSEHOLD_FEE_USD;

  const subject = "River Tech — we received your 2026-27 re-enrollment";
  const body = [
    "Hi " + (p.parent.firstName || "") + ",",
    "",
    "Welcome back. Thanks for re-enrolling " + kidsStr + " at River Tech for the 2026-27 school year.",
    "",
    "Your confirmation reference: " + registrationId,
    "Household Re-Enrollment Fee: $" + fee,
    "",
    "What happens next:",
    "• Once your Stripe payment is complete, your re-enrollment is logged and locked in.",
    "• We already have your intake information on file — no orientation call needed.",
    "• We'll follow up before the school year starts (Tuesday, September 1, 2026) with schedule confirmations, supply lists, and logistics.",
    "• Tuition is billed separately based on the schedule you chose.",
    "",
    "If anything we have on file has changed beyond what you just told us — custody, household, contacts — reply to this email or write learn@rivertech.me.",
    "",
    "Good to have you back.",
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

function sendNotificationEmail_(registrationId, p) {
  const fee = p.householdFee || HOUSEHOLD_FEE_USD;
  const subject = "[Re-Enrollment 26-27] " + (p.parent.firstName || "") + " " + (p.parent.lastName || "") +
    " — " + p.children.length + " child" + (p.children.length === 1 ? "" : "ren") + " — $" + fee;

  const childSummary = (p.children || []).map(function (c, i) {
    const lines = [
      "Child " + (i + 1) + ": " + (c.firstName || "") + " " + (c.lastName || "") +
        (c.preferredName ? " (goes by: " + c.preferredName + ")" : ""),
      "  DOB: " + (c.dob || "(not given)") + (c.gender ? " · Gender: " + c.gender : ""),
      "  Grade: " + (c.grade || "") + " · Schedule: " + (c.schedule || ""),
      "  Lives with: " + (c.livesWith || "") +
        (c.livesWithNotes ? " (" + c.livesWithNotes + ")" : "")
    ];
    if (c.health)        lines.push("  Health: " + c.health);
    if (c.notesNewYear)  lines.push("  Notes for new year: " + c.notesNewYear);
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
    "Re-enrollment for 2026-27 (current-family form).",
    "",
    "Reference: " + registrationId,
    "Submitted: " + (p.submittedAt || new Date().toISOString()),
    "Household Re-Enrollment Fee: $" + fee,
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
    "Release agreed: " + (p.releaseAgreed ? "Yes" : "No"),
    "",
    "Row appended to Re-Enrollments sheet. Payment status will remain 'Submitted (awaiting payment)' until the Stripe session completes."
  ].join("\n");

  try {
    MailApp.sendEmail({
      to: NOTIFY_EMAILS.join(","),
      subject: subject,
      body: body,
      name: "River Tech Re-Enrollments"
    });
  } catch (err) {
    Logger.log("Notification email failed: " + err);
  }
}

// ---- One-time setup helpers (run from the editor) ----------------------
/**
 * Run this once to create the Re-Enrollments Sheet.
 * Stores the new ID in Script Properties. Safe to re-run (idempotent).
 * No Drive folders needed — Re-Enrollment takes no file uploads.
 */
function setupReenrollBackend_ONCE() {
  const props = PropertiesService.getScriptProperties();

  // Sheet
  let sheetId = props.getProperty("SHEET_ID");
  if (!sheetId) {
    const ss = SpreadsheetApp.create("Re-Enrollment 2026-27");
    ss.getSheets()[0].setName("Re-Enrollments");
    sheetId = ss.getId();
    props.setProperty("SHEET_ID", sheetId);
    Logger.log("Created Sheet. ID: " + sheetId + " — URL: " + ss.getUrl());
    Logger.log("Move it into 'My Drive / RTS Website Forms /' manually.");
  } else {
    Logger.log("SHEET_ID already set: " + sheetId);
  }

  if (!props.getProperty("STRIPE_SECRET_KEY")) {
    Logger.log("⚠ STRIPE_SECRET_KEY not yet set — add it in Project Settings > Script Properties.");
    Logger.log("   Use the same live key as Full-Time (see SECRETS.md).");
  }
}

/**
 * Pretend-submit a re-enrollment to exercise the sheet, emails, and Stripe
 * session. Check Logger output and your inbox.
 */
function selfTest() {
  const fake = {
    submittedAt: new Date().toISOString(),
    schoolYear: "2026-27",
    formType: "reenrollment",
    parent: {
      firstName: "Test", lastName: "Family",
      email: Session.getActiveUser().getEmail() || "dhegelund@gmail.com",
      phone: "555-0200",
      address: "927 E Polston Ave, Post Falls, ID 83854"
    },
    parent2: null,
    emergency: {
      name: "Grandma Test", relationship: "Grandmother",
      phone: "555-0201", altPhone: ""
    },
    insurance: {
      provider: "Blue Cross", primary: "Test Family",
      policy: "BC99999999", group: ""
    },
    pickup: [
      { name: "Uncle Test", relationship: "Uncle", phone: "555-0202" },
      { name: "", relationship: "", phone: "" },
      { name: "", relationship: "", phone: "" }
    ],
    children: [
      {
        firstName: "Ada", lastName: "Family", preferredName: "Ada",
        dob: "2018-05-12", gender: "female",
        grade: "4", schedule: "double-major",
        livesWith: "both", livesWithNotes: "",
        health: "No known allergies.",
        notesNewYear: "Excited about piano this year."
      }
    ],
    householdFee: HOUSEHOLD_FEE_USD,
    totalAmount: HOUSEHOLD_FEE_USD,
    signature: "Test Family",
    signatureDate: Utilities.formatDate(new Date(), "America/Los_Angeles", "yyyy-MM-dd"),
    releaseAgreed: true
  };
  const r = handleReenrollment(fake);
  Logger.log(JSON.stringify(r, null, 2));
}

/** Utility: wipe all non-header rows. Only run manually for test cleanup. */
function deleteAllDataRows_TESTONLY() {
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty("SHEET_ID"));
  const sheet = ss.getSheetByName("Re-Enrollments");
  const last = sheet.getLastRow();
  if (last > 1) sheet.deleteRows(2, last - 1);
  Logger.log("Deleted data rows. Rows now: " + sheet.getLastRow());
}
