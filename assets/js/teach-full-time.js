/* River Tech — Full-Time Teacher application
   Cloned from teach.js (part-time) 2026-07-21 and adapted for the full-time
   role: no day-availability cards, adds Second Bachelor's education level
   (mirrors the published salary scale), a Faith & Culture section, a
   compensation-track preference, and required references. POSTs JSON to the
   Apps Script backend, which writes a sheet row and sends applicant + admin
   emails. No payments, no uploads. */
(function () {
  "use strict";

  // ---- Configuration ----------------------------------------------------
  // Set this to the deployed Apps Script web-app URL before go-live.
  const BACKEND_URL = "https://script.google.com/macros/s/AKfycbx8Ad6C2eQCPYS3MBd5LwZrw6eqP2kRQLP3mu3QlaSlb2yMMnsbRoF8i8GKL0izVCa2CA/exec";

  // Transcript uploads: optional but encouraged. Limits keep the JSON payload
  // safely inside Apps Script POST bounds (base64 inflates ~33%); the TOTAL
  // cap is the one that really matters.
  const MAX_TRANSCRIPT_FILES = 6;
  const MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024;  // 8 MB per file
  const MAX_TRANSCRIPT_TOTAL = 20 * 1024 * 1024; // 20 MB combined

  const EDU_LEVELS = [
    { id: "assoc",  label: "Associate’s degree" },
    { id: "bach",   label: "Bachelor’s degree" },
    { id: "bach2",  label: "Second bachelor’s degree" },
    { id: "master", label: "Master’s degree" },
    { id: "phd",    label: "Doctorate (Ph.D., Ed.D., M.D., J.D.…)" },
    { id: "cert",   label: "Recognized certificate(s)" }
  ];

  const EXPERIENCES = [
    { id: "classroom", label: "Classroom teaching", help: "school or international school, any level" },
    { id: "coop",      label: "Homeschool / co-op teaching", help: "including teaching your own children" },
    { id: "church",    label: "Church programs / Sunday school", help: "teaching or leading children in ministry" },
    { id: "youth",     label: "Camps, scouts, Civil Air Patrol, or coaching", help: "structured work with groups of kids or teens" },
    { id: "tutoring",  label: "Tutoring or mentoring", help: "academic, musical, or spiritual" }
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
    { title: "Core Academics", subjects: [
      "Math (Elementary)", "Math (Middle School)", "Math (High School)",
      "English & Literature", "Reading & Phonics", "Bible"
    ]},
    { title: "Body & Movement", subjects: [
      "P.E.", "Martial Arts (must be instructor)", "Dance", "Chess & Strategy Games"
    ]}
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

  // ---- Progress bar ----------------------------------------------------------
  // Each requirement contributes equally. Cosmetic encouragement, not validation.
  function updateProgress() {
    const form = document.getElementById("reg-form");
    if (!form) return;
    const checks = [
      function () { return form.firstName.value.trim() && form.lastName.value.trim(); },
      function () { return form.email.value.trim() && form.phone.value.trim(); },
      function () { return form.city.value.trim(); },
      function () { return countEducation(); },
      function () { return countExperience(); },
      function () { return form.cultureAgree.checked; },
      function () { return form.faithStory.value.trim(); },
      function () { return form.whyRiverTech.value.trim(); },
      function () { return getChecked("subjects").length > 0; },
      function () { return !!getRadio("track"); },
      function () { return !!form.startTiming.value; },
      function () { return form.references.value.trim(); },
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

  function countEducation() {
    const eduChecked = EDU_LEVELS.some(function (l) {
      const el = document.getElementById(l.id + "_has");
      return el && el.checked;
    });
    const eduOther = document.getElementById("eduOther");
    return eduChecked || (eduOther && eduOther.value.trim());
  }

  function countExperience() {
    return EXPERIENCES.some(function (x) {
      const el = document.getElementById("exp_" + x.id);
      return el && el.checked;
    });
  }

  // ---- File handling (pattern from register-school-2026-27.js) -------------
  function handleTranscriptsChange() {
    const input = document.getElementById("transcripts");
    const drop = document.getElementById("transcripts-drop");
    const nameSpan = drop.querySelector(".file-name");
    const files = Array.from(input.files || []);
    const defaultLabel = "Click to choose transcript file(s)";

    if (files.length === 0) {
      drop.classList.remove("has-file");
      nameSpan.textContent = defaultLabel;
      return;
    }
    if (files.length > MAX_TRANSCRIPT_FILES) {
      showError("Please choose at most " + MAX_TRANSCRIPT_FILES + " transcript files.");
      input.value = "";
      drop.classList.remove("has-file");
      nameSpan.textContent = defaultLabel;
      return;
    }
    let total = 0;
    for (const f of files) {
      total += f.size;
      if (f.size > MAX_TRANSCRIPT_BYTES) {
        showError("“" + f.name + "” is too large (" + Math.round(f.size / 1024 / 1024 * 10) / 10 + " MB). Please choose files under 8 MB each — a photo or a smaller PDF works great.");
        input.value = "";
        drop.classList.remove("has-file");
        nameSpan.textContent = defaultLabel;
        return;
      }
    }
    if (total > MAX_TRANSCRIPT_TOTAL) {
      showError("Your transcript files add up to " + Math.round(total / 1024 / 1024 * 10) / 10 + " MB — please keep the combined total under 20 MB.");
      input.value = "";
      drop.classList.remove("has-file");
      nameSpan.textContent = defaultLabel;
      return;
    }
    clearMessages();
    drop.classList.add("has-file");
    nameSpan.textContent = files.map(function (f) {
      return f.name + " (" + Math.round(f.size / 1024) + " KB)";
    }).join(" · ");
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

  function collectTranscripts() {
    const input = document.getElementById("transcripts");
    const files = Array.from((input && input.files) || []).slice(0, MAX_TRANSCRIPT_FILES);
    return Promise.all(files.map(readFileAsBase64));
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
    ["assoc", "bach", "bach2", "master", "phd"].forEach(function (id) {
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

    // Education: bachelor's is the stated floor for full-time
    const hasDegree = edu.bach.has || edu.bach2.has || edu.master.has || edu.phd.has;
    if (!hasDegree) return "A bachelor's degree (or higher) is required for the full-time role — please add yours under Education.";

    // Any checked level must have its required fields
    const levelNames = { assoc: "Associate's", bach: "Bachelor's", bach2: "Second bachelor's", master: "Master's", phd: "Doctorate" };
    for (const id of ["assoc", "bach", "bach2", "master", "phd"]) {
      if (edu[id].has) {
        if (!edu[id].field)       return levelNames[id] + " degree: please enter the field of study.";
        if (!edu[id].institution) return levelNames[id] + " degree: please enter the institution.";
      }
    }
    if (edu.hasCerts && edu.certs.length === 0) return "You checked certificates — please name at least one, or uncheck the box.";

    if (!countExperience()) return "Please check at least one kind of teaching experience.";
    if (!form.cultureAgree.checked) return "Please read Our Culture and confirm it resonates with you.";
    if (!form.faithStory.value.trim()) return "Please tell us a little about your faith.";
    if (!form.whyRiverTech.value.trim()) return "Please tell us why River Tech — what draws you to this role.";
    if (getChecked("subjects").length === 0 && !val("subjectsOther")) return "Please check at least one subject you could teach (or suggest your own).";
    if (!getRadio("track")) return "Please choose a compensation track (you can change your mind later).";
    if (!form.startTiming.value) return "Please tell us when you could start.";
    if (!form.references.value.trim()) return "Please give us two references — name, relationship, and phone or email.";
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

    const payloadBase = {
      submittedAt: new Date().toISOString(),
      schoolYear: "2026-27",
      role: "full-time-teacher",
      applicant: {
        firstName: form.firstName.value.trim(),
        lastName:  form.lastName.value.trim(),
        email:     form.email.value.trim(),
        phone:     form.phone.value.trim(),
        city:      form.city.value.trim()
      },
      connection:       val("connection"),
      education:        collectEducation(),
      experience:       collectExperience(),
      cultureAgreed:    true,
      faithStory:       val("faithStory"),
      whyRiverTech:     val("whyRiverTech"),
      subjects:         getChecked("subjects"),
      subjectsOther:    val("subjectsOther"),
      subjectsStrength: val("subjectsStrength"),
      track:            getRadio("track"),
      startTiming:      form.startTiming.value,
      resumeLink:       val("resumeLink"),
      references:       val("references"),
      backgroundConsent: true,
      consentAgreed:    true,
      signature:        form.signature.value.trim(),
      signatureDate:    form.signatureDate.value
    };

    collectTranscripts()
      .then(function (transcripts) {
        const payload = Object.assign({}, payloadBase, { transcripts: transcripts });

        if (!BACKEND_URL || BACKEND_URL === "__BACKEND_URL__") {
          console.log("Full-time teacher application payload (no backend configured):", payload);
          showError("Almost ready — the application backend isn't connected yet. Please try again shortly, or email learn@rivertech.me to apply by hand.");
          submitBtn.disabled = false;
          submitBtn.textContent = "Submit My Application";
          return;
        }

        progress.textContent = "Submitting…";
        progress.classList.add("show");

        return fetch(BACKEND_URL, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoid CORS preflight
          body: JSON.stringify(payload)
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data && data.ok) {
              window.location.href = "teach-full-time-success.html";
            } else {
              showError((data && data.error) || "Something went wrong. Please try again or email learn@rivertech.me.");
              submitBtn.disabled = false;
              submitBtn.textContent = "Submit My Application";
              progress.classList.remove("show");
            }
          });
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
    ["track"].forEach(function (name) {
      document.querySelectorAll("input[name='" + name + "']").forEach(function (r) {
        r.addEventListener("change", function () {
          paintRadioGroup(name);
          updateProgress();
        });
      });
    });

    // Checkbox visuals for the standalone consent boxes
    ["cultureAgree", "backgroundConsent", "consentAgree"].forEach(function (id) {
      const el = document.getElementById(id);
      el.addEventListener("change", function () {
        const lbl = el.closest(".reg-check");
        if (lbl) lbl.classList.toggle("checked", el.checked);
        updateProgress();
      });
    });

    // Transcript file picker
    const transcriptsInput = document.getElementById("transcripts");
    if (transcriptsInput) transcriptsInput.addEventListener("change", handleTranscriptsChange);

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
