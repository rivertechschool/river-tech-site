// Mobile nav toggle
document.addEventListener('DOMContentLoaded', () => {
  const hamburger = document.querySelector('.hamburger');
  const overlay = document.querySelector('.mobile-nav-overlay');
  const closeBtn = document.querySelector('.mobile-nav-overlay .close-btn');

  if (hamburger && overlay) {
    hamburger.addEventListener('click', () => overlay.classList.add('open'));
  }
  if (closeBtn && overlay) {
    closeBtn.addEventListener('click', () => overlay.classList.remove('open'));
  }
  // Close on link click (but not on parent toggle links)
  if (overlay) {
    overlay.querySelectorAll('a:not([data-has-submenu])').forEach(link => {
      link.addEventListener('click', () => overlay.classList.remove('open'));
    });
  }

  // --- Submenu expand/collapse ---
  // Mark parent links that have submenus
  document.querySelectorAll('.sidebar-submenu, .mobile-submenu').forEach(submenu => {
    const parent = submenu.previousElementSibling;
    if (parent && parent.tagName === 'A') {
      parent.setAttribute('data-has-submenu', 'true');
    }
  });

  // Auto-expand submenus that contain an active child or whose parent is active
  document.querySelectorAll('.sidebar-submenu, .mobile-submenu').forEach(submenu => {
    const parent = submenu.previousElementSibling;
    const hasActiveChild = submenu.querySelector('a.active');
    const parentIsActive = parent && parent.classList.contains('active');
    if (hasActiveChild || parentIsActive) {
      submenu.classList.add('open');
      if (parent) parent.classList.add('expanded');
    }
  });

  // Toggle submenu on parent click
  document.querySelectorAll('[data-has-submenu]').forEach(parentLink => {
    parentLink.addEventListener('click', (e) => {
      const submenu = parentLink.nextElementSibling;
      if (submenu && (submenu.classList.contains('sidebar-submenu') || submenu.classList.contains('mobile-submenu'))) {
        e.preventDefault();
        submenu.classList.toggle('open');
        parentLink.classList.toggle('expanded');
      }
    });
  });
});
