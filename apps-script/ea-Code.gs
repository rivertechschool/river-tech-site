/**
 * River Tech — Executive Assistant Applications Backend
 * Google Apps Script web app for the AI-Fluent Executive Assistant role, 2026-27.
 * Cousin of teach-Code.gs: NO Stripe, NO uploads. Collects applicant contact +
 * connection, AI-agent fluency (tools / length / described experience / proof),
 * a writing sample, skills + education, forward-thinking notes, a Christian-faith
 * affirmation, logistics (hours / work mode / start / background-check
 * willingness), and consent + typed signature.
 *
 * Deploy with:
 *   Deploy > New deployment > Type: Web app
 *   Execute as: Me (learn@rivertech.me)
 *   Who has access: Anyone
 *
 * Per submission:
 *   1. Append a row to the "Applicants" sheet (Stage = New).
 *   2. Email the applicant a confirmation + notify admin.
 *   3. Return { ok, applicationId } to the browser.
 *
 * Admin endpoints (for a future review app; token-protected):
 *   GET  ?action=list&token=...           — all applicants as JSON objects
 *   POST ?action=update (form-encoded)    — update Stage / Dan Adjustment / Dan Notes
 *
 * Script Properties required:
 *   SHEET_ID        — Google Sheet ID (created by ?action=setupSheet)
 *   PIPELINE_TOKEN  — shared token for the admin review app (see SECRETS.md)
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
const SHEET_NAME = "Executive Assistant Applications 2026-27";
const SHEET_TAB_NAME = "Applicants";
const FORM_PAGE_URL = "https://www.rivertechschool.com/pages/ea.html";

const BACKEND_VERSION = "1"; // bump with each redeploy; reported by default GET
const STAGES = ["New", "Reviewing", "Interview", "Offer", "Hired", "Bench", "Passed"];

const CONNECTION_LABELS = {
  "parent":   "Parent of a current/incoming student",
  "relative": "Relative of a student",
  "church":   "Partner church community",
  "friend":   "Friend of the school",
  "none":     "No prior connection (found the posting)"
};
const WORK_MODE_LABELS = {
  "inperson": "In person (Post Falls)",
  "hybrid":   "Hybrid",
  "either":   "Either"
};
function label_(map, key) { return map[key] || key || ""; }

// ---- Web-app entrypoints -----------------------------------------------
function doPost(e) {
  try {
    const params = (e && e.parameter) || {};
    if (params.action === "update") return json_(adminUpdate_(params));
    const payload = JSON.parse(e.postData.contents);
    return json_(handleApplication(payload));
  } catch (err) {
    Logger.log("doPost error: " + err + "\n" + (err.stack || ""));
    return json_({ ok: false, error: "Server error: " + err.message });
  }
}

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.action === "setupSheet") return json_(setupSheet_());
  if (params.action === "list") return json_(adminList_(params));
  return json_({ ok: true, message: "Executive Assistant backend is alive.", version: BACKEND_VERSION });
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---- Core handler -------------------------------------------------------
function handleApplication(p) {
  if (!p || !p.applicant || !p.applicant.email || !p.applicant.firstName) {
    return { ok: false, error: "Application data was incomplete." };
  }
  if (!p.consentAgreed) {
    return { ok: false, error: "Consent must be agreed to before submitting." };
  }
  if (!p.faithAffirm) {
    return { ok: false, error: "The faith affirmation is required for this role." };
  }
  if (!p.backgroundConsent) {
    return { ok: false, error: "Background-check willingness is required." };
  }

  const applicationId = "EA-" + Utilities.formatDate(new Date(), "America/Los_Angeles", "yyyyMMdd-HHmmss")
    + "-" + Math.floor(Math.random() * 1000).toString().padStart(3, "0");

  writeToSheet_(applicationId, p);
  sendApplicantEmail_(applicationId, p);
  sendNotificationEmail_(applicationId, p);

  return { ok: true, applicationId: applicationId };
}

// ---- Sheet write --------------------------------------------------------
function getSheet_() {
  const sheetId = cfg("SHEET_ID");
  if (!sheetId) throw new Error("SHEET_ID is not configured. Call ?action=setupSheet first.");
  const ss = SpreadsheetApp.openById(sheetId);
  return ss.getSheetByName(SHEET_TAB_NAME) || ss.getSheets()[0];
}

function headerRow_() {
  return [
    "Application ID", "Submitted (UTC)", "Stage",
    "First Name", "Last Name", "Email", "Phone", "City",
    "Connection", "Connection Detail",
    "AI Tools", "AI Experience Length", "AI Experience", "AI Proof Link",
    "Writing Sample", "Writing Link",
    "Skills", "Highest Degree", "Degree Detail", "Years Experience", "Experience Summary",
    "Future Excites", "Influences",
    "Faith Affirmed", "Faith Note",
    "Ideal Hours/Week", "Work Mode", "Earliest Start", "Availability Note", "Background Check OK",
    "Signature", "Signature Date", "Consent Agreed",
    "Dan Adjustment", "Dan Notes"
  ];
}

function writeToSheet_(applicationId, p) {
  const sh = getSheet_();

  if (sh.getLastRow() === 0) {
    const header = headerRow_();
    sh.appendRow(header);
    sh.getRange(1, 1, 1, header.length).setFontWeight("bold");
    sh.setFrozenRows(1);
  }

  const a = p.applicant || {};
  const ai = p.ai || {};
  const w = p.writing || {};

  const row = [
    applicationId,
    p.submittedAt || new Date().toISOString(),
    "New",
    a.firstName || "", a.lastName || "", a.email || "", a.phone || "", a.city || "",
    label_(CONNECTION_LABELS, p.connection), p.connectionDetail || "",
    (ai.tools || []).join(", "), ai.years || "", ai.experience || "", ai.proof || "",
    w.sample || "", w.link || "",
    (p.skills || []).join(", "), p.degree || "", p.degreeDetail || "", p.yearsExp || "", p.expSummary || "",
    p.futureExcites || "", p.influences || "",
    p.faithAffirm ? "Yes" : "", p.faithNote || "",
    p.idealHours || "", label_(WORK_MODE_LABELS, p.workMode), p.startDate || "", p.availabilityNote || "",
    p.backgroundConsent ? "Yes" : "No",
    p.signature || "", p.signatureDate || "", p.consentAgreed ? "Yes" : "No",
    "",  // Dan Adjustment
    ""   // Dan Notes
  ];

  sh.appendRow(row);
}

// ---- Emails -------------------------------------------------------------
function sendApplicantEmail_(applicationId, p) {
  const a = p.applicant || {};
  const subject = "River Tech — we received your Executive Assistant application";
  const body = [
    "Hi " + (a.firstName || "") + ",",
    "",
    "Thank you for applying to be the Executive Assistant at River Tech. Your application has been received.",
    "",
    "Your confirmation reference: " + applicationId,
    "",
    "What happens next:",
    "• The founder reads every application personally — your AI fluency, your writing, and the way you think.",
    "• If your experience fits what the school needs right now, we'll reach out to talk — usually within a couple of weeks.",
    "• The role begins part-time, so we can both learn how we work together before it grows.",
    "• Not the right moment? Strong applications stay on file. The right person and the right time don't always arrive together.",
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
      to: a.email,
      replyTo: "learn@rivertech.me",
      subject: subject,
      body: body,
      name: "River Tech School"
    });
  } catch (err) {
    Logger.log("Applicant email failed: " + err);
  }
}

function sendNotificationEmail_(applicationId, p) {
  const a = p.applicant || {};
  const ai = p.ai || {};
  const w = p.writing || {};

  const subject = "[EA] " + (a.firstName || "") + " " + (a.lastName || "") +
    " — " + ((ai.tools || []).slice(0, 3).join(", ") || "no tools?") +
    ((ai.tools || []).length > 3 ? "…" : "") +
    (ai.years ? " — " + ai.years : "") +
    (p.idealHours ? " — " + p.idealHours + " hrs/wk" : "");

  const body = [
    "Executive Assistant application for 2026-27.",
    "",
    "Reference: " + applicationId,
    "Submitted: " + (p.submittedAt || new Date().toISOString()),
    "",
    "Name: " + (a.firstName || "") + " " + (a.lastName || ""),
    "Email: " + (a.email || "") + " · Phone: " + (a.phone || "") + " · City: " + (a.city || ""),
    "Connection: " + label_(CONNECTION_LABELS, p.connection) + (p.connectionDetail ? " — " + p.connectionDetail : ""),
    "",
    "--- AI FLUENCY (the keystone) ---",
    "Tools: " + ((ai.tools || []).join(", ") || "—"),
    "Time working with agents: " + (ai.years || "—"),
    "Proof link: " + (ai.proof || "—"),
    "Experience:",
    (ai.experience || "—"),
    "",
    "--- WRITING SAMPLE ---",
    (w.sample || (w.link ? "(link) " + w.link : "—")),
    (w.sample && w.link ? "Also linked: " + w.link : ""),
    "",
    "--- EXPERIENCE & SKILLS ---",
    "Skills: " + ((p.skills || []).join(", ") || "—"),
    "Highest degree: " + (p.degree || "—") + (p.degreeDetail ? " — " + p.degreeDetail : ""),
    "Years of relevant work: " + (p.yearsExp || "—"),
    "Summary: " + (p.expSummary || "—"),
    "",
    "--- FORWARD THINKING ---",
    "Future excites: " + (p.futureExcites || "—"),
    "Influences: " + (p.influences || "—"),
    "",
    "--- FAITH ---",
    "Affirmed Christian faith: " + (p.faithAffirm ? "Yes" : "No"),
    "Note: " + (p.faithNote || "—"),
    "",
    "--- LOGISTICS ---",
    "Ideal hours/week: " + (p.idealHours || "—"),
    "Work mode: " + label_(WORK_MODE_LABELS, p.workMode),
    "Earliest start: " + (p.startDate || "—"),
    "Availability note: " + (p.availabilityNote || "—"),
    "Background check OK: " + (p.backgroundConsent ? "Yes" : "No"),
    "",
    "Signature: " + (p.signature || "") + " · Date: " + (p.signatureDate || ""),
    "",
    "Row appended to '" + SHEET_NAME + "' with Stage = New."
  ].join("\n");

  try {
    MailApp.sendEmail({
      to: NOTIFY_EMAILS.join(","),
      subject: subject,
      body: body,
      name: "River Tech EA Applications"
    });
  } catch (err) {
    Logger.log("Notification email failed: " + err);
  }
}

// ---- Admin endpoints (token-protected, for a future review app) ---------
function checkToken_(params) {
  const expected = cfg("PIPELINE_TOKEN");
  if (!expected) return "PIPELINE_TOKEN not configured";
  if (!params.token || params.token !== expected) return "Forbidden";
  return null;
}

function adminList_(params) {
  const tokenErr = checkToken_(params);
  if (tokenErr) return { ok: false, error: tokenErr };

  const sh = getSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, applicants: [] };
  const values = sh.getRange(1, 1, lastRow, sh.getLastColumn()).getValues();
  const headers = values[0];
  const applicants = values.slice(1).map(function (row) {
    const obj = {};
    headers.forEach(function (h, i) { obj[h] = row[i]; });
    return obj;
  });
  return { ok: true, applicants: applicants };
}

function adminUpdate_(params) {
  const tokenErr = checkToken_(params);
  if (tokenErr) return { ok: false, error: tokenErr };
  if (!params.appId) return { ok: false, error: "appId required" };

  const sh = getSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: false, error: "Sheet empty" };
  const values = sh.getRange(1, 1, lastRow, sh.getLastColumn()).getValues();
  const headers = values[0];
  const stageIdx = headers.indexOf("Stage");
  const adjIdx = headers.indexOf("Dan Adjustment");
  const notesIdx = headers.indexOf("Dan Notes");

  for (let r = 1; r < values.length; r++) {
    if (String(values[r][0]) === String(params.appId)) {
      if (params.stage !== undefined && params.stage !== "") {
        if (STAGES.indexOf(params.stage) < 0) return { ok: false, error: "Unknown stage: " + params.stage };
        sh.getRange(r + 1, stageIdx + 1).setValue(params.stage);
      }
      if (params.danAdjustment !== undefined) {
        sh.getRange(r + 1, adjIdx + 1).setValue(params.danAdjustment);
      }
      if (params.danNotes !== undefined) {
        sh.getRange(r + 1, notesIdx + 1).setValue(params.danNotes);
      }
      return { ok: true, appId: params.appId };
    }
  }
  return { ok: false, error: "appId not found: " + params.appId };
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
    tokenSet: !!props.getProperty("PIPELINE_TOKEN")
  };
}

/** Pretend-submit to exercise sheet + emails. Run from editor, or rely on a
 *  real browser E2E test (preferred — see FORM-BUILDING-LESSONS.md #21). */
function selfTest() {
  const fake = {
    submittedAt: new Date().toISOString(),
    schoolYear: "2026-27",
    applicant: { firstName: "Test", lastName: "Assistant", email: Session.getActiveUser().getEmail() || "dhegelund@gmail.com", phone: "555-0400", city: "Post Falls" },
    connection: "parent",
    connectionDetail: "Parent of Test Kid",
    ai: {
      tools: ["Claude Cowork", "Perplexity (Comet / Computer)"],
      years: "1–2 years",
      experience: "Built a weekly newsletter pipeline with Claude Cowork; used Perplexity to run grant research.",
      proof: "https://example.com/portfolio"
    },
    writing: { sample: "I love turning a messy inbox into a calm one. Here's a short note...", link: "" },
    skills: ["Inbox & email management", "Grant research & writing", "Writing & communication"],
    degree: "Bachelor's",
    degreeDetail: "B.A. Communications, Boise State",
    yearsExp: "7",
    expSummary: "Seven years as an executive assistant in a nonprofit.",
    futureExcites: "AI tutors that meet each kid where they are.",
    influences: "Peter Diamandis, Cal Newport",
    faithAffirm: true,
    faithNote: "Active member of a local church.",
    idealHours: "10–20",
    workMode: "hybrid",
    startDate: "2026-08-01",
    availabilityNote: "Mornings are best.",
    backgroundConsent: true,
    consentAgreed: true,
    signature: "Test Assistant",
    signatureDate: Utilities.formatDate(new Date(), "America/Los_Angeles", "yyyy-MM-dd")
  };
  Logger.log(JSON.stringify(handleApplication(fake), null, 2));
}

/** Utility: wipe all non-header rows. Only run manually for test cleanup. */
function deleteAllDataRows_TESTONLY() {
  const sh = getSheet_();
  const last = sh.getLastRow();
  if (last > 1) sh.deleteRows(2, last - 1);
  Logger.log("Deleted data rows. Rows now: " + sh.getLastRow());
}
