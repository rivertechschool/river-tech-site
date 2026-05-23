/* River Tech — HS Off-Campus Lunch (Super 1) Waiver — Form logic
   Single-student parent waiver. Parent signs once per student per school year.
   POSTs to the Apps Script backend which writes a row to the Sheet,
   sends a confirmation email to the parent, and notifies staff. */
(function () {
  "use strict";

  // ---- Configuration ----------------------------------------------------
  // Shared deployment with the field trip backend (same project, routed
  // via payload.waiverType === "hs-super1-lunch").
  const BACKEND_URL = "https://script.google.com/macros/s/AKfycbwhK9l0Ve9IVj9GU4F0BttzPtPD52tMxWNIBs2EUIf5Xg8prXlOQ8UD2Bon74K2aOtH/exec";

  // ---- Boot -------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", function () {
    stampSignatureDate();
    wireEvents();
  });

  // ---- Date stamp -------------------------------------------------------
  function stampSignatureDate() {
    const today = new Date();
    const fmt = today.toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric"
    });
    const el = document.getElementById("sig-date-display");
    if (el) el.textContent = fmt;
  }

  // ---- Validation -------------------------------------------------------
  function validate() {
    const form = document.getElementById("waiver-form");

    const parentFields = [
      ["parentFirstName", "parent/guardian first name"],
      ["parentLastName",  "parent/guardian last name"],
      ["parentEmail",     "parent/guardian email"],
      ["parentPhone",     "parent/guardian cell phone"]
    ];
    for (let i = 0; i < parentFields.length; i++) {
      const f = form.querySelector("[name='" + parentFields[i][0] + "']");
      if (!f || !f.value.trim()) return "Please fill in " + parentFields[i][1] + ".";
    }

    const email = form.parentEmail.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return "Please enter a valid email address.";
    }

    const studentFields = [
      ["studentFirstName", "student first name"],
      ["studentLastName",  "student last name"],
      ["studentGrade",     "student grade"]
    ];
    for (let i = 0; i < studentFields.length; i++) {
      const f = form.querySelector("[name='" + studentFields[i][0] + "']");
      if (!f || !f.value.trim()) return "Please fill in the " + studentFields[i][1] + ".";
    }

    // Acknowledgments
    const acks = [
      "ackWindow", "ackTellTeacher", "ackReturnCheck",
      "ackBehavior", "ackValues", "ackGroup", "ackDiscretion"
    ];
    for (let i = 0; i < acks.length; i++) {
      const a = form.querySelector("[name='" + acks[i] + "']");
      if (!a || !a.checked) return "Please confirm all acknowledgments before submitting.";
    }

    // Release
    const release = form.querySelector("#releaseAgree");
    if (!release.checked) return "Please read and agree to the release before submitting.";

    // Signature
    if (!form.signatureName.value.trim()) {
      return "Please type your full name as signature.";
    }

    return null;
  }

  // ---- Payload ----------------------------------------------------------
  function buildPayload() {
    const form = document.getElementById("waiver-form");

    return {
      submittedAt: new Date().toISOString(),
      waiverType: "hs-super1-lunch",
      schoolYear: "2025-26",
      parent: {
        firstName: form.parentFirstName.value.trim(),
        lastName:  form.parentLastName.value.trim(),
        email:     form.parentEmail.value.trim(),
        phone:     form.parentPhone.value.trim()
      },
      student: {
        firstName: form.studentFirstName.value.trim(),
        lastName:  form.studentLastName.value.trim(),
        grade:     form.studentGrade.value
      },
      acknowledgments: {
        window:       true,
        tellTeacher:  true,
        returnCheck:  true,
        behavior:     true,
        values:       true,
        group:        true,
        discretion:   true
      },
      release: {
        agreed: true,
        signatureName: form.signatureName.value.trim(),
        signatureDate: new Date().toISOString().slice(0, 10)
      }
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
      console.log("Waiver payload (no backend configured):", payload);
      showError("Almost ready — the waiver backend isn't deployed yet. Your details look good. Please try again shortly, or email learn@rivertech.me to opt in by hand.");
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
        window.location.href = "hs-super1-waiver-success.html" + rid;
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
    document.getElementById("reg-success").classList.remove("show");
  }

  // ---- Event wiring -----------------------------------------------------
  function wireEvents() {
    document.addEventListener("change", function (e) {
      const t = e.target;
      if (!t) return;
      const lbl = t.closest(".reg-check");
      if (!lbl) return;
      if (t.type === "checkbox") {
        lbl.classList.toggle("checked", t.checked);
      }
    });

    document.getElementById("waiver-form").addEventListener("submit", submitForm);
  }
})();
