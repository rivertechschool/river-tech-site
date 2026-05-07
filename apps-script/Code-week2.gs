/**
 * River Tech Days — Week 2 Registration Backend
 * Google Apps Script web app. Deploy with:
 *   Deploy > New deployment > Type: Web app
 *   Execute as: Me (learn@rivertech.me)
 *   Who has access: Anyone
 *
 * Per submission this script:
 *   1. Appends a row to the Week-2 sheet (SHEET_ID).
 *   2. Creates a Stripe Checkout Session.
 *   3. Emails the parent + admin notification.
 *   4. Returns { ok: true, checkoutUrl } to the browser.
 *
 * Stripe & Sheet config is stored in Script Properties:
 *   - SHEET_ID
 *   - STRIPE_SECRET_KEY
 *   - PIPELINE_TOKEN (optional, for ?action=list)
 *   - STRIPE_WEBHOOK_SECRET (optional, for auto-flip Status -> Paid)
 */

// ---- Constants ----------------------------------------------------------
function cfg(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

const NOTIFY_EMAILS = ["learn@rivertech.me", "dhegelund@gmail.com"];
const SCHOOL_NAME = "River Tech School of Performing Arts & Technology";
const RTD_PAGE_URL = "https://www.rivertechschool.com/pages/river-tech-days.html";
const SUCCESS_URL = "https://www.rivertechschool.com/pages/register-rtd-week2-success.html?session_id={CHECKOUT_SESSION_ID}";
const CANCEL_URL = "https://www.rivertechschool.com/pages/register-rtd-week2.html";

// Pricing — kept here for server-side validation (don't trust the browser's totalAmount).
const PRICING = {
  outside:  { perDay: 29, allThree: 69 },
  fullTime: { perDay: 19, allThree: 49 }
};

// ---- Web-app entrypoints ------------------------------------------------
function doPost(e) {
  try {
    const params = (e && e.parameter) || {};
    if (params.action === "stripeWebhook") return json_(stripeWebhook_(e));
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
  if (params.action === "list") return json_(list_(params.token));
  return json_({ ok: true, message: "RTD Week 2 backend is alive." });
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---- Sheet helpers ------------------------------------------------------
function getSheet_() {
  const id = cfg("SHEET_ID");
  if (!id) throw new Error("SHEET_ID is not configured in Script Properties.");
  const ss = SpreadsheetApp.openById(id);
  return ss.getSheetByName("Registrations") || ss.getSheets()[0];
}

function checkToken_(token) {
  const expected = cfg("PIPELINE_TOKEN");
  return expected && token && token === expected;
}

function list_(token) {
  if (!checkToken_(token)) return { ok: false, error: "Bad token" };
  const sh = getSheet_();
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) return { ok: true, source: "rtd-week2", headers: [], rows: [] };
  const all = sh.getRange(1, 1, lastRow, lastCol).getValues();
  return { ok: true, source: "rtd-week2", headers: all[0], rows: all.slice(1) };
}

// ---- Core handler --------------------------------------------------------
function handleRegistration(p) {
  if (!p || !p.parent || !Array.isArray(p.children) || p.children.length === 0) {
    return { ok: false, error: "Registration data was incomplete." };
  }
  if (!p.parent.email) return { ok: false, error: "Parent email is required." };
  if (!p.familyTier || !PRICING[p.familyTier]) {
    return { ok: false, error: "Invalid family tier." };
  }

  // Server-side total recompute — never trust the browser's totalAmount.
  const computedTotal = p.children.reduce(function (sum, c) {
    const days = (c.days || []).length;
    return sum + pricePerChild_(days, p.familyTier);
  }, 0);
  if (computedTotal <= 0) {
    return { ok: false, error: "Total amount must be greater than zero. Did every child select at least one day?" };
  }
  p.totalAmount = computedTotal;

  const registrationId = "RTD2-" + Utilities.formatDate(new Date(), "America/Los_Angeles", "yyyyMMdd-HHmmss")
    + "-" + Math.floor(Math.random() * 1000).toString().padStart(3, "0");

  writeToSheet_(registrationId, p);

  const checkoutUrl = createStripeSession_(registrationId, p);

  sendParentEmail_(registrationId, p);
  sendNotificationEmail_(registrationId, p);

  return { ok: true, registrationId: registrationId, checkoutUrl: checkoutUrl };
}

function pricePerChild_(daysCount, tier) {
  if (!tier || daysCount <= 0 || !PRICING[tier]) return 0;
  const t = PRICING[tier];
  if (daysCount >= 3) return t.allThree;
  return daysCount * t.perDay;
}

// ---- Sheet write ---------------------------------------------------------
function writeToSheet_(registrationId, p) {
  const sh = getSheet_();

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
        "Child " + n + " Age",
        "Child " + n + " Grade",
        "Child " + n + " Group",
        "Child " + n + " Days",
        "Child " + n + " Ratings"
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
        ((c.firstName || "") + " " + (c.lastName || "")).trim(),
        c.age || "",
        c.grade || "",
        c.ageGroup || "",
        (c.days || []).join(", "),
        formatRatings_(c.ratings || {})
      );
    } else {
      row.push("", "", "", "", "", "");
    }
  }

  sh.appendRow(row);
}

function formatRatings_(ratings) {
  // {"Choir": 3, "Dance": 2, ...} → "Choir:3, Dance:2, ..."
  const keys = Object.keys(ratings).sort();
  return keys.map(function (k) { return k + ":" + ratings[k]; }).join(", ");
}

// ---- Stripe Checkout -----------------------------------------------------
function createStripeSession_(registrationId, p) {
  const secretKey = cfg("STRIPE_SECRET_KEY");
  if (!secretKey) {
    Logger.log("No Stripe key configured — returning null checkout URL.");
    return null;
  }

  const amount = Math.round((p.totalAmount || 0) * 100);
  if (amount <= 0) throw new Error("Total amount must be greater than zero.");

  const parentName = ((p.parent.firstName || "") + " " + (p.parent.lastName || "")).trim();
  const childNames = p.children.map(function (c) { return (c.firstName || "").trim(); }).filter(String).join(", ");
  const description = "River Tech Days Week 2 (May 12-14) — " + childNames + " (" + p.children.length + " child" + (p.children.length === 1 ? "" : "ren") + ")";

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
    "metadata[formVersion]": "rtd-week2-v1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][product_data][name]": "River Tech Days Week 2 — Registration",
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

// ---- Stripe webhook (optional, auto-flip Status to Paid) -----------------
function stripeWebhook_(e) {
  const params = (e && e.parameter) || {};
  const expectedSecret = cfg("STRIPE_WEBHOOK_SECRET");
  if (!expectedSecret) return { ok: false, error: "Webhook secret not configured" };
  if (!params.secret || params.secret !== expectedSecret) return { ok: false, error: "Forbidden" };

  let event;
  try {
    event = JSON.parse(e.postData.contents);
  } catch (err) {
    return { ok: false, error: "Invalid body" };
  }
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
      const currentStatus = String(all[r][statusIdx] || "");
      if (/^paid$/i.test(currentStatus)) {
        return { ok: true, message: "Already Paid (idempotent)", regId: regId };
      }
      sh.getRange(r + 1, statusIdx + 1).setValue("Paid");
      return { ok: true, regId: regId, newStatus: "Paid" };
    }
  }
  return { ok: false, error: "regId not found: " + regId };
}

// ---- Emails --------------------------------------------------------------
function sendParentEmail_(registrationId, p) {
  const childList = p.children.map(function (c) { return c.firstName; }).join(" and ");
  const subject = "River Tech Days Week 2 — we received your registration";
  const body = [
    "Hi " + p.parent.firstName + ",",
    "",
    "Thanks for registering " + childList + " for River Tech Days Week 2 (May 12-14). We have your details.",
    "",
    "Confirmation reference: " + registrationId,
    "",
    "What happens next:",
    "• We'll review your child's subject ratings and match them to the classes they'll most enjoy.",
    "• You'll hear back from us within 24 hours with your confirmed schedule.",
    "• If a top-choice subject is full, we'll match your child to their next-best ratings.",
    "",
    "If you have questions, reply to this email or write learn@rivertech.me.",
    "",
    "See you at The Heart on May 12!",
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
  const subject = "[RTD-W2] New registration: " + p.parent.firstName + " " + p.parent.lastName + " — $" + p.totalAmount;
  const childSummary = p.children.map(function (c, i) {
    const ratingPairs = Object.keys(c.ratings || {}).sort()
      .map(function (k) { return k + ": " + c.ratings[k]; }).join(", ");
    const loves = Object.keys(c.ratings || {}).filter(function (k) { return c.ratings[k] === 3; });
    const skips = Object.keys(c.ratings || {}).filter(function (k) { return c.ratings[k] === 1; });
    return [
      "Child " + (i + 1) + ": " + c.firstName + " " + c.lastName + " (age " + c.age + ", " + c.ageGroup + " group" + (c.grade ? ", grade " + c.grade : "") + ")",
      "  Days: " + (c.days || []).join(", "),
      "  Ratings (1=Not so much, 2=Like it, 3=Love it):",
      "    " + ratingPairs,
      "  Loves (3s): " + (loves.length ? loves.join(", ") : "(none)"),
      "  Skips (1s): " + (skips.length ? skips.join(", ") : "(none)")
    ].join("\n");
  }).join("\n\n");

  const body = [
    "New River Tech Days Week 2 registration.",
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
    "Row appended to the Week-2 registrations sheet. Status will update to 'Paid' when the Stripe webhook fires (or update manually after Stripe confirmation)."
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

// ---- Setup helpers -------------------------------------------------------
/**
 * Run from the Apps Script editor to bootstrap config.
 * After running, clear the placeholder strings — Script Properties keeps them.
 */
function setupConfig_ONCE() {
  const props = PropertiesService.getScriptProperties();
  props.setProperties({
    "SHEET_ID": "PASTE_SHEET_ID_HERE",
    "STRIPE_SECRET_KEY": "PASTE_STRIPE_SECRET_KEY_HERE",
    "PIPELINE_TOKEN": "PASTE_PIPELINE_TOKEN_HERE"
  });
  Logger.log("Config set. Now clear the placeholders from this function and re-save.");
}

/**
 * Create a fresh Sheet in the RTS Website Forms folder, owned by learn@rivertech.me.
 * Run once from the editor while signed in as learn@rivertech.me.
 * Stores the new Sheet's ID in Script Property SHEET_ID and logs the URL.
 */
function createSheetForMe() {
  const ss = SpreadsheetApp.create("RTD Week 2 Registrations");
  const id = ss.getId();
  PropertiesService.getScriptProperties().setProperty("SHEET_ID", id);
  Logger.log("Created sheet: " + ss.getUrl());
  Logger.log("Set SHEET_ID = " + id);
  Logger.log("Move this sheet into 'My Drive / RTS Website Forms /' manually in Drive.");
}

/**
 * Pretend-submit so the sheet, emails, and (if Stripe is configured) a checkout
 * session are created. Run from the editor; check logs.
 */
function selfTest() {
  const fake = {
    submittedAt: new Date().toISOString(),
    formVersion: "rtd-week2-v1",
    parent: {
      firstName: "Test",
      lastName: "Parent",
      email: Session.getActiveUser().getEmail() || "dhegelund@gmail.com",
      phone: "555-0100"
    },
    familyTier: "outside",
    children: [
      {
        firstName: "Testchild",
        lastName: "Parent",
        age: "9",
        grade: "3rd",
        ageGroup: "younger",
        days: ["tue-may-12", "wed-may-13", "thu-may-14"],
        ratings: { "Choir": 3, "Clay Sculpt": 2, "Creative Writing": 1, "Dance": 3, "Drawing": 2, "Drill / P.E. Games": 2, "Lego / Minecraft Fort": 3, "Legos & Perler": 2, "Paint / Paper Craft": 2, "Perler Beads": 1, "Rhythm": 2 },
        subtotal: 69
      }
    ],
    notes: "Self-test — ignore.",
    totalAmount: 69,
    releaseAgreed: true
  };
  Logger.log(JSON.stringify(handleRegistration(fake), null, 2));
}
