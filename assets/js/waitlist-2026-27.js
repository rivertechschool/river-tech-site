/* River Tech — Waitlist 2026-27 — Form logic
   One form covers full-time AND homeschool interest. Multi-child support
   (add-row pattern). Submits to a backend endpoint that writes a row per
   child to the waitlist Sheet, sends parent a confirmation, notifies staff. */
(function () {
  "use strict";

  // ---- Configuration ----------------------------------------------------
  // Placeholder; will be set to the deployed Apps Script web-app URL once
  // backend is wired. Until then, submit shows a friendly "not deployed" note.
  const BACKEND_URL = "__BACKEND_URL__";

  // ---- Boot -------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", function () {
    wireEvents();
    addChild(); // start with one child row
  });

  // ---- Child management -------------------------------------------------
  let childCounter = 0;

  function addChild() {
    childCounter += 1;
    const id = "c" + childCounter;
    const list = document.getElementById("child-list");

    const card = document.createElement("div");
    card.className = "child-card";
    card.dataset.cid = id;
    card.innerHTML = renderChildCard(id);
    list.appendChild(card);

    wireChildCard(card);
    renumberChildren();
  }

  function removeChild(card) {
    const list = document.getElementById("child-list");
    if (list.children.length <= 1) {
      // Don't remove the last row — clear it instead.
      card.querySelectorAll("input, select").forEach(function (el) {
        el.value = "";
      });
      renumberChildren();
      return;
    }
    card.remove();
    renumberChildren();
  }

  function renderChildCard(id) {
    return [
      '<div class="cc-header">',
      '  <span class="cc-title" data-cc-title>Child 1</span>',
      '  <button type="button" data-action="remove" class="cc-remove">Remove</button>',
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
      '    <input class="reg-input" type="number" min="4" max="19" data-field="age" required>',
      '  </div>',
      '  <div>',
      '    <label class="reg-label">Grade entering fall<span class="req">*</span></label>',
      '    <select class="reg-select" data-field="grade" required>',
      '      <option value="">Select…</option>',
      '      <option value="K">Kindergarten</option>',
      '      <option value="1">1st</option>',
      '      <option value="2">2nd</option>',
      '      <option value="3">3rd</option>',
      '      <option value="4">4th</option>',
      '      <option value="5">5th</option>',
      '      <option value="6">6th</option>',
      '      <option value="7">7th</option>',
      '      <option value="8">8th</option>',
      '      <option value="9">9th</option>',
      '      <option value="10">10th</option>',
      '      <option value="11">11th</option>',
      '      <option value="12">12th</option>',
      '    </select>',
      '  </div>',
      '</div>',
      '<div class="reg-row" style="margin-bottom: 0;">',
      '  <label class="reg-label">Program interest<span class="req">*</span></label>',
      '  <select class="reg-select" data-field="program" required>',
      '    <option value="">Select…</option>',
      '    <option value="full-time">Full-time (4–5 days)</option>',
      '    <option value="homeschool">Homeschool / À La Carte (1–4 days)</option>',
      '    <option value="either">Either / Open to both</option>',
      '  </select>',
      '  <span class="reg-help">If homeschool, you can mention day preferences in the "Anything else?" box below.</span>',
      '</div>'
    ].join("\n");
  }

  function wireChildCard(card) {
    const removeBtn = card.querySelector('[data-action="remove"]');
    if (removeBtn) removeBtn.addEventListener("click", function () { removeChild(card); });

    const fn = card.querySelector('[data-field="firstName"]');
    const ln = card.querySelector('[data-field="lastName"]');
    [fn, ln].forEach(function (el) {
      if (el) el.addEventListener("input", renumberChildren);
    });
  }

  function renumberChildren() {
    const cards = document.querySelectorAll(".child-card");
    cards.forEach(function (card, idx) {
      const titleEl = card.querySelector("[data-cc-title]");
      if (!titleEl) return;
      const fn = (card.querySelector('[data-field="firstName"]') || {}).value || "";
      const ln = (card.querySelector('[data-field="lastName"]') || {}).value || "";
      const fullName = (fn + " " + ln).trim();
      titleEl.textContent = fullName
        ? "Child " + (idx + 1) + " — " + fullName
        : "Child " + (idx + 1);
    });
  }

  // ---- Validation -------------------------------------------------------
  function validate() {
    const form = document.getElementById("waitlist-form");

    const parentFields = [
      ["parentFirstName", "parent/guardian first name"],
      ["parentLastName",  "parent/guardian last name"],
      ["parentEmail",     "parent/guardian email"]
    ];
    for (let i = 0; i < parentFields.length; i++) {
      const f = form.querySelector("[name='" + parentFields[i][0] + "']");
      if (!f || !f.value.trim()) return "Please fill in " + parentFields[i][1] + ".";
    }

    const email = form.parentEmail.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return "Please enter a valid email address.";
    }

    const cards = document.querySelectorAll(".child-card");
    if (cards.length === 0) return "Please add at least one child.";

    let hasValidChild = false;
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const fn = (card.querySelector('[data-field="firstName"]') || {}).value || "";
      const ln = (card.querySelector('[data-field="lastName"]') || {}).value || "";
      const age = (card.querySelector('[data-field="age"]') || {}).value || "";
      const grade = (card.querySelector('[data-field="grade"]') || {}).value || "";
      const program = (card.querySelector('[data-field="program"]') || {}).value || "";

      const isEmpty = !fn.trim() && !ln.trim() && !age && !grade && !program;
      if (isEmpty) continue;

      if (!fn.trim()) return "Child " + (i + 1) + ": please enter a first name.";
      if (!ln.trim()) return "Child " + (i + 1) + ": please enter a last name.";
      if (!age)       return "Child " + (i + 1) + ": please enter an age.";
      if (!grade)     return "Child " + (i + 1) + ": please choose a grade.";
      if (!program)   return "Child " + (i + 1) + ": please choose a program interest.";

      hasValidChild = true;
    }
    if (!hasValidChild) return "Please fill in at least one child's details.";

    return null;
  }

  // ---- Payload ----------------------------------------------------------
  function buildPayload() {
    const form = document.getElementById("waitlist-form");
    const cards = document.querySelectorAll(".child-card");

    const children = [];
    cards.forEach(function (card) {
      const fn = (card.querySelector('[data-field="firstName"]') || {}).value || "";
      const ln = (card.querySelector('[data-field="lastName"]') || {}).value || "";
      if (!fn.trim()) return;
      children.push({
        firstName: fn.trim(),
        lastName:  ln.trim(),
        age:       (card.querySelector('[data-field="age"]') || {}).value || "",
        grade:     (card.querySelector('[data-field="grade"]') || {}).value || "",
        program:   (card.querySelector('[data-field="program"]') || {}).value || ""
      });
    });

    return {
      submittedAt: new Date().toISOString(),
      formType: "waitlist-2026-27",
      schoolYear: "2026-27",
      parent: {
        firstName: form.parentFirstName.value.trim(),
        lastName:  form.parentLastName.value.trim(),
        email:     form.parentEmail.value.trim(),
        phone:     (form.parentPhone.value || "").trim()
      },
      children: children,
      notes: (form.notes.value || "").trim()
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
      console.log("Waitlist payload (no backend configured):", payload);
      showError("This form is in preview mode — the waitlist backend isn't wired up yet. Email learn@rivertech.me directly for now (responses resume in August).");
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
          const msg = (data && data.error) || "Something went wrong. Please email learn@rivertech.me.";
          showError(msg);
          submitBtn.disabled = false;
          submitBtn.textContent = originalLabel;
          return;
        }
        const rid = data.registrationId ? ("?id=" + encodeURIComponent(data.registrationId)) : "";
        window.location.href = "waitlist-2026-27-success.html" + rid;
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
    const addBtn = document.getElementById("add-child");
    if (addBtn) addBtn.addEventListener("click", addChild);

    document.getElementById("waitlist-form").addEventListener("submit", submitForm);
  }
})();
