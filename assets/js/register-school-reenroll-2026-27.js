/* River Tech — Re-Enrollment 2026-27 form logic
   Streamlined re-enrollment for currently-enrolled River Tech families.
   Drops intake/discovery fields (photo, report card, interests, attitude,
   hopes, previous schooling) since the school already has this on file.
   Keeps contact/emergency/insurance/pickup/medical/schedule — things that
   can change year-to-year — and one optional "anything new for 2026–27"
   text box per child.

   POSTs to the Re-Enrollment Apps Script backend, which creates a Stripe
   Checkout session for the Household Re-Enrollment Fee ($250 since
   2026-04-29, after the early-bird window closed) and returns its URL. */
(function () {
  "use strict";

  // ---- Configuration ----------------------------------------------------
  // Set this to the deployed Re-Enrollment Apps Script web-app URL before go-live.
  const BACKEND_URL = "https://script.google.com/macros/s/AKfycbz7duCV6kqLV8brjz0ujhgsoqY7LOMW7501hjUg_oX42xykAZ-6NSY8I_kBzx93fcO1/exec";

  // Household Re-Enrollment Fee — NOT per child.
  //   Flipped 200 → 250 on 2026-04-29 after the early-bird window closed.
  //   If the fee ever changes again, ALSO change:
  //     - HOUSEHOLD_FEE_USD in apps-script/reenroll-Code.gs
  //     - Hero banner text in pages/register-school-reenroll-2026-27.html
  //     - Meta description in pages/register-school-reenroll-2026-27.html
  //     - Hardcoded $ in summary row of pages/register-school-reenroll-2026-27.html
  const HOUSEHOLD_FEE = 250;

  const MAX_CHILDREN = 6;

  // Schedule options (single-select per child).
  const SCHEDULE_OPTIONS = [
    { id: "performing-arts", label: "Performing Arts Major",
      sub: "Monday – Thursday (4 days)" },
    { id: "technology",      label: "Technology Major",
      sub: "Tuesday – Friday (4 days)" },
    { id: "double-major",    label: "Double Major",
      sub: "Monday – Friday (5 days)" }
  ];

  // Grade options (specific K-12).
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

  // "Who does child live with?" (confirm every year — custody can change).
  const LIVES_WITH = [
    { id: "both",    label: "Both parents (same household)" },
    { id: "shared",  label: "Both parents (shared custody / two households)" },
    { id: "mother",  label: "Mother primarily" },
    { id: "father",  label: "Father primarily" },
    { id: "other",   label: "Other (grandparent, guardian, etc.)" }
  ];

  // ---- Boot -------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", function () {
    // Default signature date to today in local timezone.
    const dateInput = document.getElementById("signatureDate");
    if (dateInput) {
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      dateInput.value = yyyy + "-" + mm + "-" + dd;
    }

    // Reflect current HOUSEHOLD_FEE in the summary (defensive — the HTML
    // hardcodes the dollar amount, but if the fee ever changes here and the
    // template is missed, this keeps the summary honest).
    const feeEl = document.getElementById("summary-fee");
    if (feeEl) feeEl.textContent = "$" + HOUSEHOLD_FEE;

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

    const scheduleHtml = SCHEDULE_OPTIONS.map(function (s) {
      return [
        '<label class="reg-check">',
        '  <input type="radio" name="c' + idx + '_schedule" value="' + s.id + '" required>',
        '  <span><strong>' + escapeHtml(s.label) + '</strong><br><small>' + escapeHtml(s.sub) + '</small></span>',
        '</label>'
      ].join("");
    }).join("");

    const livesWithHtml = LIVES_WITH.map(function (l) {
      return [
        '<label class="reg-check">',
        '  <input type="radio" name="c' + idx + '_livesWith" value="' + l.id + '" required>',
        '  <span>' + escapeHtml(l.label) + '</span>',
        '</label>'
      ].join("");
    }).join("");

    card.innerHTML = [
      '<div class="child-card-header">',
      '  <div class="child-card-title">Child ' + idx + '</div>',
      '</div>',

      // Name — confirm identity
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

      // Preferred name + DOB
      '<div class="reg-row-grid-2">',
      '  <div>',
      '    <label class="reg-label" for="c' + idx + '_preferredName">Preferred name <span style="font-weight:400; opacity:0.7;">(what they go by at school)</span></label>',
      '    <input class="reg-input" type="text" id="c' + idx + '_preferredName" name="c' + idx + '_preferredName">',
      '  </div>',
      '  <div>',
      '    <label class="reg-label" for="c' + idx + '_dob">Date of birth<span class="req">*</span></label>',
      '    <input class="reg-input" type="date" id="c' + idx + '_dob" name="c' + idx + '_dob" required>',
      '  </div>',
      '</div>',

      // Gender + Grade
      '<div class="reg-row-grid-2">',
      '  <div>',
      '    <label class="reg-label" for="c' + idx + '_gender">Gender</label>',
      '    <select class="reg-select" id="c' + idx + '_gender" name="c' + idx + '_gender">',
      '      <option value="">Prefer not to say</option>',
      '      <option value="female">Female</option>',
      '      <option value="male">Male</option>',
      '    </select>',
      '  </div>',
      '  <div>',
      '    <label class="reg-label" for="c' + idx + '_grade">Grade for 2026&ndash;27<span class="req">*</span></label>',
      '    <select class="reg-select" id="c' + idx + '_grade" name="c' + idx + '_grade" required>',
      '      <option value="">Select grade…</option>',
      gradeOptionsHtml,
      '    </select>',
      '  </div>',
      '</div>',

      // Schedule — confirm every year (families often change days/track)
      '<div class="reg-row">',
      '  <label class="reg-label">Schedule for 2026&ndash;27<span class="req">*</span></label>',
      '  <span class="reg-help" style="display:block; margin-bottom:10px;">Pick the track and days for next year. This can differ from this year &mdash; many families change.</span>',
      '  <div class="schedule-options">' + scheduleHtml + '</div>',
      '</div>',

      // Lives with — confirm every year (custody / guardianship can shift)
      '<div class="reg-row">',
      '  <label class="reg-label">Who does your child live with?<span class="req">*</span></label>',
      '  <div class="reg-days">' + livesWithHtml + '</div>',
      '  <div id="lives-other-' + idx + '" style="display:none; margin-top:10px;">',
      '    <input class="reg-input" type="text" id="c' + idx + '_livesWithNotes" name="c' + idx + '_livesWithNotes" placeholder="Please describe (guardian, grandparent, etc.)">',
      '  </div>',
      '</div>',

      // Health — critical to refresh each year
      '<div class="reg-row">',
      '  <label class="reg-label" for="c' + idx + '_health">Health &amp; medical notes for 2026&ndash;27<span class="req">*</span></label>',
      '  <span class="reg-help" style="display:block; margin-bottom:6px;">Please re-enter this every year, even if unchanged &mdash; allergies, current medications, conditions we should know about, anything that could come up in a school day. Enter &ldquo;none&rdquo; if there&rsquo;s nothing to report.</span>',
      '  <textarea class="reg-textarea" id="c' + idx + '_health" name="c' + idx + '_health" rows="3" required></textarea>',
      '</div>',

      // Anything new for next year — single optional open box
      '<div class="reg-row">',
      '  <label class="reg-label" for="c' + idx + '_notesNewYear">Anything you&rsquo;d like us to know about your child for the 2026&ndash;27 year? <span style="font-weight:400; opacity:0.7;">(optional)</span></label>',
      '  <span class="reg-help" style="display:block; margin-bottom:6px;">New interests, changes at home, things that went well or didn&rsquo;t last year, goals for next year. Short is fine.</span>',
      '  <textarea class="reg-textarea" id="c' + idx + '_notesNewYear" name="c' + idx + '_notesNewYear" rows="3"></textarea>',
      '</div>'
    ].join("");

    return card;
  }

  // ---- "Lives with — Other" toggle --------------------------------------
  function toggleLivesOther(idx) {
    const other = document.getElementById("lives-other-" + idx);
    if (!other) return;
    const checked = document.querySelector("input[name='c" + idx + "_livesWith']:checked");
    const show = checked && checked.value === "other";
    other.style.display = show ? "" : "none";
    if (!show) {
      const txt = document.getElementById("c" + idx + "_livesWithNotes");
      if (txt) txt.value = "";
    }
  }

  // ---- Collection -------------------------------------------------------
  function getLivesWith(idx) {
    const r = document.querySelector("input[name='c" + idx + "_livesWith']:checked");
    return r ? r.value : "";
  }

  function getSchedule(idx) {
    const r = document.querySelector("input[name='c" + idx + "_schedule']:checked");
    return r ? r.value : "";
  }

  function collectChildren() {
    const cards = Array.from(document.querySelectorAll(".child-card"));
    return cards.map(function (card, i) {
      const idx = card.dataset.childIdx;
      const q = function (sel) { return card.querySelector(sel); };
      const val = function (sel) { const e = q(sel); return e ? (e.value || "") : ""; };

      return {
        index: i + 1,
        firstName:       val("#c" + idx + "_firstName").trim(),
        lastName:        val("#c" + idx + "_lastName").trim(),
        preferredName:   val("#c" + idx + "_preferredName").trim(),
        dob:             val("#c" + idx + "_dob"),
        gender:          val("#c" + idx + "_gender"),
        grade:           val("#c" + idx + "_grade"),
        schedule:        getSchedule(idx),
        livesWith:       getLivesWith(idx),
        livesWithNotes:  val("#c" + idx + "_livesWithNotes").trim(),
        health:          val("#c" + idx + "_health").trim(),
        notesNewYear:    val("#c" + idx + "_notesNewYear").trim()
      };
    });
  }

  function updateSummary() {
    const count = document.querySelectorAll(".child-card").length;
    const el = document.getElementById("summary-child-count");
    if (el) el.textContent = String(count);
  }

  // ---- Validation -------------------------------------------------------
  function validate(children) {
    const form = document.getElementById("reg-form");

    const parentFields = ["parentFirstName", "parentLastName", "parentEmail", "parentPhone", "parentAddress"];
    for (let i = 0; i < parentFields.length; i++) {
      const f = form.querySelector("[name='" + parentFields[i] + "']");
      if (!f || !f.value.trim()) return "Please fill in all required parent/guardian fields.";
    }

    const emerFields = ["emergencyName", "emergencyRelationship", "emergencyPhone"];
    for (let i = 0; i < emerFields.length; i++) {
      const f = form.querySelector("[name='" + emerFields[i] + "']");
      if (!f || !f.value.trim()) return "Please fill in the required Emergency Contact fields.";
    }

    const insFields = ["insuranceProvider", "insurancePrimary", "insurancePolicy"];
    for (let i = 0; i < insFields.length; i++) {
      const f = form.querySelector("[name='" + insFields[i] + "']");
      if (!f || !f.value.trim()) return "Please fill in the required Insurance Information fields.";
    }

    const countSel = document.getElementById("childCount");
    if (!countSel.value) return "Please select how many children you're re-enrolling.";

    if (children.length === 0) return "Please add at least one child.";

    for (let i = 0; i < children.length; i++) {
      const c = children[i];
      if (!c.firstName) return "Child " + c.index + ": first name is required.";
      if (!c.lastName)  return "Child " + c.index + ": last name is required.";
      if (!c.dob)       return "Child " + c.index + ": date of birth is required.";
      if (!c.grade)     return "Child " + c.index + ": please pick a grade.";
      if (!c.schedule)  return "Child " + c.index + ": please pick a schedule (Performing Arts, Technology, or Double Major).";
      if (!c.livesWith) return "Child " + c.index + ": please tell us who they live with.";
      if (c.livesWith === "other" && !c.livesWithNotes) {
        return "Child " + c.index + ": please describe the \"other\" living arrangement.";
      }
      if (!c.health)    return "Child " + c.index + ": please fill in Health & medical notes (enter \"none\" if nothing to report).";
    }

    const release = form.querySelector("#releaseAgree");
    if (!release.checked) return "Please read and agree to the Release and Acknowledgment before continuing.";

    const sig = form.querySelector("#signature");
    if (!sig.value.trim()) return "Please type your full legal name as signature.";
    const sigDate = form.querySelector("#signatureDate");
    if (!sigDate.value) return "Please enter today's date.";

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
    const progress = document.getElementById("upload-progress");
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";
    progress.textContent = "Submitting…";
    progress.classList.add("show");

    const payload = {
      submittedAt: new Date().toISOString(),
      schoolYear: "2026-27",
      formType: "reenrollment",
      parent: {
        firstName: form.parentFirstName.value.trim(),
        lastName:  form.parentLastName.value.trim(),
        email:     form.parentEmail.value.trim(),
        phone:     form.parentPhone.value.trim(),
        address:   form.parentAddress.value.trim()
      },
      parent2: form.addParent2Toggle.checked ? {
        firstName: form.parent2FirstName.value.trim(),
        lastName:  form.parent2LastName.value.trim(),
        email:     form.parent2Email.value.trim(),
        phone:     form.parent2Phone.value.trim()
      } : null,
      emergency: {
        name:         form.emergencyName.value.trim(),
        relationship: form.emergencyRelationship.value.trim(),
        phone:        form.emergencyPhone.value.trim(),
        altPhone:     form.emergencyAltPhone.value.trim()
      },
      insurance: {
        provider:   form.insuranceProvider.value.trim(),
        primary:    form.insurancePrimary.value.trim(),
        policy:     form.insurancePolicy.value.trim(),
        group:      form.insuranceGroup.value.trim()
      },
      pickup: [1, 2, 3].map(function (n) {
        return {
          name:         form["pickup" + n + "Name"].value.trim(),
          relationship: form["pickup" + n + "Relationship"].value.trim(),
          phone:        form["pickup" + n + "Phone"].value.trim()
        };
      }),
      children: children.map(function (c) {
        return {
          firstName:       c.firstName,
          lastName:        c.lastName,
          preferredName:   c.preferredName,
          dob:             c.dob,
          gender:          c.gender,
          grade:           c.grade,
          schedule:        c.schedule,
          livesWith:       c.livesWith,
          livesWithNotes:  c.livesWithNotes,
          health:          c.health,
          notesNewYear:    c.notesNewYear
        };
      }),
      householdFee:  HOUSEHOLD_FEE,
      totalAmount:   HOUSEHOLD_FEE,
      signature:     form.signature.value.trim(),
      signatureDate: form.signatureDate.value,
      releaseAgreed: true
    };

    // If backend isn't wired yet, show a friendly preview.
    if (!BACKEND_URL || BACKEND_URL === "__BACKEND_URL__") {
      console.log("Re-enrollment payload (no backend configured):", payload);
      showError("Almost ready — the payment backend isn't connected yet. Your details are complete. Please try again in a few minutes, or email learn@rivertech.me to re-enroll by hand.");
      submitBtn.disabled = false;
      submitBtn.textContent = "Continue to Payment →";
      progress.classList.remove("show");
      return;
    }

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
    document.getElementById("reg-success").classList.remove("show");
  }

  // ---- Event wiring -----------------------------------------------------
  function wireEvents() {
    // Child count selector drives how many child cards render.
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
      p2Block.style.display = p2Toggle.checked ? "" : "none";
      const lbl = p2Toggle.closest(".reg-check");
      if (lbl) lbl.classList.toggle("checked", p2Toggle.checked);
    });

    // Delegated: child-container changes
    const container = document.getElementById("children-container");
    container.addEventListener("change", function (e) {
      const t = e.target;
      const card = t.closest(".child-card");
      if (!card) return;
      const idx = card.dataset.childIdx;

      // Visual checked state for custom check/radio labels
      const label = t.closest(".reg-check");
      if (label && (t.type === "checkbox" || t.type === "radio")) {
        if (t.type === "checkbox") {
          label.classList.toggle("checked", t.checked);
        } else if (t.type === "radio") {
          const group = document.getElementsByName(t.name);
          Array.prototype.forEach.call(group, function (r) {
            const lbl = r.closest(".reg-check");
            if (lbl) lbl.classList.toggle("checked", r.checked);
          });
        }
      }

      // Lives-with "Other" toggle
      if (t.name === "c" + idx + "_livesWith") {
        toggleLivesOther(idx);
      }
    });

    // Release checkbox visual
    const cb = document.getElementById("releaseAgree");
    if (cb) {
      cb.addEventListener("change", function () {
        const lbl = cb.closest(".reg-check");
        if (lbl) lbl.classList.toggle("checked", cb.checked);
      });
    }

    // Submit
    document.getElementById("reg-form").addEventListener("submit", submitForm);
  }
})();
