/**
 * Classic Wrapper — Hosts Discrub Classic in an iframe and injects the auth token.
 * Standalone JS (no React, no bundler) for Chrome extension CSP compliance.
 */

var classicIframe = document.getElementById('classic-iframe');
var loadingOverlay = document.getElementById('loading');
var TOKEN_INJECT_TIMEOUT = 15000;
var TOKEN_POLL_INTERVAL = 300;

var pendingToken = null;
var tokenInjected = false;

/**
 * Set Classic iframe src using chrome.runtime.getURL
 */
function loadClassic() {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
    classicIframe.src = chrome.runtime.getURL('classic/index.html');
  } else {
    classicIframe.src = 'classic/index.html';
  }
}

/**
 * Inject token into Classic's manual auth form via DOM manipulation.
 * Classic and wrapper are same-origin (chrome-extension://), so DOM access works.
 */
function injectToken(token) {
  if (tokenInjected) return;

  var startTime = Date.now();

  var poll = setInterval(function () {
    try {
      var doc = classicIframe.contentDocument;
      if (!doc) return;

      // Look for Classic's manual auth input field
      var input = doc.querySelector('input[type="password"], input[type="text"]');
      var submitBtn = doc.querySelector('button[type="submit"], button');

      if (input && submitBtn) {
        clearInterval(poll);
        tokenInjected = true;

        // Use native setter to bypass React's synthetic event system
        var nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value'
        ).set;
        nativeInputValueSetter.call(input, token);

        // Dispatch events React listens for
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));

        // Small delay then click submit
        setTimeout(function () {
          var buttons = doc.querySelectorAll('button');
          for (var i = 0; i < buttons.length; i++) {
            var text = (buttons[i].textContent || '').toLowerCase();
            if (text.indexOf('sign') !== -1 || text.indexOf('submit') !== -1 || text.indexOf('login') !== -1 || text.indexOf('authenticate') !== -1) {
              buttons[i].click();
              break;
            }
          }
          // Hide loading overlay after auth attempt
          setTimeout(function () {
            loadingOverlay.classList.add('hidden');
          }, 1000);
        }, 200);
      }
    } catch (e) {
      // contentDocument access may fail briefly during navigation
    }

    // Timeout — hide loading and let user interact manually
    if (Date.now() - startTime > TOKEN_INJECT_TIMEOUT) {
      clearInterval(poll);
      loadingOverlay.classList.add('hidden');
      console.warn('[Classic Wrapper] Token injection timed out — user can enter token manually');
    }
  }, TOKEN_POLL_INTERVAL);
}

/**
 * Listen for token from content script (parent)
 */
window.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'discrub:token') {
    pendingToken = event.data.token;
    if (pendingToken) {
      injectToken(pendingToken);
    }
  }
});

/**
 * When Classic iframe loads, try injecting token if we already have it
 */
classicIframe.addEventListener('load', function () {
  if (pendingToken && !tokenInjected) {
    injectToken(pendingToken);
  }
});

/**
 * Listen for Classic's close/minimize attempts via chrome.runtime.sendMessage.
 * Classic sends messages like {message: "CLOSE_DIALOG"} to the background script,
 * but since we're hosting it in our extension, those messages reach our background.
 * We also listen for the dialog element being removed as a fallback.
 */
function watchForClassicClose() {
  // Poll for Classic's dialog close — if the classic iframe's dialog gets closed/removed,
  // it means the user clicked close in Classic. Forward to parent to close the overlay.
  var closeCheckInterval = setInterval(function () {
    try {
      var doc = classicIframe.contentDocument;
      if (!doc) return;

      // Classic removes its dialog when close is clicked
      var dialog = doc.getElementById('injected_dialog');
      var root = doc.getElementById('root');

      // If Classic has finished loading (root has children) but no dialog exists,
      // the user may have closed Classic's internal UI
      if (root && root.children.length > 0) {
        // Check if Classic rendered a close button and it was clicked
        // by checking if the app root is empty (Classic unmounts on close)
        var appContent = root.innerHTML.trim();
        if (appContent === '' || appContent === '<!-- -->') {
          clearInterval(closeCheckInterval);
          window.parent.postMessage({ type: 'discrub:switchVersion', version: 'launcher' }, '*');
        }
      }
    } catch (e) {
      // Cross-frame access may fail
    }
  }, 1000);
}

// Boot
loadClassic();
watchForClassicClose();

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
