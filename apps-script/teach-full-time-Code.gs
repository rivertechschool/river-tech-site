/**
 * River Tech — Full-Time Teacher Applications Backend
 * Google Apps Script web app for full-time teacher applications, 2026-27.
 * Cloned from teach-Code.gs (part-time, v3) 2026-07-21 and adapted:
 *   - NO day availability / idealDays / paid-vs-volunteer compensation.
 *   - Education adds Second Bachelor's (bach2) — mirrors the published salary scale.
 *   - New: Faith & Culture (cultureAgreed, faithStory, whyRiverTech).
 *   - New: track (benefits / self-insure / unsure), startTiming, resumeLink.
 *   - New: transcript uploads → Drive folder (pattern from school-Code.gs).
 *   - References required by the front end.
 *   - NO Stripe.
 *
 * Deploy with:
 *   Deploy > New deployment > Type: Web app
 *   Execute as: Me (learn@rivertech.me)
 *   Who has access: Anyone
 *
 * Per submission:
 *   1. Save transcript files (if any) to the Drive folder.
 *   2. Append a row to the "Applicants" sheet (Stage = New).
 *   3. Email the applicant a confirmation + notify admin.
 *   4. Return { ok, applicationId } to the browser.
 *
 * Admin endpoints (token-protected, same pattern as teach backend):
 *   GET  ?action=list&token=...            — all applicants as JSON objects
 *   POST ?action=update (form-encoded)     — update Stage / Dan Adjustment / Dan Notes
 *   GET  ?action=scrubTest&token=...&appId=FTT-...
 *        — E2E cleanup: deletes that sheet row + its Drive transcript files.
 *
 * Script Properties required:
 *   SHEET_ID                    — created by ?action=setupSheet
 *   DRIVE_TRANSCRIPT_FOLDER_ID  — created by ?action=setupSheet
 *   PIPELINE_TOKEN              — shared admin token (see SECRETS.md pattern)
 *
 * Bootstrap WITHOUT the editor run-picker:
 *   GET <webapp>/exec?action=setupSheet
 *   (idempotent — reports existing IDs once set)
 */

// ---- Config -------------------------------------------------------------
function cfg(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

const NOTIFY_EMAILS = ["learn@rivertech.me", "dhegelund@gmail.com"];
const SCHOOL_NAME = "River Tech School of Performing Arts & Technology";
const SHEET_NAME = "Full-Time Teacher Applications 2026-27";
const SHEET_TAB_NAME = "Applicants";
const FOLDER_NAME = "Full-Time Teacher Transcripts 2026-27";
const FORM_PAGE_URL = "https://www.rivertechschool.com/pages/teach-full-time.html";

const BACKEND_VERSION = "1"; // bump with each redeploy; reported by default GET
const STAGES = ["New", "Interview", "Offer", "Hired", "Bench", "Passed"];

const MAX_TRANSCRIPT_FILES = 6;
const MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024; // matches front end

const TRACK_LABELS = {
  "benefits":    "With benefits (health/dental/vision)",
  "self-insure": "Self-insure (+$500/mo)",
  "unsure":      "Not sure yet"
};
const START_LABELS = {
  "by-aug-1":      "By August 1, 2026",
  "before-sept-1": "Before September 1, 2026",
  "fall-2026":     "During fall 2026",
  "flexible":      "Flexible"
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
  if (params.action === "scrubTest") return json_(scrubTest_(params));
  if (params.action === "resetHeader") return json_(resetHeader_(params));
  return json_({ ok: true, message: "Full-Time Teacher backend is alive.", version: BACKEND_VERSION });
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
  if (!p.cultureAgreed) {
    return { ok: false, error: "Please read Our Culture and confirm it resonates." };
  }

  const applicationId = "FTT-" + Utilities.formatDate(new Date(), "America/Los_Angeles", "yyyyMMdd-HHmmss")
    + "-" + Math.floor(Math.random() * 1000).toString().padStart(3, "0");

  const transcriptUrls = saveTranscripts_(applicationId, p);
  writeToSheet_(applicationId, p, transcriptUrls);
  sendApplicantEmail_(applicationId, p, transcriptUrls);
  sendNotificationEmail_(applicationId, p, transcriptUrls);

  return { ok: true, applicationId: applicationId };
}

// ---- Transcript uploads (pattern from school-Code.gs) -------------------
function saveTranscripts_(applicationId, p) {
  const files = (p.transcripts || []).slice(0, MAX_TRANSCRIPT_FILES);
  if (files.length === 0) return [];
  const folderId = cfg("DRIVE_TRANSCRIPT_FOLDER_ID");
  if (!folderId) {
    Logger.log("DRIVE_TRANSCRIPT_FOLDER_ID not configured — skipping transcript upload.");
    return [];
  }
  const a = p.applicant || {};
  const cleanFirst = (a.firstName || "Applicant").replace(/[^A-Za-z0-9_-]/g, "");
  const cleanLast = (a.lastName || "").replace(/[^A-Za-z0-9_-]/g, "");
  const urls = [];
  try {
    const folder = DriveApp.getFolderById(folderId);
    files.forEach(function (file, i) {
      if (!file || !file.base64) return;
      if (file.size && file.size > MAX_TRANSCRIPT_BYTES) {
        Logger.log("Transcript " + (i + 1) + " over size limit — skipped.");
        return;
      }
      const ext = extFromMime_(file.type) || extFromName_(file.name) || "pdf";
      const filename = [applicationId, cleanFirst, cleanLast].filter(String).join("_")
        + "_transcript" + (i + 1) + "." + ext;
      const bytes = Utilities.base64Decode(file.base64);
      const mime = file.type || "application/pdf";
      const blob = Utilities.newBlob(bytes, mime, filename);
      const created = folder.createFile(blob);
      urls.push(created.getUrl());
    });
  } catch (err) {
    Logger.log("Transcript upload failed: " + err);
  }
  return urls;
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
    "Connection"
  ];
  // 5 degree levels × (Has, Field, Institution, Year)
  [["Assoc", "Associate's"], ["Bach", "Bachelor's"], ["Bach2", "Second Bachelor's"], ["Masters", "Master's"], ["Doctorate", "Doctorate"]]
    .forEach(function (lvl) {
      h.push(lvl[1] + "?", lvl[1] + " Field", lvl[1] + " Institution", lvl[1] + " Year");
    });
  for (let i = 1; i <= 3; i++) h.push("Cert " + i + " Name", "Cert " + i + " Issuer", "Cert " + i + " Year");
  h.push("Other Education", "Transcript Links");
  [["Classroom", "classroom"], ["Co-op", "coop"], ["Church", "church"], ["Youth Programs", "youth"], ["Tutoring", "tutoring"]]
    .forEach(function (x) {
      h.push("Exp " + x[0] + "?", "Exp " + x[0] + " Years", "Exp " + x[0] + " Detail");
    });
  h.push(
    "Experience Highlight",
    "Culture Agreed", "Faith", "Why River Tech",
    "Subjects", "Suggested Subjects", "Strengths",
    "Track", "Start Timing", "Combo Interest", "Combo Skills", "Resume Link",
    "Background Check OK", "References",
    "Signature", "Signature Date", "Consent Agreed",
    "Dan Adjustment", "Dan Notes"
  );
  return h;
}

function writeToSheet_(applicationId, p, transcriptUrls) {
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
    p.connection || ""
  ];

  ["assoc", "bach", "bach2", "master", "phd"].forEach(function (id) {
    const d = edu[id] || {};
    row.push(d.has ? "Yes" : "", d.field || "", d.institution || "", d.year || "");
  });

  const certs = edu.certs || [];
  for (let i = 0; i < 3; i++) {
    const c = certs[i] || {};
    row.push(c.name || "", c.issuer || "", c.year || "");
  }
  row.push(edu.other || "", (transcriptUrls || []).join("\n"));

  ["classroom", "coop", "church", "youth", "tutoring"].forEach(function (id) {
    const x = exp[id] || {};
    row.push(x.has ? "Yes" : "", x.years || "", x.desc || "");
  });

  row.push(
    exp.highlight || "",
    p.cultureAgreed ? "Yes" : "No",
    p.faithStory || "",
    p.whyRiverTech || "",
    (p.subjects || []).join(", "),
    p.subjectsOther || "",
    p.subjectsStrength || "",
    label_(TRACK_LABELS, p.track),
    label_(START_LABELS, p.startTiming),
    p.comboInterest ? "Yes" : "",
    p.comboSkills || "",
    p.resumeLink || "",
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
function sendApplicantEmail_(applicationId, p, transcriptUrls) {
  const a = p.applicant || {};
  const subject = "River Tech — we received your full-time teacher application";
  const body = [
    "Hi " + (a.firstName || "") + ",",
    "",
    "Thank you for applying to teach full-time at River Tech for the 2026-27 school year. Your application has been received.",
    "",
    "Your confirmation reference: " + applicationId,
    (transcriptUrls && transcriptUrls.length
      ? "Transcripts received: " + transcriptUrls.length + " file(s)."
      : "Transcripts: none attached — no problem, just be ready to send them when we follow up."),
    "",
    "What happens next:",
    "• The principal reads every application personally — your education, your experience, and especially what you can teach.",
    "• If it looks like a fit, we'll reach out to talk and invite you to visit the school — usually within a few weeks.",
    "• Before any offer, we call your references and run an Idaho background check (River Tech covers the fee).",
    "• Not a fit right now? Timing matters as much as talent. Strong applications stay on file for future school years.",
    "",
    "Subjects you offered: " + ((p.subjects || []).join(", ") || "(see your suggestion)"),
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

function sendNotificationEmail_(applicationId, p, transcriptUrls) {
  const a = p.applicant || {};
  const edu = p.education || {};
  const exp = p.experience || {};

  // Quick-read degree summary for the subject line.
  const degrees = [];
  if ((edu.phd || {}).has) degrees.push("PhD");
  if ((edu.master || {}).has) degrees.push("Masters");
  if ((edu.bach2 || {}).has) degrees.push("2xBach");
  if ((edu.bach || {}).has) degrees.push("Bachelors");
  if ((edu.assoc || {}).has) degrees.push("Assoc");

  const subject = "[FT Teach] " + (a.firstName || "") + " " + (a.lastName || "") +
    " — " + ((p.subjects || []).slice(0, 3).join(", ") || p.subjectsOther || "no subjects?") +
    ((p.subjects || []).length > 3 ? "…" : "") +
    (degrees.length ? " — " + degrees.join("/") : "") +
    " — " + label_(START_LABELS, p.startTiming) +
    (p.comboInterest ? " — ★COMBO" : "") +
    (transcriptUrls && transcriptUrls.length ? " — 📎" + transcriptUrls.length : "");

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
    "Full-time teacher application for 2026-27.",
    "",
    "Reference: " + applicationId,
    "Submitted: " + (p.submittedAt || new Date().toISOString()),
    "",
    "Name: " + (a.firstName || "") + " " + (a.lastName || ""),
    "Email: " + (a.email || "") + " · Phone: " + (a.phone || "") + " · City: " + (a.city || ""),
    "Connection: " + (p.connection || "—"),
    "",
    "--- EDUCATION ---",
    degreeLine("Doctorate", edu.phd),
    degreeLine("Master's", edu.master),
    degreeLine("Second Bachelor's", edu.bach2),
    degreeLine("Bachelor's", edu.bach),
    degreeLine("Associate's", edu.assoc),
    certLines.length ? certLines.join("\n") : "Certs: —",
    edu.other ? "Other education: " + edu.other : "Other education: —",
    "Transcripts: " + ((transcriptUrls || []).length ? "\n" + transcriptUrls.join("\n") : "— (follow up to request)"),
    "",
    "--- EXPERIENCE ---",
    expLine("Classroom teaching", exp.classroom),
    expLine("Homeschool/co-op", exp.coop),
    expLine("Church programs / Sunday school", exp.church),
    expLine("Camps/scouts/CAP/coaching", exp.youth),
    expLine("Tutoring/mentoring", exp.tutoring),
    exp.highlight ? "Most interesting: " + exp.highlight : "Most interesting: —",
    "",
    "--- FAITH & CULTURE ---",
    "Read Our Culture: " + (p.cultureAgreed ? "Yes" : "No"),
    "Faith: " + (p.faithStory || "—"),
    "Why River Tech: " + (p.whyRiverTech || "—"),
    "",
    "--- TEACHING OFFER ---",
    "Subjects: " + ((p.subjects || []).join(", ") || "—"),
    "Suggested subjects: " + (p.subjectsOther || "—"),
    "Strengths: " + (p.subjectsStrength || "—"),
    "Track: " + label_(TRACK_LABELS, p.track),
    "Start: " + label_(START_LABELS, p.startTiming),
    (p.comboInterest ? "★ TEACHER + EA COMBO INTEREST — office/AI skills: " + (p.comboSkills || "(not described)") : "Combo interest: —"),
    "Résumé link: " + (p.resumeLink || "—"),
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

// ---- Admin endpoints (token-protected) ----------------------------------
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

// ---- E2E cleanup (token-protected; no editor run-picker needed) ---------
// GET ?action=scrubTest&token=...&appId=FTT-...
// Deletes that application's sheet row and trashes its Drive transcript files.
function scrubTest_(params) {
  const tokenErr = checkToken_(params);
  if (tokenErr) return { ok: false, error: tokenErr };
  if (!params.appId || String(params.appId).indexOf("FTT-") !== 0) {
    return { ok: false, error: "A specific appId (FTT-...) is required." };
  }

  const result = { ok: true, appId: params.appId, rowDeleted: false, filesTrashed: 0 };

  const sh = getSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow >= 2) {
    const ids = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(params.appId)) {
        sh.deleteRow(i + 2);
        result.rowDeleted = true;
        break;
      }
    }
  }

  const folderId = cfg("DRIVE_TRANSCRIPT_FOLDER_ID");
  if (folderId) {
    try {
      const files = DriveApp.getFolderById(folderId).getFiles();
      while (files.hasNext()) {
        const f = files.next();
        if (f.getName().indexOf(params.appId) === 0) {
          f.setTrashed(true);
          result.filesTrashed++;
        }
      }
    } catch (err) {
      Logger.log("scrubTest file cleanup failed: " + err);
    }
  }

  return result;
}

// ---- Header reset (token-protected; only when sheet has no data rows) ---
// GET ?action=resetHeader&token=...  — clears the header row so the next
// submission regenerates it with the current schema. Refuses if data exists.
function resetHeader_(params) {
  const tokenErr = checkToken_(params);
  if (tokenErr) return { ok: false, error: tokenErr };
  const sh = getSheet_();
  if (sh.getLastRow() > 1) return { ok: false, error: "Sheet has data rows; refusing to reset header." };
  sh.clear();
  return { ok: true, message: "Header cleared; next submission regenerates it with the current schema." };
}

// ---- Setup (curl-triggerable, no editor run-picker needed) -------------
function setupSheet_() {
  const props = PropertiesService.getScriptProperties();
  let sheetId = props.getProperty("SHEET_ID");
  let folderId = props.getProperty("DRIVE_TRANSCRIPT_FOLDER_ID");
  const out = { ok: true };

  if (sheetId) {
    out.sheetMessage = "SHEET_ID already set.";
    out.sheetId = sheetId;
  } else {
    const ss = SpreadsheetApp.create(SHEET_NAME);
    ss.getSheets()[0].setName(SHEET_TAB_NAME);
    sheetId = ss.getId();
    props.setProperty("SHEET_ID", sheetId);
    out.sheetMessage = "Created sheet '" + SHEET_NAME + "'. Move it into 'My Drive / RTS Website Forms /' and share with dhegelund@gmail.com.";
    out.sheetId = sheetId;
    out.sheetUrl = ss.getUrl();
    Logger.log("Created Sheet. ID: " + sheetId + " — URL: " + ss.getUrl());
  }

  if (folderId) {
    out.folderMessage = "DRIVE_TRANSCRIPT_FOLDER_ID already set.";
    out.folderId = folderId;
  } else {
    const folder = DriveApp.createFolder(FOLDER_NAME);
    folderId = folder.getId();
    props.setProperty("DRIVE_TRANSCRIPT_FOLDER_ID", folderId);
    out.folderMessage = "Created Drive folder '" + FOLDER_NAME + "'. Move it into 'My Drive / RTS Website Forms /' and share with dhegelund@gmail.com (Viewer).";
    out.folderId = folderId;
    out.folderUrl = folder.getUrl();
    Logger.log("Created Folder. ID: " + folderId + " — URL: " + folder.getUrl());
  }

  out.tokenSet = !!props.getProperty("PIPELINE_TOKEN");
  return out;
}

/** Pretend-submit to exercise sheet + emails. Run from editor, or rely on a
 *  real browser E2E test (preferred — see FORM-BUILDING-LESSONS.md #21). */
function selfTest() {
  const fake = {
    submittedAt: new Date().toISOString(),
    schoolYear: "2026-27",
    role: "full-time-teacher",
    applicant: { firstName: "Test", lastName: "Teacher", email: Session.getActiveUser().getEmail() || "dhegelund@gmail.com", phone: "555-0300", city: "Post Falls" },
    connection: "Friend of the Johnson family",
    education: {
      assoc: { has: false, field: "", institution: "", year: "" },
      bach: { has: true, field: "Music Education", institution: "University of Idaho", year: "2010" },
      bach2: { has: true, field: "Computer Science", institution: "Boise State", year: "2015" },
      master: { has: false, field: "", institution: "", year: "" },
      phd: { has: false, field: "", institution: "", year: "" },
      certs: [],
      hasCerts: false,
      other: ""
    },
    experience: {
      classroom: { has: true, years: "8", desc: "Middle-school music, two schools" },
      coop: { has: false, years: "", desc: "" },
      church: { has: true, years: "5", desc: "Sunday school, The Heart" },
      youth: { has: false, years: "", desc: "" },
      tutoring: { has: false, years: "", desc: "" },
      highlight: "Toured with a brass band."
    },
    cultureAgreed: true,
    faithStory: "Test faith story.",
    whyRiverTech: "Test motivation.",
    subjects: ["Coding", "Instruments (must be skilled)", "Math (Middle School)"],
    subjectsOther: "",
    subjectsStrength: "Band and beginning coding.",
    track: "benefits",
    startTiming: "by-aug-1",
    resumeLink: "",
    references: "Jane Doe, former principal, 555-0100. John Smith, pastor, 555-0200.",
    backgroundConsent: true,
    consentAgreed: true,
    signature: "Test Teacher",
    signatureDate: Utilities.formatDate(new Date(), "America/Los_Angeles", "yyyy-MM-dd"),
    transcripts: []
  };
  Logger.log(JSON.stringify(handleApplication(fake), null, 2));
}
