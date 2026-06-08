/**
 * River Tech — Apply Tax Credit to Tuition (2026-27) Backend
 * Google Apps Script web app. Deploy with:
 *   Deploy > New deployment > Type: Web app
 *   Execute as: Me (learn@rivertech.me)
 *   Who has access: Anyone
 *
 * Receives a family's tax-credit tuition choice, writes one row per
 * submission to the Sheet, emails the family a confirmation, and notifies
 * staff. No payment processing — invoices are sent separately by Dan.
 *
 * Script Properties (Project Settings > Script Properties):
 *   SHEET_ID — Google Sheet ID for "Tax Credit Tuition Choices 2026-27"
 */

// ---- Config -------------------------------------------------------------
function cfg(key) { return PropertiesService.getScriptProperties().getProperty(key); }

const NOTIFY_EMAILS = ["learn@rivertech.me", "dhegelund@gmail.com"];
const SCHOOL_NAME = "River Tech School of Performing Arts & Technology";
const FORM_PAGE_URL = "https://www.rivertechschool.com/pages/register-tax-credit-2026-27.html";
const SHEET_TAB_NAME = "Choices";
const MAX_CHILDREN = 6;

const PLAN_LABEL = { quarterly: "Quarterly", annual: "Annual", monthly: "Monthly" };
const PERIOD_WORD = { quarterly: "quarter", annual: "year", monthly: "month" };

// ---- Web-app entrypoints ------------------------------------------------
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    return json_(handleSubmission(payload));
  } catch (err) {
    Logger.log("doPost error: " + err + "\n" + (err && err.stack));
    return json_({ ok: false, error: "Server error: " + err.message });
  }
}

function doGet() {
  return json_({ ok: true, message: "Tax Credit Tuition Choices backend is alive.", form: "tax-credit-tuition" });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---- Core handler -------------------------------------------------------
function handleSubmission(p) {
  if (!p || !p.parent || !p.parent.name || !p.parent.email || !p.parent.phone) {
    return { ok: false, error: "Parent/guardian information is incomplete." };
  }
  const kids = (p.children || []).filter(function (c) { return c && c.firstName && c.program; });
  if (kids.length === 0) return { ok: false, error: "Please add at least one child with a program." };
  if (!p.cadence || !PLAN_LABEL[p.cadence]) return { ok: false, error: "Please choose a payment plan." };
  if (p.decision !== "apply" && p.decision !== "keep") return { ok: false, error: "Please choose your credit option." };
  if (p.specialSituation && !p.specialDetails) return { ok: false, error: "Please describe your special situation." };

  const registrationId = "TC-" + Utilities.formatDate(new Date(), "America/Los_Angeles", "yyyyMMdd-HHmmss")
    + "-" + Math.floor(Math.random() * 1000).toString().padStart(3, "0");

  writeToSheet_(registrationId, p, kids);
  sendParentEmail_(registrationId, p, kids);
  sendNotificationEmail_(registrationId, p, kids);

  return { ok: true, registrationId: registrationId };
}

// ---- Sheet write --------------------------------------------------------
function headerRow_() {
  const head = [
    "Reference ID", "Submitted (UTC)", "School Year",
    "Parent Name", "Parent Email", "Parent Phone",
    "Decision", "Payment Plan",
    "Credit Applied", "Year Total", "Remaining Balance", "Per-Period", "Periods",
    "Special Situation", "Special Details", "Notes",
    "Children Count"
  ];
  for (let i = 1; i <= MAX_CHILDREN; i++) {
    head.push("Child " + i + " Name");
    head.push("Child " + i + " Program");
  }
  head.push("Status");
  return head;
}

function writeToSheet_(registrationId, p, kids) {
  const sheetId = cfg("SHEET_ID");
  if (!sheetId) throw new Error("SHEET_ID is not configured in Script Properties.");
  const ss = SpreadsheetApp.openById(sheetId);
  let sh = ss.getSheetByName(SHEET_TAB_NAME) || ss.insertSheet(SHEET_TAB_NAME);

  if (sh.getLastRow() === 0) {
    const header = headerRow_();
    sh.appendRow(header);
    sh.getRange(1, 1, 1, header.length).setFontWeight("bold");
    sh.setFrozenRows(1);
  }

  const decision = p.decision === "apply" ? "Apply credit" : "Keep credit (regular)";
  const row = [
    registrationId,
    p.submittedAt || new Date().toISOString(),
    p.schoolYear || "2026-27",
    p.parent.name, p.parent.email, p.parent.phone,
    decision, PLAN_LABEL[p.cadence] || p.cadence,
    p.creditApplied || 0, p.yearTotal || 0, p.remaining || 0, p.perPeriod || 0, p.periods || 0,
    p.specialSituation ? "Yes" : "", p.specialDetails || "", p.notes || "",
    kids.length
  ];
  for (let i = 0; i < MAX_CHILDREN; i++) {
    if (kids[i]) {
      row.push((kids[i].firstName + " " + (kids[i].lastName || "")).trim());
      row.push(kids[i].program === "5-day" ? "5-Day" : (kids[i].program === "4-day" ? "4-Day" : kids[i].program));
    } else {
      row.push(""); row.push("");
    }
  }
  row.push(p.specialSituation ? "Needs follow-up" : "Submitted");
  sh.appendRow(row);
}

// ---- Helpers ------------------------------------------------------------
function money_(n) {
  n = Number(n) || 0;
  const hasCents = Math.abs(n - Math.round(n)) > 0.001;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: 2 });
}

function planSummaryLines_(p) {
  const word = PERIOD_WORD[p.cadence];
  const lines = [];
  if (p.decision === "apply") {
    if (p.cadence === "annual") {
      lines.push("One invoice for the full year: " + money_(p.yearTotal) + ".");
      lines.push("Your credit of " + money_(p.creditApplied) + " covers most of it, leaving " + money_(p.remaining) + " from you.");
    } else {
      lines.push("We'll invoice your credit of " + money_(p.creditApplied) + " up front,");
      lines.push("then " + money_(p.perPeriod) + " per " + word + " (" + p.periods + " payments, " + money_(p.remaining) + " total).");
    }
  } else {
    if (p.cadence === "annual") {
      lines.push("Regular tuition, one invoice for the year: " + money_(p.yearTotal) + ".");
    } else {
      lines.push("Regular tuition: " + money_(p.perPeriod) + " per " + word + " (" + p.periods + " payments, " + money_(p.yearTotal) + " total).");
    }
  }
  return lines;
}

// ---- Emails -------------------------------------------------------------
function sendParentEmail_(registrationId, p, kids) {
  const first = (p.parent.name || "").split(" ")[0] || "there";
  const childList = kids.map(function (c) {
    return "  • " + (c.firstName + " " + (c.lastName || "")).trim() + " — " + (c.program === "5-day" ? "5-Day" : "4-Day") + " School";
  });

  let lines = [
    "Hi " + first + ",",
    "",
    "Thank you for letting us know how you'd like to apply your Idaho Parental Choice Tax Credit toward 2026–27 tuition. Here's what we have:",
    "",
    "Plan: " + (PLAN_LABEL[p.cadence] || p.cadence)
  ];
  lines = lines.concat(planSummaryLines_(p).map(function (l) { return "  " + l; }));
  lines.push("");
  lines.push("Children:");
  lines = lines.concat(childList);
  lines.push("");
  lines.push("Confirmation reference: " + registrationId);
  lines.push("");
  if (p.specialSituation) {
    lines.push("You flagged a special situation. Since we're a small team, the fastest way to sort it out is to email us directly at learn@rivertech.me and we'll take it from there.");
    lines.push("");
  }
  lines.push("We'll send your invoice to this email address. No payment was taken through the form.");
  lines.push("Questions? Just reply to this email.");
  lines.push("");
  lines.push(SCHOOL_NAME);
  lines.push("927 E Polston Ave, Post Falls, ID 83854");

  try {
    MailApp.sendEmail({
      to: p.parent.email,
      replyTo: "learn@rivertech.me",
      subject: "Your tax credit & tuition choice — received (" + registrationId + ")",
      body: lines.join("\n"),
      name: "River Tech School"
    });
  } catch (err) { Logger.log("Parent email failed: " + err); }
}

function sendNotificationEmail_(registrationId, p, kids) {
  const flag = p.specialSituation ? "[FOLLOW-UP] " : "";
  const childList = kids.map(function (c) {
    return "  • " + (c.firstName + " " + (c.lastName || "")).trim() + " — " + (c.program === "5-day" ? "5-Day" : "4-Day");
  });
  let lines = [
    "New tax-credit tuition choice submitted.",
    "",
    "Reference: " + registrationId,
    "Submitted: " + (p.submittedAt || new Date().toISOString()),
    "",
    "Parent: " + p.parent.name,
    "Email:  " + p.parent.email,
    "Phone:  " + p.parent.phone,
    "",
    "Decision: " + (p.decision === "apply" ? "APPLY credit" : "KEEP credit (regular price)"),
    "Plan: " + (PLAN_LABEL[p.cadence] || p.cadence)
  ];
  lines = lines.concat(planSummaryLines_(p).map(function (l) { return "  " + l; }));
  lines.push("");
  lines.push("Credit applied: " + money_(p.creditApplied) + " | Year total: " + money_(p.yearTotal) + " | Remaining: " + money_(p.remaining));
  lines.push("");
  lines.push("Children:");
  lines = lines.concat(childList);
  if (p.specialSituation) {
    lines.push("");
    lines.push("SPECIAL SITUATION: " + p.specialDetails);
  }
  if (p.notes) {
    lines.push("");
    lines.push("Notes: " + p.notes);
  }
  lines.push("");
  lines.push("Row appended to the Tax Credit Tuition Choices sheet.");

  try {
    MailApp.sendEmail({
      to: NOTIFY_EMAILS.join(","),
      subject: flag + "[Tax Credit] " + p.parent.name + " — " + (p.decision === "apply" ? "Apply" : "Keep") + " / " + (PLAN_LABEL[p.cadence] || p.cadence),
      body: lines.join("\n"),
      name: "River Tech Forms"
    });
  } catch (err) { Logger.log("Notification email failed: " + err); }
}

// ---- Setup & self-test --------------------------------------------------
/**
 * Run ONCE from the editor (Run > setupSheet). Creates the backing sheet
 * owned by this account (learn@rivertech.me), writes the header row, and
 * stores its ID in Script Properties. Safe to re-run — it no-ops if already set.
 */
function setupSheet() {
  const existing = cfg("SHEET_ID");
  if (existing) { Logger.log("SHEET_ID already set: " + existing); return existing; }
  const ss = SpreadsheetApp.create("Tax Credit Tuition Choices 2026-27");
  const sh = ss.getSheets()[0];
  sh.setName(SHEET_TAB_NAME);
  const header = headerRow_();
  sh.appendRow(header);
  sh.getRange(1, 1, 1, header.length).setFontWeight("bold");
  sh.setFrozenRows(1);
  PropertiesService.getScriptProperties().setProperty("SHEET_ID", ss.getId());
  Logger.log("Created sheet: " + ss.getUrl());
  Logger.log("SHEET_ID: " + ss.getId());
  return ss.getId();
}

function verifyConfig() {
  const sheetId = cfg("SHEET_ID");
  Logger.log("SHEET_ID set: " + !!sheetId);
  if (sheetId) {
    try { Logger.log("Sheet name: " + SpreadsheetApp.openById(sheetId).getName()); }
    catch (e) { Logger.log("Cannot open sheet: " + e.message); }
  }
}

function selfTest() {
  const fake = {
    submittedAt: new Date().toISOString(),
    formType: "tax-credit-tuition",
    schoolYear: "2026-27",
    parent: { name: "Test Parent", email: Session.getActiveUser().getEmail() || "dhegelund@gmail.com", phone: "208-555-0100" },
    children: [{ firstName: "Amy", lastName: "Parent", program: "5-day" }],
    cadence: "quarterly", decision: "apply",
    creditApplied: 5000, yearTotal: 7800, remaining: 2800, perPeriod: 700, periods: 4,
    specialSituation: false, specialDetails: "", notes: ""
  };
  Logger.log(JSON.stringify(handleSubmission(fake), null, 2));
}
