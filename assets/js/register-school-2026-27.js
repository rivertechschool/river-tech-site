/* River Tech — Full-Time Enrollment 2026-27 form logic
   Renders N child cards based on #childCount selector, collects child
   details + optional photo + report-card uploads, and POSTs to the
   Apps Script backend which creates a Stripe Checkout session for the
   flat $300 Household Registration Fee and returns its URL.
   Files are sent as base64 and uploaded to Drive on the backend. */
(function () {
  "use strict";

  // ---- Configuration ----------------------------------------------------
  // Set this to the deployed Apps Script web-app URL before go-live.
  const BACKEND_URL = "https://script.google.com/macros/s/AKfycbwggeLDK4kzV0HOXXhfqW7aX2ow5zUZwuOpET8RmXuZCOhmiWSGP-OSPrrH9ouqkZxC/exec";

  // Flat household registration fee — NOT per child.
  const HOUSEHOLD_FEE = 300;

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

  // "Who does child live with?" (Cognito-style).
  const LIVES_WITH = [
    { id: "both",    label: "Both parents (same household)" },
    { id: "shared",  label: "Both parents (shared custody / two households)" },
    { id: "mother",  label: "Mother primarily" },
    { id: "father",  label: "Father primarily" },
    { id: "other",   label: "Other (grandparent, guardian, etc.)" }
  ];

  // Interests taxonomy (5 buckets × multi-select).
  const INTERESTS = {
    academic: {
      label: "Academic interests",
      options: [
        { id: "math",       label: "Math" },
        { id: "science",    label: "Science" },
        { id: "reading",    label: "Reading" },
        { id: "writing",    label: "Writing" },
        { id: "history",    label: "History / social studies" },
        { id: "languages",  label: "Languages" }
      ]
    },
    arts: {
      label: "Performing &amp; visual arts",
      options: [
        { id: "piano",       label: "Piano / keyboard" },
        { id: "voice",       label: "Voice / singing" },
        { id: "guitar",      label: "Guitar / strings" },
        { id: "band",        label: "Band instrument (brass/wind)" },
        { id: "drama",       label: "Drama / theater" },
        { id: "dance",       label: "Dance" },
        { id: "visual-art",  label: "Drawing / painting / visual art" }
      ]
    },
    technology: {
      label: "Technology",
      options: [
        { id: "coding",      label: "Programming / coding" },
        { id: "robotics",    label: "Robotics / electronics" },
        { id: "gamedev",     label: "Game development" },
        { id: "3d-design",   label: "3D design / 3D printing" },
        { id: "video",       label: "Video editing / filmmaking" },
        { id: "ai",          label: "AI / machine learning" }
      ]
    },
    sports: {
      label: "Sports &amp; fitness",
      options: [
        { id: "team",        label: "Team sports" },
        { id: "individual",  label: "Individual sports (running, swim, etc.)" },
        { id: "martial",     label: "Martial arts" },
        { id: "fitness",     label: "Fitness / conditioning" },
        { id: "outdoors",    label: "Hiking / outdoors" }
      ]
    },
    other: {
      label: "Life skills &amp; service",
      options: [
        { id: "cooking",        label: "Cooking / culinary" },
        { id: "gardening",      label: "Gardening / farming" },
        { id: "entrepreneurship", label: "Entrepreneurship / business" },
        { id: "leadership",     label: "Leadership / public speaking" },
        { id: "service",        label: "Mission work / community service" }
      ]
    }
  };

  // Previous schooling options (multi-select).
  const PREV_SCHOOLING = [
    { id: "public",    label: "Public school" },
    { id: "private",   label: "Private school" },
    { id: "homeschool",label: "Homeschool" },
    { id: "online",    label: "Online / virtual school" },
    { id: "rivertech", label: "River Tech (à la carte or prior year)" },
    { id: "preschool", label: "Preschool / daycare only" },
    { id: "none",      label: "None — first year of school" },
    { id: "other",     label: "Other" }
  ];

  // File size limits. Photo 2 MB + report card 3 MB = 5 MB max per child.
  // 6 children × 5 MB = 30 MB raw → ~40 MB base64 → fits under Apps Script's 50 MB POST limit.
  const MAX_PHOTO_BYTES  = 2 * 1024 * 1024;
  const MAX_REPORT_BYTES = 3 * 1024 * 1024;

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

    const interestsHtml = Object.keys(INTERESTS).map(function (cat) {
      const group = INTERESTS[cat];
      const optsHtml = group.options.map(function (o) {
        return [
          '<label class="reg-check">',
          '  <input type="checkbox" name="c' + idx + '_int_' + cat + '" value="' + o.id + '">',
          '  <span>' + escapeHtml(o.label) + '</span>',
          '</label>'
        ].join("");
      }).join("");
      return [
        '<div class="interests-block">',
        '  <span class="interests-label">' + group.label + '</span>',
        '  <div class="reg-days">' + optsHtml + '</div>',
        '</div>'
      ].join("");
    }).join("");

    const prevSchoolingHtml = PREV_SCHOOLING.map(function (s) {
      return [
        '<label class="reg-check">',
        '  <input type="checkbox" name="c' + idx + '_prev" value="' + s.id + '">',
        '  <span>' + escapeHtml(s.label) + '</span>',
        '</label>'
      ].join("");
    }).join("");

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

      // Schedule
      '<div class="reg-row">',
      '  <label class="reg-label">Schedule<span class="req">*</span></label>',
      '  <div class="schedule-options">' + scheduleHtml + '</div>',
      '</div>',

      // Lives with
      '<div class="reg-row">',
      '  <label class="reg-label">Who does your child live with?<span class="req">*</span></label>',
      '  <div class="reg-days">' + livesWithHtml + '</div>',
      '  <div id="lives-other-' + idx + '" style="display:none; margin-top:10px;">',
      '    <input class="reg-input" type="text" id="c' + idx + '_livesWithNotes" name="c' + idx + '_livesWithNotes" placeholder="Please describe (guardian, grandparent, etc.)">',
      '  </div>',
      '</div>',

      // Interests
      '<div class="reg-row">',
      '  <label class="reg-label">Interests (check any that apply)</label>',
      '  <span class="reg-help" style="display:block; margin-bottom:10px;">This helps us match your child to the right teachers and start-of-year activities. Don&rsquo;t overthink it &mdash; they can add or drop later.</span>',
      interestsHtml,
      '</div>',

      // Photo upload
      '<div class="reg-row">',
      '  <label class="reg-label" for="c' + idx + '_photo">Photo of child (optional)</label>',
      '  <label class="file-drop" id="photo-drop-' + idx + '" for="c' + idx + '_photo">',
      '    <span class="file-name">Click to choose a photo</span>',
      '    <span class="file-hint">JPG or PNG, up to 2 MB. Helps us learn names on day one.</span>',
      '    <input type="file" id="c' + idx + '_photo" name="c' + idx + '_photo" accept="image/jpeg,image/png,image/heic,image/webp">',
      '  </label>',
      '</div>',

      // Report card upload
      '<div class="reg-row">',
      '  <label class="reg-label" for="c' + idx + '_report">Most recent report card (optional)</label>',
      '  <label class="file-drop" id="report-drop-' + idx + '" for="c' + idx + '_report">',
      '    <span class="file-name">Click to choose a report card</span>',
      '    <span class="file-hint">PDF, JPG, or PNG, up to 3 MB. Helps us place your child correctly.</span>',
      '    <input type="file" id="c' + idx + '_report" name="c' + idx + '_report" accept="application/pdf,image/jpeg,image/png">',
      '  </label>',
      '</div>',

      // Attitude / personality
      '<div class="reg-row">',
      '  <label class="reg-label" for="c' + idx + '_attitude">Tell us about your child&rsquo;s personality and learning style</label>',
      '  <textarea class="reg-textarea" id="c' + idx + '_attitude" name="c' + idx + '_attitude" rows="3" placeholder="Shy/outgoing, quiet/chatty, reader/doer, gets frustrated by…, loves…"></textarea>',
      '</div>',

      // Health
      '<div class="reg-row">',
      '  <label class="reg-label" for="c' + idx + '_health">Health &amp; medical notes<span class="req">*</span></label>',
      '  <span class="reg-help" style="display:block; margin-bottom:6px;">Allergies, current medications, conditions we should know about, anything that could come up in a school day. Enter &ldquo;none&rdquo; if there&rsquo;s nothing to report.</span>',
      '  <textarea class="reg-textarea" id="c' + idx + '_health" name="c' + idx + '_health" rows="3" required></textarea>',
      '</div>',

      // Previous schooling
      '<div class="reg-row">',
      '  <label class="reg-label">Previous schooling (check all that apply)</label>',
      '  <div class="reg-days">' + prevSchoolingHtml + '</div>',
      '  <div id="prev-other-' + idx + '" style="display:none; margin-top:10px;">',
      '    <input class="reg-input" type="text" id="c' + idx + '_prevOther" name="c' + idx + '_prevOther" placeholder="Please describe">',
      '  </div>',
      '</div>',

      // Hopes
      '<div class="reg-row">',
      '  <label class="reg-label" for="c' + idx + '_hopes">What do you hope your child gets out of this year at River Tech?</label>',
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

  // ---- File handling ----------------------------------------------------
  function handleFileChange(input, idx, kind) {
    const dropId = (kind === "photo" ? "photo-drop-" : "report-drop-") + idx;
    const drop = document.getElementById(dropId);
    const nameSpan = drop.querySelector(".file-name");
    const file = input.files && input.files[0];
    const limit = kind === "photo" ? MAX_PHOTO_BYTES : MAX_REPORT_BYTES;
    const limitLabel = kind === "photo" ? "2 MB" : "3 MB";
    const defaultLabel = kind === "photo" ? "Click to choose a photo" : "Click to choose a report card";

    if (!file) {
      drop.classList.remove("has-file");
      nameSpan.textContent = defaultLabel;
      return;
    }
    if (file.size > limit) {
      showError("Child " + idx + " " + (kind === "photo" ? "photo" : "report card") +
                " is too large (" + Math.round(file.size / 1024 / 1024 * 10) / 10 + " MB). Please choose a file under " + limitLabel + ".");
      input.value = "";
      drop.classList.remove("has-file");
      nameSpan.textContent = defaultLabel;
      return;
    }
    drop.classList.add("has-file");
    nameSpan.textContent = file.name + " (" + Math.round(file.size / 1024) + " KB)";
  }

  function readFileAsBase64(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
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

  // ---- Collection -------------------------------------------------------
  function collectInterestsForChild(idx) {
    const out = {};
    Object.keys(INTERESTS).forEach(function (cat) {
      const boxes = document.querySelectorAll("input[name='c" + idx + "_int_" + cat + "']:checked");
      out[cat] = Array.prototype.map.call(boxes, function (b) { return b.value; });
    });
    return out;
  }

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

      const prev = Array.from(card.querySelectorAll("input[name='c" + idx + "_prev']:checked"))
        .map(function (c) { return c.value; });

      const photoInput = q("#c" + idx + "_photo");
      const photoFile = photoInput && photoInput.files && photoInput.files[0] ? photoInput.files[0] : null;

      const reportInput = q("#c" + idx + "_report");
      const reportFile = reportInput && reportInput.files && reportInput.files[0] ? reportInput.files[0] : null;

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
        interests:       collectInterestsForChild(idx),
        previousSchooling: prev,
        previousSchoolingOther: val("#c" + idx + "_prevOther").trim(),
        attitude:        val("#c" + idx + "_attitude").trim(),
        health:          val("#c" + idx + "_health").trim(),
        hopes:           val("#c" + idx + "_hopes").trim(),
        notes:           val("#c" + idx + "_notes").trim(),
        photoFile:       photoFile,
        reportFile:      reportFile
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
    if (!countSel.value) return "Please select how many children you're enrolling.";

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
      if (c.previousSchooling.indexOf("other") !== -1 && !c.previousSchoolingOther) {
        return "Child " + c.index + ": please describe the other previous schooling.";
      }
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
    submitBtn.textContent = "Preparing…";

    // Read files to base64 before building payload.
    const fileTasks = [];
    children.forEach(function (c) {
      fileTasks.push(c.photoFile  ? readFileAsBase64(c.photoFile)  : Promise.resolve(null));
      fileTasks.push(c.reportFile ? readFileAsBase64(c.reportFile) : Promise.resolve(null));
    });

    const withProgress = function (label) {
      progress.textContent = label;
      progress.classList.add("show");
    };

    if (children.some(function (c) { return c.photoFile || c.reportFile; })) {
      withProgress("Reading files…");
    }

    Promise.all(fileTasks)
      .then(function (files) {
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
          children: children.map(function (c, i) {
            const photo  = files[i * 2];
            const report = files[i * 2 + 1];
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
              interests:       c.interests,
              previousSchooling: c.previousSchooling,
              previousSchoolingOther: c.previousSchoolingOther,
              attitude:        c.attitude,
              health:          c.health,
              hopes:           c.hopes,
              notes:           c.notes,
              photo:           photo,   // { name, type, size, base64 } or null
              reportCard:      report   // { name, type, size, base64 } or null
            };
          }),
          householdFee:  HOUSEHOLD_FEE,
          totalAmount:   HOUSEHOLD_FEE,
          signature:     form.signature.value.trim(),
          signatureDate: form.signatureDate.value,
          releaseAgreed: true,
          cultureAgreed: true
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

      // Previous schooling "Other" toggle
      if (t.name === "c" + idx + "_prev") {
        togglePrevOther(idx);
      }

      // File inputs
      if (t.type === "file") {
        if (t.name === "c" + idx + "_photo")  handleFileChange(t, idx, "photo");
        if (t.name === "c" + idx + "_report") handleFileChange(t, idx, "report");
      }
    });

    // Release + Culture checkbox visuals
    ["releaseAgree", "cultureAgree"].forEach(function (id) {
      const cb = document.getElementById(id);
      if (!cb) return;
      cb.addEventListener("change", function () {
        const lbl = cb.closest(".reg-check");
        if (lbl) lbl.classList.toggle("checked", cb.checked);
      });
    });

    // Submit
    document.getElementById("reg-form").addEventListener("submit", submitForm);
  }
})();
