/* River Tech Days — Week 2 Registration form logic
   May 12-14, 2026. Single tier with two pricing levels (outside / full-time).
   Each child rates the available subjects 1 (Not so much) / 2 (Like it) / 3 (Love it).
   Subjects shown depend on age: ≤10 = Younger list, ≥11 = Older list.
*/
(function () {
  "use strict";

  // ---- Configuration ----------------------------------------------------
  // Set this to your deployed Apps Script web-app URL before go-live.
  const BACKEND_URL = "__BACKEND_URL__";

  // Pricing: per child, based on day count + tier.
  // Outside families: $29/day, $69 for all 3.
  // Full-time RTS students: $19/day, $49 for all 3.
  const PRICING = {
    outside:  { perDay: 29, allThree: 69 },
    fullTime: { perDay: 19, allThree: 49 }
  };

  const MAX_CHILDREN = 6;

  // The three days of Week 2.
  const DAYS = [
    { id: "tue-may-12", label: "Tuesday, May 12" },
    { id: "wed-may-13", label: "Wednesday, May 13" },
    { id: "thu-may-14", label: "Thursday, May 14" }
  ];

  // Subjects available, by age group. Each child sees the list matching their age.
  const SUBJECTS_YOUNGER = [
    "Choir",
    "Clay Sculpt",
    "Creative Writing",
    "Dance",
    "Drawing",
    "Drill / P.E. Games",
    "Lego / Minecraft Fort",
    "Legos & Perler",
    "Paint / Paper Craft",
    "Perler Beads",
    "Rhythm"
  ];
  const SUBJECTS_OLDER = [
    "3D Modeling",
    "A.I. Vibe Code",
    "Chess",
    "Choir",
    "Christianity",
    "Coding",
    "Creative Writing",
    "Dance",
    "Debate",
    "Drill / P.E.",
    "Entrepreneurship",
    "Mindset",
    "Political Science",
    "Public Speaking",
    "Robotics",
    "Song Writing"
  ];

  const RATING_LABELS = [
    { value: 1, label: "Not so much" },
    { value: 2, label: "Like it" },
    { value: 3, label: "Love it" }
  ];

  const YOUNGER_AGE_MAX = 10; // ≤10 → younger group; ≥11 → older group.

  // ---- State ------------------------------------------------------------
  let childCount = 0;

  // ---- Boot -------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", function () {
    addChild();
    wireEvents();
  });

  // ---- DOM helpers ------------------------------------------------------
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function ageGroupForAge(age) {
    const n = parseInt(age, 10);
    if (isNaN(n)) return null;
    return n <= YOUNGER_AGE_MAX ? "younger" : "older";
  }

  function subjectsForGroup(group) {
    return group === "younger" ? SUBJECTS_YOUNGER : SUBJECTS_OLDER;
  }

  function subjectKey(subj, childIdx) {
    return "c" + childIdx + "_rating_" + subj.replace(/[^a-zA-Z0-9]/g, "_");
  }

  // ---- Child card rendering ---------------------------------------------
  function addChild() {
    if (childCount >= MAX_CHILDREN) return;
    childCount += 1;
    const idx = childCount;

    const container = document.getElementById("children-container");
    const card = document.createElement("div");
    card.className = "child-card";
    card.id = "child-" + idx;
    card.dataset.childIdx = idx;

    const canRemove = idx > 1;

    card.innerHTML = [
      '<div class="child-card-header">',
      '  <div class="child-card-title">Child ' + idx + '</div>',
      canRemove ? '  <button type="button" class="child-remove" data-remove="' + idx + '">Remove</button>' : '',
      '</div>',
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
      '<div class="reg-row-grid-2">',
      '  <div>',
      '    <label class="reg-label" for="c' + idx + '_age">Age<span class="req">*</span></label>',
      '    <input class="reg-input" type="number" min="4" max="19" id="c' + idx + '_age" name="c' + idx + '_age" required>',
      '  </div>',
      '  <div>',
      '    <label class="reg-label" for="c' + idx + '_grade">Current grade <span style="opacity:0.6; font-weight:400;">(optional)</span></label>',
      '    <input class="reg-input" type="text" id="c' + idx + '_grade" name="c' + idx + '_grade" placeholder="e.g. 4th, 8th, 11th">',
      '  </div>',
      '</div>',
      '<div class="reg-row">',
      '  <label class="reg-label">Which days will Child ' + idx + ' attend?<span class="req">*</span></label>',
      '  <div class="reg-days" data-days-for="' + idx + '">',
      daysCheckboxesHtml(idx),
      '  </div>',
      '  <span class="reg-help">$29/day or $69 for all three (outside families). $19/day or $49 for all three (full-time RTS students).</span>',
      '</div>',
      '<div class="ratings-block" id="ratings-' + idx + '" style="display:none;">',
      '  <div class="ratings-block-title">How much would Child ' + idx + ' want each subject?</div>',
      '  <div class="ratings-block-help">Rate each subject below: <strong>1 = Not so much</strong>, <strong>2 = Like it</strong>, <strong>3 = Love it</strong>. We&rsquo;ll use these ratings to assign your child to the classes they&rsquo;ll most enjoy. Default is &ldquo;Like it&rdquo; &mdash; only change the ones you feel strongly about.</div>',
      '  <div class="ratings-grid" id="ratings-grid-' + idx + '"></div>',
      '</div>'
    ].join("");

    container.appendChild(card);
    updateAddChildBtn();
  }

  function removeChild(idx) {
    const card = document.getElementById("child-" + idx);
    if (card) card.remove();
    childCount -= 1;
    // Renumber remaining children visually
    const remaining = document.querySelectorAll(".child-card");
    remaining.forEach(function (c, i) {
      const newIdx = i + 1;
      c.querySelector(".child-card-title").textContent = "Child " + newIdx;
      c.dataset.childIdx = newIdx;
    });
    updateSummary();
    updateAddChildBtn();
  }

  function updateAddChildBtn() {
    const btn = document.getElementById("add-child-btn");
    btn.disabled = childCount >= MAX_CHILDREN;
    if (childCount >= MAX_CHILDREN) {
      btn.textContent = "Maximum of " + MAX_CHILDREN + " children per registration";
    } else {
      btn.textContent = "+ Add another child (up to " + MAX_CHILDREN + ")";
    }
  }

  function daysCheckboxesHtml(childIdx) {
    return DAYS.map(function (d) {
      return [
        '<label class="reg-check">',
        '  <input type="checkbox" name="c' + childIdx + '_days" value="' + d.id + '" data-day="' + d.id + '">',
        '  <span>' + escapeHtml(d.label) + '</span>',
        '</label>'
      ].join("");
    }).join("");
  }

  // ---- Subject ratings rendering ----------------------------------------
  function rebuildRatingsBlock(childIdx) {
    const card = document.getElementById("child-" + childIdx);
    if (!card) return;
    const ageInput = card.querySelector("#c" + childIdx + "_age");
    const ageVal = ageInput ? ageInput.value : "";
    const group = ageGroupForAge(ageVal);
    const block = document.getElementById("ratings-" + childIdx);
    const grid = document.getElementById("ratings-grid-" + childIdx);

    if (!group) {
      block.style.display = "none";
      grid.innerHTML = "";
      return;
    }

    // Save existing selections (if any) so they survive re-render.
    const existing = {};
    grid.querySelectorAll("input[type='radio']:checked").forEach(function (r) {
      existing[r.dataset.subject] = r.value;
    });

    block.style.display = "";
    const subjects = subjectsForGroup(group);
    grid.innerHTML = subjects.map(function (subj) {
      const safeSubj = escapeHtml(subj);
      const radioName = subjectKey(subj, childIdx);
      // Default rating: 2 (Like it). Preserve user's prior selection if still applicable.
      const currentVal = existing[subj] != null ? existing[subj] : "2";
      const buttonsHtml = RATING_LABELS.map(function (r) {
        const isSel = String(r.value) === String(currentVal);
        return [
          '<label' + (isSel ? ' class="selected"' : '') + '>',
          '  <input type="radio" name="' + radioName + '" value="' + r.value + '" data-subject="' + safeSubj + '"' + (isSel ? ' checked' : '') + '>',
          '  <span>' + r.value + ' &middot; ' + r.label + '</span>',
          '</label>'
        ].join("");
      }).join("");
      return [
        '<div class="rating-row">',
        '  <div class="rating-subject">' + safeSubj + '</div>',
        '  <div class="rating-buttons" data-subject="' + safeSubj + '">' + buttonsHtml + '</div>',
        '</div>'
      ].join("");
    }).join("");
  }

  // Wire click handler for rating button labels (since radios are visually hidden).
  function handleRatingsClick(e) {
    const label = e.target.closest(".rating-buttons label");
    if (!label) return;
    const radio = label.querySelector("input[type='radio']");
    if (!radio) return;
    radio.checked = true;
    // Mark this label as selected, clear siblings.
    const buttons = label.parentElement;
    buttons.querySelectorAll("label").forEach(function (l) { l.classList.remove("selected"); });
    label.classList.add("selected");
  }

  // ---- Pricing / summary ------------------------------------------------
  function getFamilyTier() {
    const radio = document.querySelector("input[name='fullTimeFamily']:checked");
    if (!radio) return null;
    return radio.value === "yes" ? "fullTime" : "outside";
  }

  function pricePerChild(daysCount, tier) {
    if (!tier || daysCount <= 0) return 0;
    const t = PRICING[tier];
    if (daysCount >= 3) return t.allThree;
    return daysCount * t.perDay;
  }

  function collectChildren() {
    const cards = Array.from(document.querySelectorAll(".child-card"));
    return cards.map(function (card, i) {
      const idx = card.dataset.childIdx;
      const firstName = (card.querySelector("[id$='_firstName']") || {}).value || "";
      const lastName = (card.querySelector("[id$='_lastName']") || {}).value || "";
      const age = (card.querySelector("[id$='_age']") || {}).value || "";
      const grade = (card.querySelector("#c" + idx + "_grade") || {}).value || "";
      const days = Array.from(card.querySelectorAll("input[name='c" + idx + "_days']:checked"))
        .map(function (c) { return c.value; });
      const group = ageGroupForAge(age);

      const ratings = {};
      if (group) {
        const subjects = subjectsForGroup(group);
        subjects.forEach(function (subj) {
          const radioName = subjectKey(subj, idx);
          const checked = card.querySelector("input[name='" + radioName + "']:checked");
          if (checked) ratings[subj] = parseInt(checked.value, 10);
        });
      }

      return {
        index: i + 1,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        age: age,
        grade: grade.trim(),
        ageGroup: group,
        days: days,
        ratings: ratings
      };
    });
  }

  function updateSummary() {
    const tier = getFamilyTier();
    const children = collectChildren();
    const summaryBox = document.getElementById("summary-box");
    const summarySection = document.getElementById("summary-section");

    if (!tier || children.length === 0 || children.every(function (c) { return c.days.length === 0; })) {
      summarySection.style.display = "none";
      return;
    }

    let total = 0;
    const lines = children.map(function (c) {
      const cost = pricePerChild(c.days.length, tier);
      total += cost;
      const name = (c.firstName || "Child " + c.index).trim();
      const dayLabel = c.days.length >= 3 ? "all three days" : c.days.length + " day" + (c.days.length === 1 ? "" : "s");
      return '<div class="reg-summary-row"><span>' + escapeHtml(name) + ' — ' + dayLabel + '</span><span>$' + cost + '</span></div>';
    }).join("");

    const tierLabel = tier === "fullTime" ? "Full-time RTS family (stay-late rate)" : "Outside family";
    summaryBox.innerHTML = [
      '<div class="reg-summary-row" style="font-size:14px; opacity:0.7; margin-bottom:10px;"><span>' + tierLabel + '</span><span></span></div>',
      lines,
      '<div class="reg-summary-row reg-summary-total"><span>Total</span><span>$' + total + '</span></div>'
    ].join("");
    summarySection.style.display = "block";
  }

  // ---- Validation -------------------------------------------------------
  function validate() {
    const form = document.getElementById("reg-form");
    const children = collectChildren();
    const tier = getFamilyTier();

    if (!tier) return "Please tell us whether your family has a current full-time student.";

    const parentFields = ["parentFirstName", "parentLastName", "parentEmail", "parentPhone"];
    for (let i = 0; i < parentFields.length; i++) {
      const f = form.querySelector("[name='" + parentFields[i] + "']");
      if (!f.value.trim()) return "Please fill in all parent/guardian fields.";
    }

    if (children.length === 0) return "Please add at least one child.";

    for (let i = 0; i < children.length; i++) {
      const c = children[i];
      if (!c.firstName) return "Child " + c.index + ": first name is required.";
      if (!c.lastName)  return "Child " + c.index + ": last name is required.";
      if (!c.age)       return "Child " + c.index + ": please enter an age.";
      if (!c.ageGroup)  return "Child " + c.index + ": age must be a number.";
      if (c.days.length === 0) return "Child " + c.index + ": please pick at least one day.";

      const expectedSubjects = subjectsForGroup(c.ageGroup);
      const missing = expectedSubjects.filter(function (s) { return c.ratings[s] == null; });
      if (missing.length > 0) {
        return "Child " + c.index + ": please rate every subject. Missing: " + missing.slice(0, 3).join(", ") +
               (missing.length > 3 ? " (+" + (missing.length - 3) + " more)" : "") + ".";
      }
    }

    const release = form.querySelector("#releaseAgree");
    if (!release.checked) return "Please read and agree to the release before continuing.";

    return null;
  }

  // ---- Submit -----------------------------------------------------------
  function submitForm(e) {
    e.preventDefault();
    clearMessages();

    const err = validate();
    if (err) { showError(err); return; }

    const submitBtn = document.getElementById("reg-submit");
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";

    const form = document.getElementById("reg-form");
    const tier = getFamilyTier();
    const children = collectChildren();
    const total = children.reduce(function (sum, c) { return sum + pricePerChild(c.days.length, tier); }, 0);

    const payload = {
      submittedAt: new Date().toISOString(),
      formVersion: "rtd-week2-v1",
      parent: {
        firstName: form.parentFirstName.value.trim(),
        lastName:  form.parentLastName.value.trim(),
        email:     form.parentEmail.value.trim(),
        phone:     form.parentPhone.value.trim()
      },
      familyTier: tier,
      children: children.map(function (c) {
        return {
          firstName: c.firstName,
          lastName:  c.lastName,
          age:       c.age,
          grade:     c.grade,
          ageGroup:  c.ageGroup,
          days:      c.days,
          ratings:   c.ratings,
          subtotal:  pricePerChild(c.days.length, tier)
        };
      }),
      notes: form.notes.value.trim(),
      totalAmount: total,
      releaseAgreed: true
    };

    if (!BACKEND_URL || BACKEND_URL === "__BACKEND_URL__") {
      console.log("Registration payload (no backend configured):", payload);
      showError("Almost ready — payment isn't connected yet. Your details are complete, but the payment backend hasn't been deployed. Please try again in a few minutes, or email learn@rivertech.me to register by hand.");
      submitBtn.disabled = false;
      submitBtn.textContent = "Continue to Payment →";
      return;
    }

    fetch(BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
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
        }
      })
      .catch(function (err) {
        console.error("Submit error:", err);
        showError("We couldn't reach the server. Please check your connection and try again.");
        submitBtn.disabled = false;
        submitBtn.textContent = "Continue to Payment →";
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
    document.getElementById("add-child-btn").addEventListener("click", addChild);

    // Delegated: remove button + ratings click
    document.getElementById("children-container").addEventListener("click", function (e) {
      const rm = e.target.closest("[data-remove]");
      if (rm) {
        const idx = parseInt(rm.dataset.remove, 10);
        removeChild(idx);
        return;
      }
      handleRatingsClick(e);
    });

    document.getElementById("children-container").addEventListener("change", function (e) {
      const t = e.target;
      const card = t.closest(".child-card");
      if (!card) return;
      const idx = card.dataset.childIdx;

      // Update checked-state visual on check labels (days)
      const label = t.closest(".reg-check");
      if (label && t.type === "checkbox") {
        label.classList.toggle("checked", t.checked);
      }

      // Age changed → rebuild the subject ratings block (group may flip)
      if (t.name === "c" + idx + "_age") {
        rebuildRatingsBlock(idx);
      }

      updateSummary();
    });

    // Also rebuild ratings on input (so it doesn't wait for blur on age)
    document.getElementById("children-container").addEventListener("input", function (e) {
      const t = e.target;
      if (t.tagName !== "INPUT" || t.type !== "number") return;
      const card = t.closest(".child-card");
      if (!card) return;
      const idx = card.dataset.childIdx;
      if (t.name === "c" + idx + "_age") {
        rebuildRatingsBlock(idx);
      }
    });

    // Family tier radios
    document.querySelectorAll("input[name='fullTimeFamily']").forEach(function (r) {
      r.addEventListener("change", function () {
        document.querySelectorAll("input[name='fullTimeFamily']").forEach(function (x) {
          const lbl = x.closest(".reg-check");
          if (lbl) lbl.classList.toggle("checked", x.checked);
        });
        updateSummary();
      });
    });

    document.getElementById("reg-form").addEventListener("submit", submitForm);
  }
})();
