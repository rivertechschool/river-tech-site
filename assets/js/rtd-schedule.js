/* River Tech Days — interactive schedule
   Loads rtd-schedule.json + rtd-class-info.json, renders grid,
   supports grade + date filters, click for class detail. */
(function () {
  "use strict";

  const root = document.getElementById("rtd-schedule-app");
  if (!root) return;

  const base = "../assets/data/";

  Promise.all([
    fetch(base + "rtd-schedule.json").then((r) => r.json()),
    fetch(base + "rtd-class-info.json").then((r) => r.json()),
  ])
    .then(([schedule, info]) => render(schedule, info))
    .catch((err) => {
      console.error("Schedule load failed:", err);
      root.innerHTML =
        '<div class="rtd-sched__loading">Couldn\'t load the schedule. See the printable version below.</div>';
    });

  // --- band helpers -------------------------------------------------------
  const BAND_CLASS = {
    elementary: "rtd-class--elem",
    middle: "rtd-class--mid",
    highmiddle: "rtd-class--hm",
    high: "rtd-class--high",
  };

  function visibleForGrade(band, grade) {
    if (grade === "all") return true;
    if (grade === "elementary") return band === "elementary" || band === "highmiddle";
    if (grade === "middle") return band === "middle" || band === "highmiddle";
    if (grade === "high") return band === "high" || band === "highmiddle";
    return true;
  }
  // Note: highmiddle is shown to both middle and high. Elementary only sees
  // elementary-band classes (per the source schedule), so we keep that strict.
  function visibleForGradeStrict(band, grade) {
    if (grade === "all") return true;
    if (grade === "elementary") return band === "elementary";
    if (grade === "middle") return band === "middle" || band === "highmiddle";
    if (grade === "high") return band === "high" || band === "highmiddle";
    return true;
  }

  // --- state --------------------------------------------------------------
  const state = {
    grade: "all", // all | elementary | middle | high
    day: "all", // all | day-id
  };

  function render(schedule, info) {
    const meta = schedule.meta;
    const days = schedule.days;
    const slots = schedule.slots;
    const classes = schedule.classes;

    root.innerHTML = "";

    // Controls
    const controls = document.createElement("div");
    controls.className = "rtd-sched__controls";
    controls.innerHTML = `
      <div class="rtd-sched__group" role="group" aria-label="Grade filter">
        <span class="rtd-sched__label">Grade</span>
        <button class="rtd-pill" data-grade="all" aria-pressed="true">All</button>
        <button class="rtd-pill rtd-pill--elem" data-grade="elementary" aria-pressed="false">Elementary</button>
        <button class="rtd-pill rtd-pill--mid"  data-grade="middle"     aria-pressed="false">Middle</button>
        <button class="rtd-pill rtd-pill--high" data-grade="high"       aria-pressed="false">High School</button>
      </div>
      <div class="rtd-sched__group" role="group" aria-label="Day filter">
        <span class="rtd-sched__label">Day</span>
        <button class="rtd-pill" data-day="all" aria-pressed="true">All 6 days</button>
        ${days
          .map(
            (d) =>
              `<button class="rtd-pill" data-day="${d.id}" aria-pressed="false">${d.label}</button>`
          )
          .join("")}
      </div>
    `;
    root.appendChild(controls);

    // Legend
    const legend = document.createElement("div");
    legend.className = "rtd-sched__legend";
    legend.innerHTML = `
      <span><i class="rtd-sched__swatch" style="background:${meta.gradeBands.elementary.color}"></i>Elementary</span>
      <span><i class="rtd-sched__swatch" style="background:${meta.gradeBands.middle.color}"></i>Middle</span>
      <span><i class="rtd-sched__swatch" style="background:${meta.gradeBands.highmiddle.color}"></i>Middle + High</span>
      <span><i class="rtd-sched__swatch" style="background:${meta.gradeBands.high.color}"></i>High School</span>
    `;
    root.appendChild(legend);

    // Grid container
    const scroll = document.createElement("div");
    scroll.className = "rtd-sched__scroll";
    const grid = document.createElement("div");
    grid.className = "rtd-sched__grid";
    scroll.appendChild(grid);
    root.appendChild(scroll);

    // Modal
    const modal = document.createElement("div");
    modal.className = "rtd-sched__modal";
    modal.setAttribute("aria-hidden", "true");
    modal.setAttribute("role", "dialog");
    modal.innerHTML = `
      <div class="rtd-sched__dialog" role="document" tabindex="-1">
        <button class="rtd-sched__close" aria-label="Close">×</button>
        <span class="rtd-sched__band-tag"></span>
        <h3></h3>
        <p class="rtd-sched__meta"></p>
        <h4>About this class</h4>
        <p class="rtd-sched__desc"></p>
        <h4 class="rtd-sched__teacher-head">Teacher</h4>
        <p class="rtd-sched__bio"></p>
      </div>
    `;
    document.body.appendChild(modal);

    // --- renderers --------------------------------------------------------
    function paint() {
      const activeDays =
        state.day === "all" ? days : days.filter((d) => d.id === state.day);
      grid.style.setProperty("--days", activeDays.length);
      grid.className =
        "rtd-sched__grid" + (activeDays.length === 1 ? " rtd-sched__grid--1col" : "");

      let html = "";
      // Header row
      html += `<div class="rtd-sched__row" style="display:contents;">`;
      html += `<div class="rtd-sched__cell rtd-sched__cell--head rtd-sched__cell--time"></div>`;
      activeDays.forEach((d) => {
        html += `<div class="rtd-sched__cell rtd-sched__cell--head">${d.label}</div>`;
      });
      html += `</div>`;

      slots.forEach((slot, slotIdx) => {
        html += `<div class="rtd-sched__row" style="display:contents;">`;
        // Time cell
        const timeMain = slot.time;
        const timeLabel =
          slot.type === "assembly"
            ? "Assembly"
            : slot.type === "cleanup"
            ? "Clean Up"
            : "";
        html += `<div class="rtd-sched__cell rtd-sched__cell--time">
                   ${timeMain}
                   ${timeLabel ? `<small>${timeLabel}</small>` : ""}
                 </div>`;

        if (slot.type !== "class") {
          // Banner spanning all day columns
          html += `<div class="rtd-sched__cell rtd-sched__cell--banner">${
            slot.type === "assembly" ? "Assembly — all students together" : "Clean Up Time"
          }</div>`;
        } else {
          activeDays.forEach((d) => {
            const cellClasses = classes
              .filter((c) => c.day === d.id && c.slot === slot.id)
              .filter((c) => visibleForGradeStrict(c.band, state.grade));
            const cellHtml = cellClasses
              .map((c, i) => {
                const cls = BAND_CLASS[c.band] || "";
                const teacherKey = c.teacher;
                return `<button class="rtd-class ${cls}"
                          data-day="${c.day}" data-slot="${c.slot}" data-idx="${classes.indexOf(
                  c
                )}">
                          <span class="rtd-class__teacher">${escapeHtml(c.teacher)}</span>
                          <span class="rtd-class__title"> — ${escapeHtml(c.title)}</span>
                        </button>`;
              })
              .join("");
            html += `<div class="rtd-sched__cell">${
              cellHtml || `<span style="font-size:12px;color:#aaa;font-style:italic;">—</span>`
            }</div>`;
          });
        }
        html += `</div>`;
      });

      grid.innerHTML = html;
    }

    // --- events -----------------------------------------------------------
    controls.addEventListener("click", (e) => {
      const btn = e.target.closest(".rtd-pill");
      if (!btn) return;
      if (btn.dataset.grade) {
        state.grade = btn.dataset.grade;
        controls
          .querySelectorAll("[data-grade]")
          .forEach((b) => b.setAttribute("aria-pressed", b === btn ? "true" : "false"));
      } else if (btn.dataset.day) {
        state.day = btn.dataset.day;
        controls
          .querySelectorAll("[data-day]")
          .forEach((b) => b.setAttribute("aria-pressed", b === btn ? "true" : "false"));
      }
      paint();
    });

    grid.addEventListener("click", (e) => {
      const btn = e.target.closest(".rtd-class");
      if (!btn) return;
      const idx = parseInt(btn.dataset.idx, 10);
      const c = classes[idx];
      if (!c) return;
      openModal(c);
    });

    modal.addEventListener("click", (e) => {
      if (e.target === modal || e.target.closest(".rtd-sched__close")) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal.getAttribute("aria-hidden") === "false") closeModal();
    });

    function openModal(c) {
      const day = days.find((d) => d.id === c.day);
      const slot = slots.find((s) => s.id === c.slot);
      const band = meta.gradeBands[c.band];
      const teacherInfo = info.teachers[c.teacher] || { name: c.teacher, bio: "" };
      const desc = info.descriptions[c.title] || "";

      const dlg = modal.querySelector(".rtd-sched__dialog");
      dlg.querySelector(".rtd-sched__band-tag").textContent = band.label;
      dlg.querySelector(".rtd-sched__band-tag").style.background = band.color;
      dlg.querySelector("h3").textContent = c.title;
      dlg.querySelector(".rtd-sched__meta").textContent =
        day.label + " · " + slot.time + " · with " + teacherInfo.name;
      dlg.querySelector(".rtd-sched__desc").textContent =
        desc || "Details shared on the first day of class.";
      const bioEl = dlg.querySelector(".rtd-sched__bio");
      const teacherHead = dlg.querySelector(".rtd-sched__teacher-head");
      if (teacherInfo.bio) {
        bioEl.textContent = teacherInfo.bio;
        bioEl.style.display = "";
        teacherHead.style.display = "";
      } else {
        bioEl.style.display = "none";
        teacherHead.style.display = "none";
      }

      modal.setAttribute("aria-hidden", "false");
      dlg.focus();
    }
    function closeModal() {
      modal.setAttribute("aria-hidden", "true");
    }

    paint();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
})();
