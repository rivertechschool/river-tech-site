/**
 * River Tech — Silverwood Field Trip Registration Backend
 * Google Apps Script web app. Deploy with:
 *   Deploy > Manage deployments > Edit (pencil) > New version > Deploy
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * Handles the Silverwood June 1, 2026 field trip form. Multi-participant
 * model: one parent registers a family (full-time or homeschool), each
 * person is either a Student or a Parent/family member. Read 2 Ride
 * students are free; everyone else is $35.
 *
 * Per submission:
 *   1. Validate payload structure.
 *   2. Append one row PER PARTICIPANT to the Sheet (auto-init headers).
 *   3. If totalUSD > 0: create a single Stripe Checkout Session covering
 *      the whole registration. (R2R-only families bypass Stripe.)
 *   4. Email parent + notify learn@rivertech.me and dhegelund@gmail.com.
 *   5. Return { ok: true, registrationId, checkoutUrl? }.
 *
 * Script Properties (set via Project Settings > Script Properties):
 *   SHEET_ID           — Google Sheet ID for "Silverwood Field Trip 2026-06-01"
 *   STRIPE_SECRET_KEY  — sk_live_... (same key already used by RTD; do not change)
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

const PRICE_PER_PERSON_USD = 35;

// ---- Web-app entrypoints ------------------------------------------------
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    // Route by payload type. Waiver submissions tag themselves with
    // `waiverType`; everything else is treated as a field-trip submission.
    if (payload && payload.waiverType === "hs-super1-lunch") {
      return json_(handleWaiverSubmission_(payload));
    }
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
    message: "River Tech Field Trip + Waiver backend is alive.",
    handlers: ["Silverwood field trip (June 1, 2026)", "HS Off-Campus Lunch Waiver"]
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
  if (!p || !p.trip || !p.parent || !p.participants || !p.release) {
    return { ok: false, error: "Registration data was incomplete. Please fill out every required field." };
  }
  if (p.trip.id !== "silverwood-2026-06-01") {
    return { ok: false, error: "Unknown trip. Please refresh and try again." };
  }
  if (p.familyType !== "full-time" && p.familyType !== "homeschool") {
    return { ok: false, error: "Please choose a family type." };
  }
  if (!p.parent.firstName || !p.parent.lastName || !p.parent.email || !p.parent.phone) {
    return { ok: false, error: "Parent/guardian information is incomplete." };
  }
  if (!Array.isArray(p.participants) || p.participants.length === 0) {
    return { ok: false, error: "Please add at least one participant." };
  }
  for (let i = 0; i < p.participants.length; i++) {
    const part = p.participants[i];
    if (!part.firstName || !part.lastName || !part.age || !part.type) {
      return { ok: false, error: "Participant " + (i + 1) + " is missing required information." };
    }
    if (p.familyType === "full-time" && part.type === "student" && !part.transport) {
      return { ok: false, error: "Participant " + (i + 1) + ": transportation choice is required for full-time students." };
    }
  }
  if (!p.release.signatureName) {
    return { ok: false, error: "Please type your signature (parent/guardian full name)." };
  }
  if (!p.release.agreed) {
    return { ok: false, error: "Please check the release agreement box." };
  }

  const registrationId = "SW-" + Utilities.formatDate(
    new Date(), "America/Los_Angeles", "yyyyMMdd-HHmmss"
  ) + "-" + Math.floor(Math.random() * 1000).toString().padStart(3, "0");

  // Compute the trustworthy total server-side (don't trust client math)
  let paidCount = 0;
  let freeCount = 0;
  p.participants.forEach(function (part) {
    const isStudent = part.type === "student";
    const isR2R = !!(part.read2Ride && isStudent && p.familyType === "full-time");
    if (isR2R) freeCount += 1;
    else paidCount += 1;
  });
  const totalUSD = paidCount * PRICE_PER_PERSON_USD;

  // 1. Write rows to Sheet (one per participant)
  writeToSheet_(registrationId, p, totalUSD);

  // 2. Stripe Checkout (only if totalUSD > 0)
  let checkoutUrl = null;
  if (totalUSD > 0) {
    checkoutUrl = createStripeSession_(registrationId, p, totalUSD, paidCount);
  }

  // 3. Emails
  sendParentEmail_(registrationId, p, totalUSD, paidCount, freeCount);
  sendNotificationEmail_(registrationId, p, totalUSD, paidCount, freeCount);

  return { ok: true, registrationId: registrationId, checkoutUrl: checkoutUrl };
}

// ---- Sheet write --------------------------------------------------------
function headerRow_() {
  return [
    "Registration ID",
    "Submitted (UTC)",
    "Status",
    "Family Type",
    "Parent First",
    "Parent Last",
    "Parent Email",
    "Parent Phone",
    "Participant First",
    "Participant Last",
    "Participant Age",
    "Participant Type",
    "Read 2 Ride",
    "Transportation",
    "Price (USD)",
    "Registration Total (USD)",
    "Paid",
    "Signature Name",
    "Signature Date",
    "Ack: Homeschool Supervision",
    "Ack: No Swimsuits",
    "Ack: No Devices",
    "Ack: Schedule Read"
  ];
}

function writeToSheet_(registrationId, p, totalUSD) {
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

  const status = totalUSD > 0
    ? "Submitted (awaiting payment)"
    : "Submitted (free — R2R only)";
  const paidLabel = totalUSD > 0 ? "No" : "N/A (free)";
  const submittedAt = p.submittedAt || new Date().toISOString();

  p.participants.forEach(function (part) {
    const isStudent = part.type === "student";
    const isR2R = !!(part.read2Ride && isStudent && p.familyType === "full-time");
    const pricePerPerson = isR2R ? 0 : PRICE_PER_PERSON_USD;

    const row = [
      registrationId,
      submittedAt,
      status,
      p.familyType,
      p.parent.firstName,
      p.parent.lastName,
      p.parent.email,
      p.parent.phone,
      part.firstName,
      part.lastName,
      part.age,
      part.typeLabel || part.type,
      isR2R ? "Yes (free)" : (isStudent ? "No" : "N/A"),
      part.transportLabel || part.transport || "",
      pricePerPerson,
      totalUSD,
      paidLabel,
      (p.release && p.release.signatureName) || "",
      (p.release && p.release.signatureDate) || "",
      (p.acknowledgments && p.acknowledgments.homeschoolSupervision) ? "Yes" : "",
      (p.acknowledgments && p.acknowledgments.noSwimsuits) ? "Yes" : "",
      (p.acknowledgments && p.acknowledgments.noDevices) ? "Yes" : "",
      (p.acknowledgments && p.acknowledgments.scheduleRead) ? "Yes" : ""
    ];

    sh.appendRow(row);
  });
}

// ---- Stripe Checkout ----------------------------------------------------
function createStripeSession_(registrationId, p, totalUSD, paidCount) {
  const secretKey = cfg("STRIPE_SECRET_KEY");
  if (!secretKey) {
    Logger.log("No Stripe key configured — returning null checkout URL.");
    return null;
  }

  const amountCents = Math.round(PRICE_PER_PERSON_USD * 100);
  if (paidCount <= 0) throw new Error("paidCount must be > 0 to charge.");

  const parentName = (p.parent.firstName + " " + p.parent.lastName).trim();
  const description = "Silverwood field trip — " + paidCount +
    " paid participant" + (paidCount === 1 ? "" : "s") + " · " + parentName;

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
    "metadata[familyType]": p.familyType,
    "metadata[paidCount]": String(paidCount),
    "metadata[totalUSD]": String(totalUSD),
    "metadata[trip]": p.trip.id,
    "metadata[tripDate]": p.trip.date,
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][product_data][name]": "Silverwood Field Trip — June 1, 2026",
    "line_items[0][price_data][product_data][description]": description,
    "line_items[0][price_data][unit_amount]": String(amountCents),
    "line_items[0][quantity]": String(paidCount)
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
function sendParentEmail_(registrationId, p, totalUSD, paidCount, freeCount) {
  const subject = "Silverwood Field Trip Registration Received — June 1, 2026";

  const lines = [
    "Hi " + p.parent.firstName + ",",
    "",
    "Thanks for registering your family for the Silverwood field trip on Monday, June 1, 2026.",
    "",
    "Confirmation reference: " + registrationId,
    "Family type: " + (p.familyType === "full-time" ? "Full-time" : "Homeschool"),
    "Participants: " + p.participants.length +
      " (" + paidCount + " paid · " + freeCount + " free)",
    "Total: $" + totalUSD + (totalUSD > 0 ? " — paid via Stripe at registration. A separate receipt comes from Stripe." : " (free — Read 2 Ride only)"),
    ""
  ];

  lines.push("Registered participants:");
  p.participants.forEach(function (part) {
    const isStudent = part.type === "student";
    const isR2R = !!(part.read2Ride && isStudent && p.familyType === "full-time");
    const priceLabel = isR2R ? "Free (R2R)" : ("$" + PRICE_PER_PERSON_USD);
    const transportSuffix = part.transportLabel ? " · " + part.transportLabel : "";
    lines.push("  • " + part.firstName + " " + part.lastName +
      " (" + (part.typeLabel || part.type) + ", age " + part.age + ") — " +
      priceLabel + transportSuffix);
  });
  lines.push("");

  if (p.familyType === "full-time") {
    lines.push("Schedule (bus riders):");
    lines.push("  8:50 AM — Student drop-off at River Tech / The Heart");
    lines.push("  9:00 AM — School bus departs");
    lines.push("  9:45 AM — Bus arrives at Silverwood, security check");
    lines.push("  10:00 AM — Meet at the ticket windows by the bathrooms, group split, tickets handed out");
    lines.push("  11:00 AM — Park opens");
    lines.push("  4:30 PM — Begin heading back to bus");
    lines.push("  5:00 PM — Bus departs Silverwood");
    lines.push("  5:45 PM — Bus arrives back at The Heart for pick-up");
    lines.push("");
  } else {
    lines.push("Schedule (homeschool families):");
    lines.push("  10:00 AM — Meet at the ticket windows by the bathrooms at Silverwood");
    lines.push("  Mary will hand out tickets here for everyone in your family.");
    lines.push("  11:00 AM — Park opens");
    lines.push("  6:00 PM — Park closes");
    lines.push("");
    lines.push("Reminder: homeschool students must have a parent or responsible adult with them all day.");
    lines.push("");
  }

  lines.push("What to bring:");
  lines.push("  • Cold lunch and dinner (or money for food)");
  lines.push("  • Snacks (or money for snacks)");
  lines.push("  • Large water bottle filled with cold water (mandatory)");
  lines.push("  • Hydration drinks (recommended)");
  lines.push("  • Sunscreen + sun hat (recommended)");
  lines.push("  • Light, weather-appropriate clothes");
  lines.push("  • Extra clothes + small towel (many students will get wet on rides)");
  lines.push("  • Phone (optional)");
  lines.push("");
  lines.push("Not allowed: tablets, laptops, other devices. Swimsuits not allowed — no Boulder Beach this trip.");
  lines.push("");
  lines.push("Questions? Text Mary at 425-444-2271 (24–48 hr reply time) or reply to this email.");
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

function sendNotificationEmail_(registrationId, p, totalUSD, paidCount, freeCount) {
  const parentName = p.parent.firstName + " " + p.parent.lastName;
  const subject = "[Silverwood] " + parentName +
    " — " + p.participants.length + " ppl ($" + totalUSD + ")";

  const lines = [
    "New Silverwood Field Trip registration.",
    "",
    "Reference: " + registrationId,
    "Submitted: " + (p.submittedAt || new Date().toISOString()),
    "Family type: " + p.familyType,
    "Total: $" + totalUSD + " (" + paidCount + " paid · " + freeCount + " free R2R)",
    "",
    "Parent: " + parentName,
    "Email:  " + p.parent.email,
    "Phone:  " + p.parent.phone,
    ""
  ];

  lines.push("Participants:");
  p.participants.forEach(function (part) {
    const isStudent = part.type === "student";
    const isR2R = !!(part.read2Ride && isStudent && p.familyType === "full-time");
    const tag = isR2R ? "FREE (R2R)" : ("$" + PRICE_PER_PERSON_USD);
    const transport = part.transportLabel ? " · " + part.transportLabel : "";
    lines.push("  • " + part.firstName + " " + part.lastName +
      " (" + (part.typeLabel || part.type) + ", age " + part.age + ") — " + tag + transport);
  });
  lines.push("");

  // Bus summary for full-time families
  if (p.familyType === "full-time") {
    let busBoth = 0, busThere = 0, busBack = 0, ownBoth = 0;
    p.participants.forEach(function (part) {
      if (part.type !== "student") return;
      if (part.transport === "bus-both") busBoth += 1;
      else if (part.transport === "bus-there") busThere += 1;
      else if (part.transport === "bus-back") busBack += 1;
      else if (part.transport === "own-both") ownBoth += 1;
    });
    lines.push("Bus summary for this family:");
    lines.push("  Bus both ways:        " + busBoth);
    lines.push("  Bus there only:       " + busThere);
    lines.push("  Bus back only:        " + busBack);
    lines.push("  Own transport both:   " + ownBoth);
    lines.push("");
  }

  lines.push("Acknowledgments:");
  lines.push("  Homeschool supervision: " + ((p.acknowledgments && p.acknowledgments.homeschoolSupervision) ? "Yes" : "—"));
  lines.push("  No swimsuits:           " + ((p.acknowledgments && p.acknowledgments.noSwimsuits) ? "Yes" : "—"));
  lines.push("  No devices:             " + ((p.acknowledgments && p.acknowledgments.noDevices) ? "Yes" : "—"));
  lines.push("  Schedule read:          " + ((p.acknowledgments && p.acknowledgments.scheduleRead) ? "Yes" : "—"));
  lines.push("");
  lines.push("Signed: " + (p.release && p.release.signatureName) + " on " + (p.release && p.release.signatureDate));
  lines.push("");
  lines.push("Rows appended to Silverwood Field Trip 2026-06-01 sheet (one per participant).");

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
 * Run once from the Apps Script editor after setting Script Properties.
 * Verifies the SHEET_ID and STRIPE_SECRET_KEY are reachable.
 */
function verifyConfig() {
  const sheetId = cfg("SHEET_ID");
  const stripeKey = cfg("STRIPE_SECRET_KEY");
  Logger.log("SHEET_ID set: " + !!sheetId);
  Logger.log("STRIPE_SECRET_KEY set: " + !!stripeKey + (stripeKey ? " (" + stripeKey.slice(0, 8) + "...)" : ""));
  if (sheetId) {
    try {
      const ss = SpreadsheetApp.openById(sheetId);
      Logger.log("Sheet name: " + ss.getName());
    } catch (e) {
      Logger.log("Cannot open sheet: " + e.message);
    }
  }
}

/**
 * Self-test: fake an R2R-only ($0) full-time registration through the full
 * pipeline. Hits the Sheet + emails. Skips Stripe (totalUSD === 0).
 */
function selfTestR2ROnly() {
  const fake = {
    submittedAt: new Date().toISOString(),
    trip: {
      id: "silverwood-2026-06-01",
      name: "Silverwood Field Trip",
      date: "2026-06-01",
      deadline: "2026-05-28",
      pricePerPersonUSD: 35
    },
    familyType: "full-time",
    parent: {
      firstName: "Test",
      lastName: "Parent",
      email: Session.getActiveUser().getEmail() || "dhegelund@gmail.com",
      phone: "555-0100"
    },
    participants: [
      {
        firstName: "TestKid",
        lastName: "Parent",
        age: "10",
        type: "student",
        typeLabel: "Student",
        transport: "bus-both",
        transportLabel: "Bus both ways",
        read2Ride: true,
        priceUSD: 0
      }
    ],
    counts: { paid: 0, free: 1, total: 1 },
    totalUSD: 0,
    acknowledgments: {
      homeschoolSupervision: false,
      noSwimsuits: true,
      noDevices: true,
      scheduleRead: true
    },
    release: {
      agreed: true,
      signatureName: "Test Parent",
      signatureDate: new Date().toISOString().slice(0, 10)
    }
  };
  Logger.log(JSON.stringify(handleSubmission(fake), null, 2));
}

/**
 * Self-test: fake a $35 single-paying registration. Returns a real Stripe
 * Checkout URL (LIVE mode). Do NOT actually pay unless you intend to.
 */
function selfTestSinglePaid() {
  const fake = {
    submittedAt: new Date().toISOString(),
    trip: {
      id: "silverwood-2026-06-01",
      name: "Silverwood Field Trip",
      date: "2026-06-01",
      deadline: "2026-05-28",
      pricePerPersonUSD: 35
    },
    familyType: "homeschool",
    parent: {
      firstName: "Test",
      lastName: "Homeschool",
      email: Session.getActiveUser().getEmail() || "dhegelund@gmail.com",
      phone: "555-0100"
    },
    participants: [
      {
        firstName: "TestParent",
        lastName: "Homeschool",
        age: "40",
        type: "family",
        typeLabel: "Parent or family member",
        transport: "",
        transportLabel: "",
        read2Ride: false,
        priceUSD: 35
      }
    ],
    counts: { paid: 1, free: 0, total: 1 },
    totalUSD: 35,
    acknowledgments: {
      homeschoolSupervision: true,
      noSwimsuits: false,
      noDevices: false,
      scheduleRead: false
    },
    release: {
      agreed: true,
      signatureName: "Test Homeschool",
      signatureDate: new Date().toISOString().slice(0, 10)
    }
  };
  Logger.log(JSON.stringify(handleSubmission(fake), null, 2));
}

// =========================================================================
// HS Super 1 Lunch Waiver — handlers bundled into this project so we
// don't need a fresh OAuth grant. Routed via doPost based on
// payload.waiverType === "hs-super1-lunch". Writes to a separate sheet
// (configured via Script Property WAIVER_SHEET_ID).
// =========================================================================

const WAIVER_SHEET_TAB_NAME = "Waivers";
const WAIVER_PAGE_URL = "https://www.rivertechschool.com/pages/hs-super1-waiver.html";

function handleWaiverSubmission_(p) {
  if (!p || !p.parent || !p.release) {
    return { ok: false, error: "Waiver data is incomplete. Please fill out every required field." };
  }
  if (!p.parent.firstName || !p.parent.lastName || !p.parent.email || !p.parent.phone) {
    return { ok: false, error: "Parent/guardian information is incomplete." };
  }
  // Support both new multi-student payload (p.students) and legacy
  // single-student payload (p.student) for backwards compatibility.
  let students = p.students;
  if (!students && p.student) students = [p.student];
  if (!Array.isArray(students) || students.length === 0) {
    return { ok: false, error: "Please add at least one HS student." };
  }
  for (let i = 0; i < students.length; i++) {
    const s = students[i];
    if (!s || !s.firstName || !s.lastName || !s.grade) {
      return { ok: false, error: "Student " + (i + 1) + " is missing required information." };
    }
  }
  if (!p.release.signatureName) {
    return { ok: false, error: "Please type your signature (parent/guardian full name)." };
  }
  if (!p.release.agreed) {
    return { ok: false, error: "Please check the agreement box." };
  }

  const registrationId = "WV-" + Utilities.formatDate(
    new Date(), "America/Los_Angeles", "yyyyMMdd-HHmmss"
  ) + "-" + Math.floor(Math.random() * 1000).toString().padStart(3, "0");

  writeWaiverToSheet_(registrationId, p, students);
  sendWaiverParentEmail_(registrationId, p, students);
  sendWaiverNotificationEmail_(registrationId, p, students);

  return { ok: true, registrationId: registrationId };
}

function waiverHeaderRow_() {
  return [
    "Waiver ID", "Submitted (UTC)", "School Year",
    "Parent First", "Parent Last", "Parent Email", "Parent Phone",
    "Student First", "Student Last", "Student Grade",
    "Agreement", "Signature Name", "Signature Date", "Status"
  ];
}

function writeWaiverToSheet_(registrationId, p, students) {
  const sheetId = cfg("WAIVER_SHEET_ID");
  if (!sheetId) throw new Error("WAIVER_SHEET_ID is not configured in Script Properties.");
  const ss = SpreadsheetApp.openById(sheetId);
  let sh = ss.getSheetByName(WAIVER_SHEET_TAB_NAME);
  if (!sh) sh = ss.insertSheet(WAIVER_SHEET_TAB_NAME);

  if (sh.getLastRow() === 0) {
    const header = waiverHeaderRow_();
    sh.appendRow(header);
    sh.getRange(1, 1, 1, header.length).setFontWeight("bold");
    sh.setFrozenRows(1);
  }

  const submittedAt = p.submittedAt || new Date().toISOString();
  const sigName = (p.release && p.release.signatureName) || "";
  const sigDate = (p.release && p.release.signatureDate) || "";

  students.forEach(function (s) {
    const row = [
      registrationId,
      submittedAt,
      p.schoolYear || "2025-26",
      p.parent.firstName,
      p.parent.lastName,
      p.parent.email,
      p.parent.phone,
      s.firstName,
      s.lastName,
      s.grade,
      "Yes",
      sigName,
      sigDate,
      "Active"
    ];
    sh.appendRow(row);
  });
}

function sendWaiverParentEmail_(registrationId, p, students) {
  const studentNames = students.map(function (s) {
    return s.firstName + " " + s.lastName + " (Grade " + s.grade + ")";
  }).join(", ");
  const subject = "HS Off-Campus Lunch Waiver — Received";

  const lines = [
    "Hi " + p.parent.firstName + ",",
    "",
    "Thanks for opting your student" + (students.length > 1 ? "s" : "") + " into the High School off-campus lunch privilege at River Tech.",
    "",
    "Confirmation reference: " + registrationId,
    "Student" + (students.length > 1 ? "s" : "") + ": " + studentNames,
    "",
    "Quick reminders of the policy you agreed to:",
    "  • Tuesday and Wednesday only, 11:45 AM – 12:05 PM",
    "  • Students should tell a teacher before leaving",
    "  • Teachers will check at 12:05 that all students have returned",
    "  • Late return or off-campus misbehavior = privilege revoked immediately",
    "  • Students may go alone or in a small group (their choice)",
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
    Logger.log("Waiver parent email failed: " + err);
  }
}

function sendWaiverNotificationEmail_(registrationId, p, students) {
  const subject = "[Waiver] HS Off-Campus Lunch — " + p.parent.firstName + " " + p.parent.lastName + " (" + students.length + " student" + (students.length > 1 ? "s" : "") + ")";

  const lines = [
    "New HS Off-Campus Lunch Waiver received.",
    "",
    "Reference: " + registrationId,
    "Submitted: " + (p.submittedAt || new Date().toISOString()),
    "",
    "Parent: " + p.parent.firstName + " " + p.parent.lastName,
    "Email:  " + p.parent.email,
    "Phone:  " + p.parent.phone,
    "",
    "Students (" + students.length + "):"
  ];
  students.forEach(function (s) {
    lines.push("  • " + s.firstName + " " + s.lastName + " (Grade " + s.grade + ")");
  });
  lines.push("");
  lines.push("Signed: " + (p.release && p.release.signatureName) + " on " + (p.release && p.release.signatureDate));
  lines.push("");
  lines.push("Row" + (students.length > 1 ? "s" : "") + " appended to the HS Off-Campus Lunch Waivers sheet (one per student).");

  try {
    MailApp.sendEmail({
      to: NOTIFY_EMAILS.join(","),
      subject: subject,
      body: lines.join("\n"),
      name: "River Tech Waivers"
    });
  } catch (err) {
    Logger.log("Waiver notification email failed: " + err);
  }
}

function verifyWaiverConfig() {
  const sheetId = cfg("WAIVER_SHEET_ID");
  Logger.log("WAIVER_SHEET_ID set: " + !!sheetId);
  if (sheetId) {
    try {
      const ss = SpreadsheetApp.openById(sheetId);
      Logger.log("Waiver sheet name: " + ss.getName());
    } catch (e) {
      Logger.log("Cannot open waiver sheet: " + e.message);
    }
  }
}
