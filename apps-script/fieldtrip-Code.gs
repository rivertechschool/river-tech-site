/**
 * River Tech — Field Trip Registration Backend
 * Google Apps Script web app. Deploy with:
 *   Deploy > New deployment > Type: Web app
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * Handles ONE field trip form (April 29, 2026 trip: Karate + CDA Park
 * OR NIC Tour + CDA Park). When we universalize the form later, this
 * backend gets replaced; for now it's purpose-built for this trip.
 *
 * Per submission:
 *   1. Validate payload structure.
 *   2. Append a row to the Sheet (auto-initialize header row).
 *   3. For Karate trips: create Stripe Checkout Session.
 *   4. Email parent + notify learn@rivertech.me and dhegelund@gmail.com.
 *   5. Return { ok: true, registrationId, checkoutUrl? }.
 *
 * Script Properties (set via Project Settings > Script Properties):
 *   SHEET_ID           — Google Sheet ID (file in My Drive/RTS Website Forms/)
 *   STRIPE_SECRET_KEY  — sk_live_... (same key used by RTD; one key, one org)
 */

// ---- Config helpers -----------------------------------------------------
function cfg(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

const NOTIFY_EMAILS = ["learn@rivertech.me", "dhegelund@gmail.com"];
const SCHOOL_NAME = "River Tech School of Performing Arts & Technology";
const FIELDTRIP_PAGE_URL = "https://www.rivertechschool.com/pages/fieldtrips.html";
const FORM_PAGE_URL = "https://www.rivertechschool.com/pages/register-fieldtrip.html";
const SUCCESS_URL = "https://www.rivertechschool.com/pages/register-fieldtrip-success.html?session_id={CHECKOUT_SESSION_ID}";
const CANCEL_URL = "https://www.rivertechschool.com/pages/register-fieldtrip.html";
const SHEET_TAB_NAME = "Signups";

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
    message: "River Tech Field Trip backend is alive.",
    trip: "April 29, 2026"
  });
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---- Core handler -------------------------------------------------------
function handleSubmission(p) {
  // Validate top-level structure
  if (!p || !p.trip || !p.parent || !p.student || !p.release) {
    return { ok: false, error: "Registration data was incomplete. Please fill out every required field." };
  }
  if (p.trip.id !== "karate" && p.trip.id !== "nic") {
    return { ok: false, error: "Unknown trip selection. Please refresh the page and try again." };
  }
  if (!p.parent.firstName || !p.parent.lastName || !p.parent.email || !p.parent.phone) {
    return { ok: false, error: "Parent/guardian information is incomplete." };
  }
  if (!p.student.firstName || !p.student.lastName || !p.student.grade || !p.student.age) {
    return { ok: false, error: "Student information is incomplete." };
  }
  if (!p.release.signatureName) {
    return { ok: false, error: "Please type your signature (parent/guardian full name)." };
  }
  if (!p.release.agreed) {
    return { ok: false, error: "Please check the release agreement box." };
  }

  const registrationId = "FT-" + Utilities.formatDate(
    new Date(), "America/Los_Angeles", "yyyyMMdd-HHmmss"
  ) + "-" + Math.floor(Math.random() * 1000).toString().padStart(3, "0");

  // 1. Write to Sheet
  writeToSheet_(registrationId, p);

  // 2. Stripe Checkout (Karate only)
  let checkoutUrl = null;
  if (p.trip.id === "karate" && p.trip.requiresPayment) {
    checkoutUrl = createStripeSession_(registrationId, p);
  }

  // 3. Emails
  sendParentEmail_(registrationId, p);
  sendNotificationEmail_(registrationId, p);

  return { ok: true, registrationId: registrationId, checkoutUrl: checkoutUrl };
}

// ---- Sheet write --------------------------------------------------------
function headerRow_() {
  return [
    "Registration ID",
    "Submitted (UTC)",
    "Status",
    "Trip",
    "Trip Name",
    "Parent First",
    "Parent Last",
    "Parent Email",
    "Parent Phone",
    "Emergency Contact Name",
    "Emergency Contact Phone",
    "Student First",
    "Student Last",
    "Student Grade",
    "Student Age",
    "Homeschool",
    "Dropoff Request",
    "Allergies",
    "Medications",
    "Medical Conditions",
    "First Aid Permission",
    "Chaperone Volunteer",
    "Notes",
    "Signature Name",
    "Signature Date",
    "Amount (USD)",
    "Paid"
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

  const isPaid = p.trip.id === "nic" ? "N/A (free)" : "No";
  const status = p.trip.id === "nic"
    ? "Submitted (free trip)"
    : "Submitted (awaiting payment)";

  const row = [
    registrationId,
    p.submittedAt || new Date().toISOString(),
    status,
    p.trip.id,
    p.trip.name || "",
    p.parent.firstName,
    p.parent.lastName,
    p.parent.email,
    p.parent.phone,
    (p.emergency && p.emergency.name) || "",
    (p.emergency && p.emergency.phone) || "",
    p.student.firstName,
    p.student.lastName,
    p.student.grade,
    p.student.age,
    p.homeschool && p.homeschool.isHomeschool ? "Yes" : "No",
    p.homeschool && p.homeschool.dropoffRequest ? "Yes" : "No",
    (p.medical && p.medical.allergies) || "",
    (p.medical && p.medical.medications) || "",
    (p.medical && p.medical.medicalConditions) || "",
    p.medical && p.medical.firstAidPermission ? "Yes" : "No",
    p.chaperone || "",
    p.notes || "",
    (p.release && p.release.signatureName) || "",
    (p.release && p.release.signatureDate) || "",
    p.trip.price || 0,
    isPaid
  ];

  sh.appendRow(row);
}

// ---- Stripe Checkout ----------------------------------------------------
function createStripeSession_(registrationId, p) {
  const secretKey = cfg("STRIPE_SECRET_KEY");
  if (!secretKey) {
    Logger.log("No Stripe key configured — returning null checkout URL.");
    return null;
  }

  const amountCents = Math.round((p.trip.price || 0) * 100);
  if (amountCents <= 0) throw new Error("Trip price must be greater than zero for paid trips.");

  const parentName = (p.parent.firstName + " " + p.parent.lastName).trim();
  const studentName = (p.student.firstName + " " + p.student.lastName).trim();
  const description = p.trip.name + " — " + studentName + " (Grade " + p.student.grade + ")";

  const params = {
    "mode": "payment",
    "success_url": SUCCESS_URL,
    "cancel_url": CANCEL_URL,
    "customer_email": p.parent.email,
    "client_reference_id": registrationId,
    "metadata[registrationId]": registrationId,
    "metadata[parentName]": parentName,
    "metadata[parentEmail]": p.parent.email,
    "metadata[parentPhone]": p.parent.phone,
    "metadata[studentName]": studentName,
    "metadata[studentGrade]": String(p.student.grade),
    "metadata[trip]": p.trip.id,
    "metadata[tripDate]": p.trip.date,
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][product_data][name]": "River Tech Field Trip — " + p.trip.name,
    "line_items[0][price_data][product_data][description]": description,
    "line_items[0][price_data][unit_amount]": String(amountCents),
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
  const isKarate = p.trip.id === "karate";
  const subject = "Field Trip Registration Received — April 29 " + (isKarate ? "Karate" : "NIC") + " Trip";

  const lines = [
    "Hi " + p.parent.firstName + ",",
    "",
    "Thanks for registering " + p.student.firstName + " for the April 29 field trip.",
    "",
    "Confirmation reference: " + registrationId,
    "Trip: " + p.trip.name,
    "Date: Wednesday, April 29, 2026",
    ""
  ];

  if (isKarate) {
    lines.push("Schedule:");
    lines.push("  9:45 AM — Drop-off at Christian Karate Coeur d'Alene");
    lines.push("  10:00–11:00 AM — Karate workshop");
    lines.push("  11:15 AM — School bus to CDA City Park");
    lines.push("  11:30 AM–2:00 PM — Lunch, Fort Sherman playground, beach time");
    lines.push("  2:00 PM — Pickup at Rotary Bandshell (CDA City Park)");
    lines.push("");
    lines.push("What to bring:");
    lines.push("  • Backpack, comfortable athletic clothes & shoes");
    lines.push("  • Large water bottle (or two)");
    lines.push("  • Cold lunch and snacks");
    lines.push("  • Extra t-shirt (recommended)");
    lines.push("  • Sunscreen (weather dependent)");
    lines.push("  • Optional: swimsuit + towel");
    lines.push("  • No electronic devices");
    lines.push("");
    if (p.trip.requiresPayment) {
      lines.push("Payment: $10 — paid via Stripe at registration. A separate receipt comes from Stripe.");
      lines.push("");
    }
  } else {
    lines.push("Schedule:");
    lines.push("  10:15 AM — Drop-off at DeArmond College & University Center");
    lines.push("            901 W River Ave, Coeur d'Alene, ID");
    lines.push("  10:30–11:45 AM — NIC campus tour");
    lines.push("  11:45 AM — Walk to CDA City Park");
    lines.push("  12:00–2:00 PM — Lunch, beach, volleyball, basketball, playground");
    lines.push("  2:00 PM — Pickup at Rotary Bandshell (CDA City Park)");
    lines.push("");
    lines.push("What to bring:");
    lines.push("  • Backpack, water bottle, cold lunch");
    lines.push("  • Sunscreen (if sunny)");
    lines.push("  • Optional: swimsuit + towel");
    lines.push("  • No electronic devices (phones allowed for communication if needed)");
    lines.push("");
    lines.push("Cost: Free");
    lines.push("");
  }

  lines.push("Times and pickup locations are subject to minor adjustments — we'll email any updates.");
  lines.push("");
  lines.push("If you have questions, reply to this email or write learn@rivertech.me.");
  lines.push("");
  lines.push(SCHOOL_NAME);
  lines.push("927 E Polston Ave, Post Falls, ID 83854");
  lines.push(FIELDTRIP_PAGE_URL);

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
  const subject = "[Field Trip] " + p.trip.name.split(" ")[0] + " — " +
    p.student.firstName + " " + p.student.lastName +
    " (Grade " + p.student.grade + ")";

  const lines = [
    "New Field Trip registration.",
    "",
    "Reference: " + registrationId,
    "Submitted: " + (p.submittedAt || new Date().toISOString()),
    "Trip: " + p.trip.name,
    "Price: $" + (p.trip.price || 0) + (p.trip.requiresPayment ? " (via Stripe)" : " (free)"),
    "",
    "Student: " + p.student.firstName + " " + p.student.lastName +
      " (Grade " + p.student.grade + ", age " + p.student.age + ")",
    "",
    "Parent: " + p.parent.firstName + " " + p.parent.lastName,
    "Email:  " + p.parent.email,
    "Phone:  " + p.parent.phone,
    ""
  ];

  if (p.emergency && (p.emergency.name || p.emergency.phone)) {
    lines.push("Emergency contact: " + (p.emergency.name || "(same as parent)") + " — " + (p.emergency.phone || ""));
    lines.push("");
  }

  if (p.homeschool && p.homeschool.isHomeschool) {
    lines.push("Homeschool: Yes" + (p.homeschool.dropoffRequest ? " (REQUESTING drop-off permission — age 11+)" : ""));
    lines.push("");
  }

  lines.push("Medical:");
  lines.push("  Allergies:   " + ((p.medical && p.medical.allergies) || "(none)"));
  lines.push("  Medications: " + ((p.medical && p.medical.medications) || "(none)"));
  lines.push("  Conditions:  " + ((p.medical && p.medical.medicalConditions) || "(none)"));
  lines.push("  First aid OK: " + (p.medical && p.medical.firstAidPermission ? "Yes" : "No"));
  lines.push("");

  if (p.trip.id === "karate") {
    lines.push("Chaperone volunteer: " + (p.chaperone || "(not answered)"));
    lines.push("");
  }

  lines.push("Notes: " + (p.notes || "(none)"));
  lines.push("");
  lines.push("Signed: " + (p.release && p.release.signatureName) + " on " + (p.release && p.release.signatureDate));
  lines.push("");
  lines.push("Row has been appended to the Field Trip Signups 2026 sheet.");

  try {
    MailApp.sendEmail({
      to: NOTIFY_EMAILS.join(","),
      subject: subject,
      body: lines.join("\n"),
      name: "River Tech Field Trips"
    });
  } catch (err) {
    Logger.log("Notification email failed: " + err);
  }
}

// ---- Setup & self-test helpers ------------------------------------------
/**
 * Run once from the Apps Script editor to load Script Properties.
 * Replace the placeholder strings first. After running, DELETE the
 * values from this function and re-save — Script Properties keeps them.
 */
function setupConfig_ONCE() {
  PropertiesService.getScriptProperties().setProperties({
    "SHEET_ID": "PASTE_SHEET_ID_HERE",
    "STRIPE_SECRET_KEY": "PASTE_STRIPE_SECRET_KEY_HERE"
  });
  Logger.log("Config set. Now clear the placeholders from this function.");
}

/**
 * Quick self-test — fake a Karate registration and run it through the
 * full pipeline. Check the sheet, your inbox, and the Stripe dashboard.
 */
function selfTestKarate() {
  const fake = {
    submittedAt: new Date().toISOString(),
    trip: {
      id: "karate",
      name: "Christian Karate + CDA Park",
      date: "2026-04-29",
      gradeBand: "Elementary & Middle",
      price: 10,
      requiresPayment: true
    },
    parent: {
      firstName: "Test",
      lastName: "Parent",
      email: Session.getActiveUser().getEmail() || "dhegelund@gmail.com",
      phone: "555-0100"
    },
    emergency: { name: "Test Emergency", phone: "555-0101" },
    student: {
      firstName: "Testchild",
      lastName: "Parent",
      grade: "5",
      age: "10"
    },
    homeschool: { isHomeschool: false, dropoffRequest: false },
    medical: {
      allergies: "none",
      medications: "none",
      medicalConditions: "none",
      firstAidPermission: true
    },
    chaperone: "maybe",
    notes: "Self-test submission — delete this row.",
    release: {
      agreed: true,
      signatureName: "Test Parent",
      signatureDate: new Date().toISOString().slice(0, 10)
    }
  };
  Logger.log(JSON.stringify(handleSubmission(fake), null, 2));
}

function selfTestNIC() {
  const fake = {
    submittedAt: new Date().toISOString(),
    trip: {
      id: "nic",
      name: "North Idaho College Tour + CDA Park",
      date: "2026-04-29",
      gradeBand: "High School",
      price: 0,
      requiresPayment: false
    },
    parent: {
      firstName: "Test",
      lastName: "Parent",
      email: Session.getActiveUser().getEmail() || "dhegelund@gmail.com",
      phone: "555-0100"
    },
    emergency: { name: "", phone: "555-0100" },
    student: {
      firstName: "Teststudent",
      lastName: "Parent",
      grade: "11",
      age: "16"
    },
    homeschool: { isHomeschool: false, dropoffRequest: false },
    medical: {
      allergies: "none",
      medications: "none",
      medicalConditions: "none",
      firstAidPermission: true
    },
    chaperone: "",
    notes: "Self-test NIC submission — delete this row.",
    release: {
      agreed: true,
      signatureName: "Test Parent",
      signatureDate: new Date().toISOString().slice(0, 10)
    }
  };
  Logger.log(JSON.stringify(handleSubmission(fake), null, 2));
}
