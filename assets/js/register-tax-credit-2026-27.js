/* River Tech — Apply Tax Credit to Tuition (2026-27) — Form logic
   Families who received the Idaho Parental Choice Tax Credit tell us how
   they'd like to apply it. Live calculator shows their exact payment.
   POSTs JSON to a dedicated Apps Script backend (no payment processing).

   Tuition (per child, per year, by plan):
     5-Day: Quarterly $1,950/qtr ($7,800/yr) · Annual $7,999/yr · Monthly $699/mo ($8,388/yr)
     4-Day: Quarterly $1,679/qtr ($6,716/yr) · Annual $6,900/yr · Monthly $600/mo ($7,200/yr)
*/
(function () {
  "use strict";

  // ---- Configuration ----------------------------------------------------
  const BACKEND_URL = "https://script.google.com/macros/s/AKfycbwkgfvzGNG9WUf9oSMlT3QhYTzLjiO1NwnMDMvhoTkYrRvoa42Rlo6jHVIxmpALKw2EfA/exec";

  // Per-child yearly total by program + plan, plus periods + per-period sticker.
  const TUITION = {
    "5-day": {
      label: "5-Day School",
      quarterly: { year: 7800, periods: 4,  sticker: 1950 },
      annual:    { year: 7999, periods: 1,  sticker: 7999 },
      monthly:   { year: 8388, periods: 12, sticker: 699 }
    },
    "4-day": {
      label: "4-Day School",
      quarterly: { year: 6716, periods: 4,  sticker: 1679 },
      annual:    { year: 6900, periods: 1,  sticker: 6900 },
      monthly:   { year: 7200, periods: 12, sticker: 600 }
    }
  };

  const PLAN_LABEL = { quarterly: "Quarterly", annual: "Annual", monthly: "Monthly" };
  const PERIOD_WORD = { quarterly: "quarter", annual: "year", monthly: "month" };
  const DEFAULT_CREDIT_PER_CHILD = 5000;

  // ---- Boot -------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", function () {
    syncChildren();
    wireEvents();
    recalc();
  });

  // ---- Children management ----------------------------------------------
  function renderChildCard(idx) {
    const n = idx + 1;
    return [
      '<div class="child-card" data-child="' + idx + '">',
      '  <div class="child-card-head">',
      '    <span class="child-card-title" data-child-title>Child ' + n + '</span>',
      '  </div>',
      '  <div class="reg-row-grid-2">',
      '    <div>',
      '      <label class="reg-label">First name<span class="req">*</span></label>',
      '      <input class="reg-input" type="text" data-field="firstName" required>',
      '    </div>',
      '    <div>',
      '      <label class="reg-label">Last name<span class="req">*</span></label>',
      '      <input class="reg-input" type="text" data-field="lastName" required>',
      '    </div>',
      '  </div>',
      '  <div class="reg-row" style="margin-bottom:0; margin-top:14px;">',
      '    <label class="reg-label">Program<span class="req">*</span></label>',
      '    <select class="reg-select" data-field="program" required>',
      '      <option value="">Select…</option>',
      '      <option value="5-day">5-Day School (30 periods/week)</option>',
      '      <option value="4-day">4-Day School (24 periods/week)</option>',
      '    </select>',
      '  </div>',
      '</div>'
    ].join("\n");
  }

  function syncChildren() {
    const count = parseInt(document.getElementById("childCount").value, 10) || 1;
    const container = document.getElementById("children-container");
    const existing = container.querySelectorAll(".child-card");

    // Preserve current values
    const saved = [];
    existing.forEach(function (card) {
      saved.push({
        firstName: val(card, "firstName"),
        lastName: val(card, "lastName"),
        program: val(card, "program")
      });
    });

    container.innerHTML = "";
    for (let i = 0; i < count; i++) {
      const wrap = document.createElement("div");
      wrap.innerHTML = renderChildCard(i);
      const card = wrap.firstElementChild;
      container.appendChild(card);
      if (saved[i]) {
        setVal(card, "firstName", saved[i].firstName);
        setVal(card, "lastName", saved[i].lastName);
        setVal(card, "program", saved[i].program);
      }
      wireChildCard(card);
    }
    renumberChildren();
    updateCreditDefault();
  }

  function wireChildCard(card) {
    card.querySelectorAll("input, select").forEach(function (el) {
      el.addEventListener("input", function () {
        renumberChildren();
        recalc();
      });
      el.addEventListener("change", recalc);
    });
  }

  function renumberChildren() {
    document.querySelectorAll(".child-card").forEach(function (card, idx) {
      const titleEl = card.querySelector("[data-child-title]");
      const fn = val(card, "firstName");
      const ln = val(card, "lastName");
      const name = (fn + " " + ln).trim();
      titleEl.textContent = name ? "Child " + (idx + 1) + " — " + name : "Child " + (idx + 1);
    });
  }

  function val(card, field) {
    const el = card.querySelector('[data-field="' + field + '"]');
    return el ? (el.value || "").trim() : "";
  }
  function setVal(card, field, value) {
    const el = card.querySelector('[data-field="' + field + '"]');
    if (el) el.value = value || "";
  }

  // ---- Credit default ---------------------------------------------------
  function updateCreditDefault() {
    const count = parseInt(document.getElementById("childCount").value, 10) || 1;
    const field = document.getElementById("creditAmount");
    if (!field.dataset.touched) {
      field.value = DEFAULT_CREDIT_PER_CHILD * count;
    }
    field.placeholder = (DEFAULT_CREDIT_PER_CHILD * count).toString();
  }

  // ---- Helpers ----------------------------------------------------------
  function byId(id) { return document.getElementById(id); }
  function getCadence() {
    const el = document.querySelector('input[name="cadence"]:checked');
    return el ? el.value : "";
  }
  function getDecision() {
    const el = document.querySelector('input[name="decision"]:checked');
    return el ? el.value : "";
  }
  function money(n) {
    const rounded = Math.round(n * 100) / 100;
    const hasCents = Math.abs(rounded - Math.round(rounded)) > 0.001;
    return "$" + rounded.toLocaleString("en-US", {
      minimumFractionDigits: hasCents ? 2 : 0,
      maximumFractionDigits: 2
    });
  }

  function gatherChildren() {
    const out = [];
    document.querySelectorAll(".child-card").forEach(function (card) {
      out.push({
        firstName: val(card, "firstName"),
        lastName: val(card, "lastName"),
        program: val(card, "program")
      });
    });
    return out;
  }

  // ---- The live calculator ----------------------------------------------
  function recalc() {
    const body = document.getElementById("calc-body");
    const cadence = getCadence();
    const decision = getDecision();
    const children = gatherChildren();

    const programmed = children.filter(function (c) { return c.program; });

    if (!cadence || !decision || programmed.length === 0) {
      body.innerHTML = '<p class="calc-empty">Choose your children&rsquo;s programs, a payment plan, and your credit option above to see your exact payment here.</p>';
      return;
    }

    // Family yearly total for the chosen plan.
    let yearTotal = 0;
    programmed.forEach(function (c) {
      yearTotal += TUITION[c.program][cadence].year;
    });
    const periods = TUITION[programmed[0].program][cadence].periods;

    let creditApplied = 0;
    if (decision === "apply") {
      const raw = parseFloat(document.getElementById("creditAmount").value) || 0;
      creditApplied = Math.max(0, Math.min(raw, yearTotal));
    }
    const remaining = yearTotal - creditApplied;
    const perPeriod = remaining / periods;

    const planName = PLAN_LABEL[cadence];
    const word = PERIOD_WORD[cadence];

    let rows = "";
    rows += row("Tuition for the year (" + planName + ")", money(yearTotal));
    if (decision === "apply") {
      rows += row("Your tax credit applied", "−" + money(creditApplied), "credit");
      rows += row("Remaining balance", money(remaining));
    }

    // Headline + how-it's-billed line.
    let big = "", sub = "";
    if (cadence === "annual") {
      if (decision === "apply") {
        big = money(remaining) + " from you";
        sub = "One invoice for the full year (" + money(yearTotal) + "). Your credit of " + money(creditApplied) + " covers most of it, leaving " + money(remaining) + " from you.";
      } else {
        big = money(yearTotal);
        sub = "One invoice for the full year.";
      }
    } else {
      big = money(perPeriod) + " / " + word;
      if (decision === "apply") {
        sub = "We invoice your credit of " + money(creditApplied) + " up front, then " + money(perPeriod) + " per " + word + " × " + periods + " (" + money(remaining) + " total).";
      } else {
        sub = money(perPeriod) + " per " + word + " × " + periods + " (" + money(remaining) + " total).";
      }
    }

    let html = rows;
    html += '<div class="calc-headline"><div class="big">' + big + '</div><div class="sub">' + sub + '</div></div>';
    if (programmed.length < children.length) {
      html += '<p class="calc-note">Pick a program for every child to include them in this total.</p>';
    }
    if (decision === "apply" && programmed.length > 1) {
      html += '<p class="calc-note">Tip: each child has their own $5,000 credit — apply $' + (DEFAULT_CREDIT_PER_CHILD * programmed.length).toLocaleString("en-US") + ' total for ' + programmed.length + ' children.</p>';
    }
    body.innerHTML = html;
  }

  function row(label, value, cls) {
    return '<div class="calc-row ' + (cls || "") + '"><span class="lbl">' + label + '</span><span class="val">' + value + '</span></div>';
  }

  // ---- Validation -------------------------------------------------------
  function validate() {
    if (!byId("parentName").value.trim()) return "Please enter the parent/guardian full name.";
    const email = byId("parentEmail").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Please enter a valid email address.";
    if (!byId("parentPhone").value.trim()) return "Please enter a phone number.";

    const children = gatherChildren();
    for (let i = 0; i < children.length; i++) {
      const c = children[i];
      if (!c.firstName) return "Child " + (i + 1) + ": please enter a first name.";
      if (!c.lastName)  return "Child " + (i + 1) + ": please enter a last name.";
      if (!c.program)   return "Child " + (i + 1) + ": please choose a program.";
    }

    if (!getCadence()) return "Please choose a payment plan.";
    if (!getDecision()) return "Please choose whether to apply or keep your credit.";

    if (getDecision() === "apply") {
      const credit = parseFloat(document.getElementById("creditAmount").value);
      if (!credit || credit <= 0) return "Please enter how much of your credit to apply.";
    }

    if (byId("specialSituation").checked && !byId("specialDetails").value.trim()) {
      return "Please describe your special situation, or uncheck that box.";
    }

    return null;
  }

  // ---- Payload ----------------------------------------------------------
  function buildPayload() {
    const cadence = getCadence();
    const decision = getDecision();
    const children = gatherChildren();

    let yearTotal = 0;
    children.forEach(function (c) {
      if (c.program) yearTotal += TUITION[c.program][cadence].year;
    });
    const periods = children[0].program ? TUITION[children[0].program][cadence].periods : 0;
    let creditApplied = 0;
    if (decision === "apply") {
      const raw = parseFloat(document.getElementById("creditAmount").value) || 0;
      creditApplied = Math.max(0, Math.min(raw, yearTotal));
    }
    const remaining = yearTotal - creditApplied;
    const perPeriod = periods ? Math.round((remaining / periods) * 100) / 100 : 0;

    return {
      submittedAt: new Date().toISOString(),
      formType: "tax-credit-tuition",
      schoolYear: "2026-27",
      parent: {
        name: byId("parentName").value.trim(),
        email: byId("parentEmail").value.trim(),
        phone: byId("parentPhone").value.trim()
      },
      children: children,
      cadence: cadence,
      decision: decision,
      creditApplied: creditApplied,
      yearTotal: yearTotal,
      remaining: remaining,
      perPeriod: perPeriod,
      periods: periods,
      specialSituation: byId("specialSituation").checked,
      specialDetails: byId("specialSituation").checked ? byId("specialDetails").value.trim() : "",
      notes: byId("notes").value.trim()
    };
  }

  // ---- Submit -----------------------------------------------------------
  function submitForm(e) {
    e.preventDefault();
    clearMessages();

    const err = validate();
    if (err) { showError(err); return; }

    const submitBtn = document.getElementById("reg-submit");
    submitBtn.disabled = true;
    const originalLabel = submitBtn.textContent;
    submitBtn.textContent = "Sending…";

    const payload = buildPayload();

    if (!BACKEND_URL || BACKEND_URL === "__BACKEND_URL__") {
      console.log("Tax-credit choice payload (no backend configured yet):", payload);
      showError("Almost ready — the form backend isn't connected yet. Please check back shortly, or email learn@rivertech.me.");
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
      return;
    }

    fetch(BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.ok) {
          const msg = (data && data.error) || "Something went wrong. Please try again or email learn@rivertech.me.";
          showError(msg);
          submitBtn.disabled = false;
          submitBtn.textContent = originalLabel;
          return;
        }
        const rid = data.registrationId ? ("?id=" + encodeURIComponent(data.registrationId)) : "";
        window.location.href = "register-tax-credit-2026-27-success.html" + rid;
      })
      .catch(function (err) {
        console.error("Submit error:", err);
        showError("We couldn't reach the server. Please check your connection and try again.");
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
      });
  }

  // ---- UI messaging -----------------------------------------------------
  function showError(msg) {
    const box = document.getElementById("reg-error");
    box.textContent = msg;
    box.classList.add("show");
    box.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function clearMessages() {
    document.getElementById("reg-error").classList.remove("show");
  }

  // ---- Event wiring -----------------------------------------------------
  function wireEvents() {
    document.getElementById("childCount").addEventListener("change", function () {
      syncChildren();
      recalc();
    });

    // Plan cards + radio/checkbox visual state
    document.addEventListener("change", function (e) {
      const t = e.target;
      if (!t) return;

      if (t.name === "cadence") {
        document.querySelectorAll(".plan-card").forEach(function (card) {
          card.classList.toggle("checked", card.querySelector("input").checked);
        });
        recalc();
      }
      if (t.name === "decision") {
        document.querySelectorAll('input[name="decision"]').forEach(function (r) {
          r.closest(".reg-check").classList.toggle("checked", r.checked);
        });
        document.getElementById("credit-block").classList.toggle("show", t.value === "apply");
        recalc();
      }
      if (t.id === "specialSituation") {
        document.getElementById("special-block").classList.toggle("show", t.checked);
      }
      const lbl = t.closest(".reg-check");
      if (lbl && t.type === "checkbox") lbl.classList.toggle("checked", t.checked);
    });

    const credit = document.getElementById("creditAmount");
    credit.addEventListener("input", function () {
      credit.dataset.touched = "1";
      recalc();
    });

    document.getElementById("reg-form").addEventListener("submit", submitForm);
  }
})();
