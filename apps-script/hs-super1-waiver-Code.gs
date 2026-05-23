/**
 * River Tech — HS Off-Campus Lunch (Super 1) Waiver Backend
 * Google Apps Script web app. Deploy with:
 *   Deploy > New deployment > Type: Web app
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * Receives parent-completed waivers, writes one row per submission to
 * the Sheet, sends a confirmation email to the parent, and notifies
 * staff. No payment processing — pure waiver/permission flow.
 *
 * Script Properties (set via Project Settings > Script Properties):
 *   SHEET_ID — Google Sheet ID for "HS Super 1 Lunch Waivers 2025-26"
 */

// ---- Config helpers -----------------------------------------------------
function cfg(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

const NOTIFY_EMAILS = ["learn@rivertech.me", "dhegelund@gmail.com"];
const SCHOOL_NAME = "River Tech School of Performing Arts & Technology";
const WAIVER_PAGE_URL = "https://www.rivertechschool.com/pages/hs-super1-waiver.html";
const SHEET_TAB_NAME = "Waivers";

// ---- Web-app entrypoints ------------------------------------------------
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const result = handleSubmission(payload);
    return json_(result);
  } catch (err) {
    Logger.log("doPost error: " + err + "\n" + (err && err.stack));
    return json_({ ok: false, error: "Server error: " + err.message });
  }
}

function doGet() {
  return json_({
    ok: true,
    message: "HS Super 1 Lunch Waiver backend is alive.",
    waiver: "hs-super1-lunch"
  });
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---- Core handler -------------------------------------------------------
function handleSubmission(p) {
  if (!p || !p.parent || !p.student || !p.release) {
    return { ok: false, error: "Waiver data is incomplete. Please fill out every required field." };
  }
  if (!p.parent.firstName || !p.parent.lastName || !p.parent.email || !p.parent.phone) {
    return { ok: false, error: "Parent/guardian information is incomplete." };
  }
  if (!p.student.firstName || !p.student.lastName || !p.student.grade) {
    return { ok: false, error: "Student information is incomplete." };
  }
  if (!p.release.signatureName) {
    return { ok: false, error: "Please type your signature (parent/guardian full name)." };
  }
  if (!p.release.agreed) {
    return { ok: false, error: "Please check the release agreement box." };
  }

  const registrationId = "WV-" + Utilities.formatDate(
    new Date(), "America/Los_Angeles", "yyyyMMdd-HHmmss"
  ) + "-" + Math.floor(Math.random() * 1000).toString().padStart(3, "0");

  writeToSheet_(registrationId, p);
  sendParentEmail_(registrationId, p);
  sendNotificationEmail_(registrationId, p);

  return { ok: true, registrationId: registrationId };
}

// ---- Sheet write --------------------------------------------------------
function headerRow_() {
  return [
    "Waiver ID",
    "Submitted (UTC)",
    "School Year",
    "Parent First",
    "Parent Last",
    "Parent Email",
    "Parent Phone",
    "Student First",
    "Student Last",
    "Student Grade",
    "Ack: Window",
    "Ack: Tell Teacher",
    "Ack: Return Check",
    "Ack: Behavior",
    "Ack: Values",
    "Ack: Group",
    "Ack: Discretion",
    "Signature Name",
    "Signature Date",
    "Status"
  ];
}

function writeToSheet_(registrationId, p) {
  const sheetId = cfg("SHEET_ID");
  if (!sheetId) throw new Error("SHEET_ID is not configured in Script Properties.");
  const ss = SpreadsheetApp.openById(sheetId);
  let sh = ss.getSheetByName(SHEET_TAB_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_TAB_NAME);

  if (sh.getLastRow() === 0) {
    const header = headerRow_();
    sh.appendRow(header);
    sh.getRange(1, 1, 1, header.length).setFontWeight("bold");
    sh.setFrozenRows(1);
  }

  const submittedAt = p.submittedAt || new Date().toISOString();
  const a = p.acknowledgments || {};

  const row = [
    registrationId,
    submittedAt,
    p.schoolYear || "2025-26",
    p.parent.firstName,
    p.parent.lastName,
    p.parent.email,
    p.parent.phone,
    p.student.firstName,
    p.student.lastName,
    p.student.grade,
    a.window ? "Yes" : "",
    a.tellTeacher ? "Yes" : "",
    a.returnCheck ? "Yes" : "",
    a.behavior ? "Yes" : "",
    a.values ? "Yes" : "",
    a.group ? "Yes" : "",
    a.discretion ? "Yes" : "",
    (p.release && p.release.signatureName) || "",
    (p.release && p.release.signatureDate) || "",
    "Active"
  ];

  sh.appendRow(row);
}

// ---- Emails -------------------------------------------------------------
function sendParentEmail_(registrationId, p) {
  const subject = "HS Off-Campus Lunch Waiver — Received for " + p.student.firstName + " " + p.student.lastName;

  const lines = [
    "Hi " + p.parent.firstName + ",",
    "",
    "Thanks for opting " + p.student.firstName + " into the High School off-campus lunch privilege at River Tech.",
    "",
    "Confirmation reference: " + registrationId,
    "Student: " + p.student.firstName + " " + p.student.lastName + " (Grade " + p.student.grade + ")",
    "",
    "Quick reminders of the policy you agreed to:",
    "  • Tuesday and Wednesday only, 11:45 AM – 12:05 PM",
    "  • " + p.student.firstName + " should tell a teacher before leaving",
    "  • Teachers will check at 12:05 that all students have returned",
    "  • Late return or off-campus misbehavior = privilege revoked immediately",
    "  • " + p.student.firstName + " may go alone or in a small group (their choice)",
    "  • Expected to reflect River Tech values while off-campus",
    "",
    "This permission stays in effect for the rest of the current school year unless revoked by you in writing, or by River Tech staff at their discretion.",
    "",
    "Questions? Reply to this email or text Mary at 425-444-2271.",
    "",
    SCHOOL_NAME,
    "927 E Polston Ave, Post Falls, ID 83854",
    WAIVER_PAGE_URL
  ];

  try {
    MailApp.sendEmail({
      to: p.parent.email,
      replyTo: "learn@rivertech.me",
      subject: subject,
      body: lines.join("\n"),
      name: "River Tech School"
    });
  } catch (err) {
    Logger.log("Parent email failed: " + err);
  }
}

function sendNotificationEmail_(registrationId, p) {
  const subject = "[Waiver] HS Super 1 Lunch — " + p.student.firstName + " " + p.student.lastName + " (Grade " + p.student.grade + ")";

  const lines = [
    "New HS Off-Campus Lunch Waiver received.",
    "",
    "Reference: " + registrationId,
    "Submitted: " + (p.submittedAt || new Date().toISOString()),
    "",
    "Student: " + p.student.firstName + " " + p.student.lastName + " (Grade " + p.student.grade + ")",
    "",
    "Parent: " + p.parent.firstName + " " + p.parent.lastName,
    "Email:  " + p.parent.email,
    "Phone:  " + p.parent.phone,
    "",
    "Signed: " + (p.release && p.release.signatureName) + " on " + (p.release && p.release.signatureDate),
    "",
    "Row appended to the HS Super 1 Lunch Waivers sheet."
  ];

  try {
    MailApp.sendEmail({
      to: NOTIFY_EMAILS.join(","),
      subject: subject,
      body: lines.join("\n"),
      name: "River Tech Waivers"
    });
  } catch (err) {
    Logger.log("Notification email failed: " + err);
  }
}

// ---- Setup & self-test --------------------------------------------------
function verifyConfig() {
  const sheetId = cfg("SHEET_ID");
  Logger.log("SHEET_ID set: " + !!sheetId);
  if (sheetId) {
    try {
      const ss = SpreadsheetApp.openById(sheetId);
      Logger.log("Sheet name: " + ss.getName());
    } catch (e) {
      Logger.log("Cannot open sheet: " + e.message);
    }
  }
}

function selfTest() {
  const fake = {
    submittedAt: new Date().toISOString(),
    waiverType: "hs-super1-lunch",
    schoolYear: "2025-26",
    parent: {
      firstName: "Test",
      lastName: "Parent",
      email: Session.getActiveUser().getEmail() || "dhegelund@gmail.com",
      phone: "555-0100"
    },
    student: {
      firstName: "TestStudent",
      lastName: "Parent",
      grade: "10"
    },
    acknowledgments: {
      window: true, tellTeacher: true, returnCheck: true,
      behavior: true, values: true, group: true, discretion: true
    },
    release: {
      agreed: true,
      signatureName: "Test Parent",
      signatureDate: new Date().toISOString().slice(0, 10)
    }
  };
  Logger.log(JSON.stringify(handleSubmission(fake), null, 2));
}
