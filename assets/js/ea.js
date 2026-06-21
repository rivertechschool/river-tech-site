/* River Tech — Executive Assistant application.
   Renders AI-tool checkboxes and skill checkboxes from config arrays. Tracks a
   live progress bar as required sections complete. POSTs JSON to the Apps
   Script backend, which writes a sheet row and sends applicant + admin emails.
   No payments, no uploads. Cousin of teach.js. */
(function () {
  "use strict";

  // ---- Configuration ----------------------------------------------------
  // Set this to the deployed Apps Script web-app URL before go-live.
  const BACKEND_URL = "https://script.google.com/macros/s/AKfycbz_LO-ocd9hKskJ5JNfcAscfkldR-HPE6yRddLVxayNG8ZUOFuH24yeiPPwUBvYSzGM/exec";

  const AI_TOOLS = [
    "Claude Cowork",
    "Claude (claude.ai / Claude Code)",
    "Perplexity (Comet / Computer)",
    "ChatGPT / GPT agents",
    "Google Gemini",
    "Microsoft Copilot",
    "Other agent / automation tool"
  ];

  const SKILLS = [
    "Inbox & email management",
    "Calendar & scheduling",
    "Grant research & writing",
    "Bookkeeping & invoices",
    "Documents & spreadsheets",
    "Project / operations coordination",
    "Writing & communication",
    "Teaching / training others",
    "Family / customer communication"
  ];

  // ---- Boot -------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", function () {
    const dateInput = document.getElementById("signatureDate");
    if (dateInput) {
      const now = new Date();
      dateInput.value = now.getFullYear() + "-" +
        String(now.getMonth() + 1).padStart(2, "0") + "-" +
        String(now.getDate()).padStart(2, "0");
    }
    renderChecks("ai-tools-container", "agents", AI_TOOLS);
    renderChecks("skills-container", "skills", SKILLS);
    wireEvents();
    updateProgress();
  });

  // ---- DOM helpers ------------------------------------------------------
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---- Render: a grid of checkbox choice-cards --------------------------
  function renderChecks(containerId, name, items) {
    const container = document.getElementById(containerId);
    if (!container) return;
    items.forEach(function (label) {
      const el = document.createElement("label");
      el.className = "reg-check";
      el.innerHTML =
        '<input type="checkbox" name="' + name + '" value="' + escapeHtml(label) + '">' +
        '<span>' + escapeHtml(label) + '</span>';
      container.appendChild(el);
      el.querySelector("input").addEventListener("change", function (e) {
        el.classList.toggle("checked", e.target.checked);
        updateProgress();
      });
    });
  }

  // ---- Collection -------------------------------------------------------
  function getRadio(name) {
    const r = document.querySelector("input[name='" + name + "']:checked");
    return r ? r.value : "";
  }
  function getChecked(name) {
    return Array.from(document.querySelectorAll("input[name='" + name + "']:checked"))
      .map(function (el) { return el.value; });
  }
  function val(id) {
    const el = document.getElementById(id);
    return el ? (el.value || "").trim() : "";
  }
  function isChecked(id) {
    const el = document.getElementById(id);
    return !!(el && el.checked);
  }

  // ---- Progress bar -----------------------------------------------------
  // Each requirement contributes equally. Cosmetic encouragement, not validation.
  function updateProgress() {
    const form = document.getElementById("ea-form");
    if (!form) return;
    const checks = [
      function () { return val("firstName") && val("lastName"); },
      function () { return val("email") && val("phone"); },
      function () { return val("city"); },
      function () { return !!getRadio("connection"); },
      function () { return getChecked("agents").length > 0; },
      function () { return val("aiExperience"); },
      function () { return val("writingSample") || val("writingLink"); },
      function () { return getChecked("skills").length > 0; },
      function () { return isChecked("faithAffirm"); },
      function () { return !!val("idealHours") && !!getRadio("workMode"); },
      function () { return isChecked("backgroundConsent"); },
      function () { return isChecked("consentAgree") && val("signature"); }
    ];
    let done = 0;
    checks.forEach(function (fn) { try { if (fn()) done++; } catch (e) { /* field absent */ } });
    const pct = Math.round((done / checks.length) * 100);
    const fill = document.getElementById("ea-progress-fill");
    const label = document.getElementById("ea-progress-label");
    if (fill) fill.style.width = pct + "%";
    if (label) label.textContent = pct === 100 ? "Application complete — ready to submit ✓" : "Application progress: " + pct + "%";
  }

  // ---- Validation -------------------------------------------------------
  function validate() {
    if (!val("firstName")) return "Please enter your first name.";
    if (!val("lastName"))  return "Please enter your last name.";
    if (!val("email"))     return "Please enter your email.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val("email"))) return "That email doesn't look right — please double-check it.";
    if (!val("phone"))     return "Please enter your phone number.";
    if (!val("city"))      return "Please enter the city you live in.";
    if (!getRadio("connection")) return "Please tell us your connection to River Tech (choose the last option if you found this posting on your own).";

    if (getChecked("agents").length === 0) return "Please check at least one AI tool you've worked with. (This role requires hands-on AI-agent experience.)";
    if (!val("aiExperience")) return "Please describe real work you've done with AI agents — this is the heart of the role.";

    if (!val("writingSample") && !val("writingLink")) return "Please paste a short writing sample, or link to something you've written.";

    if (getChecked("skills").length === 0) return "Please check at least one area you're strong in.";

    if (!isChecked("faithAffirm")) return "This role serves a Christian school. Please confirm the faith statement, or email us if you'd like to talk first.";

    if (!val("idealHours")) return "Please tell us roughly how many hours a week you're looking for.";
    if (!getRadio("workMode")) return "Please choose whether you'd work in person, hybrid, or either.";

    if (!isChecked("backgroundConsent")) return "Background-check willingness is required for anyone working around our students.";
    if (!isChecked("consentAgree")) return "Please read and agree to the statements before submitting.";
    if (!val("signature")) return "Please type your full legal name as your signature.";
    if (!val("signatureDate")) return "Please enter today's date.";

    return null;
  }

  // ---- Submit -----------------------------------------------------------
  function submitForm(e) {
    e.preventDefault();
    clearMessages();

    const err = validate();
    if (err) { showError(err); return; }

    const submitBtn = document.getElementById("ea-submit");
    const progress = document.getElementById("ea-progress");
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";

    const payload = {
      submittedAt: new Date().toISOString(),
      schoolYear: "2026-27",
      applicant: {
        firstName: val("firstName"),
        lastName:  val("lastName"),
        email:     val("email"),
        phone:     val("phone"),
        city:      val("city")
      },
      connection:       getRadio("connection"),
      connectionDetail: val("connectionDetail"),
      ai: {
        tools:      getChecked("agents"),
        years:      val("aiYears"),
        experience: val("aiExperience"),
        proof:      val("aiProof")
      },
      writing: {
        sample: val("writingSample"),
        link:   val("writingLink")
      },
      skills:        getChecked("skills"),
      degree:        val("degree"),
      degreeDetail:  val("degreeDetail"),
      yearsExp:      val("yearsExp"),
      expSummary:    val("expSummary"),
      futureExcites: val("futureExcites"),
      influences:    val("influences"),
      faithAffirm:   true,
      faithNote:     val("faithNote"),
      idealHours:    val("idealHours"),
      workMode:      getRadio("workMode"),
      startDate:     val("startDate"),
      availabilityNote: val("availabilityNote"),
      backgroundConsent: true,
      consentAgreed: true,
      signature:     val("signature"),
      signatureDate: val("signatureDate")
    };

    if (!BACKEND_URL || BACKEND_URL === "__BACKEND_URL__") {
      console.log("EA application payload (no backend configured):", payload);
      showError("Almost ready — the application backend isn't connected yet. Please try again shortly, or email learn@rivertech.me to apply by hand.");
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit My Application";
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
        if (data && data.ok) {
          window.location.href = "ea-success.html";
        } else {
          showError((data && data.error) || "Something went wrong. Please try again or email learn@rivertech.me.");
          submitBtn.disabled = false;
          submitBtn.textContent = "Submit My Application";
          progress.classList.remove("show");
        }
      })
      .catch(function (err) {
        console.error("Submit error:", err);
        showError("We couldn't complete the submission. Please check your connection and try again, or email learn@rivertech.me.");
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit My Application";
        progress.classList.remove("show");
      });
  }

  // ---- UI messaging -----------------------------------------------------
  function showError(msg) {
    const box = document.getElementById("ea-error");
    box.textContent = msg;
    box.classList.add("show");
    box.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function clearMessages() {
    document.getElementById("ea-error").classList.remove("show");
  }

  // ---- Event wiring -----------------------------------------------------
  function wireEvents() {
    const form = document.getElementById("ea-form");

    // Radio visuals
    ["connection", "workMode"].forEach(function (name) {
      document.querySelectorAll("input[name='" + name + "']").forEach(function (r) {
        r.addEventListener("change", function () {
          paintRadioGroup(name);
          updateProgress();
        });
      });
    });

    // Checkbox visuals for the standalone consent boxes
    ["faithAffirm", "backgroundConsent", "consentAgree"].forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("change", function () {
        const lbl = el.closest(".reg-check");
        if (lbl) lbl.classList.toggle("checked", el.checked);
        updateProgress();
      });
    });

    form.addEventListener("input", updateProgress);
    form.addEventListener("change", updateProgress);
    form.addEventListener("submit", submitForm);
  }

  function paintRadioGroup(name) {
    const group = document.getElementsByName(name);
    Array.prototype.forEach.call(group, function (r) {
      const lbl = r.closest(".reg-check");
      if (lbl) lbl.classList.toggle("checked", r.checked);
    });
  }
})();
