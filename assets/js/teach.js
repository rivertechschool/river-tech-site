/* River Tech — Teach at River Tech (part-time teaching application)
   Renders education degree cards, experience blocks, grouped subject
   checkboxes, and day-availability cards from config arrays. Tracks a live
   progress bar as required sections complete. POSTs JSON to the Apps Script
   backend, which writes a sheet row and sends applicant + admin emails.
   No payments, no uploads. */
(function () {
  "use strict";

  // ---- Configuration ----------------------------------------------------
  // Set this to the deployed Apps Script web-app URL before go-live.
  const BACKEND_URL = "__BACKEND_URL__";

  const EDU_LEVELS = [
    { id: "assoc",  label: "Associate’s degree" },
    { id: "bach",   label: "Bachelor’s degree" },
    { id: "master", label: "Master’s degree" },
    { id: "phd",    label: "Doctorate (Ph.D., Ed.D., M.D., J.D.…)" },
    { id: "cert",   label: "Recognized certificate(s)" }
  ];

  const EXPERIENCES = [
    { id: "classroom", label: "Classroom teaching", help: "school or international school, any level" },
    { id: "coop",      label: "Homeschool / co-op teaching", help: "including teaching your own children" },
    { id: "tutoring",  label: "Tutoring, coaching, or mentoring", help: "academic, athletic, musical, or spiritual" },
    { id: "pro",       label: "Professional mastery of a subject I’d teach", help: "you’ve done this for a living" }
  ];

  const SUBJECT_GROUPS = [
    { title: "Science & Engineering", subjects: [
      "Physics", "Chemistry", "Biology", "General Science", "Scientific Literacy",
      "Astronomy & Rocketry", "Molecular Biology", "Medicine & Anatomy", "Engineering & Electronics"
    ]},
    { title: "Technology", subjects: [
      "Coding", "AI & Machine Learning", "Robotics", "Drones", "Digital Arts",
      "Game Development", "3D Design & Printing"
    ]},
    { title: "Arts & Media", subjects: [
      "Filmmaking", "Photography", "Animation", "Music Production & Sound Engineering",
      "Instruments (must be skilled)", "Creative Writing", "Crafts"
    ]},
    { title: "Humanities & Life", subjects: [
      "History", "Geography", "Personal Finance & Family Life", "Leadership Mindset",
      "Critical Thinking & Debate", "Public Speaking", "Entrepreneurship",
      "Foreign Languages (must be fluent)"
    ]},
    { title: "Body & Movement", subjects: [
      "P.E.", "Martial Arts (must be instructor)", "Dance", "Chess & Strategy Games"
    ]}
  ];

  const DAYS = [
    { id: "monday",   name: "Monday",   theme: "Performing Arts" },
    { id: "tuesday",  name: "Tuesday",  theme: "Science & Social Studies" },
    { id: "thursday", name: "Thursday", theme: "Life Skills" },
    { id: "friday",   name: "Friday",   theme: "Technology" }
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
    renderEducation();
    renderExperience();
    renderSubjects();
    renderDays();
    wireEvents();
    updateProgress();
  });

  // ---- DOM helpers ------------------------------------------------------
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---- Render: education degree cards ------------------------------------
  function renderEducation() {
    const container = document.getElementById("edu-container");
    EDU_LEVELS.forEach(function (lvl) {
      const card = document.createElement("div");
      card.className = "edu-card";
      card.id = "edu-" + lvl.id;

      let bodyHtml;
      if (lvl.id === "cert") {
        // Up to 3 certificate rows
        bodyHtml = [1, 2, 3].map(function (i) {
          return [
            '<div class="reg-row-grid-3">',
            '  <div>',
            '    <label class="reg-label" for="cert' + i + '_name">Certificate ' + i + (i === 1 ? '<span class="req">*</span>' : '') + '</label>',
            '    <input class="reg-input" type="text" id="cert' + i + '_name" name="cert' + i + '_name" placeholder="e.g. TEFL, CompTIA, CPR Instructor">',
            '  </div>',
            '  <div>',
            '    <label class="reg-label" for="cert' + i + '_issuer">Issued by</label>',
            '    <input class="reg-input" type="text" id="cert' + i + '_issuer" name="cert' + i + '_issuer">',
            '  </div>',
            '  <div>',
            '    <label class="reg-label" for="cert' + i + '_year">Year</label>',
            '    <input class="reg-input" type="text" id="cert' + i + '_year" name="cert' + i + '_year" inputmode="numeric" maxlength="4">',
            '  </div>',
            '</div>'
          ].join("");
        }).join("");
      } else {
        bodyHtml = [
          '<div class="reg-row-grid-3">',
          '  <div>',
          '    <label class="reg-label" for="' + lvl.id + '_field">Field of study<span class="req">*</span></label>',
          '    <input class="reg-input" type="text" id="' + lvl.id + '_field" name="' + lvl.id + '_field">',
          '  </div>',
          '  <div>',
          '    <label class="reg-label" for="' + lvl.id + '_school">Institution<span class="req">*</span></label>',
          '    <input class="reg-input" type="text" id="' + lvl.id + '_school" name="' + lvl.id + '_school">',
          '  </div>',
          '  <div>',
          '    <label class="reg-label" for="' + lvl.id + '_year">Year completed</label>',
          '    <input class="reg-input" type="text" id="' + lvl.id + '_year" name="' + lvl.id + '_year" inputmode="numeric" maxlength="4">',
          '  </div>',
          '</div>'
        ].join("");
      }

      card.innerHTML = [
        '<label class="edu-card-toggle">',
        '  <input type="checkbox" id="' + lvl.id + '_has" name="' + lvl.id + '_has">',
        '  <span>' + escapeHtml(lvl.label) + '</span>',
        '</label>',
        '<div class="edu-card-body">' + bodyHtml + '</div>'
      ].join("");

      container.appendChild(card);

      card.querySelector('input[type="checkbox"]').addEventListener("change", function (e) {
        card.classList.toggle("on", e.target.checked);
        updateProgress();
      });
    });
  }

  // ---- Render: experience blocks -----------------------------------------
  function renderExperience() {
    const container = document.getElementById("exp-container");
    EXPERIENCES.forEach(function (exp) {
      const card = document.createElement("div");
      card.className = "edu-card";
      card.id = "exp-" + exp.id;
      card.innerHTML = [
        '<label class="edu-card-toggle">',
        '  <input type="checkbox" id="exp_' + exp.id + '" name="exp_' + exp.id + '">',
        '  <span>' + escapeHtml(exp.label) + '<small style="display:block;font-weight:400;font-size:13px;opacity:0.7;">' + escapeHtml(exp.help) + '</small></span>',
        '</label>',
        '<div class="edu-card-body">',
        '  <div class="reg-row-grid-2">',
        '    <div>',
        '      <label class="reg-label" for="exp_' + exp.id + '_years">Roughly how many years?</label>',
        '      <input class="reg-input" type="text" id="exp_' + exp.id + '_years" name="exp_' + exp.id + '_years" inputmode="numeric" maxlength="2" style="max-width:120px;">',
        '    </div>',
        '    <div>',
        '      <label class="reg-label" for="exp_' + exp.id + '_desc">Briefly, what and where?</label>',
        '      <input class="reg-input" type="text" id="exp_' + exp.id + '_desc" name="exp_' + exp.id + '_desc">',
        '    </div>',
        '  </div>',
        '</div>'
      ].join("");

      container.appendChild(card);

      card.querySelector('input[type="checkbox"]').addEventListener("change", function (e) {
        card.classList.toggle("on", e.target.checked);
        updateProgress();
      });
    });
  }

  // ---- Render: subject groups ---------------------------------------------
  function renderSubjects() {
    const container = document.getElementById("subjects-container");
    SUBJECT_GROUPS.forEach(function (group, gi) {
      const div = document.createElement("div");
      div.className = "subj-group";
      const items = group.subjects.map(function (s, si) {
        const id = "subj_" + gi + "_" + si;
        return [
          '<label class="reg-check">',
          '  <input type="checkbox" id="' + id + '" name="subjects" value="' + escapeHtml(s) + '">',
          '  <span>' + escapeHtml(s) + '</span>',
          '</label>'
        ].join("");
      }).join("");
      div.innerHTML =
        '<div class="subj-group-title">' + escapeHtml(group.title) + '</div>' +
        '<div class="subj-grid">' + items + '</div>';
      container.appendChild(div);
    });

    container.addEventListener("change", function (e) {
      if (e.target.name === "subjects") {
        const lbl = e.target.closest(".reg-check");
        if (lbl) lbl.classList.toggle("checked", e.target.checked);
        updateProgress();
      }
    });
  }

  // ---- Render: day cards ----------------------------------------------------
  function renderDays() {
    const container = document.getElementById("days-container");
    DAYS.forEach(function (d) {
      const label = document.createElement("label");
      label.className = "day-card";
      label.innerHTML = [
        '<input type="checkbox" name="days" value="' + d.id + '">',
        '<span>',
        '  <span class="dc-name">' + d.name + '</span>',
        '  <span class="dc-theme">' + d.theme + '</span>',
        '  <span class="dc-time">10:30 a.m. – 2:30 p.m.</span>',
        '</span>'
      ].join("");
      container.appendChild(label);
      label.querySelector("input").addEventListener("change", function (e) {
        label.classList.toggle("checked", e.target.checked);
        updateProgress();
      });
    });
  }

  // ---- Progress bar ----------------------------------------------------------
  // Each requirement contributes equally. Cosmetic encouragement, not validation.
  function updateProgress() {
    const form = document.getElementById("reg-form");
    if (!form) return;
    const checks = [
      function () { return form.firstName.value.trim() && form.lastName.value.trim(); },
      function () { return form.email.value.trim() && form.phone.value.trim(); },
      function () { return !!getRadio("connection"); },
      function () { return form.connectionDetail.value.trim(); },
      function () { return countEducationOrExperience(); },
      function () { return getChecked("subjects").length > 0; },
      function () { return getChecked("days").length > 0; },
      function () { return !!form.idealDays.value; },
      function () { return !!getRadio("compensation"); },
      function () { return form.backgroundConsent.checked; },
      function () { return form.consentAgree.checked && form.signature.value.trim(); }
    ];
    let done = 0;
    checks.forEach(function (fn) { try { if (fn()) done++; } catch (e) { /* field absent */ } });
    const pct = Math.round((done / checks.length) * 100);
    const fill = document.getElementById("teach-progress-fill");
    const label = document.getElementById("teach-progress-label");
    if (fill) fill.style.width = pct + "%";
    if (label) label.textContent = pct === 100 ? "Application complete — ready to submit ✓" : "Application progress: " + pct + "%";
  }

  function countEducationOrExperience() {
    const eduChecked = EDU_LEVELS.some(function (l) {
      const el = document.getElementById(l.id + "_has");
      return el && el.checked;
    });
    const expChecked = EXPERIENCES.some(function (x) {
      const el = document.getElementById("exp_" + x.id);
      return el && el.checked;
    });
    const eduOther = document.getElementById("eduOther");
    return eduChecked || expChecked || (eduOther && eduOther.value.trim());
  }

  // ---- Collection ----------------------------------------------------------
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

  function collectEducation() {
    const out = {};
    ["assoc", "bach", "master", "phd"].forEach(function (id) {
      out[id] = {
        has: isChecked(id + "_has"),
        field: val(id + "_field"),
        institution: val(id + "_school"),
        year: val(id + "_year")
      };
    });
    out.certs = [1, 2, 3].map(function (i) {
      return { name: val("cert" + i + "_name"), issuer: val("cert" + i + "_issuer"), year: val("cert" + i + "_year") };
    }).filter(function (c) { return c.name; });
    out.hasCerts = isChecked("cert_has");
    out.other = val("eduOther");
    return out;
  }

  function collectExperience() {
    const out = {};
    EXPERIENCES.forEach(function (x) {
      out[x.id] = {
        has: isChecked("exp_" + x.id),
        years: val("exp_" + x.id + "_years"),
        desc: val("exp_" + x.id + "_desc")
      };
    });
    out.highlight = val("expHighlight");
    return out;
  }

  // ---- Validation -----------------------------------------------------------
  function validate() {
    const form = document.getElementById("reg-form");
    const edu = collectEducation();

    if (!form.firstName.value.trim()) return "Please enter your first name.";
    if (!form.lastName.value.trim())  return "Please enter your last name.";
    if (!form.email.value.trim())     return "Please enter your email.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.value.trim())) return "That email doesn't look right — please double-check it.";
    if (!form.phone.value.trim())     return "Please enter your phone number.";
    if (!form.city.value.trim())      return "Please enter the city you live in.";
    if (!getRadio("connection"))      return "Please tell us your connection to River Tech.";
    if (!form.connectionDetail.value.trim()) return "Please tell us which student(s) or family you're connected to.";

    // Education: any checked level must have its required fields
    const levelNames = { assoc: "Associate's", bach: "Bachelor's", master: "Master's", phd: "Doctorate" };
    for (const id of ["assoc", "bach", "master", "phd"]) {
      if (edu[id].has) {
        if (!edu[id].field)       return levelNames[id] + " degree: please enter the field of study.";
        if (!edu[id].institution) return levelNames[id] + " degree: please enter the institution.";
      }
    }
    if (edu.hasCerts && edu.certs.length === 0) return "You checked certificates — please name at least one, or uncheck the box.";

    if (getChecked("subjects").length === 0 && !val("subjectsOther")) return "Please check at least one subject you could teach (or suggest your own).";
    if (getChecked("days").length === 0) return "Please check at least one day you're available to teach.";
    if (!form.idealDays.value) return "Please select how many days a week you'd ideally teach.";
    if (!getRadio("compensation")) return "Please choose your compensation preference.";
    if (!form.backgroundConsent.checked) return "Background check willingness is required to teach at River Tech.";
    if (!form.consentAgree.checked) return "Please read and agree to the consent statements before submitting.";
    if (!form.signature.value.trim()) return "Please type your full legal name as your signature.";
    if (!form.signatureDate.value) return "Please enter today's date.";

    return null;
  }

  // ---- Submit -----------------------------------------------------------------
  function submitForm(e) {
    e.preventDefault();
    clearMessages();

    const form = document.getElementById("reg-form");
    const err = validate();
    if (err) { showError(err); return; }

    const submitBtn = document.getElementById("reg-submit");
    const progress = document.getElementById("reg-progress");
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";

    const payload = {
      submittedAt: new Date().toISOString(),
      schoolYear: "2026-27",
      applicant: {
        firstName: form.firstName.value.trim(),
        lastName:  form.lastName.value.trim(),
        email:     form.email.value.trim(),
        phone:     form.phone.value.trim(),
        city:      form.city.value.trim()
      },
      connection:       getRadio("connection"),
      connectionDetail: form.connectionDetail.value.trim(),
      education:        collectEducation(),
      experience:       collectExperience(),
      subjects:         getChecked("subjects"),
      subjectsOther:    val("subjectsOther"),
      subjectsStrength: val("subjectsStrength"),
      days:             getChecked("days"),
      idealDays:        form.idealDays.value,
      compensation:     getRadio("compensation"),
      backgroundConsent: true,
      references:       val("references"),
      consentAgreed:    true,
      signature:        form.signature.value.trim(),
      signatureDate:    form.signatureDate.value
    };

    if (!BACKEND_URL || BACKEND_URL === "__BACKEND_URL__") {
      console.log("Teach application payload (no backend configured):", payload);
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
          window.location.href = "teach-success.html";
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

  // ---- UI messaging --------------------------------------------------------
  function showError(msg) {
    const box = document.getElementById("reg-error");
    box.textContent = msg;
    box.classList.add("show");
    box.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function clearMessages() {
    document.getElementById("reg-error").classList.remove("show");
  }

  // ---- Event wiring -----------------------------------------------------------
  function wireEvents() {
    const form = document.getElementById("reg-form");

    // Radio visuals
    ["connection", "compensation"].forEach(function (name) {
      document.querySelectorAll("input[name='" + name + "']").forEach(function (r) {
        r.addEventListener("change", function () {
          paintRadioGroup(name);
          updateProgress();
        });
      });
    });

    // Checkbox visuals for the standalone consent boxes
    ["backgroundConsent", "consentAgree"].forEach(function (id) {
      const el = document.getElementById(id);
      el.addEventListener("change", function () {
        const lbl = el.closest(".reg-check");
        if (lbl) lbl.classList.toggle("checked", el.checked);
        updateProgress();
      });
    });

    // Progress updates on typing
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
