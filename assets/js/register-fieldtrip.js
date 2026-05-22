/* River Tech Field Trip — Silverwood June 1, 2026 — Registration form logic
   Branches on family type at the top:
     - Full-time family: students get bus/own transport choice. R2R applies.
     - Homeschool family: parent must accompany. Everyone drives. R2R applies.
   Multi-participant form. Each participant is Student or Parent/family member.
   Price is $35/person except for Read 2 Ride students (free at gate).
   POSTs to the Apps Script backend which writes a row per participant,
   creates the Stripe Checkout session (if total > 0), and returns
   { ok, checkoutUrl? }. */
(function () {
  "use strict";

  // ---- Configuration ----------------------------------------------------
  // Existing Apps Script web-app deployment (was the April 29 field trip;
  // now serves the Silverwood June 1 trip with the new multi-participant
  // model). Same URL — only the underlying code + SHEET_ID change.
  const BACKEND_URL = "https://script.google.com/macros/s/AKfycbwhK9l0Ve9IVj9GU4F0BttzPtPD52tMxWNIBs2EUIf5Xg8prXlOQ8UD2Bon74K2aOtH/exec";

  const PRICE_PER_PERSON = 35;

  const TRIP_CONFIG = {
    id: "silverwood-2026-06-01",
    name: "Silverwood Field Trip",
    date: "2026-06-01",
    deadline: "2026-05-28",
    price: PRICE_PER_PERSON
  };

  const PARTICIPANT_TYPES = {
    "student": "Student",
    "family":  "Parent or family member"
  };

  const TRANSPORT_OPTIONS = {
    "bus-both":  "Bus both ways",
    "bus-there": "Bus there, own ride home",
    "bus-back":  "Own ride there, bus back",
    "own-both":  "Own transport both ways"
  };

  // Track current family type at module scope so participant cards can adapt
  let currentFamilyType = null; // "full-time" | "homeschool" | null

  // ---- Boot -------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", function () {
    stampSignatureDate();
    wireEvents();
    // Form body stays hidden until family type is picked.
  });

  // ---- Family-type branching --------------------------------------------
  function setFamilyType(val) {
    currentFamilyType = val;

    // Reveal form body
    const body = document.getElementById("form-body");
    body.classList.toggle("show", !!val);

    // Toggle [data-branch] elements
    document.querySelectorAll("[data-branch]").forEach(function (el) {
      const branch = el.getAttribute("data-branch");
      el.classList.toggle("show", branch === val);
    });

    // If switching family type, refresh every participant card
    document.querySelectorAll(".participant-card").forEach(function (card) {
      applyTypeToCard(card);
    });

    // Make sure there's at least one participant row when the form opens
    const list = document.getElementById("participant-list");
    if (val && list.children.length === 0) {
      addParticipant();
    }

    // Required flag on the homeschool acknowledgment
    const homeschoolAck = document.querySelector("[name='ackHomeschool']");
    if (homeschoolAck) {
      if (val === "homeschool") {
        homeschoolAck.setAttribute("required", "");
      } else {
        homeschoolAck.removeAttribute("required");
        homeschoolAck.checked = false;
        const lbl = homeschoolAck.closest(".reg-check");
        if (lbl) lbl.classList.remove("checked");
      }
    }

    updateTotal();
  }

  // ---- Participant management -------------------------------------------
  let participantCounter = 0;

  function addParticipant() {
    participantCounter += 1;
    const id = "p" + participantCounter;
    const list = document.getElementById("participant-list");

    const card = document.createElement("div");
    card.className = "participant-card";
    card.dataset.pid = id;
    card.innerHTML = renderParticipantCard(id, list.children.length + 1);
    list.appendChild(card);

    wireParticipantCard(card);
    applyTypeToCard(card);
    renumberParticipants();
    updateTotal();
  }

  function removeParticipant(card) {
    const list = document.getElementById("participant-list");
    if (list.children.length <= 1) {
      // Don't remove the last row — clear it instead.
      const inputs = card.querySelectorAll("input, select");
      inputs.forEach(function (el) {
        if (el.type === "checkbox" || el.type === "radio") el.checked = false;
        else el.value = "";
      });
      const r2rLbl = card.querySelector(".pc-r2r .reg-check");
      if (r2rLbl) r2rLbl.classList.remove("checked");
      applyTypeToCard(card);
      updateTotal();
      return;
    }
    card.remove();
    renumberParticipants();
    updateTotal();
  }

  function renderParticipantCard(id, n) {
    const typeOptions = Object.keys(PARTICIPANT_TYPES).map(function (k) {
      return '<option value="' + k + '">' + PARTICIPANT_TYPES[k] + '</option>';
    }).join("");

    const transportOptions = Object.keys(TRANSPORT_OPTIONS).map(function (k) {
      return '<option value="' + k + '">' + TRANSPORT_OPTIONS[k] + '</option>';
    }).join("");

    return [
      '<div class="pc-header">',
      '  <span class="pc-title" data-pc-title>Person ' + n + '</span>',
      '  <button type="button" class="pc-remove" data-action="remove">Remove</button>',
      '</div>',
      '<div class="reg-row-grid-2">',
      '  <div>',
      '    <label class="reg-label">First name<span class="req">*</span></label>',
      '    <input class="reg-input" type="text" data-field="firstName" required>',
      '  </div>',
      '  <div>',
      '    <label class="reg-label">Last name<span class="req">*</span></label>',
      '    <input class="reg-input" type="text" data-field="lastName" required>',
      '  </div>',
      '</div>',
      '<div class="reg-row-grid-2">',
      '  <div>',
      '    <label class="reg-label">Age<span class="req">*</span></label>',
      '    <input class="reg-input" type="number" min="0" max="99" data-field="age" required>',
      '  </div>',
      '  <div>',
      '    <label class="reg-label">Who is this?<span class="req">*</span></label>',
      '    <select class="reg-select" data-field="type" required>',
      '      <option value="">Select…</option>',
      typeOptions,
      '    </select>',
      '  </div>',
      '</div>',
      '<div class="pc-r2r">',
      '  <label class="reg-label">Select ticket price<span class="req">*</span></label>',
      '  <span class="reg-help">Read 2 Ride was a spring program. Only students who already submitted their reading log to Mary back in March qualify. This is not something that can be done now.</span>',
      '  <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px;">',
      '    <label class="reg-check">',
      '      <input type="radio" data-field="r2r" name="r2r-' + id + '" value="yes">',
      '      <span>Already submitted Read 2 Ride log to Mary in spring — <strong>free ticket at the gate</strong></span>',
      '    </label>',
      '    <label class="reg-check">',
      '      <input type="radio" data-field="r2r" name="r2r-' + id + '" value="no">',
      '      <span>Does not apply — <strong>$35</strong></span>',
      '    </label>',
      '  </div>',
      '</div>',
      '<div class="pc-transport">',
      '  <label class="reg-label">Transportation<span class="req">*</span></label>',
      '  <select class="reg-select" data-field="transport">',
      '    <option value="">Select…</option>',
      transportOptions,
      '  </select>',
      '  <span class="reg-help">Choose whether this student rides the school bus, drives, or both.</span>',
      '</div>',
      '<div class="pc-homeschool-note">',
      '  Homeschool families and family members provide their own transportation to and from the park.',
      '</div>'
    ].join("\n");
  }

  function wireParticipantCard(card) {
    const removeBtn = card.querySelector('[data-action="remove"]');
    if (removeBtn) removeBtn.addEventListener("click", function () { removeParticipant(card); });

    const typeSel = card.querySelector('[data-field="type"]');
    if (typeSel) {
      typeSel.addEventListener("change", function () {
        applyTypeToCard(card);
        updateTotal();
      });
    }

    card.querySelectorAll('[data-field="r2r"]').forEach(function (r) {
      r.addEventListener("change", function () { updateTotal(); });
    });

    const transport = card.querySelector('[data-field="transport"]');
    if (transport) transport.addEventListener("change", function () { updateTotal(); });

    const fn = card.querySelector('[data-field="firstName"]');
    const ln = card.querySelector('[data-field="lastName"]');
    [fn, ln].forEach(function (el) {
      if (el) el.addEventListener("input", function () { renumberParticipants(); updateTotal(); });
    });
  }

  function applyTypeToCard(card) {
    const typeSel = card.querySelector('[data-field="type"]');
    const type = typeSel ? typeSel.value : "";
    const transport = card.querySelector(".pc-transport");
    const hsNote = card.querySelector(".pc-homeschool-note");
    const r2rWrap = card.querySelector(".pc-r2r");

    const showTransport = (type === "student" && currentFamilyType === "full-time");
    const showHsNote = (type === "student" && currentFamilyType === "homeschool");
    // R2R is full-time only (homeschool families don't get R2R)
    const showR2R = (type === "student" && currentFamilyType === "full-time");

    transport.classList.toggle("show", showTransport);
    hsNote.classList.toggle("show", showHsNote);
    r2rWrap.style.display = showR2R ? "" : "none";

    if (!showTransport) {
      const tSel = card.querySelector('[data-field="transport"]');
      if (tSel) tSel.value = "";
    }
    if (!showR2R) {
      card.querySelectorAll('[data-field="r2r"]').forEach(function (r) {
        r.checked = false;
        const lbl = r.closest(".reg-check");
        if (lbl) lbl.classList.remove("checked");
      });
    }
  }

  function renumberParticipants() {
    const cards = document.querySelectorAll(".participant-card");
    cards.forEach(function (card, idx) {
      const titleEl = card.querySelector("[data-pc-title]");
      if (!titleEl) return;
      const fn = (card.querySelector('[data-field="firstName"]') || {}).value || "";
      const ln = (card.querySelector('[data-field="lastName"]') || {}).value || "";
      const fullName = (fn + " " + ln).trim();
      titleEl.textContent = fullName
        ? "Person " + (idx + 1) + " — " + fullName
        : "Person " + (idx + 1);
    });
  }

  // ---- Total calculation ------------------------------------------------
  function updateTotal() {
    const cards = document.querySelectorAll(".participant-card");
    let paidCount = 0;
    let freeCount = 0;

    cards.forEach(function (card) {
      const type = (card.querySelector('[data-field="type"]') || {}).value;
      const fn = (card.querySelector('[data-field="firstName"]') || {}).value || "";
      if (!fn.trim()) return;

      const r2rChecked = card.querySelector('[data-field="r2r"]:checked');
      const isR2R = !!(r2rChecked && r2rChecked.value === "yes");

      if (type === "student" && isR2R) {
        freeCount += 1;
      } else if (type) {
        paidCount += 1;
      }
    });

    const total = paidCount * PRICE_PER_PERSON;
    const totalEl = document.getElementById("total-amount");
    const breakdownEl = document.getElementById("total-breakdown");
    const submitBtn = document.getElementById("reg-submit");
    const helper = document.getElementById("submit-helper");

    totalEl.textContent = "$" + total;

    if (paidCount === 0 && freeCount === 0) {
      breakdownEl.textContent = "Add at least one person to get started.";
      submitBtn.textContent = "Complete Registration →";
      helper.style.display = "none";
    } else {
      const parts = [];
      if (paidCount > 0) parts.push(paidCount + " × $" + PRICE_PER_PERSON + " paid");
      if (freeCount > 0) parts.push(freeCount + " × free (Read 2 Ride)");
      breakdownEl.textContent = parts.join(" · ");

      if (total > 0) {
        submitBtn.textContent = "Pay $" + total + " & Complete Registration →";
        helper.style.display = "block";
      } else {
        submitBtn.textContent = "Complete Registration →";
        helper.style.display = "none";
      }
    }
  }

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
    const form = document.getElementById("reg-form");

    // Family type
    if (!currentFamilyType) {
      return "Please choose whether you're a full-time family or a homeschool family.";
    }

    // Parent block
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

    // Participants
    const cards = document.querySelectorAll(".participant-card");
    if (cards.length === 0) return "Please add at least one participant.";

    let hasValidParticipant = false;
    let hasStudent = false;
    let hasAttendingAdult = false;

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const fn = (card.querySelector('[data-field="firstName"]') || {}).value || "";
      const ln = (card.querySelector('[data-field="lastName"]') || {}).value || "";
      const age = (card.querySelector('[data-field="age"]') || {}).value || "";
      const type = (card.querySelector('[data-field="type"]') || {}).value || "";

      const isEmpty = !fn.trim() && !ln.trim() && !age.trim() && !type;
      if (isEmpty) continue;

      if (!fn.trim()) return "Person " + (i + 1) + ": please enter a first name.";
      if (!ln.trim()) return "Person " + (i + 1) + ": please enter a last name.";
      if (!age.trim()) return "Person " + (i + 1) + ": please enter an age.";
      const ageNum = parseInt(age, 10);
      if (isNaN(ageNum) || ageNum < 0 || ageNum > 99) {
        return "Person " + (i + 1) + ": please enter a valid age.";
      }
      if (!type) return "Person " + (i + 1) + ": please choose who this person is.";

      if (type === "student" && currentFamilyType === "full-time") {
        const r2rChecked = card.querySelector('[data-field="r2r"]:checked');
        if (!r2rChecked) return "Person " + (i + 1) + ": please choose a Read 2 Ride status.";

        const transport = (card.querySelector('[data-field="transport"]') || {}).value || "";
        if (!transport) return "Person " + (i + 1) + ": please choose a transportation option.";
      }

      if (type === "student") hasStudent = true;
      if (type === "family") hasAttendingAdult = true;

      hasValidParticipant = true;
    }

    if (!hasValidParticipant) return "Please complete at least one participant's details.";

    // Homeschool families: must have at least one attending adult (family member)
    if (currentFamilyType === "homeschool" && hasStudent && !hasAttendingAdult) {
      return "Homeschool families: please add yourself (or another attending adult) as a Parent or family member. Homeschool students must be accompanied by an adult.";
    }

    // Acknowledgments — different sets per branch
    const requiredAcks = (currentFamilyType === "homeschool")
      ? ["ackHomeschool"]
      : ["ackSwimsuits", "ackDevices", "ackSchedule"];

    for (let i = 0; i < requiredAcks.length; i++) {
      const a = form.querySelector("[name='" + requiredAcks[i] + "']");
      if (!a || !a.checked) return "Please confirm all acknowledgments above the release.";
    }

    // Release
    const release = form.querySelector("#releaseAgree");
    if (!release.checked) return "Please read and agree to the release before continuing.";

    // Signature
    if (!form.signatureName.value.trim()) {
      return "Please type your full name as signature.";
    }

    return null;
  }

  // ---- Payload ----------------------------------------------------------
  function buildPayload() {
    const form = document.getElementById("reg-form");
    const cards = document.querySelectorAll(".participant-card");

    const participants = [];
    let paidCount = 0;
    let freeCount = 0;

    cards.forEach(function (card) {
      const fn = (card.querySelector('[data-field="firstName"]') || {}).value || "";
      const ln = (card.querySelector('[data-field="lastName"]') || {}).value || "";
      const age = (card.querySelector('[data-field="age"]') || {}).value || "";
      const type = (card.querySelector('[data-field="type"]') || {}).value || "";
      const transport = (card.querySelector('[data-field="transport"]') || {}).value || "";
      const r2rChecked = card.querySelector('[data-field="r2r"]:checked');

      if (!fn.trim()) return;

      const isStudent = type === "student";
      const isR2R = !!(r2rChecked && r2rChecked.value === "yes" && isStudent);
      const isFree = isR2R;

      if (isFree) freeCount += 1;
      else paidCount += 1;

      participants.push({
        firstName: fn.trim(),
        lastName:  ln.trim(),
        age:       age,
        type:      type,                                  // "student" | "family"
        typeLabel: PARTICIPANT_TYPES[type] || "",
        transport: transport,                              // only set for full-time students
        transportLabel: TRANSPORT_OPTIONS[transport] || "",
        read2Ride: isFree,
        priceUSD:  isFree ? 0 : PRICE_PER_PERSON
      });
    });

    const totalUSD = paidCount * PRICE_PER_PERSON;

    return {
      submittedAt: new Date().toISOString(),
      trip: {
        id:   TRIP_CONFIG.id,
        name: TRIP_CONFIG.name,
        date: TRIP_CONFIG.date,
        deadline: TRIP_CONFIG.deadline,
        pricePerPersonUSD: PRICE_PER_PERSON
      },
      familyType: currentFamilyType,    // "full-time" | "homeschool"
      parent: {
        firstName: form.parentFirstName.value.trim(),
        lastName:  form.parentLastName.value.trim(),
        email:     form.parentEmail.value.trim(),
        phone:     form.parentPhone.value.trim()
      },
      participants: participants,
      counts: {
        paid: paidCount,
        free: freeCount,
        total: participants.length
      },
      totalUSD: totalUSD,
      acknowledgments: {
        homeschoolSupervision: !!(form.querySelector("[name='ackHomeschool']") && form.querySelector("[name='ackHomeschool']").checked),
        noSwimsuits:           !!form.querySelector("[name='ackSwimsuits']").checked,
        noDevices:             !!form.querySelector("[name='ackDevices']").checked,
        scheduleRead:          !!form.querySelector("[name='ackSchedule']").checked
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
      console.log("Field trip registration payload (no backend configured):", payload);
      showError("Almost ready — the registration backend isn't deployed yet. Your details look good. Please try again shortly, or email learn@rivertech.me to sign up by hand.");
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
        if (data.checkoutUrl) {
          window.location.href = data.checkoutUrl;
        } else {
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
    // Family-type radios
    document.querySelectorAll("input[name='familyType']").forEach(function (r) {
      r.addEventListener("change", function (e) {
        document.querySelectorAll(".family-card").forEach(function (card) {
          const input = card.querySelector("input[name='familyType']");
          card.classList.toggle("checked", input && input.checked);
        });
        setFamilyType(e.target.value);
      });
    });

    // Add-participant button
    const addBtn = document.getElementById("add-participant");
    if (addBtn) addBtn.addEventListener("click", addParticipant);

    // Visual state for ALL .reg-check labels
    document.addEventListener("change", function (e) {
      const t = e.target;
      if (!t) return;
      const lbl = t.closest(".reg-check");
      if (!lbl) return;
      if (t.type === "checkbox") {
        lbl.classList.toggle("checked", t.checked);
      } else if (t.type === "radio") {
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
