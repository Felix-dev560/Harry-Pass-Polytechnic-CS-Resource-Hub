/* Light/dark theme. Loaded as a classic script in <head> so the saved theme applies before first paint (no flash).
   Preference is stored in localStorage; the first visit starts in light mode.
   Buttons marked data-icon-only keep their SVG icons; only their aria-label changes. */
(function () {
  'use strict';
  var KEY = 'hp-theme';
  var root = document.documentElement;

  function stored() {
    try {
      var v = localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' ? v : null;
    } catch (e) {
      return null; // storage blocked (private mode, strict settings): fall back to the light default
    }
  }
  function apply(theme) {
    root.setAttribute('data-theme', theme);
    var buttons = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < buttons.length; i++) {
      var text = theme === 'dark' ? 'Light mode' : 'Dark mode';
      var label = buttons[i].querySelector('[data-theme-label]');
      if (label) label.textContent = text;
      else if (!buttons[i].hasAttribute('data-icon-only') && !buttons[i].querySelector('svg')) buttons[i].textContent = text;
      buttons[i].setAttribute('aria-label', 'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' mode');
    }
  }

  apply(stored() || 'light');

  document.addEventListener('DOMContentLoaded', function () {
    apply(root.getAttribute('data-theme'));
    var buttons = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function () {
        var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem(KEY, next); } catch (e) { /* preference just won't persist */ }
        apply(next);
      });
    }
  });
})();