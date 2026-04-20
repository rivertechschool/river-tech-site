/* River Tech Days — Registration form logic
   Fetches canonical schedule from rtd-schedule.json, builds dynamic
   day/slot dropdowns per child filtered by grade band, computes price,
   and POSTs to the Apps Script backend which creates a Stripe Checkout
   session and returns its URL. */
(function () {
  "use strict";

  // ---- Configuration ----------------------------------------------------
  // Set this to your deployed Apps Script web-app URL before go-live.
  const BACKEND_URL = "__BACKEND_URL__";

  const PRICING = {
    newFamily: { "3": 75, "6": 99 },
    fullTime:  { "3": 29, "6": 49 }
  };

  const MAX_CHILDREN = 6;
  const MIN_DAYS = 1;
  const MAX_DAYS = 6;

  // ---- State ------------------------------------------------------------
  let scheduleData = null;
  let childCount = 0;

  // ---- Grade-band filter (matches rtd-schedule.js strict rules) ---------
  // Elementary sees ONLY elementary band (highmiddle classes are not
  // advertised to elementary per the source page). Middle sees middle +
  // highmiddle. High sees high + highmiddle.
  function bandVisibleForGrade(band, grade) {
    if (grade === "elementary") return band === "elementary";
    if (grade === "middle")     return band === "middle" || band === "highmiddle";
    if (grade === "high")       return band === "high"   || band === "highmiddle";
    return false;
  }

  // ---- Boot -------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", function () {
    fetch("../assets/data/rtd-schedule.json")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        scheduleData = data;
        addChild();
        wireEvents();
      })
      .catch(function (err) {
        console.error("Schedule load failed:", err);
        showError("We couldn't load the class schedule. Please refresh the page. If this keeps happening, email learn@rivertech.me.");
      });
  });

  // ---- DOM helpers ------------------------------------------------------
  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === "class") n.className = attrs[k];
        else if (k === "text") n.textContent = attrs[k];
        else if (k === "html") n.innerHTML = attrs[k];
        else n.setAttribute(k, attrs[k]);
      }
    }
    if (children) children.forEach(function (c) { n.appendChild(c); });
    return n;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
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
      '<div class="reg-row">',
      '  <label class="reg-label">Grade level<span class="req">*</span></label>',
      '  <div class="reg-grade-bands">',
      '    <label class="reg-check">',
      '      <input type="radio" name="c' + idx + '_grade" value="elementary" required>',
      '      <span><strong>Elementary</strong><br><small>can read &amp; use a tablet</small></span>',
      '    </label>',
      '    <label class="reg-check">',
      '      <input type="radio" name="c' + idx + '_grade" value="middle" required>',
      '      <span><strong>Middle School</strong></span>',
      '    </label>',
      '    <label class="reg-check">',
      '      <input type="radio" name="c' + idx + '_grade" value="high" required>',
      '      <span><strong>High School</strong></span>',
      '    </label>',
      '  </div>',
      '</div>',
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
      '<div class="reg-row-grid-2">',
      '  <div>',
      '    <label class="reg-label" for="c' + idx + '_age">Age<span class="req">*</span></label>',
      '    <input class="reg-input" type="number" min="4" max="19" id="c' + idx + '_age" name="c' + idx + '_age" required>',
      '  </div>',
      '  <div></div>',
      '</div>',
      '<div class="reg-row">',
      '  <label class="reg-label">Which days will Child ' + idx + ' attend?<span class="req">*</span></label>',
      '  <div class="reg-days" data-days-for="' + idx + '">',
      daysCheckboxesHtml(idx),
      '  </div>',
      '  <span class="reg-help">Pick any 3 days for the 3-day rate, or all 6 for the 6-day rate. Same rate whether you come part-time or full day.</span>',
      '</div>',
      '<div class="day-blocks" id="day-blocks-' + idx + '"></div>'
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

  // Current grade (band) for a child card
  function getChildGrade(idx) {
    const r = document.querySelector("input[name='c" + idx + "_grade']:checked");
    return r ? r.value : "";
  }

  // Show/hide Elementary follow-ups based on band selection
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

  function daysCheckboxesHtml(childIdx) {
    return scheduleData.days.map(function (d) {
      return [
        '<label class="reg-check">',
        '  <input type="checkbox" name="c' + childIdx + '_days" value="' + d.id + '" data-day="' + d.id + '">',
        '  <span>' + d.label + '</span>',
        '</label>'
      ].join("");
    }).join("");
  }

  // ---- Slot dropdowns (day-blocks inside each child) --------------------
  function rebuildDayBlocks(childIdx) {
    const card = document.getElementById("child-" + childIdx);
    if (!card) return;
    const band = getChildGrade(childIdx);
    const checked = card.querySelectorAll("input[name='c" + childIdx + "_days']:checked");
    const dayIds = Array.from(checked).map(function (c) { return c.value; });

    const blocks = card.querySelector("#day-blocks-" + childIdx);
    blocks.innerHTML = "";

    if (!band || dayIds.length === 0) {
      return; // no grade yet OR no days chosen
    }

    const days = scheduleData.days.filter(function (d) { return dayIds.indexOf(d.id) !== -1; });
    const classSlots = scheduleData.slots.filter(function (s) { return s.type === "class"; });

    days.forEach(function (d) {
      const block = document.createElement("div");
      block.className = "day-block";
      block.innerHTML = '<div class="day-block-title">' + escapeHtml(d.label) + '</div>';

      classSlots.forEach(function (s) {
        const options = scheduleData.classes.filter(function (c) {
          return c.day === d.id && c.slot === s.id && bandVisibleForGrade(c.band, band);
        });
        const row = document.createElement("div");
        row.className = "slot-row";
        row.innerHTML = [
          '<div class="slot-label">Slot ' + s.id.replace("slot-", "") + ' (' + s.time + ')</div>',
          '<div>',
          options.length === 0
            ? '<span class="slot-waiting">No class offered for this grade</span>'
            : [
                '<select class="reg-select" name="c' + childIdx + '_' + d.id + '_' + s.id + '" required>',
                '<option value="">Select a class…</option>',
                options.map(function (o) {
                  // Display only the subject; teacher travels in the data layer
                  return '<option value="' + escapeHtml(o.title) + '" data-teacher="' + escapeHtml(o.teacher || "") + '">' + escapeHtml(o.title) + '</option>';
                }).join(""),
                '</select>'
              ].join(""),
          '</div>'
        ].join("");
        block.appendChild(row);
      });

      blocks.appendChild(block);
    });
  }

  // ---- Pricing / summary ------------------------------------------------
  function getFamilyTier() {
    const radio = document.querySelector("input[name='fullTimeFamily']:checked");
    if (!radio) return null;
    return radio.value === "yes" ? "fullTime" : "newFamily";
  }

  function pricePerChild(daysCount, tier) {
    if (!tier) return 0;
    if (daysCount >= 6) return PRICING[tier]["6"];
    if (daysCount >= 3) return PRICING[tier]["3"];
    // < 3 days: charge 3-day rate per RTD page ("Any 3 days $75" is the floor)
    if (daysCount >= 1) return PRICING[tier]["3"];
    return 0;
  }

  function collectChildren() {
    const cards = Array.from(document.querySelectorAll(".child-card"));
    return cards.map(function (card, i) {
      const idx = card.dataset.childIdx;
      const grade = getChildGrade(idx);
      const reading = (card.querySelector("[id$='_reading']") || {}).value || "";
      const tablet = (card.querySelector("[id$='_tablet']") || {}).value || "";
      const days = Array.from(card.querySelectorAll("input[name='c" + idx + "_days']:checked"))
        .map(function (c) { return c.value; });
      const firstName = (card.querySelector("[id$='_firstName']") || {}).value || "";
      const lastName = (card.querySelector("[id$='_lastName']") || {}).value || "";
      const age = (card.querySelector("[id$='_age']") || {}).value || "";

      const picks = [];
      days.forEach(function (dayId) {
        const classSlots = scheduleData.slots.filter(function (s) { return s.type === "class"; });
        classSlots.forEach(function (s) {
          const sel = card.querySelector("select[name='c" + idx + "_" + dayId + "_" + s.id + "']");
          const val = sel ? sel.value : "";
          const teacher = sel && sel.selectedOptions.length ? sel.selectedOptions[0].dataset.teacher || "" : "";
          picks.push({ day: dayId, slot: s.id, className: val, teacher: teacher });
        });
      });

      return {
        index: i + 1,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        grade: grade, // "elementary" | "middle" | "high"
        readingLevel: reading,
        tabletLevel: tablet,
        age: age,
        days: days,
        picks: picks
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
      const dayLabel = c.days.length >= 6 ? "all 6 days" : c.days.length + " day" + (c.days.length === 1 ? "" : "s");
      return '<div class="reg-summary-row"><span>' + escapeHtml(name) + ' — ' + dayLabel + '</span><span>$' + cost + '</span></div>';
    }).join("");

    const tierLabel = tier === "fullTime" ? "Full-time family (stay-late rate)" : "New / homeschool family";
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
      if (!c.grade)     return "Child " + c.index + ": please pick a grade level.";
      if (c.grade === "elementary") {
        if (!c.readingLevel) return "Child " + c.index + ": please select a reading ability.";
        if (!c.tabletLevel)  return "Child " + c.index + ": please select a tablet proficiency.";
      }
      if (!c.age)       return "Child " + c.index + ": please enter an age.";
      if (c.days.length === 0) return "Child " + c.index + ": please pick at least one day.";

      // Every checked day must have all 3 slot classes selected
      const classSlots = scheduleData.slots.filter(function (s) { return s.type === "class"; });
      for (let d = 0; d < c.days.length; d++) {
        for (let s = 0; s < classSlots.length; s++) {
          const pick = c.picks.find(function (p) { return p.day === c.days[d] && p.slot === classSlots[s].id; });
          if (!pick || !pick.className) {
            const dayLabel = scheduleData.days.find(function (x) { return x.id === c.days[d]; }).label;
            // Some slots legitimately have zero options for a band — don't fail on those
            const avail = scheduleData.classes.filter(function (cl) {
              return cl.day === c.days[d] && cl.slot === classSlots[s].id && bandVisibleForGrade(cl.band, c.grade);
            });
            if (avail.length === 0) continue;
            return "Child " + c.index + " (" + dayLabel + "): please pick a class for every slot.";
          }
        }
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
      parent: {
        firstName: form.parentFirstName.value.trim(),
        lastName:  form.parentLastName.value.trim(),
        email:     form.parentEmail.value.trim(),
        phone:     form.parentPhone.value.trim()
      },
      familyTier: tier, // "newFamily" | "fullTime"
      children: children.map(function (c) {
        return {
          firstName:    c.firstName,
          lastName:     c.lastName,
          grade:        c.grade, // elementary | middle | high
          readingLevel: c.readingLevel,
          tabletLevel:  c.tabletLevel,
          age:          c.age,
          days:         c.days,
          picks:        c.picks.filter(function (p) { return p.className; }),
          subtotal:     pricePerChild(c.days.length, tier)
        };
      }),
      notes: form.notes.value.trim(),
      totalAmount: total,
      releaseAgreed: true
    };

    // If backend isn't wired yet, show a friendly preview.
    if (!BACKEND_URL || BACKEND_URL === "__BACKEND_URL__") {
      console.log("Registration payload (no backend configured):", payload);
      showError("Almost ready — payment isn't connected yet. Your details are complete, but the payment backend hasn't been deployed. Please try again in a few minutes, or email learn@rivertech.me to register by hand.");
      submitBtn.disabled = false;
      submitBtn.textContent = "Continue to Payment →";
      return;
    }

    fetch(BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoid CORS preflight on Apps Script
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

    // Delegated: remove button, grade change, day checkbox change, slot change
    document.getElementById("children-container").addEventListener("click", function (e) {
      const rm = e.target.closest("[data-remove]");
      if (rm) {
        const idx = parseInt(rm.dataset.remove, 10);
        removeChild(idx);
      }
    });

    document.getElementById("children-container").addEventListener("change", function (e) {
      const t = e.target;
      const card = t.closest(".child-card");
      if (!card) return;
      const idx = card.dataset.childIdx;

      // Update checked-state visual on check labels
      const label = t.closest(".reg-check");
      if (label && (t.type === "checkbox" || t.type === "radio")) {
        if (t.type === "checkbox") {
          label.classList.toggle("checked", t.checked);
        } else if (t.type === "radio") {
          // Clear siblings in the same radio group
          const group = document.getElementsByName(t.name);
          Array.prototype.forEach.call(group, function (r) {
            const lbl = r.closest(".reg-check");
            if (lbl) lbl.classList.toggle("checked", r.checked);
          });
        }
      }

      // Grade band changed → toggle Elementary follow-ups, rebuild slots
      if (t.name === "c" + idx + "_grade") {
        toggleElemFollowUp(idx, t.value);
        rebuildDayBlocks(idx);
      }
      // Days changed → rebuild slot dropdowns
      if (t.name === "c" + idx + "_days") {
        rebuildDayBlocks(idx);
      }
      updateSummary();
    });

    // Family tier radios
    document.querySelectorAll("input[name='fullTimeFamily']").forEach(function (r) {
      r.addEventListener("change", function (e) {
        const label = e.target.closest(".reg-check");
        if (label) {
          // Clear siblings for this radio group
          document.querySelectorAll("input[name='fullTimeFamily']").forEach(function (x) {
            const lbl = x.closest(".reg-check");
            if (lbl) lbl.classList.toggle("checked", x.checked);
          });
        }
        updateSummary();
      });
    });

    document.getElementById("reg-form").addEventListener("submit", submitForm);
  }
})();
