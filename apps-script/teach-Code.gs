/**
 * River Tech — Teach at River Tech (Part-Time Teaching Applications) Backend
 * Google Apps Script web app for part-time teaching applications, 2026-27.
 * Cousin of scholarship-Code.gs: NO Stripe, NO uploads. Collects applicant
 * contact + connection, sectioned education (Assoc/Bach/Masters/Doctorate/
 * certificates), experience blocks, subjects, day availability, compensation
 * preference, background-check willingness, optional references, consent +
 * typed signature.
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
 * Admin endpoints (for the Phase-2 review app; token-protected):
 *   GET  ?action=list&token=...           — all applicants as JSON objects
 *   POST ?action=update (form-encoded)    — update Stage / Dan Adjustment / Dan Notes
 *
 * Script Properties required:
 *   SHEET_ID        — Google Sheet ID (created by ?action=setupSheet)
 *   PIPELINE_TOKEN  — shared token for the admin review app (same pattern as
 *                     the enrollment backends; see SECRETS.md)
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
const SHEET_NAME = "Teaching Applications 2026-27";
const SHEET_TAB_NAME = "Applicants";
const FORM_PAGE_URL = "https://www.rivertechschool.com/pages/teach.html";

const BACKEND_VERSION = "2"; // bump with each redeploy; reported by default GET
const STAGES = ["New", "Interview", "Offer", "Hired", "Bench", "Passed"];

const CONNECTION_LABELS = {
  "parent":   "Parent of a current/incoming student",
  "relative": "Relative of a student",
  "church":   "Partner church community",
  "friend":   "Friend of the school"
};
const COMPENSATION_LABELS = {
  "paid":      "Paid contractor ($25–$35/hr)",
  "volunteer": "Volunteer (potential tuition discount)",
  "either":    "Either — open to discussion"
};
const DAY_LABELS = {
  "monday":   "Monday (Performing Arts)",
  "tuesday":  "Tuesday (Science & Social Studies)",
  "thursday": "Thursday (Life Skills)",
  "friday":   "Friday (Technology)"
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
  return json_({ ok: true, message: "Teach at River Tech backend is alive.", version: BACKEND_VERSION });
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
  if (!p.backgroundConsent) {
    return { ok: false, error: "Background-check willingness is required." };
  }

  const applicationId = "TEACH-" + Utilities.formatDate(new Date(), "America/Los_Angeles", "yyyyMMdd-HHmmss")
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
  const h = [
    "Application ID", "Submitted (UTC)", "Stage",
    "First Name", "Last Name", "Email", "Phone", "City",
    "Connection", "Connection Detail"
  ];
  // 4 degree levels × (Has, Field, Institution, Year)
  [["Assoc", "Associate's"], ["Bach", "Bachelor's"], ["Masters", "Master's"], ["Doctorate", "Doctorate"]]
    .forEach(function (lvl) {
      h.push(lvl[1] + "?", lvl[1] + " Field", lvl[1] + " Institution", lvl[1] + " Year");
    });
  for (let i = 1; i <= 3; i++) h.push("Cert " + i + " Name", "Cert " + i + " Issuer", "Cert " + i + " Year");
  h.push("Other Education");
  [["Classroom", "classroom"], ["Co-op", "coop"], ["Tutoring", "tutoring"], ["Professional", "pro"]]
    .forEach(function (x) {
      h.push("Exp " + x[0] + "?", "Exp " + x[0] + " Years", "Exp " + x[0] + " Detail");
    });
  h.push(
    "Experience Highlight",
    "Subjects", "Suggested Subjects", "Strengths",
    "Days", "Ideal Days/Week",
    "Compensation", "Background Check OK", "References",
    "Signature", "Signature Date", "Consent Agreed",
    "Dan Adjustment", "Dan Notes"
  );
  return h;
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
  const edu = p.education || {};
  const exp = p.experience || {};

  const row = [
    applicationId,
    p.submittedAt || new Date().toISOString(),
    "New",
    a.firstName || "", a.lastName || "", a.email || "", a.phone || "", a.city || "",
    label_(CONNECTION_LABELS, p.connection),
    p.connectionDetail || ""
  ];

  ["assoc", "bach", "master", "phd"].forEach(function (id) {
    const d = edu[id] || {};
    row.push(d.has ? "Yes" : "", d.field || "", d.institution || "", d.year || "");
  });

  const certs = edu.certs || [];
  for (let i = 0; i < 3; i++) {
    const c = certs[i] || {};
    row.push(c.name || "", c.issuer || "", c.year || "");
  }
  row.push(edu.other || "");

  ["classroom", "coop", "tutoring", "pro"].forEach(function (id) {
    const x = exp[id] || {};
    row.push(x.has ? "Yes" : "", x.years || "", x.desc || "");
  });

  row.push(
    exp.highlight || "",
    (p.subjects || []).join(", "),
    p.subjectsOther || "",
    p.subjectsStrength || "",
    (p.days || []).map(function (d) { return label_(DAY_LABELS, d); }).join(", "),
    p.idealDays || "",
    label_(COMPENSATION_LABELS, p.compensation),
    p.backgroundConsent ? "Yes" : "No",
    p.references || "",
    p.signature || "",
    p.signatureDate || "",
    p.consentAgreed ? "Yes" : "No",
    "",  // Dan Adjustment
    ""   // Dan Notes
  );

  sh.appendRow(row);
}

// ---- Emails -------------------------------------------------------------
function sendApplicantEmail_(applicationId, p) {
  const a = p.applicant || {};
  const subject = "River Tech — we received your teaching application";
  const body = [
    "Hi " + (a.firstName || "") + ",",
    "",
    "Thank you for offering to teach at River Tech for the 2026-27 school year. Your application has been received.",
    "",
    "Your confirmation reference: " + applicationId,
    "",
    "What happens next:",
    "• The principal reads every application personally — your education, your experience, and especially what you can teach.",
    "• If your subjects and availability fit the school's needs, we'll reach out to talk — usually within a few weeks.",
    "• New part-time teachers start in September, one day a week, with our full support.",
    "• Not a fit right now? Timing matters as much as talent — a subject we don't offer this semester may be exactly what next year needs. Strong applications stay on file for future semesters and school years.",
    "",
    "Subjects you offered: " + ((p.subjects || []).join(", ") || "(see your suggestion)"),
    "Days you're available: " + (p.days || []).map(function (d) { return label_(DAY_LABELS, d); }).join(", "),
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
  const edu = p.education || {};
  const exp = p.experience || {};

  // Quick-read degree summary for the subject line.
  const degrees = [];
  if ((edu.phd || {}).has) degrees.push("PhD");
  if ((edu.master || {}).has) degrees.push("Masters");
  if ((edu.bach || {}).has) degrees.push("Bachelors");
  if ((edu.assoc || {}).has) degrees.push("Assoc");
  const dayShort = (p.days || []).map(function (d) {
    return d.charAt(0).toUpperCase() + d.slice(1, 3);
  }).join("/");

  const subject = "[Teach] " + (a.firstName || "") + " " + (a.lastName || "") +
    " — " + ((p.subjects || []).slice(0, 3).join(", ") || p.subjectsOther || "no subjects?") +
    ((p.subjects || []).length > 3 ? "…" : "") +
    " — " + (dayShort || "no days?") +
    " — " + label_(COMPENSATION_LABELS, p.compensation) +
    (degrees.length ? " — " + degrees.join("/") : "");

  function degreeLine(label, d) {
    if (!d || !d.has) return label + ": —";
    return label + ": " + (d.field || "?") + ", " + (d.institution || "?") + (d.year ? " (" + d.year + ")" : "");
  }
  function expLine(label, x) {
    if (!x || !x.has) return label + ": —";
    return label + ": " + (x.years ? x.years + " yrs" : "yes") + (x.desc ? " — " + x.desc : "");
  }

  const certLines = (edu.certs || []).map(function (c, i) {
    return "Cert " + (i + 1) + ": " + (c.name || "") + (c.issuer ? " — " + c.issuer : "") + (c.year ? " (" + c.year + ")" : "");
  });

  const body = [
    "Part-time teaching application for 2026-27.",
    "",
    "Reference: " + applicationId,
    "Submitted: " + (p.submittedAt || new Date().toISOString()),
    "",
    "Name: " + (a.firstName || "") + " " + (a.lastName || ""),
    "Email: " + (a.email || "") + " · Phone: " + (a.phone || "") + " · City: " + (a.city || ""),
    "Connection: " + label_(CONNECTION_LABELS, p.connection) + " — " + (p.connectionDetail || ""),
    "",
    "--- EDUCATION ---",
    degreeLine("Doctorate", edu.phd),
    degreeLine("Master's", edu.master),
    degreeLine("Bachelor's", edu.bach),
    degreeLine("Associate's", edu.assoc),
    certLines.length ? certLines.join("\n") : "Certs: —",
    edu.other ? "Other education: " + edu.other : "Other education: —",
    "",
    "--- EXPERIENCE ---",
    expLine("Classroom teaching", exp.classroom),
    expLine("Homeschool/co-op", exp.coop),
    expLine("Tutoring/coaching", exp.tutoring),
    expLine("Professional mastery", exp.pro),
    exp.highlight ? "Most interesting: " + exp.highlight : "Most interesting: —",
    "",
    "--- TEACHING OFFER ---",
    "Subjects: " + ((p.subjects || []).join(", ") || "—"),
    "Suggested subjects: " + (p.subjectsOther || "—"),
    "Strengths: " + (p.subjectsStrength || "—"),
    "Days available: " + (p.days || []).map(function (d) { return label_(DAY_LABELS, d); }).join(", "),
    "Ideal days/week: " + (p.idealDays || "—"),
    "Compensation: " + label_(COMPENSATION_LABELS, p.compensation),
    "",
    "Background check OK: " + (p.backgroundConsent ? "Yes" : "No"),
    "References: " + (p.references || "—"),
    "Signature: " + (p.signature || "") + " · Date: " + (p.signatureDate || ""),
    "",
    "Row appended to '" + SHEET_NAME + "' with Stage = New."
  ].join("\n");

  try {
    MailApp.sendEmail({
      to: NOTIFY_EMAILS.join(","),
      subject: subject,
      body: body,
      name: "River Tech Teaching Applications"
    });
  } catch (err) {
    Logger.log("Notification email failed: " + err);
  }
}

// ---- Admin endpoints (token-protected, for the Phase-2 review app) ------
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
    applicant: { firstName: "Test", lastName: "Teacher", email: Session.getActiveUser().getEmail() || "dhegelund@gmail.com", phone: "555-0300", city: "Post Falls" },
    connection: "parent",
    connectionDetail: "Parent of Test Kid",
    education: {
      assoc: { has: false, field: "", institution: "", year: "" },
      bach: { has: true, field: "Chemistry", institution: "University of Idaho", year: "2008" },
      master: { has: false, field: "", institution: "", year: "" },
      phd: { has: false, field: "", institution: "", year: "" },
      certs: [{ name: "CPR Instructor", issuer: "Red Cross", year: "2022" }],
      hasCerts: true,
      other: ""
    },
    experience: {
      classroom: { has: false, years: "", desc: "" },
      coop: { has: true, years: "6", desc: "Taught science at our homeschool co-op" },
      tutoring: { has: true, years: "3", desc: "Math tutoring" },
      pro: { has: false, years: "", desc: "" },
      highlight: "Once built a backyard observatory."
    },
    subjects: ["Chemistry", "General Science", "Astronomy & Rocketry"],
    subjectsOther: "",
    subjectsStrength: "Chemistry — taught it for six years.",
    days: ["tuesday", "friday"],
    idealDays: "1",
    compensation: "either",
    backgroundConsent: true,
    references: "",
    consentAgreed: true,
    signature: "Test Teacher",
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
