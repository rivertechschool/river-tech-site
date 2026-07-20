/**
 * River Tech — Wait Pool backend (waitpool-v1)
 *
 * Deploy on learn@rivertech.me as a Web App: Execute as Me, Anyone has access.
 * Script Properties used:
 *   PIPELINE_TOKEN     — shared admin token (same value as the other backends)
 *   WAITPOOL_SHEET_ID  — set automatically by ?action=setupSheet
 *
 * Endpoints:
 *   POST (no action)                     — public form submission (JSON body)
 *   GET  ?action=ping                    — health check
 *   GET  ?action=setupSheet&token=…      — creates the sheet AS learn@ (lesson 20) and stores its ID
 *   GET  ?action=list&token=…            — returns {headers, rows} for admin/reporting
 *
 * No Stripe. No uploads. Simplest backend in the family — keep it that way.
 */

var NOTIFY_EMAIL = "learn@rivertech.me";
var MAX_CHILDREN = 4;

var FAMILY_HEADERS = [
  "Pool ID", "Submitted (UTC)", "Status",
  "Parent 1 First", "Parent 1 Last", "Parent 1 Email", "Parent 1 Phone", "City",
  "Referred By", "Program", "A La Carte Days", "Desired Start",
  "Culture Read", "Worldview", "Payment Plan", "Scholarship Dependence", "Tuition Affirmed",
  "Notes", "Child Count"
];
var CHILD_FIELDS = ["First", "Last", "Birthdate", "Grade", "Current Schooling",
  "Tech Interest", "Tech Favorite", "Arts Interest", "Arts Favorite",
  "Stage Feelings", "CYT", "Instrument", "Dance"];

function allHeaders_() {
  var h = FAMILY_HEADERS.slice();
  for (var i = 1; i <= MAX_CHILDREN; i++) {
    CHILD_FIELDS.forEach(function (f) { h.push("Child " + i + " " + f); });
  }
  return h;
}

function cfg_(key) { return PropertiesService.getScriptProperties().getProperty(key); }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function checkToken_(token) {
  if (!token) throw new Error("bad token");
  var props = PropertiesService.getScriptProperties();
  var expected = props.getProperty("PIPELINE_TOKEN");
  // Trust-on-first-use bootstrap (same pattern as the other backends):
  // if no token is configured yet, the first caller sets it.
  if (!expected) { props.setProperty("PIPELINE_TOKEN", token); return; }
  if (token !== expected) throw new Error("bad token");
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.action === "ping") return json_({ ok: true, message: "wait pool backend is alive" });
    if (p.action === "setupSheet") { checkToken_(p.token); return json_(setupSheet_()); }
    if (p.action === "list") { checkToken_(p.token); return json_(list_()); }
    if (p.action === "scrub") { checkToken_(p.token); return json_(scrub_(p.id)); }
    return json_({ ok: false, error: "unknown action" });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    // Honeypot: real families leave it empty.
    if (body.website) return json_({ ok: true });
    return json_(submit_(body));
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function setupSheet_() {
  var props = PropertiesService.getScriptProperties();
  var existing = props.getProperty("WAITPOOL_SHEET_ID");
  if (existing) return { ok: true, message: "sheet already exists", sheetId: existing };
  var ss = SpreadsheetApp.create("RTS Wait Pool");
  var sh = ss.getSheets()[0];
  sh.setName("Pool");
  sh.appendRow(allHeaders_());
  sh.setFrozenRows(1);
  props.setProperty("WAITPOOL_SHEET_ID", ss.getId());
  return { ok: true, sheetId: ss.getId(), url: ss.getUrl(), columns: allHeaders_().length };
}

function sheet_() {
  var id = cfg_("WAITPOOL_SHEET_ID");
  if (!id) throw new Error("WAITPOOL_SHEET_ID not set — run ?action=setupSheet first");
  return SpreadsheetApp.openById(id).getSheetByName("Pool");
}

function poolId_() {
  var now = new Date();
  function pad(n, w) { return ("000" + n).slice(-w); }
  return "WP-" + now.getUTCFullYear() + pad(now.getUTCMonth() + 1, 2) + pad(now.getUTCDate(), 2) +
    "-" + pad(now.getUTCHours(), 2) + pad(now.getUTCMinutes(), 2) + pad(now.getUTCSeconds(), 2) +
    "-" + pad(now.getUTCMilliseconds(), 3);
}

function submit_(b) {
  // Required family-level fields.
  ["parentFirstName", "parentLastName", "parentEmail", "parentPhone", "parentCity",
   "program", "desiredStart", "payPlan", "scholarship"].forEach(function (k) {
    if (!b[k]) throw new Error("missing field: " + k);
  });
  if (b.cultureRead !== true) throw new Error("culture acknowledgment required");
  if (b.worldviewAffirm !== true) throw new Error("worldview acknowledgment required");
  if (b.tuitionAffirm !== true) throw new Error("tuition acknowledgment required");
  var children = (b.children || []).slice(0, MAX_CHILDREN);
  if (!children.length) throw new Error("at least one child required");
  children.forEach(function (c) {
    ["firstName", "lastName", "birthdate", "grade", "schooling", "techInterest", "artsInterest", "stage"]
      .forEach(function (k) { if (!c[k]) throw new Error("missing child field: " + k); });
  });

  var id = poolId_();
  var row = [
    id, new Date().toISOString(), "New",
    b.parentFirstName, b.parentLastName, b.parentEmail, b.parentPhone, b.parentCity,
    b.referredBy || "", b.program, b.alcDays || "", b.desiredStart,
    "Yes", "Yes", b.payPlan, b.scholarship, "Yes",
    b.notes || "", children.length
  ];
  children.forEach(function (c) {
    row.push(c.firstName, c.lastName, c.birthdate, c.grade, c.schooling,
      c.techInterest, c.techFavorite || "", c.artsInterest, c.artsFavorite || "",
      c.stage, c.cyt || "", c.instrument || "", c.dance || "");
  });
  for (var i = children.length; i < MAX_CHILDREN; i++) {
    CHILD_FIELDS.forEach(function () { row.push(""); });
  }

  sheet_().appendRow(row);

  // Confirmation to the family — same voice as the site.
  try {
    MailApp.sendEmail({
      to: b.parentEmail,
      subject: "You're in the pool — River Tech School",
      name: "River Tech School",
      replyTo: NOTIFY_EMAIL,
      body:
"Dear " + b.parentFirstName + ",\n\n" +
"Thank you — your family is in the River Tech wait pool. Joining is free and commits you to nothing.\n\n" +
"Here is what happens next. When a seat opens in your child's grade, we reach out directly. Seats open most often in September and after Christmas break, but they can open at any time of year. We will not pretend to know when that will be — what we promise is honesty: you will hear from us when things change.\n\n" +
"In the meantime, you are warmly invited to River Tech Days, our concerts, and our productions. Keep an eye on the calendar at rivertechschool.com — waiting is easier when you can watch.\n\n" +
"If your plans change, simply reply to this email and tell us. We would rather know than guess.\n\n" +
"Warmly,\nRiver Tech School of Performing Arts & Technology\nThe Heart — 927 E Polston Ave, Post Falls, ID\nlearn@rivertech.me — (425) 444-2081\n\nLife is a Stage. Love is our Script."
    });
  } catch (mailErr) { /* the row is saved; email failure must not fail the submission */ }

  // Heads-up to the school.
  try {
    var kidLines = children.map(function (c) {
      return "  - " + c.firstName + " " + c.lastName + " (grade " + c.grade + ", " + c.schooling + ")";
    }).join("\n");
    MailApp.sendEmail({
      to: NOTIFY_EMAIL,
      subject: "Wait pool: " + b.parentLastName + " family (" + children.length + " child" + (children.length > 1 ? "ren" : "") + ") — " + id,
      name: "Wait Pool Form",
      body:
"New wait pool submission " + id + "\n\n" +
"Parent: " + b.parentFirstName + " " + b.parentLastName + " — " + b.parentEmail + " — " + b.parentPhone + " — " + b.parentCity + "\n" +
"Referred by: " + (b.referredBy || "—") + "\n" +
"Program: " + b.program + (b.alcDays ? " (" + b.alcDays + ")" : "") + " · Start: " + b.desiredStart + "\n" +
"Worldview affirmed: Yes · Plan: " + b.payPlan + " · Scholarship-dependent: " + b.scholarship + "\n" +
"Children:\n" + kidLines + "\n" +
(b.notes ? "\nNotes: " + b.notes + "\n" : "") +
"\nFull details in the RTS Wait Pool sheet."
    });
  } catch (mailErr2) { /* non-fatal */ }

  return { ok: true, id: id };
}

function list_() {
  var sh = sheet_();
  var values = sh.getDataRange().getValues();
  return { ok: true, headers: values[0], rows: values.slice(1) };
}

// Admin-only: remove a row by Pool ID (for scrubbing E2E test data).
function scrub_(id) {
  if (!id) throw new Error("missing id");
  var sh = sheet_();
  var values = sh.getDataRange().getValues();
  for (var r = values.length - 1; r >= 1; r--) {
    if (values[r][0] === id) { sh.deleteRow(r + 1); return { ok: true, deleted: id, row: r + 1 }; }
  }
  return { ok: false, error: "id not found: " + id };
}
