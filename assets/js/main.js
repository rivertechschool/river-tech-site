// Mobile nav toggle
document.addEventListener('DOMContentLoaded', () => {
  const hamburger = document.querySelector('.hamburger');
  const overlay = document.querySelector('.mobile-nav-overlay');
  const closeBtn = document.querySelector('.mobile-nav-overlay .close-btn');

  // --- Submenu expand/collapse ---
  // Mark parent links that have submenus FIRST (before binding close handlers)
  document.querySelectorAll('.sidebar-submenu, .mobile-submenu').forEach(submenu => {
    const parent = submenu.previousElementSibling;
    if (parent && parent.tagName === 'A') {
      parent.setAttribute('data-has-submenu', 'true');
    }
  });

  // Sidebar: hover to show submenus, click always navigates
  // Parent links with submenus — clicking always navigates (no preventDefault)
  // Hover opens/closes submenus on desktop
  document.querySelectorAll('.sidebar-nav .nav-group').forEach(group => {
    const submenu = group.querySelector('.sidebar-submenu');
    if (!submenu) return;

    group.addEventListener('mouseenter', () => {
      // Close all other submenus first
      document.querySelectorAll('.sidebar-nav .sidebar-submenu.open').forEach(s => {
        if (s !== submenu) {
          s.classList.remove('open');
          const p = s.previousElementSibling;
          if (p) p.classList.remove('expanded');
        }
      });
      submenu.classList.add('open');
      const parent = submenu.previousElementSibling;
      if (parent) parent.classList.add('expanded');
    });

    group.addEventListener('mouseleave', () => {
      submenu.classList.remove('open');
      const parent = submenu.previousElementSibling;
      if (parent) parent.classList.remove('expanded');
    });
  });

  // Mobile nav: tap toggles submenu (since no hover on mobile)
  document.querySelectorAll('.mobile-nav-overlay [data-has-submenu]').forEach(parentLink => {
    parentLink.addEventListener('click', (e) => {
      const submenu = parentLink.nextElementSibling;
      if (submenu && submenu.classList.contains('mobile-submenu')) {
        e.preventDefault();
        e.stopPropagation();
        // Close other mobile submenus
        document.querySelectorAll('.mobile-submenu.open').forEach(s => {
          if (s !== submenu) {
            s.classList.remove('open');
            const p = s.previousElementSibling;
            if (p) p.classList.remove('expanded');
          }
        });
        submenu.classList.toggle('open');
        parentLink.classList.toggle('expanded');
      }
    });
  });

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
});
