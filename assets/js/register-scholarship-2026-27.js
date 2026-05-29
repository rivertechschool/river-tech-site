/* River Tech — Scholarship Application 2026-27 form logic
   Renders N child cards based on #childCount, collects child basics
   (name, DOB, gender, program), parent/guardian contacts, the level of
   tuition assistance needed, an optional financial-hardship narrative,
   volunteer status, consent, and a typed signature. POSTs JSON to the
   Apps Script backend, which writes a sheet row, creates a Stripe Checkout
   session for the flat $20 processing fee, and returns its URL. No file
   uploads. */
(function () {
  "use strict";

  // ---- Configuration ----------------------------------------------------
  // Set this to the deployed Apps Script web-app URL before go-live.
  const BACKEND_URL = "https://script.google.com/macros/s/AKfycbwS6IbPLFRSbmMMGsupjhHau-XPefwwSDFD5q07M56hVe3dnkAU_lI_hTgZM3E9aq1A/exec";

  // Flat, non-refundable application processing fee.
  const PROCESSING_FEE = 20;

  const MAX_CHILDREN = 6;

  // Program options (mirrors the school's actual tracks + a la carte).
  const PROGRAMS = [
    { id: "performing-arts", label: "Performing Arts Major (Mon–Thu)" },
    { id: "technology",      label: "Technology Major (Tue–Fri)" },
    { id: "double-major",    label: "Double Major (Mon–Fri)" },
    { id: "a-la-carte",      label: "À La Carte / Homeschool days" },
    { id: "undecided",       label: "Not sure yet" }
  ];

  const GRADES = [
    { id: "K",  label: "Kindergarten" },
    { id: "1",  label: "1st grade" },
    { id: "2",  label: "2nd grade" },
    { id: "3",  label: "3rd grade" },
    { id: "4",  label: "4th grade" },
    { id: "5",  label: "5th grade" },
    { id: "6",  label: "6th grade" },
    { id: "7",  label: "7th grade" },
    { id: "8",  label: "8th grade" },
    { id: "9",  label: "9th grade" },
    { id: "10", label: "10th grade" },
    { id: "11", label: "11th grade" },
    { id: "12", label: "12th grade" }
  ];

  // ---- Boot -------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", function () {
    const dateInput = document.getElementById("signatureDate");
    if (dateInput) {
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      dateInput.value = yyyy + "-" + mm + "-" + dd;
    }
    wireEvents();
  });

  // ---- DOM helpers ------------------------------------------------------
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---- Child card rendering ---------------------------------------------
  function renderChildren(n) {
    const container = document.getElementById("children-container");
    const existingCount = container.querySelectorAll(".child-card").length;
    if (existingCount === n) return;
    container.innerHTML = "";
    for (let i = 1; i <= n; i++) {
      container.appendChild(buildChildCard(i));
    }
  }

  function buildChildCard(idx) {
    const card = document.createElement("div");
    card.className = "child-card";
    card.id = "child-" + idx;
    card.dataset.childIdx = idx;

    const gradeOptionsHtml = GRADES.map(function (g) {
      return '<option value="' + g.id + '">' + escapeHtml(g.label) + '</option>';
    }).join("");

    const programOptionsHtml = PROGRAMS.map(function (p) {
      return '<option value="' + p.id + '">' + escapeHtml(p.label) + '</option>';
    }).join("");

    card.innerHTML = [
      '<div class="child-card-header">',
      '  <div class="child-card-dot"></div>',
      '  <div class="child-card-title">Child ' + idx + '</div>',
      '</div>',

      // Name
      '<div class="reg-row-grid-2">',
      '  <div>',
      '    <label class="reg-label" for="c' + idx + '_firstName">First name<span class="req">*</span></label>',
      '    <input class="reg-input" type="text" id="c' + idx + '_firstName" name="c' + idx + '_firstName" required>',
      '  </div>',
      '  <div>',
      '    <label class="reg-label" for="c' + idx + '_lastName">Last name<span class="req">*</span></label>',
      '    <input class="reg-input" type="text" id="c' + idx + '_lastName" name="c' + idx + '_lastName" required>',
      '  </div>',
      '</div>',

      // DOB + Gender
      '<div class="reg-row-grid-2">',
      '  <div>',
      '    <label class="reg-label" for="c' + idx + '_dob">Date of birth<span class="req">*</span></label>',
      '    <input class="reg-input" type="date" id="c' + idx + '_dob" name="c' + idx + '_dob" required>',
      '  </div>',
      '  <div>',
      '    <label class="reg-label" for="c' + idx + '_gender">Gender</label>',
      '    <select class="reg-select" id="c' + idx + '_gender" name="c' + idx + '_gender">',
      '      <option value="">Select…</option>',
      '      <option value="female">Female</option>',
      '      <option value="male">Male</option>',
      '    </select>',
      '  </div>',
      '</div>',

      // Grade + Program
      '<div class="reg-row-grid-2">',
      '  <div>',
      '    <label class="reg-label" for="c' + idx + '_grade">Grade for 2026&ndash;27<span class="req">*</span></label>',
      '    <select class="reg-select" id="c' + idx + '_grade" name="c' + idx + '_grade" required>',
      '      <option value="">Select grade…</option>',
      gradeOptionsHtml,
      '    </select>',
      '  </div>',
      '  <div>',
      '    <label class="reg-label" for="c' + idx + '_program">Program applying for<span class="req">*</span></label>',
      '    <select class="reg-select" id="c' + idx + '_program" name="c' + idx + '_program" required>',
      '      <option value="">Select program…</option>',
      programOptionsHtml,
      '    </select>',
      '  </div>',
      '</div>'
    ].join("");

    return card;
  }

  // ---- Collection -------------------------------------------------------
  function collectChildren() {
    const cards = Array.from(document.querySelectorAll(".child-card"));
    return cards.map(function (card, i) {
      const idx = card.dataset.childIdx;
      const val = function (sel) { const e = card.querySelector(sel); return e ? (e.value || "") : ""; };
      return {
        index: i + 1,
        firstName: val("#c" + idx + "_firstName").trim(),
        lastName:  val("#c" + idx + "_lastName").trim(),
        dob:       val("#c" + idx + "_dob"),
        gender:    val("#c" + idx + "_gender"),
        grade:     val("#c" + idx + "_grade"),
        program:   val("#c" + idx + "_program")
      };
    });
  }

  function getRadio(name) {
    const r = document.querySelector("input[name='" + name + "']:checked");
    return r ? r.value : "";
  }

  function updateSummary() {
    const count = document.querySelectorAll(".child-card").length;
    const el = document.getElementById("summary-child-count");
    if (el) el.textContent = String(count);
  }

  // ---- Validation -------------------------------------------------------
  function validate(children) {
    const form = document.getElementById("reg-form");

    const countSel = document.getElementById("childCount");
    if (!countSel.value) return "Please select how many children you're applying for.";
    if (children.length === 0) return "Please add at least one child.";

    for (let i = 0; i < children.length; i++) {
      const c = children[i];
      if (!c.firstName) return "Child " + c.index + ": first name is required.";
      if (!c.lastName)  return "Child " + c.index + ": last name is required.";
      if (!c.dob)       return "Child " + c.index + ": date of birth is required.";
      if (!c.grade)     return "Child " + c.index + ": please pick a grade.";
      if (!c.program)   return "Child " + c.index + ": please pick a program.";
    }

    if (!form.parentName.value.trim())  return "Please enter the parent/guardian full name.";
    if (!form.parentEmail.value.trim()) return "Please enter the parent/guardian email.";
    if (!form.parentPhone.value.trim()) return "Please enter the parent/guardian phone number.";

    if (!getRadio("assistance")) return "Please choose the level of tuition assistance that would help.";
    if (!getRadio("volunteer"))  return "Please tell us your family's volunteer status.";

    if (!form.consentAgree.checked) return "Please read and agree to the consent statements before continuing.";
    if (!form.signature.value.trim()) return "Please type your full legal name as your signature.";
    if (!form.signatureDate.value)    return "Please enter today's date.";

    return null;
  }

  // ---- Submit -----------------------------------------------------------
  function submitForm(e) {
    e.preventDefault();
    clearMessages();

    const form = document.getElementById("reg-form");
    const children = collectChildren();

    const err = validate(children);
    if (err) { showError(err); return; }

    const submitBtn = document.getElementById("reg-submit");
    const progress = document.getElementById("reg-progress");
    submitBtn.disabled = true;
    submitBtn.textContent = "Preparing…";

    const payload = {
      submittedAt: new Date().toISOString(),
      schoolYear: "2026-27",
      parent: {
        name:  form.parentName.value.trim(),
        email: form.parentEmail.value.trim(),
        phone: form.parentPhone.value.trim()
      },
      parent2: form.addParent2Toggle.checked ? {
        name:  form.parent2Name.value.trim(),
        email: form.parent2Email.value.trim(),
        phone: form.parent2Phone.value.trim()
      } : null,
      children: children,
      assistanceLevel: getRadio("assistance"),
      assistanceNotes: form.assistanceNotes.value.trim(),
      hardship:        form.hardship.value.trim(),
      volunteerStatus: getRadio("volunteer"),
      volunteerNotes:  form.volunteerNotes.value.trim(),
      consentAgreed:   true,
      signature:       form.signature.value.trim(),
      signatureDate:   form.signatureDate.value,
      processingFee:   PROCESSING_FEE,
      totalAmount:     PROCESSING_FEE
    };

    // If backend isn't wired yet, show a friendly preview.
    if (!BACKEND_URL || BACKEND_URL === "__BACKEND_URL__") {
      console.log("Scholarship payload (no backend configured):", payload);
      showError("Almost ready — the payment backend isn't connected yet. Your details are complete. Please try again shortly, or email learn@rivertech.me to apply by hand.");
      submitBtn.disabled = false;
      submitBtn.textContent = "Continue to Payment →";
      return;
    }

    progress.textContent = "Submitting…";
    progress.classList.add("show");

    fetch(BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoid CORS preflight
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.ok && data.checkoutUrl) {
          window.location.href = data.checkoutUrl;
        } else {
          showError((data && data.error) || "Something went wrong. Please try again or email learn@rivertech.me.");
          submitBtn.disabled = false;
          submitBtn.textContent = "Continue to Payment →";
          progress.classList.remove("show");
        }
      })
      .catch(function (err) {
        console.error("Submit error:", err);
        showError("We couldn't complete the submission. Please check your connection and try again, or email learn@rivertech.me.");
        submitBtn.disabled = false;
        submitBtn.textContent = "Continue to Payment →";
        progress.classList.remove("show");
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
    const countSel = document.getElementById("childCount");
    countSel.addEventListener("change", function () {
      const n = parseInt(countSel.value, 10) || 0;
      if (n > MAX_CHILDREN) return;
      renderChildren(n);
      updateSummary();
    });

    // Parent 2 toggle
    const p2Toggle = document.getElementById("addParent2Toggle");
    const p2Block = document.getElementById("parent2-block");
    p2Toggle.addEventListener("change", function () {
      p2Block.classList.toggle("show", p2Toggle.checked);
      const lbl = p2Toggle.closest(".reg-check");
      if (lbl) lbl.classList.toggle("checked", p2Toggle.checked);
    });

    // Assistance "more than 25%" elaborate toggle + radio visuals
    const assistBox = document.getElementById("assistance-choices");
    const elaborate = document.getElementById("assistance-elaborate");
    assistBox.addEventListener("change", function (e) {
      paintRadioGroup("assistance");
      elaborate.classList.toggle("show", getRadio("assistance") === "more-than-20");
    });

    // Volunteer radio visuals
    document.querySelectorAll("input[name='volunteer']").forEach(function (r) {
      r.addEventListener("change", function () { paintRadioGroup("volunteer"); });
    });

    // Consent checkbox visual
    const consent = document.getElementById("consentAgree");
    consent.addEventListener("change", function () {
      const lbl = consent.closest(".reg-check");
      if (lbl) lbl.classList.toggle("checked", consent.checked);
    });

    document.getElementById("reg-form").addEventListener("submit", submitForm);
  }

  function paintRadioGroup(name) {
    const group = document.getElementsByName(name);
    Array.prototype.forEach.call(group, function (r) {
      const lbl = r.closest(".reg-check");
      if (lbl) lbl.classList.toggle("checked", r.checked);
    });
  }
})();
