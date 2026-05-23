/* River Tech — HS Off-Campus Lunch (Super 1) Waiver — Form logic
   Multi-student parent waiver. One submission covers all HS students in
   a family. One consolidated agreement checkbox replaces the previous
   seven-acknowledgment list. POSTs to the shared field-trip backend,
   which routes via payload.waiverType. */
(function () {
  "use strict";

  // ---- Configuration ----------------------------------------------------
  const BACKEND_URL = "https://script.google.com/macros/s/AKfycbwhK9l0Ve9IVj9GU4F0BttzPtPD52tMxWNIBs2EUIf5Xg8prXlOQ8UD2Bon74K2aOtH/exec";

  // ---- Boot -------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", function () {
    stampSignatureDate();
    wireEvents();
    addStudent(); // start with one row
  });

  // ---- Student management -----------------------------------------------
  let studentCounter = 0;

  function addStudent() {
    studentCounter += 1;
    const id = "s" + studentCounter;
    const list = document.getElementById("student-list");

    const card = document.createElement("div");
    card.className = "student-card";
    card.dataset.sid = id;
    card.style.cssText = "border: 1.5px solid rgba(39, 36, 67, 0.18); border-radius: 4px; padding: 18px 20px; background: var(--color-bg); position: relative;";
    card.innerHTML = renderStudentCard(id);
    list.appendChild(card);

    wireStudentCard(card);
    renumberStudents();
  }

  function removeStudent(card) {
    const list = document.getElementById("student-list");
    if (list.children.length <= 1) {
      // Don't remove the last row — clear it instead.
      card.querySelectorAll("input, select").forEach(function (el) {
        el.value = "";
      });
      renumberStudents();
      return;
    }
    card.remove();
    renumberStudents();
  }

  function renderStudentCard(id) {
    return [
      '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">',
      '  <span class="sc-title" data-sc-title style="font-weight: 700; font-size: 16px;">Student 1</span>',
      '  <button type="button" data-action="remove" style="background: none; border: 1px solid rgba(39, 36, 67, 0.25); border-radius: 2px; padding: 4px 10px; font-size: 13px; cursor: pointer; color: var(--color-text); opacity: 0.7;">Remove</button>',
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
      '<div class="reg-row" style="margin-bottom: 0;">',
      '  <label class="reg-label">Grade<span class="req">*</span></label>',
      '  <select class="reg-select" data-field="grade" required>',
      '    <option value="">Select…</option>',
      '    <option value="9">9th grade</option>',
      '    <option value="10">10th grade</option>',
      '    <option value="11">11th grade</option>',
      '    <option value="12">12th grade</option>',
      '  </select>',
      '</div>'
    ].join("\n");
  }

  function wireStudentCard(card) {
    const removeBtn = card.querySelector('[data-action="remove"]');
    if (removeBtn) removeBtn.addEventListener("click", function () { removeStudent(card); });

    const fn = card.querySelector('[data-field="firstName"]');
    const ln = card.querySelector('[data-field="lastName"]');
    [fn, ln].forEach(function (el) {
      if (el) el.addEventListener("input", renumberStudents);
    });
  }

  function renumberStudents() {
    const cards = document.querySelectorAll(".student-card");
    cards.forEach(function (card, idx) {
      const titleEl = card.querySelector("[data-sc-title]");
      if (!titleEl) return;
      const fn = (card.querySelector('[data-field="firstName"]') || {}).value || "";
      const ln = (card.querySelector('[data-field="lastName"]') || {}).value || "";
      const fullName = (fn + " " + ln).trim();
      titleEl.textContent = fullName
        ? "Student " + (idx + 1) + " — " + fullName
        : "Student " + (idx + 1);
    });
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

    // Students
    const cards = document.querySelectorAll(".student-card");
    if (cards.length === 0) return "Please add at least one HS student.";

    let hasValidStudent = false;
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const fn = (card.querySelector('[data-field="firstName"]') || {}).value || "";
      const ln = (card.querySelector('[data-field="lastName"]') || {}).value || "";
      const grade = (card.querySelector('[data-field="grade"]') || {}).value || "";

      const isEmpty = !fn.trim() && !ln.trim() && !grade;
      if (isEmpty) continue;

      if (!fn.trim()) return "Student " + (i + 1) + ": please enter a first name.";
      if (!ln.trim()) return "Student " + (i + 1) + ": please enter a last name.";
      if (!grade)     return "Student " + (i + 1) + ": please choose a grade.";

      hasValidStudent = true;
    }

    if (!hasValidStudent) return "Please fill in at least one student's details.";

    // Single agreement
    const release = form.querySelector("#releaseAgree");
    if (!release.checked) return "Please confirm the agreement before submitting.";

    // Signature
    if (!form.signatureName.value.trim()) {
      return "Please type your full name as signature.";
    }

    return null;
  }

  // ---- Payload ----------------------------------------------------------
  function buildPayload() {
    const form = document.getElementById("waiver-form");
    const cards = document.querySelectorAll(".student-card");

    const students = [];
    cards.forEach(function (card) {
      const fn = (card.querySelector('[data-field="firstName"]') || {}).value || "";
      const ln = (card.querySelector('[data-field="lastName"]') || {}).value || "";
      const grade = (card.querySelector('[data-field="grade"]') || {}).value || "";
      if (!fn.trim()) return; // skip empty rows
      students.push({
        firstName: fn.trim(),
        lastName:  ln.trim(),
        grade:     grade
      });
    });

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
      students: students,
      agreement: {
        agreed: true,
        // Single consolidated agreement; the policy summary at the top
        // of the page enumerates the rules the parent agreed to.
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
      showError("Almost ready — the waiver backend isn't deployed yet.");
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

    const addBtn = document.getElementById("add-student");
    if (addBtn) addBtn.addEventListener("click", addStudent);

    document.getElementById("waiver-form").addEventListener("submit", submitForm);
  }
})();
