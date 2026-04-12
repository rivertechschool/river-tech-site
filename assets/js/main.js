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
  // Close on link click
  if (overlay) {
    overlay.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => overlay.classList.remove('open'));
    });
  }
});
