/**
 * River Tech Days — Registration Backend
 * Google Apps Script web app. Deploy with:
 *   Deploy > New deployment > Type: Web app
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * Fills two jobs per submission:
 *   1. Append a row to the Sheet below (SHEET_ID).
 *   2. Create a Stripe Checkout Session (one line item, amount = total).
 *   3. Email parent + Dan.
 *   4. Return { ok: true, checkoutUrl } to the browser.
 *
 * Stripe & Sheet config is stored in Script Properties (see setup notes
 * at bottom of file).
 */

// ---- Constants (read from Script Properties at runtime) -----------------
function cfg(key) {
  const p = PropertiesService.getScriptProperties();
  return p.getProperty(key);
}

const NOTIFY_EMAILS = ["learn@rivertech.me", "dhegelund@gmail.com"];
const SCHOOL_NAME = "River Tech School of Performing Arts & Technology";
const RTD_PAGE_URL = "https://www.rivertechschool.com/pages/river-tech-days.html";
const SUCCESS_URL = "https://www.rivertechschool.com/pages/register-rtd-success.html?session_id={CHECKOUT_SESSION_ID}";
const CANCEL_URL = "https://www.rivertechschool.com/pages/register-rtd.html";

// ---- Web-app entrypoint --------------------------------------------------
function doPost(e) {
  try {
    const params = (e && e.parameter) || {};
    if (params.action === "migrate") return json_(rtdMigrate_(params.token));
    if (params.action === "stripeWebhook") return json_(rtdStripeWebhook_(e));
    // Default: form submission.
    const payload = JSON.parse(e.postData.contents);
    const result = handleRegistration(payload);
    return json_(result);
  } catch (err) {
    Logger.log("doPost error: " + err);
    return json_({ ok: false, error: "Server error: " + err.message });
  }
}

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.action === "list") return json_(rtdList_(params.token));
  return json_({ ok: true, message: "River Tech Days backend is alive." });
}

// ---- Pipeline (RTD admin app) -------------------------------------------
// Mirrors the pattern used by school/homeschool/reenroll backends. Token
// stored in Script Property PIPELINE_TOKEN (same value across all backends
// for v1). doGet?action=list returns sheet headers + rows.

function rtdSheet_() {
  const ss = SpreadsheetApp.openById(cfg("SHEET_ID"));
  return ss.getSheetByName("Registrations") || ss.getSheets()[0];
}

function rtdCheckToken_(token) {
  const expected = cfg("PIPELINE_TOKEN");
  return expected && token && token === expected;
}

function rtdList_(token) {
  if (!rtdCheckToken_(token)) return { ok: false, error: "Bad token" };
  const sh = rtdSheet_();
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) return { ok: true, source: "rtd", headers: [], rows: [] };
  const all = sh.getRange(1, 1, lastRow, lastCol).getValues();
  return { ok: true, source: "rtd", headers: all[0], rows: all.slice(1) };
}

/**
 * Stripe webhook handler — flips Status to "Paid" on checkout.session.completed.
 *
 * Auth has two layers because Apps Script doPost(e) can't read the
 * Stripe-Signature header (no HMAC verification possible):
 *   1. URL secret. Stripe is configured to call us at
 *      .../exec?action=stripeWebhook&secret=<random>. The secret matches
 *      Script Property STRIPE_WEBHOOK_SECRET. First-pass defense against
 *      anyone POSTing to this URL.
 *   2. Out-of-band verify. We use STRIPE_SECRET_KEY to fetch the event
 *      back from Stripe's API by ID. If Stripe returns the same event,
 *      it's authentic. This is the recommended pattern when signature
 *      verification isn't possible (per Stripe's own webhook docs).
 *
 * Idempotent on retries: if the row's Status is already "Paid", we
 * return success without rewriting.
 */
function rtdStripeWebhook_(e) {
  const params = (e && e.parameter) || {};
  const expectedSecret = cfg("STRIPE_WEBHOOK_SECRET");
  if (!expectedSecret) {
    Logger.log("stripeWebhook: STRIPE_WEBHOOK_SECRET not configured");
    return { ok: false, error: "Webhook secret not configured" };
  }
  if (!params.secret || params.secret !== expectedSecret) {
    Logger.log("stripeWebhook: bad/missing secret in URL");
    return { ok: false, error: "Forbidden" };
  }

  let event;
  try {
    event = JSON.parse(e.postData.contents);
  } catch (err) {
    Logger.log("stripeWebhook: body parse error: " + err);
    return { ok: false, error: "Invalid body" };
  }
  if (!event || !event.id || !event.type) {
    return { ok: false, error: "Event missing id/type" };
  }

  // Out-of-band verify: ask Stripe API for this event by ID.
  const stripeKey = cfg("STRIPE_SECRET_KEY");
  if (!stripeKey) return { ok: false, error: "STRIPE_SECRET_KEY not configured" };
  let verifiedEvent;
  try {
    const verifyRes = UrlFetchApp.fetch(
      "https://api.stripe.com/v1/events/" + encodeURIComponent(event.id),
      { method: "get", headers: { "Authorization": "Bearer " + stripeKey }, muteHttpExceptions: true }
    );
    if (verifyRes.getResponseCode() !== 200) {
      Logger.log("stripeWebhook: verify GET returned " + verifyRes.getResponseCode() + " for event " + event.id);
      return { ok: false, error: "Event verification failed" };
    }
    verifiedEvent = JSON.parse(verifyRes.getContentText());
  } catch (err) {
    Logger.log("stripeWebhook: verify fetch failed: " + err);
    return { ok: false, error: "Event verification network error" };
  }
  if (verifiedEvent.id !== event.id) {
    return { ok: false, error: "Verified event ID mismatch" };
  }

  // Only act on checkout.session.completed. Other events are acknowledged
  // (so Stripe stops retrying) but otherwise ignored.
  if (verifiedEvent.type !== "checkout.session.completed") {
    return { ok: true, message: "Event ignored (not checkout.session.completed): " + verifiedEvent.type };
  }

  const session = verifiedEvent.data && verifiedEvent.data.object;
  if (!session) return { ok: false, error: "Event data.object missing" };

  // We set client_reference_id = registrationId at session creation in
  // createStripeSession_. That's our key back to the sheet row.
  const regId = session.client_reference_id;
  if (!regId) {
    Logger.log("stripeWebhook: session has no client_reference_id; session id=" + session.id);
    return { ok: false, error: "No client_reference_id on session" };
  }

  // Find the row, flip Status. Idempotent: skip if already Paid.
  const sh = rtdSheet_();
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) return { ok: false, error: "Sheet empty" };
  const all = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = all[0];
  const statusIdx = headers.indexOf("Status");
  if (statusIdx < 0) return { ok: false, error: "Status column not found" };

  for (let r = 1; r < all.length; r++) {
    if (String(all[r][0]) === String(regId)) {
      const currentStatus = String(all[r][statusIdx] || "");
      if (/^paid$/i.test(currentStatus)) {
        return { ok: true, message: "Already Paid (idempotent)", regId: regId, eventId: event.id };
      }
      sh.getRange(r + 1, statusIdx + 1).setValue("Paid");
      Logger.log("stripeWebhook: marked " + regId + " Paid (event " + event.id + ")");
      return { ok: true, regId: regId, newStatus: "Paid", eventId: event.id };
    }
  }
  Logger.log("stripeWebhook: regId not found in sheet: " + regId);
  return { ok: false, error: "regId not found: " + regId };
}

function rtdMigrate_(token) {
  // Trust-on-first-use bootstrap so the same token used by the other backends
  // can be planted on this one without manual Script Properties editing.
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty("PIPELINE_TOKEN")) {
    if (!token) return { ok: false, error: "Token required for first migrate" };
    props.setProperty("PIPELINE_TOKEN", token);
    return { ok: true, message: "PIPELINE_TOKEN set" };
  }
  if (!rtdCheckToken_(token)) return { ok: false, error: "Bad token" };
  return { ok: true, message: "PIPELINE_TOKEN already set" };
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---- Core handler --------------------------------------------------------
function handleRegistration(p) {
  if (!p || !p.parent || !Array.isArray(p.children) || p.children.length === 0) {
    return { ok: false, error: "Registration data was incomplete." };
  }

  const registrationId = "RTD-" + Utilities.formatDate(new Date(), "America/Los_Angeles", "yyyyMMdd-HHmmss")
    + "-" + Math.floor(Math.random() * 1000).toString().padStart(3, "0");

  // 1. Write to Sheet
  writeToSheet_(registrationId, p);

  // 2. Create Stripe Checkout session
  const checkoutUrl = createStripeSession_(registrationId, p);

  // 3. Emails (parent confirmation that registration was received;
  //    Dan gets a notification so he can plan class assignments).
  sendParentEmail_(registrationId, p);
  sendNotificationEmail_(registrationId, p);

  return { ok: true, registrationId: registrationId, checkoutUrl: checkoutUrl };
}

// ---- Sheet write ---------------------------------------------------------
function writeToSheet_(registrationId, p) {
  const sheetId = cfg("SHEET_ID");
  if (!sheetId) throw new Error("SHEET_ID is not configured in Script Properties.");
  const ss = SpreadsheetApp.openById(sheetId);
  const sh = ss.getSheetByName("Registrations") || ss.getSheets()[0];

  // Header row if empty
  if (sh.getLastRow() === 0) {
    const header = [
      "Registration ID", "Submitted (UTC)", "Status",
      "Parent First", "Parent Last", "Parent Email", "Parent Phone",
      "Family Tier",
      "Children Count", "Total Days", "Total Amount (USD)",
      "Notes"
    ];
    for (let n = 1; n <= 6; n++) {
      header.push(
        "Child " + n + " Name",
        "Child " + n + " Grade",
        "Child " + n + " Reading",
        "Child " + n + " Tablet",
        "Child " + n + " Age",
        "Child " + n + " Days",
        "Child " + n + " Classes"
      );
    }
    sh.appendRow(header);
    sh.getRange(1, 1, 1, header.length).setFontWeight("bold");
  }

  const children = p.children;
  const totalDays = children.reduce(function (s, c) { return s + (c.days ? c.days.length : 0); }, 0);

  const row = [
    registrationId,
    p.submittedAt || new Date().toISOString(),
    "Submitted (awaiting payment)",
    p.parent.firstName, p.parent.lastName, p.parent.email, p.parent.phone,
    p.familyTier,
    children.length, totalDays, p.totalAmount || 0,
    p.notes || ""
  ];

  for (let i = 0; i < 6; i++) {
    const c = children[i];
    if (c) {
      row.push(
        (c.firstName + " " + c.lastName).trim(),
        c.grade,
        c.readingLevel || "",
        c.tabletLevel || "",
        c.age,
        (c.days || []).join(", "),
        formatPicks_(c.picks || [])
      );
    } else {
      row.push("", "", "", "", "", "", "");
    }
  }

  sh.appendRow(row);
}

function formatPicks_(picks) {
  // "tue-may-5 Slot 1: Perler Beads (Mary); Slot 2: Dance (Caitlin); ..."
  if (!picks || picks.length === 0) return "";
  const byDay = {};
  picks.forEach(function (p) {
    if (!byDay[p.day]) byDay[p.day] = [];
    const slotNum = p.slot.replace("slot-", "");
    byDay[p.day].push("Slot " + slotNum + ": " + p.className + (p.teacher ? " (" + p.teacher + ")" : ""));
  });
  return Object.keys(byDay).map(function (d) {
    return d + " — " + byDay[d].join("; ");
  }).join(" | ");
}

// ---- Stripe Checkout -----------------------------------------------------
function createStripeSession_(registrationId, p) {
  const secretKey = cfg("STRIPE_SECRET_KEY");
  if (!secretKey) {
    Logger.log("No Stripe key configured — returning null checkout URL.");
    return null;
  }

  const amount = Math.round((p.totalAmount || 0) * 100); // cents
  if (amount <= 0) throw new Error("Total amount must be greater than zero.");

  const parentName = (p.parent.firstName + " " + p.parent.lastName).trim();
  const childNames = p.children.map(function (c) { return (c.firstName || "").trim(); }).filter(String).join(", ");
  const description = "River Tech Days registration — " + childNames + " (" + p.children.length + " child" + (p.children.length === 1 ? "" : "ren") + ")";

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
    "metadata[childCount]": String(p.children.length),
    "metadata[familyTier]": p.familyTier,
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][product_data][name]": "River Tech Days — Registration",
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

// ---- Emails --------------------------------------------------------------
function sendParentEmail_(registrationId, p) {
  const subject = "River Tech Days — we received your registration";
  const body = [
    "Hi " + p.parent.firstName + ",",
    "",
    "Thanks for registering for River Tech Days. We received your details for " +
      p.children.map(function (c) { return c.firstName; }).join(" and ") + ".",
    "",
    "Your confirmation reference: " + registrationId,
    "",
    "What happens next:",
    "• We review every registration to make sure class spots are balanced.",
    "• You'll hear back from us by May 2 with your confirmed schedule.",
    "• If a class you picked is full, we'll offer a swap or refund that child's fee.",
    "• Please wait for your confirmation email before coming.",
    "",
    "If you have questions or need to update anything, reply to this email or write learn@rivertech.me.",
    "",
    "Looking forward to seeing you at The Heart.",
    "",
    SCHOOL_NAME,
    "927 E Polston Ave, Post Falls, ID 83854",
    RTD_PAGE_URL
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
  const subject = "[RTD] New registration: " + p.parent.firstName + " " + p.parent.lastName + " — $" + p.totalAmount;
  const childSummary = p.children.map(function (c, i) {
    const extras = [];
    if (c.readingLevel) extras.push("reading: " + c.readingLevel);
    if (c.tabletLevel)  extras.push("tablet: "  + c.tabletLevel);
    const headerSuffix = extras.length ? ", " + extras.join(", ") : "";
    return [
      "Child " + (i + 1) + ": " + c.firstName + " " + c.lastName + " (grade " + c.grade + ", age " + c.age + headerSuffix + ")",
      "  Days: " + (c.days || []).join(", "),
      "  Picks:",
      (c.picks || []).map(function (pk) {
        const slotNum = pk.slot.replace("slot-", "");
        return "    " + pk.day + " Slot " + slotNum + " — " + pk.className + (pk.teacher ? " (" + pk.teacher + ")" : "");
      }).join("\n")
    ].join("\n");
  }).join("\n\n");

  const body = [
    "New River Tech Days registration.",
    "",
    "Reference: " + registrationId,
    "Submitted: " + (p.submittedAt || new Date().toISOString()),
    "Tier: " + p.familyTier,
    "Total: $" + p.totalAmount,
    "",
    "Parent: " + p.parent.firstName + " " + p.parent.lastName,
    "Email:  " + p.parent.email,
    "Phone:  " + p.parent.phone,
    "",
    childSummary,
    "",
    "Notes: " + (p.notes || "(none)"),
    "",
    "This row has been appended to the registrations sheet. Payment status will update to 'Paid' when the Stripe webhook fires (or manually after confirmation)."
  ].join("\n");

  try {
    MailApp.sendEmail({
      to: NOTIFY_EMAILS.join(","),
      subject: subject,
      body: body,
      name: "River Tech Registrations"
    });
  } catch (err) {
    Logger.log("Notification email failed: " + err);
  }
}

// ---- Setup helper (run once from the editor) -----------------------------
/**
 * Run this once from the Apps Script editor to store config.
 * Replace the placeholder strings first. After running, DELETE the
 * stored values from this function and re-save — Script Properties
 * keeps them; the function is just a convenience loader.
 */
function setupConfig_ONCE() {
  const props = PropertiesService.getScriptProperties();
  props.setProperties({
    "SHEET_ID": "PASTE_SHEET_ID_HERE",
    "STRIPE_SECRET_KEY": "PASTE_STRIPE_SECRET_KEY_HERE"
  });
  Logger.log("Config set. Now clear the placeholders from this function.");
}

/**
 * Quick self-test — pretend-submit a registration so the Sheet, emails,
 * and (if Stripe is configured) a checkout session are created. Run from
 * the editor; check logs and your inbox.
 */
function selfTest() {
  const fake = {
    submittedAt: new Date().toISOString(),
    parent: {
      firstName: "Test",
      lastName: "Parent",
      email: Session.getActiveUser().getEmail() || "dhegelund@gmail.com",
      phone: "555-0100"
    },
    familyTier: "newFamily",
    children: [
      {
        firstName: "Testchild",
        lastName: "Parent",
        grade: "4",
        age: "9",
        days: ["tue-may-5", "wed-may-6", "thu-may-7"],
        picks: [
          { day: "tue-may-5", slot: "slot-1", className: "Perler Beads", teacher: "Mary" },
          { day: "tue-may-5", slot: "slot-2", className: "Dance", teacher: "Caitlin" },
          { day: "tue-may-5", slot: "slot-3", className: "Rhythm", teacher: "Luke" }
        ],
        subtotal: 75
      }
    ],
    notes: "Self-test submission — ignore.",
    totalAmount: 75,
    releaseAgreed: true
  };
  const r = handleRegistration(fake);
  Logger.log(JSON.stringify(r, null, 2));
}
