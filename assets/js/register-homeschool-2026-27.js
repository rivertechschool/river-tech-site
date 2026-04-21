/* River Tech — Homeschool Enrollment 2026-27 form logic
   Renders N child cards based on #childCount selector, collects child
   details + optional photo uploads, computes Annual Family Setup Fee
   (keyed to the highest-enrolled child's day count), and POSTs to the
   Apps Script backend which creates a Stripe Checkout session and
   returns its URL. Photos are sent as base64 and uploaded to Drive on
   the backend. */
(function () {
  "use strict";

  // ---- Configuration ----------------------------------------------------
  // Set this to the deployed Apps Script web-app URL before go-live.
  const BACKEND_URL = "https://script.google.com/macros/s/AKfycbxbZ8U_EhvQTJLrXLLo1EsS45grDHTtCRnOJbU_Di_o16Rc4bJSSV0Kf3yTOQk9dbEUDQ/exec";

  // Annual Family Setup Fee keyed to the highest-enrolled child's day count.
  // E.g. if one child is in 3 days and another is in 2 days, the family
  // fee is $125 (the 3-day rate), not $125 + $100.
  const FAMILY_FEE_BY_MAX_DAYS = { 1: 75, 2: 100, 3: 125, 4: 150 };

  const MAX_CHILDREN = 6;

  // Program days offered.
  const PROGRAMS = [
    { id: "monday",   label: "Monday — Performing Arts" },
    { id: "tuesday",  label: "Tuesday — Science & Social Studies" },
    { id: "thursday", label: "Thursday — Life Skills" },
    { id: "friday",   label: "Friday — Technology" }
  ];

  // Previous schooling options (multi-select).
  const PREV_SCHOOLING = [
    { id: "public",    label: "Public school" },
    { id: "private",   label: "Private school" },
    { id: "homeschool",label: "Homeschool" },
    { id: "online",    label: "Online / virtual school" },
    { id: "preschool", label: "Preschool / daycare only" },
    { id: "none",      label: "None — first year of school" },
    { id: "other",     label: "Other" }
  ];

  // Photo size limit. 5 MB is plenty for a phone portrait. Bigger files
  // bloat the JSON payload and can trip Apps Script limits.
  const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

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
    // Preserve any values already entered — rebuild only if child count changed.
    const existingCount = container.querySelectorAll(".child-card").length;
    if (existingCount === n) return;

    // Simple approach: rebuild from scratch. Users set count first, then fill.
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

    card.innerHTML = [
      '<div class="child-card-header">',
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
      '      <option value="">Prefer not to say</option>',
      '      <option value="female">Female</option>',
      '      <option value="male">Male</option>',
      '    </select>',
      '  </div>',
      '</div>',

      // Grade band
      '<div class="reg-row">',
      '  <label class="reg-label">Grade level<span class="req">*</span></label>',
      '  <div class="reg-grade-bands">',
      '    <label class="reg-check">',
      '      <input type="radio" name="c' + idx + '_grade" value="elementary" required>',
      '      <span><strong>Elementary</strong><br><small>approx. K&ndash;5</small></span>',
      '    </label>',
      '    <label class="reg-check">',
      '      <input type="radio" name="c' + idx + '_grade" value="middle" required>',
      '      <span><strong>Middle School</strong><br><small>approx. 6&ndash;8</small></span>',
      '    </label>',
      '    <label class="reg-check">',
      '      <input type="radio" name="c' + idx + '_grade" value="high" required>',
      '      <span><strong>High School</strong><br><small>approx. 9&ndash;12</small></span>',
      '    </label>',
      '  </div>',
      '</div>',

      // Elementary follow-up (hidden unless Elementary selected)
      '<div class="elem-follow-up" id="elem-follow-' + idx + '" style="display:none;">',
      '  <div class="reg-row-grid-2">',
      '    <div>',
      '      <label class="reg-label" for="c' + idx + '_reading">Reading ability<span class="req">*</span></label>',
      '      <select class="reg-select" id="c' + idx + '_reading" name="c' + idx + '_reading">',
      '        <option value="">Select…</option>',
      '        <option value="independent">Reads confidently on their own</option>',
      '        <option value="with-help">Reads with some help</option>',
      '        <option value="letters">Knows letters and simple words</option>',
      '        <option value="pre-reader">Not yet reading</option>',
      '      </select>',
      '    </div>',
      '    <div>',
      '      <label class="reg-label" for="c' + idx + '_tablet">Tablet proficiency<span class="req">*</span></label>',
      '      <select class="reg-select" id="c' + idx + '_tablet" name="c' + idx + '_tablet">',
      '        <option value="">Select…</option>',
      '        <option value="independent">Uses a tablet independently</option>',
      '        <option value="some-help">Uses with occasional help</option>',
      '        <option value="lots-of-help">Needs help with most tablet tasks</option>',
      '        <option value="never-used">Has never used a tablet</option>',
      '      </select>',
      '    </div>',
      '  </div>',
      '</div>',

      // Programs
      '<div class="reg-row">',
      '  <label class="reg-label">Which program days?<span class="req">*</span></label>',
      '  <span class="reg-help" style="display:block; margin-bottom:8px;">Select 1&ndash;4 days. The Annual Family Setup Fee is keyed to the child enrolled for the most days.</span>',
      '  <div class="reg-days">',
      PROGRAMS.map(function (p) {
        return [
          '    <label class="reg-check">',
          '      <input type="checkbox" name="c' + idx + '_programs" value="' + p.id + '">',
          '      <span>' + escapeHtml(p.label) + '</span>',
          '    </label>'
        ].join("");
      }).join(""),
      '  </div>',
      '</div>',

      // Photo upload
      '<div class="reg-row">',
      '  <label class="reg-label" for="c' + idx + '_photo">Photo of child (optional)</label>',
      '  <label class="file-drop" id="file-drop-' + idx + '" for="c' + idx + '_photo">',
      '    <span class="file-name">Click to choose a photo</span>',
      '    <span class="file-hint">JPG or PNG, up to 5 MB. Helps us learn names on day one.</span>',
      '    <input type="file" id="c' + idx + '_photo" name="c' + idx + '_photo" accept="image/jpeg,image/png,image/heic,image/webp">',
      '  </label>',
      '</div>',

      // Attitude / personality
      '<div class="reg-row">',
      '  <label class="reg-label" for="c' + idx + '_attitude">Tell us about your child&rsquo;s personality and learning style</label>',
      '  <textarea class="reg-textarea" id="c' + idx + '_attitude" name="c' + idx + '_attitude" rows="3" placeholder="Shy/outgoing, quiet/chatty, reader/doer, gets frustrated by…, loves…"></textarea>',
      '</div>',

      // Health
      '<div class="reg-row">',
      '  <label class="reg-label" for="c' + idx + '_health">Health &amp; medical notes</label>',
      '  <span class="reg-help" style="display:block; margin-bottom:6px;">Allergies, current medications, conditions we should know about, anything that could come up in a school day.</span>',
      '  <textarea class="reg-textarea" id="c' + idx + '_health" name="c' + idx + '_health" rows="3"></textarea>',
      '</div>',

      // Previous schooling
      '<div class="reg-row">',
      '  <label class="reg-label">Previous schooling (check all that apply)</label>',
      '  <div class="reg-days">',
      PREV_SCHOOLING.map(function (s) {
        return [
          '    <label class="reg-check">',
          '      <input type="checkbox" name="c' + idx + '_prev" value="' + s.id + '">',
          '      <span>' + escapeHtml(s.label) + '</span>',
          '    </label>'
        ].join("");
      }).join(""),
      '  </div>',
      '  <div id="prev-other-' + idx + '" style="display:none; margin-top:10px;">',
      '    <input class="reg-input" type="text" id="c' + idx + '_prevOther" name="c' + idx + '_prevOther" placeholder="Please describe">',
      '  </div>',
      '</div>',

      // Hopes
      '<div class="reg-row">',
      '  <label class="reg-label" for="c' + idx + '_hopes">What do you hope your child gets out of this year?</label>',
      '  <textarea class="reg-textarea" id="c' + idx + '_hopes" name="c' + idx + '_hopes" rows="3"></textarea>',
      '</div>',

      // Anything else
      '<div class="reg-row">',
      '  <label class="reg-label" for="c' + idx + '_notes">Anything else we should know about this child?</label>',
      '  <textarea class="reg-textarea" id="c' + idx + '_notes" name="c' + idx + '_notes" rows="2"></textarea>',
      '</div>'
    ].join("");

    return card;
  }

  // ---- Grade follow-up toggle ------------------------------------------
  function toggleElemFollowUp(idx, grade) {
    const block = document.getElementById("elem-follow-" + idx);
    if (!block) return;
    const selects = block.querySelectorAll("select");
    if (grade === "elementary") {
      block.style.display = "";
      selects.forEach(function (s) { s.required = true; });
    } else {
      block.style.display = "none";
      selects.forEach(function (s) { s.required = false; s.value = ""; });
    }
  }

  // ---- "Previous schooling — Other" toggle ------------------------------
  function togglePrevOther(idx) {
    const other = document.getElementById("prev-other-" + idx);
    if (!other) return;
    const card = document.getElementById("child-" + idx);
    const otherChecked = card && card.querySelector("input[name='c" + idx + "_prev'][value='other']:checked");
    other.style.display = otherChecked ? "" : "none";
    if (!otherChecked) {
      const txt = document.getElementById("c" + idx + "_prevOther");
      if (txt) txt.value = "";
    }
  }

  // ---- Photo handling ---------------------------------------------------
  function handlePhotoChange(input, idx) {
    const drop = document.getElementById("file-drop-" + idx);
    const nameSpan = drop.querySelector(".file-name");
    const file = input.files && input.files[0];
    if (!file) {
      drop.classList.remove("has-file");
      nameSpan.textContent = "Click to choose a photo";
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      showError("Child " + idx + " photo is too large (" + Math.round(file.size / 1024 / 1024) + " MB). Please choose a photo under 5 MB.");
      input.value = "";
      drop.classList.remove("has-file");
      nameSpan.textContent = "Click to choose a photo";
      return;
    }
    drop.classList.add("has-file");
    nameSpan.textContent = file.name + " (" + Math.round(file.size / 1024) + " KB)";
  }

  function readFileAsBase64(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        // Strip "data:...;base64," prefix — backend only wants raw base64.
        const s = String(reader.result || "");
        const commaIdx = s.indexOf(",");
        resolve({
          name: file.name,
          type: file.type,
          size: file.size,
          base64: commaIdx >= 0 ? s.substring(commaIdx + 1) : s
        });
      };
      reader.onerror = function () { reject(reader.error || new Error("File read failed")); };
      reader.readAsDataURL(file);
    });
  }

  // ---- Collection / pricing --------------------------------------------
  function getChildGrade(idx) {
    const r = document.querySelector("input[name='c" + idx + "_grade']:checked");
    return r ? r.value : "";
  }

  function collectChildren() {
    const cards = Array.from(document.querySelectorAll(".child-card"));
    return cards.map(function (card, i) {
      const idx = card.dataset.childIdx;
      const q = function (sel) { return card.querySelector(sel); };
      const val = function (sel) { const e = q(sel); return e ? (e.value || "") : ""; };

      const programs = Array.from(card.querySelectorAll("input[name='c" + idx + "_programs']:checked"))
        .map(function (c) { return c.value; });

      const prev = Array.from(card.querySelectorAll("input[name='c" + idx + "_prev']:checked"))
        .map(function (c) { return c.value; });

      const photoInput = q("#c" + idx + "_photo");
      const photoFile = photoInput && photoInput.files && photoInput.files[0] ? photoInput.files[0] : null;

      return {
        index: i + 1,
        firstName:  val("#c" + idx + "_firstName").trim(),
        lastName:   val("#c" + idx + "_lastName").trim(),
        dob:        val("#c" + idx + "_dob"),
        gender:     val("#c" + idx + "_gender"),
        grade:      getChildGrade(idx),
        readingLevel: val("#c" + idx + "_reading"),
        tabletLevel:  val("#c" + idx + "_tablet"),
        programs:   programs,
        previousSchooling: prev,
        previousSchoolingOther: val("#c" + idx + "_prevOther").trim(),
        attitude:   val("#c" + idx + "_attitude").trim(),
        health:     val("#c" + idx + "_health").trim(),
        hopes:      val("#c" + idx + "_hopes").trim(),
        notes:      val("#c" + idx + "_notes").trim(),
        photoFile:  photoFile
      };
    });
  }

  function computeFamilyFee(children) {
    let max = 0;
    children.forEach(function (c) {
      if (c.programs.length > max) max = c.programs.length;
    });
    if (max < 1) return { maxDays: 0, fee: 0 };
    const capped = Math.min(max, 4);
    return { maxDays: capped, fee: FAMILY_FEE_BY_MAX_DAYS[capped] || 0 };
  }

  function updateSummary() {
    const section = document.getElementById("summary-section");
    const box = document.getElementById("summary-box");
    const children = collectChildren();
    const { maxDays, fee } = computeFamilyFee(children);

    if (fee <= 0) {
      section.style.display = "none";
      return;
    }

    const lines = children
      .filter(function (c) { return c.programs.length > 0; })
      .map(function (c) {
        const name = c.firstName || ("Child " + c.index);
        const dayWord = c.programs.length === 1 ? "day" : "days";
        return '<div class="reg-summary-row"><span>' + escapeHtml(name) + '</span><span>' + c.programs.length + ' ' + dayWord + '</span></div>';
      }).join("");

    box.innerHTML = [
      '<div class="reg-summary-row" style="font-size:14px; opacity:0.7; margin-bottom:8px;"><span>Children enrolled</span><span></span></div>',
      lines,
      '<div class="reg-summary-row reg-summary-total"><span>Annual Family Setup Fee (' + maxDays + '-day rate)</span><span>$' + fee + '</span></div>'
    ].join("");
    section.style.display = "block";
  }

  // ---- Validation -------------------------------------------------------
  function validate(children) {
    const form = document.getElementById("reg-form");

    const parentFields = ["parentFirstName", "parentLastName", "parentEmail", "parentPhone", "parentAddress"];
    for (let i = 0; i < parentFields.length; i++) {
      const f = form.querySelector("[name='" + parentFields[i] + "']");
      if (!f || !f.value.trim()) return "Please fill in all required parent/guardian fields.";
    }

    const countSel = document.getElementById("childCount");
    if (!countSel.value) return "Please select how many children you're enrolling.";

    if (children.length === 0) return "Please add at least one child.";

    for (let i = 0; i < children.length; i++) {
      const c = children[i];
      if (!c.firstName) return "Child " + c.index + ": first name is required.";
      if (!c.lastName)  return "Child " + c.index + ": last name is required.";
      if (!c.dob)       return "Child " + c.index + ": date of birth is required.";
      if (!c.grade)     return "Child " + c.index + ": please pick a grade level.";
      if (c.grade === "elementary") {
        if (!c.readingLevel) return "Child " + c.index + ": please select a reading ability.";
        if (!c.tabletLevel)  return "Child " + c.index + ": please select a tablet proficiency.";
      }
      if (c.programs.length === 0) return "Child " + c.index + ": please pick at least one program day.";
      if (c.previousSchooling.indexOf("other") !== -1 && !c.previousSchoolingOther) {
        return "Child " + c.index + ": please describe the other previous schooling.";
      }
    }

    const release = form.querySelector("#releaseAgree");
    if (!release.checked) return "Please read and agree to the Release & Acknowledgment before continuing.";

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
    submitBtn.textContent = "Preparing…";

    // Read photos to base64 before building payload.
    const readTasks = children.map(function (c) {
      if (!c.photoFile) return Promise.resolve(null);
      return readFileAsBase64(c.photoFile);
    });

    const withProgress = function (label) {
      progress.textContent = label;
      progress.classList.add("show");
    };

    if (children.some(function (c) { return c.photoFile; })) {
      withProgress("Reading photos…");
    }

    Promise.all(readTasks)
      .then(function (photos) {
        const { maxDays, fee } = computeFamilyFee(children);

        const payload = {
          submittedAt: new Date().toISOString(),
          schoolYear: "2026-27",
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
          children: children.map(function (c, i) {
            const p = photos[i];
            return {
              firstName:  c.firstName,
              lastName:   c.lastName,
              dob:        c.dob,
              gender:     c.gender,
              grade:      c.grade,
              readingLevel: c.readingLevel,
              tabletLevel:  c.tabletLevel,
              programs:   c.programs,
              previousSchooling: c.previousSchooling,
              previousSchoolingOther: c.previousSchoolingOther,
              attitude:   c.attitude,
              health:     c.health,
              hopes:      c.hopes,
              notes:      c.notes,
              photo:      p // { name, type, size, base64 } or null
            };
          }),
          maxDays:       maxDays,
          familyFee:     fee,
          totalAmount:   fee,
          signature:     form.signature.value.trim(),
          signatureDate: form.signatureDate.value,
          releaseAgreed: true
        };

        // If backend isn't wired yet, show a friendly preview.
        if (!BACKEND_URL || BACKEND_URL === "__BACKEND_URL__") {
          console.log("Registration payload (no backend configured):", payload);
          showError("Almost ready — the payment backend isn't connected yet. Your details are complete. Please try again in a few minutes, or email learn@rivertech.me to enroll by hand.");
          submitBtn.disabled = false;
          submitBtn.textContent = "Continue to Payment →";
          progress.classList.remove("show");
          return;
        }

        withProgress("Submitting…");

        return fetch(BACKEND_URL, {
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
          });
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

    // Delegated: child-container changes (grade, programs, photos, prev-schooling)
    const container = document.getElementById("children-container");
    container.addEventListener("change", function (e) {
      const t = e.target;
      const card = t.closest(".child-card");
      if (!card) return;
      const idx = card.dataset.childIdx;

      // Visual checked state for custom check labels
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

      // Grade changed → show/hide Elementary follow-up
      if (t.name === "c" + idx + "_grade") {
        toggleElemFollowUp(idx, t.value);
      }

      // Previous schooling "Other" toggle
      if (t.name === "c" + idx + "_prev") {
        togglePrevOther(idx);
      }

      // Photo input
      if (t.type === "file" && t.name === "c" + idx + "_photo") {
        handlePhotoChange(t, idx);
      }

      // Programs change → recompute summary
      if (t.name === "c" + idx + "_programs") {
        updateSummary();
      }
    });

    // Release checkbox visual
    const release = document.getElementById("releaseAgree");
    release.addEventListener("change", function () {
      const lbl = release.closest(".reg-check");
      if (lbl) lbl.classList.toggle("checked", release.checked);
    });

    // Submit
    document.getElementById("reg-form").addEventListener("submit", submitForm);
  }
})();
