/* Decides, before the first paint, whether the home page shows its splash.
   Loaded as a classic script in <head> so there is no flash of the splash image.
   The splash shows when someone arrives at the site. It does not show again in the same browser tab,
   so pressing Back (or the arrow in the header) to return home goes straight to the page. */
(function () {
  'use strict';
  var KEY = 'hp-splash-seen';
  var root = document.documentElement;
  var skip = false;

  try {
    var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    // Back and forward always restore the page as it was left, whatever storage says.
    if (nav && nav.type === 'back_forward') skip = true;
    if (sessionStorage.getItem(KEY)) skip = true;
    else sessionStorage.setItem(KEY, '1');
  } catch (e) {
    /* storage blocked: the back_forward check above is the only protection */
  }

  if (skip) root.classList.add('no-splash');
})();
