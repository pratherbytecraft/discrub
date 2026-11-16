/**
 * Discrub Launcher — Standalone splash screen for version selection.
 * No React, no bundler. Pure vanilla JS for instant load.
 */

const COUNTDOWN_SECONDS = 5;
const PREF_KEY = 'discrub-launcher-preference';

// DOM elements
const logo = document.getElementById('logo');
const versionSelect = document.getElementById('version-select');
const launchBtn = document.getElementById('launch-btn');
const launchText = document.getElementById('launch-text');
const progressBar = document.getElementById('progress-bar');
const progressFill = document.getElementById('progress-fill');
const countdownText = document.getElementById('countdown-text');
const hintText = document.getElementById('hint-text');

// State
let countdown = COUNTDOWN_SECONDS;
let countdownInterval = null;
let countdownPaused = false;
let isFirstTime = true;
let selectedVersion = '';

/**
 * Set the logo src using chrome.runtime.getURL if available
 */
function initLogo() {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
    logo.src = chrome.runtime.getURL('discrub.png');
  } else {
    logo.src = 'discrub.png';
  }
}

/**
 * Update the progress bar to reflect remaining time
 */
function updateProgressBar(remaining) {
  const progress = ((COUNTDOWN_SECONDS - remaining) / COUNTDOWN_SECONDS) * 100;
  progressFill.style.width = progress + '%';
}

/**
 * Start the countdown timer
 */
function startCountdown() {
  if (isFirstTime || !selectedVersion) return;

  countdown = COUNTDOWN_SECONDS;
  countdownPaused = false;
  progressBar.classList.add('active');
  updateProgressBar(countdown);
  countdownText.textContent = 'Launching in ' + countdown + '...';

  clearInterval(countdownInterval);
  countdownInterval = setInterval(function () {
    if (countdownPaused) return;

    countdown -= 0.1;
    updateProgressBar(countdown);

    if (countdown <= 0) {
      clearInterval(countdownInterval);
      countdownText.textContent = 'Launching...';
      launch();
    } else {
      countdownText.textContent = 'Launching in ' + Math.ceil(countdown) + '...';
    }
  }, 100);
}

/**
 * Pause the countdown
 */
function pauseCountdown() {
  countdownPaused = true;
  countdownText.textContent = '';
  progressBar.classList.remove('active');
}

/**
 * Launch the selected version
 */
function launch() {
  clearInterval(countdownInterval);
  countdownText.textContent = '';
  progressBar.classList.remove('active');
  launchBtn.disabled = true;
  launchText.textContent = 'Loading...';

  // Save preference
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ [PREF_KEY]: selectedVersion });
  }

  // Notify content script
  window.parent.postMessage({
    type: 'discrub:launch',
    version: selectedVersion,
  }, '*');
}

/**
 * Check auth status via content script
 */
function checkAuth() {
  window.parent.postMessage({ type: 'discrub:checkAuth' }, '*');
}

/**
 * Load saved preference
 */
function loadPreference(callback) {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(PREF_KEY, function (result) {
      callback(result[PREF_KEY] || null);
    });
  } else {
    callback(null);
  }
}

/**
 * Handle version selection change
 */
function onVersionChange() {
  selectedVersion = versionSelect.value;
  launchBtn.disabled = !selectedVersion;

  if (selectedVersion) {
    launchText.textContent = 'Launch Discrub';
    hintText.textContent = '';

    // Restart countdown if returning user changed selection
    if (!isFirstTime) {
      startCountdown();
    }
  }
}

/**
 * Listen for auth status response from content script
 */
window.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'discrub:authStatus') {
    if (!event.data.authenticated) {
      // Need to authenticate first — tell content script to load Discrub for auth
      window.parent.postMessage({ type: 'discrub:requestAuth' }, '*');
    }
  }
});

/**
 * Initialize launcher
 */
function init() {
  initLogo();

  loadPreference(function (savedVersion) {
    if (savedVersion) {
      isFirstTime = false;
      selectedVersion = savedVersion;
      versionSelect.value = savedVersion;
      launchBtn.disabled = false;
      hintText.textContent = 'Click the dropdown to switch versions';
      startCountdown();
    } else {
      isFirstTime = true;
      hintText.textContent = 'Select a version to get started';
      launchBtn.disabled = true;
    }
  });

  // Event listeners
  versionSelect.addEventListener('change', onVersionChange);

  // Pause countdown when dropdown is interacted with
  versionSelect.addEventListener('mousedown', pauseCountdown);
  versionSelect.addEventListener('focus', pauseCountdown);

  launchBtn.addEventListener('click', function () {
    if (selectedVersion) {
      launch();
    }
  });

  // Check auth status
  checkAuth();
}

// Boot
init();

/**
 * An open Discrub page holds an extension update until it closes (2.2.10,
 * see src/extension/updateHold.ts). This page answers the background's
 * check and says when it goes away.
 */
(function () {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id || !chrome.runtime.onMessage) return;
  var closing = false;
  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (!message || message.action !== 'pageOpenCheck' || closing) return false;
    sendResponse({ open: true });
    return false;
  });
  window.addEventListener('pageshow', function () { closing = false; });
  window.addEventListener('pagehide', function () {
    closing = true;
    try {
      var sent = chrome.runtime.sendMessage({ action: 'pageClosed' });
      if (sent && sent.catch) sent.catch(function () {});
    } catch (e) {
      // The extension is already gone.
    }
  });
})();
