/**
 * River Tech — Scholarship Application 2026-27 Backend
 * Google Apps Script web app for families requesting need-based tuition
 * assistance for 2026-27. Thin cousin of reenroll-Code.gs: no Drive uploads,
 * no emergency/insurance/pickup blocks. Collects child basics, parent
 * contacts, the level of assistance needed, an optional hardship narrative,
 * volunteer status, consent, and a typed signature.
 *
 * Deploy with:
 *   Deploy > New deployment > Type: Web app
 *   Execute as: Me (learn@rivertech.me)
 *   Who has access: Anyone
 *
 * Per submission:
 *   1. Append a row to the "Scholarships" sheet (Status = awaiting payment).
 *   2. Create a Stripe Checkout Session for the flat $20 processing fee.
 *   3. Email the applicant + notify admin.
 *   4. Return { ok, checkoutUrl, registrationId } to the browser.
 *
 * Script Properties required:
 *   SHEET_ID            — Google Sheet ID (created by ?action=setupSheet)
 *   STRIPE_SECRET_KEY   — sk_live_... (same key as the other forms; SECRETS.md)
 * Optional:
 *   STRIPE_WEBHOOK_SECRET — enables ?action=stripeWebhook auto-flip to Paid.
 *
 * Bootstrap the sheet WITHOUT the editor run-picker:
 *   GET <webapp>/exec?action=setupSheet
 *   (idempotent — once SHEET_ID is set it just reports the existing ID)
 */

// ---- Config -------------------------------------------------------------
function cfg(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

const NOTIFY_EMAILS = ["learn@rivertech.me", "dhegelund@gmail.com"];
const SCHOOL_NAME = "River Tech School of Performing Arts & Technology";
const SHEET_NAME = "Scholarship 2026-27";
const SHEET_TAB_NAME = "Scholarships";
const FORM_PAGE_URL = "https://www.rivertechschool.com/pages/register-scholarship-2026-27.html";
const SUCCESS_URL = "https://www.rivertechschool.com/pages/register-scholarship-2026-27-success.html?session_id={CHECKOUT_SESSION_ID}";
const CANCEL_URL = "https://www.rivertechschool.com/pages/register-scholarship-2026-27.html";

// Flat, non-refundable application processing fee.
const PROCESSING_FEE_USD = 20;

const MAX_CHILDREN = 6;
const CHILD_COLS = 5; // Name, DOB, Gender, Grade, Program

// Human-readable labels for the coded radio/select values.
const ASSISTANCE_LABELS = {
  "up-to-10":     "Up to 10% of tuition",
  "11-20":        "Between 11% and 20% of tuition",
  "more-than-20": "More than 20% of tuition",
  "unsure":       "Not sure yet"
};
const VOLUNTEER_LABELS = {
  "currently": "Currently volunteers at River Tech",
  "willing":   "Willing and able to volunteer this year",
  "limited":   "Would like to help in limited ways",
  "unable":    "Not able to volunteer right now"
};
const PROGRAM_LABELS = {
  "performing-arts": "Performing Arts Major (Mon–Thu)",
  "technology":      "Technology Major (Tue–Fri)",
  "double-major":    "Double Major (Mon–Fri)",
  "a-la-carte":      "À La Carte / Homeschool days",
  "undecided":       "Not sure yet"
};
function label_(map, key) { return map[key] || key || ""; }

// ---- Web-app entrypoints -----------------------------------------------
function doPost(e) {
  try {
    const params = (e && e.parameter) || {};
    if (params.action === "stripeWebhook") return json_(scholarshipStripeWebhook_(e));
    const payload = JSON.parse(e.postData.contents);
    return json_(handleScholarship(payload));
  } catch (err) {
    Logger.log("doPost error: " + err + "\n" + (err.stack || ""));
    return json_({ ok: false, error: "Server error: " + err.message });
  }
}

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.action === "setupSheet") return json_(setupSheet_());
  return json_({ ok: true, message: "Scholarship 2026-27 backend is alive." });
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---- Core handler -------------------------------------------------------
function handleScholarship(p) {
  if (!p || !p.parent || !Array.isArray(p.children) || p.children.length === 0) {
    return { ok: false, error: "Application data was incomplete." };
  }
  if (!p.consentAgreed) {
    return { ok: false, error: "Consent must be agreed to before submitting." };
  }
  if (p.children.length > MAX_CHILDREN) {
    return { ok: false, error: "Too many children in one application (max " + MAX_CHILDREN + ")." };
  }

  const registrationId = "SCH-" + Utilities.formatDate(new Date(), "America/Los_Angeles", "yyyyMMdd-HHmmss")
    + "-" + Math.floor(Math.random() * 1000).toString().padStart(3, "0");

  writeToSheet_(registrationId, p);
  const checkoutUrl = createStripeSession_(registrationId, p);
  sendApplicantEmail_(registrationId, p);
  sendNotificationEmail_(registrationId, p);

  return { ok: true, registrationId: registrationId, checkoutUrl: checkoutUrl };
}

// ---- Sheet write --------------------------------------------------------
function getSheet_() {
  const sheetId = cfg("SHEET_ID");
  if (!sheetId) throw new Error("SHEET_ID is not configured. Call ?action=setupSheet first.");
  const ss = SpreadsheetApp.openById(sheetId);
  return ss.getSheetByName(SHEET_TAB_NAME) || ss.getSheets()[0];
}

function writeToSheet_(registrationId, p) {
  const sh = getSheet_();

  if (sh.getLastRow() === 0) {
    const header = [
      "Registration ID", "Submitted (UTC)", "Status",
      "Parent 1 Name", "Parent 1 Email", "Parent 1 Phone",
      "Parent 2 Name", "Parent 2 Email", "Parent 2 Phone",
      "Assistance Level", "Assistance Notes", "Financial Hardship",
      "Volunteer Status", "Volunteer Notes",
      "Children Count", "Processing Fee (USD)",
      "Signature", "Signature Date", "Consent Agreed"
    ];
    for (let n = 1; n <= MAX_CHILDREN; n++) {
      header.push(
        "Child " + n + " Name",
        "Child " + n + " DOB",
        "Child " + n + " Gender",
        "Child " + n + " Grade",
        "Child " + n + " Program"
      );
    }
    sh.appendRow(header);
    sh.getRange(1, 1, 1, header.length).setFontWeight("bold");
    sh.setFrozenRows(1);
  }

  const children = p.children || [];
  const p2 = p.parent2 || {};

  const row = [
    registrationId,
    p.submittedAt || new Date().toISOString(),
    "Submitted (awaiting payment)",
    p.parent.name  || "",
    p.parent.email || "",
    p.parent.phone || "",
    p2.name  || "",
    p2.email || "",
    p2.phone || "",
    label_(ASSISTANCE_LABELS, p.assistanceLevel),
    p.assistanceNotes || "",
    p.hardship || "",
    label_(VOLUNTEER_LABELS, p.volunteerStatus),
    p.volunteerNotes || "",
    children.length,
    p.processingFee || PROCESSING_FEE_USD,
    p.signature || "",
    p.signatureDate || "",
    p.consentAgreed ? "Yes" : "No"
  ];

  for (let i = 0; i < MAX_CHILDREN; i++) {
    const c = children[i];
    if (c) {
      row.push(
        ((c.firstName || "") + " " + (c.lastName || "")).trim(),
        c.dob || "",
        c.gender || "",
        c.grade || "",
        label_(PROGRAM_LABELS, c.program)
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

  const amount = Math.round((p.processingFee || PROCESSING_FEE_USD) * 100); // cents
  if (amount <= 0) throw new Error("Amount must be greater than zero.");

  const childNames = (p.children || [])
    .map(function (c) { return (c.firstName || "").trim(); })
    .filter(String).join(", ");
  const childWord = p.children.length === 1 ? "child" : "children";
  const description = "River Tech Scholarship Application 2026-27 — " + childNames +
    " (" + p.children.length + " " + childWord + ")";

  const params = {
    "mode": "payment",
    "success_url": SUCCESS_URL,
    "cancel_url": CANCEL_URL,
    "customer_email": p.parent.email,
    "client_reference_id": registrationId,
    "metadata[registrationId]": registrationId,
    "metadata[parentName]": p.parent.name || "",
    "metadata[parentEmail]": p.parent.email || "",
    "metadata[parentPhone]": p.parent.phone || "",
    "metadata[childCount]": String(p.children.length),
    "metadata[schoolYear]": p.schoolYear || "2026-27",
    "metadata[applicationType]": "scholarship",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][product_data][name]": "River Tech Scholarship Application Fee",
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
  return JSON.parse(body).url;
}

// ---- Emails -------------------------------------------------------------
function childNamesPretty_(p) {
  const names = (p.children || [])
    .map(function (c) { return (c.firstName || "").trim(); })
    .filter(String);
  if (names.length === 0) return "your child";
  if (names.length === 1) return names[0];
  if (names.length === 2) return names[0] + " and " + names[1];
  return names.slice(0, -1).join(", ") + ", and " + names[names.length - 1];
}

function sendApplicantEmail_(registrationId, p) {
  const fee = p.processingFee || PROCESSING_FEE_USD;
  const subject = "River Tech — we received your 2026-27 scholarship application";
  const body = [
    "Hi " + (p.parent.name || "") + ",",
    "",
    "Thank you for applying for a River Tech scholarship for " + childNamesPretty_(p) + " for the 2026-27 school year.",
    "",
    "Your confirmation reference: " + registrationId,
    "Application processing fee: $" + fee + " (non-refundable)",
    "",
    "What happens next:",
    "• Once your $" + fee + " payment is complete, your application is logged and held on file.",
    "• All applications are reviewed together in late July, once enrollment for the year has taken shape.",
    "• You'll receive an email then with the decision and next steps. Additional documentation (e.g. proof of hardship) may be requested if your application advances.",
    "",
    "A reminder that Idaho's Parental Choice Tax Credit (up to $5,000 per child) is the starting point for every family — our scholarship bridges remaining need where we can.",
    "",
    "Questions in the meantime? Just reply to this email or write learn@rivertech.me.",
    "",
    "With gratitude,",
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
    Logger.log("Applicant email failed: " + err);
  }
}

function sendNotificationEmail_(registrationId, p) {
  const fee = p.processingFee || PROCESSING_FEE_USD;
  const subject = "[Scholarship 26-27] " + (p.parent.name || "") +
    " — " + p.children.length + " child" + (p.children.length === 1 ? "" : "ren") +
    " — " + label_(ASSISTANCE_LABELS, p.assistanceLevel);

  const childSummary = (p.children || []).map(function (c, i) {
    return [
      "Child " + (i + 1) + ": " + (c.firstName || "") + " " + (c.lastName || ""),
      "  DOB: " + (c.dob || "(not given)") + (c.gender ? " · Gender: " + c.gender : ""),
      "  Grade: " + (c.grade || "") + " · Program: " + label_(PROGRAM_LABELS, c.program)
    ].join("\n");
  }).join("\n\n");

  const p2 = p.parent2 || null;
  const parent2Lines = p2 ? [
    "Parent 2: " + (p2.name || ""),
    "  Email: " + (p2.email || "") + " · Phone: " + (p2.phone || "")
  ] : ["Parent 2: (not added)"];

  const body = [
    "Scholarship application for 2026-27.",
    "",
    "Reference: " + registrationId,
    "Submitted: " + (p.submittedAt || new Date().toISOString()),
    "Processing fee: $" + fee + " (awaiting payment until Stripe completes)",
    "",
    "Parent 1: " + (p.parent.name || ""),
    "  Email: " + (p.parent.email || "") + " · Phone: " + (p.parent.phone || ""),
    "",
    parent2Lines.join("\n"),
    "",
    "Assistance needed: " + label_(ASSISTANCE_LABELS, p.assistanceLevel),
    p.assistanceNotes ? "Assistance notes: " + p.assistanceNotes : "Assistance notes: (none)",
    "",
    "Financial hardship: " + (p.hardship || "(none provided)"),
    "",
    "Volunteer status: " + label_(VOLUNTEER_LABELS, p.volunteerStatus),
    p.volunteerNotes ? "Volunteer notes: " + p.volunteerNotes : "Volunteer notes: (none)",
    "",
    childSummary,
    "",
    "Signature: " + (p.signature || "") + " · Date: " + (p.signatureDate || ""),
    "Consent agreed: " + (p.consentAgreed ? "Yes" : "No"),
    "",
    "Row appended to the Scholarships sheet. Status stays 'Submitted (awaiting payment)' until the Stripe session completes."
  ].join("\n");

  try {
    MailApp.sendEmail({
      to: NOTIFY_EMAILS.join(","),
      subject: subject,
      body: body,
      name: "River Tech Scholarships"
    });
  } catch (err) {
    Logger.log("Notification email failed: " + err);
  }
}

// ---- Setup (curl-triggerable, no editor run-picker needed) -------------
function setupSheet_() {
  const props = PropertiesService.getScriptProperties();
  let sheetId = props.getProperty("SHEET_ID");
  if (sheetId) {
    return { ok: true, message: "SHEET_ID already set.", sheetId: sheetId };
  }
  const ss = SpreadsheetApp.create(SHEET_NAME);
  ss.getSheets()[0].setName(SHEET_TAB_NAME);
  sheetId = ss.getId();
  props.setProperty("SHEET_ID", sheetId);
  Logger.log("Created Sheet. ID: " + sheetId + " — URL: " + ss.getUrl());
  return {
    ok: true,
    message: "Created sheet '" + SHEET_NAME + "'. Move it into 'My Drive / RTS Website Forms /' and share with dhegelund@gmail.com.",
    sheetId: sheetId,
    url: ss.getUrl(),
    stripeKeySet: !!props.getProperty("STRIPE_SECRET_KEY")
  };
}

/** Editor-run alternative to the GET endpoint above. */
function setupScholarshipBackend_ONCE() {
  Logger.log(JSON.stringify(setupSheet_(), null, 2));
}

/** Pretend-submit to exercise sheet + emails + Stripe. Run from editor. */
function selfTest() {
  const fake = {
    submittedAt: new Date().toISOString(),
    schoolYear: "2026-27",
    parent: { name: "Test Applicant", email: Session.getActiveUser().getEmail() || "dhegelund@gmail.com", phone: "555-0300" },
    parent2: null,
    children: [
      { firstName: "Ada", lastName: "Test", dob: "2018-05-12", gender: "female", grade: "4", program: "double-major" }
    ],
    assistanceLevel: "11-20",
    assistanceNotes: "",
    hardship: "Reduced hours at work this year.",
    volunteerStatus: "willing",
    volunteerNotes: "Can help with events.",
    consentAgreed: true,
    signature: "Test Applicant",
    signatureDate: Utilities.formatDate(new Date(), "America/Los_Angeles", "yyyy-MM-dd"),
    processingFee: PROCESSING_FEE_USD,
    totalAmount: PROCESSING_FEE_USD
  };
  Logger.log(JSON.stringify(handleScholarship(fake), null, 2));
}

/** Utility: wipe all non-header rows. Only run manually for test cleanup. */
function deleteAllDataRows_TESTONLY() {
  const sh = getSheet_();
  const last = sh.getLastRow();
  if (last > 1) sh.deleteRows(2, last - 1);
  Logger.log("Deleted data rows. Rows now: " + sh.getLastRow());
}

// ---- Stripe webhook (optional — flips Status to Paid) ------------------
function scholarshipStripeWebhook_(e) {
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

  const sh = getSheet_();
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) return { ok: false, error: "Sheet empty" };
  const all = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = all[0];
  const statusIdx = headers.indexOf("Status");
  if (statusIdx < 0) return { ok: false, error: "Status column not found" };

  for (let r = 1; r < all.length; r++) {
    if (String(all[r][0]) === String(regId)) {
      const current = String(all[r][statusIdx] || "");
      if (/^paid$/i.test(current)) return { ok: true, message: "Already Paid (idempotent)", regId: regId };
      sh.getRange(r + 1, statusIdx + 1).setValue("Paid");
      Logger.log("stripeWebhook: marked " + regId + " Paid (event " + event.id + ")");
      return { ok: true, regId: regId, newStatus: "Paid", eventId: event.id };
    }
  }
  return { ok: false, error: "regId not found: " + regId };
}
