/* River Tech Field Trip — Registration form logic
   Branches on trip selection (Karate $10 Elem/Middle vs NIC Free HS):
     - Karate: shows homeschool/dropoff + chaperone sections + bus permission
       clause in release. Submits and is redirected to Stripe Checkout.
     - NIC: skips Karate-only blocks. Submits and goes straight to success.
   POSTs to the Apps Script backend which writes the row, creates the
   Stripe Checkout session (Karate only), sends emails, and returns
   { ok, checkoutUrl? }. */
(function () {
  "use strict";

  // ---- Configuration ----------------------------------------------------
  // Set this to the deployed Apps Script web-app URL before go-live.
  const BACKEND_URL = "https://script.google.com/macros/s/AKfycbwhK9l0Ve9IVj9GU4F0BttzPtPD52tMxWNIBs2EUIf5Xg8prXlOQ8UD2Bon74K2aOtH/exec";

  const KARATE_PRICE_USD = 10;

  // Form config — hard-coded for the April 29 trip. When we universalize
  // the form later, this moves into the Current Trip sheet.
  const TRIP_CONFIG = {
    karate: {
      id: "karate",
      name: "Christian Karate + CDA Park",
      date: "2026-04-29",
      price: KARATE_PRICE_USD,
      gradeBand: "Elementary & Middle",
      requiresPayment: true,
      submitLabel: "Pay $10 & Complete Registration →"
    },
    nic: {
      id: "nic",
      name: "North Idaho College Tour + CDA Park",
      date: "2026-04-29",
      price: 0,
      gradeBand: "High School",
      requiresPayment: false,
      submitLabel: "Complete Registration →"
    }
  };

  // ---- Boot -------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", function () {
    stampSignatureDate();
    wireEvents();
    // No trip chosen yet — hide everything below the selector.
    setTripBranch(null);
  });

  // ---- Helpers ----------------------------------------------------------
  function getSelectedTrip() {
    const r = document.querySelector("input[name='trip']:checked");
    return r ? r.value : null;
  }

  function stampSignatureDate() {
    const today = new Date();
    const fmt = today.toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric"
    });
    const el = document.getElementById("sig-date-display");
    if (el) el.textContent = fmt;
  }

  function show(el, yes) {
    if (!el) return;
    el.classList.toggle("show", !!yes);
  }

  // ---- Branching --------------------------------------------------------
  function setTripBranch(trip) {
    // Show/hide the trip-details info blocks below the selector
    show(document.getElementById("trip-details-karate"), trip === "karate");
    show(document.getElementById("trip-details-nic"),    trip === "nic");

    // Everything below the trip-selection section is branch-only until a
    // trip is chosen.
    const allBranchBlocks = document.querySelectorAll(".branch-only");
    allBranchBlocks.forEach(function (el) {
      el.classList.remove("show");
    });

    if (!trip) {
      // Hide submit button; no trip picked.
      document.getElementById("reg-submit").style.display = "none";
      document.getElementById("submit-helper").style.display = "none";
      return;
    }

    // Shared sections visible in both branches:
    ["section-parent", "section-student", "section-medical",
     "section-notes", "section-release", "section-signature"].forEach(function (id) {
      show(document.getElementById(id), true);
    });

    // Karate-only sections:
    const karate = trip === "karate";
    show(document.getElementById("homeschool-block"), karate);
    show(document.getElementById("section-chaperone"), karate);

    // Karate-only release clauses (the Transportation paragraph)
    document.querySelectorAll(".branch-karate").forEach(function (el) {
      show(el, karate);
    });

    // Configure submit button
    const cfg = TRIP_CONFIG[trip];
    const btn = document.getElementById("reg-submit");
    btn.textContent = cfg.submitLabel;
    btn.style.display = "block";

    const helper = document.getElementById("submit-helper");
    if (cfg.requiresPayment) {
      helper.style.display = "block";
    } else {
      helper.style.display = "none";
    }

    // Reset Karate-only field requireds when switching to NIC
    const homeschoolRadios = document.querySelectorAll("input[name='homeschool']");
    homeschoolRadios.forEach(function (r) {
      if (!karate) r.checked = false;
    });
    const chaperoneRadios = document.querySelectorAll("input[name='chaperone']");
    chaperoneRadios.forEach(function (r) {
      if (!karate) r.checked = false;
    });
    if (!karate) {
      const dropoff = document.getElementById("dropoffRequest");
      if (dropoff) dropoff.checked = false;
      // hide the dropoff sub-block
      show(document.getElementById("dropoff-block"), false);
      // clear visual .checked states on karate-only cards
      document.querySelectorAll("#homeschool-block .reg-check, #section-chaperone .reg-check")
        .forEach(function (lbl) { lbl.classList.remove("checked"); });
    }
  }

  function setHomeschoolBranch(val) {
    // Drop-off request sub-block only appears if homeschool === "yes"
    show(document.getElementById("dropoff-block"), val === "yes");
    if (val !== "yes") {
      const dropoff = document.getElementById("dropoffRequest");
      if (dropoff) {
        dropoff.checked = false;
        const lbl = dropoff.closest(".reg-check");
        if (lbl) lbl.classList.remove("checked");
      }
    }
  }

  // ---- Validation -------------------------------------------------------
  function validate() {
    const form = document.getElementById("reg-form");
    const trip = getSelectedTrip();
    if (!trip) return "Please select a trip at the top of the form.";

    // Parent block
    const parentFields = [
      ["parentFirstName", "parent/guardian first name"],
      ["parentLastName",  "parent/guardian last name"],
      ["parentEmail",     "parent/guardian email"],
      ["parentPhone",     "parent/guardian cell phone"],
      ["emergencyPhone",  "emergency contact phone"]
    ];
    for (let i = 0; i < parentFields.length; i++) {
      const f = form.querySelector("[name='" + parentFields[i][0] + "']");
      if (!f || !f.value.trim()) return "Please fill in " + parentFields[i][1] + ".";
    }

    // Email format
    const email = form.parentEmail.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return "Please enter a valid email address.";
    }

    // Student block
    const studentFields = [
      ["studentFirstName", "student first name"],
      ["studentLastName",  "student last name"],
      ["studentGrade",     "student grade"],
      ["studentAge",       "student age"]
    ];
    for (let i = 0; i < studentFields.length; i++) {
      const f = form.querySelector("[name='" + studentFields[i][0] + "']");
      if (!f || !f.value.trim()) return "Please fill in the " + studentFields[i][1] + ".";
    }

    const age = parseInt(form.studentAge.value, 10);
    if (isNaN(age) || age < 4 || age > 19) {
      return "Please enter a valid age between 4 and 19.";
    }

    // First aid permission — required
    const firstAid = form.querySelector("input[name='firstAidPermission']:checked");
    if (!firstAid) return "Please choose yes or no for first-aid permission.";

    // Release
    const release = form.querySelector("#releaseAgree");
    if (!release.checked) return "Please read and agree to the release before continuing.";

    // Signature
    if (!form.signatureName.value.trim()) {
      return "Please type your full name as signature.";
    }

    // Sanity: signature name should match one of the parent name parts
    // (gentle check — not blocking if they signed in a different order)
    // Intentionally not enforced to avoid false negatives.

    return null;
  }

  // ---- Payload ----------------------------------------------------------
  function buildPayload() {
    const form = document.getElementById("reg-form");
    const trip = getSelectedTrip();
    const cfg = TRIP_CONFIG[trip];

    const homeschool = (form.querySelector("input[name='homeschool']:checked") || {}).value || "";
    const chaperone  = (form.querySelector("input[name='chaperone']:checked") || {}).value  || "";
    const firstAid   = (form.querySelector("input[name='firstAidPermission']:checked") || {}).value || "";
    const dropoff    = document.getElementById("dropoffRequest");

    return {
      submittedAt: new Date().toISOString(),
      trip: {
        id:       trip,
        name:     cfg.name,
        date:     cfg.date,
        gradeBand: cfg.gradeBand,
        price:    cfg.price,
        requiresPayment: cfg.requiresPayment
      },
      parent: {
        firstName: form.parentFirstName.value.trim(),
        lastName:  form.parentLastName.value.trim(),
        email:     form.parentEmail.value.trim(),
        phone:     form.parentPhone.value.trim()
      },
      emergency: {
        name:  form.emergencyName.value.trim(),
        phone: form.emergencyPhone.value.trim()
      },
      student: {
        firstName: form.studentFirstName.value.trim(),
        lastName:  form.studentLastName.value.trim(),
        grade:     form.studentGrade.value,
        age:       form.studentAge.value
      },
      homeschool: {
        isHomeschool: homeschool === "yes",
        dropoffRequest: !!(dropoff && dropoff.checked)
      },
      medical: {
        allergies:          form.allergies.value.trim(),
        medications:        form.medications.value.trim(),
        medicalConditions:  form.medicalConditions.value.trim(),
        firstAidPermission: firstAid === "yes"
      },
      chaperone: chaperone,
      notes: form.notes.value.trim(),
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

    // If backend isn't wired yet, show a friendly preview.
    if (!BACKEND_URL || BACKEND_URL === "__BACKEND_URL__") {
      console.log("Field trip registration payload (no backend configured):", payload);
      showError("Almost ready — the registration backend isn't deployed yet. Your details are complete. Please try again shortly, or email learn@rivertech.me to sign up by hand.");
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
      return;
    }

    fetch(BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoid CORS preflight on Apps Script
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
        if (data.checkoutUrl) {
          // Karate branch — Stripe redirect
          window.location.href = data.checkoutUrl;
        } else {
          // NIC (free) branch — go straight to the success page
          const rid = data.registrationId ? ("?id=" + encodeURIComponent(data.registrationId)) : "";
          window.location.href = "register-fieldtrip-success.html" + rid;
        }
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
    // Trip card selection (radios)
    document.querySelectorAll("input[name='trip']").forEach(function (r) {
      r.addEventListener("change", function (e) {
        // Visual: toggle .checked on the outer trip-card label
        document.querySelectorAll(".trip-card").forEach(function (card) {
          const input = card.querySelector("input[name='trip']");
          card.classList.toggle("checked", input && input.checked);
        });
        setTripBranch(e.target.value);
      });
    });

    // Homeschool radios → toggle drop-off sub-block
    document.querySelectorAll("input[name='homeschool']").forEach(function (r) {
      r.addEventListener("change", function (e) {
        setHomeschoolBranch(e.target.value);
        // Visual .checked toggle
        document.querySelectorAll("input[name='homeschool']").forEach(function (x) {
          const lbl = x.closest(".reg-check");
          if (lbl) lbl.classList.toggle("checked", x.checked);
        });
      });
    });

    // Visual state for ALL radio/checkbox .reg-check labels
    document.addEventListener("change", function (e) {
      const t = e.target;
      if (!t) return;
      const lbl = t.closest(".reg-check");
      if (!lbl) return;
      if (t.type === "checkbox") {
        lbl.classList.toggle("checked", t.checked);
      } else if (t.type === "radio") {
        // Clear siblings in the same radio group
        const group = document.getElementsByName(t.name);
        Array.prototype.forEach.call(group, function (r) {
          const l = r.closest(".reg-check");
          if (l) l.classList.toggle("checked", r.checked);
        });
      }
    });

    // Form submit
    document.getElementById("reg-form").addEventListener("submit", submitForm);
  }
})();
