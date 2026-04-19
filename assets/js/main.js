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

  // Helpers for two-stage fade: .open = display:block (in DOM),
  // .visible = opacity:1 (faded in). Class order avoids iOS clipping.
  function openSubmenu(submenu) {
    submenu.classList.add('open');
    // Force layout before adding .visible so the opacity transition runs
    // eslint-disable-next-line no-unused-expressions
    submenu.offsetHeight;
    requestAnimationFrame(() => submenu.classList.add('visible'));
  }
  function closeSubmenu(submenu) {
    submenu.classList.remove('visible');
    // After fade-out finishes, remove .open (display:block)
    setTimeout(() => {
      if (!submenu.classList.contains('visible')) {
        submenu.classList.remove('open');
      }
    }, 600);
  }

  // Pre-expand the mobile submenu containing the current page's link
  document.querySelectorAll('.mobile-nav-overlay .mobile-submenu').forEach(submenu => {
    const hasActive = submenu.querySelector('a.active');
    if (hasActive) {
      submenu.classList.add('open');
      submenu.classList.add('visible');
      const parent = submenu.previousElementSibling;
      if (parent) parent.classList.add('expanded');
    }
  });

  // Mobile nav: tap toggles submenu (since no hover on mobile)
  document.querySelectorAll('.mobile-nav-overlay [data-has-submenu]').forEach(parentLink => {
    parentLink.addEventListener('click', (e) => {
      const submenu = parentLink.nextElementSibling;
      if (submenu && submenu.classList.contains('mobile-submenu')) {
        e.preventDefault();
        e.stopPropagation();
        const isOpen = submenu.classList.contains('open');
        // Close other mobile submenus
        document.querySelectorAll('.mobile-submenu.open').forEach(s => {
          if (s !== submenu) {
            closeSubmenu(s);
            const p = s.previousElementSibling;
            if (p) p.classList.remove('expanded');
          }
        });
        if (isOpen) {
          closeSubmenu(submenu);
          parentLink.classList.remove('expanded');
        } else {
          openSubmenu(submenu);
          parentLink.classList.add('expanded');
        }
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
