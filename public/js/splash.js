// Shows the splash for 2 seconds when someone arrives at the site, then fades it out and removes it.
// js/splash-gate.js (in <head>) hides it before first paint when it was already shown in this tab.
const splash = document.getElementById('splash');

function removeSplash() {
  splash?.remove();
  document.body.style.overflow = '';
}

if (splash) {
  if (document.documentElement.classList.contains('no-splash')) {
    removeSplash();
  } else {
    document.body.style.overflow = 'hidden'; // no scrolling behind the splash
    setTimeout(() => {
      splash.classList.add('is-leaving');
      splash.addEventListener('transitionend', removeSplash, { once: true });
      setTimeout(removeSplash, 700); // safety net when transitions are disabled (reduced motion)
    }, 2000);
  }
}

// Returning with Back can restore this page from the browser's memory. Never bring the splash back.
window.addEventListener('pageshow', (event) => { if (event.persisted) removeSplash(); });
