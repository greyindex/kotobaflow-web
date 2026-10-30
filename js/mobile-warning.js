(function () {
  'use strict';

  var SESSION_KEY = 'jp_learning_mobile_warning_dismissed';

  function isTouchBrowser() {
    var touchPoints = Math.max(0, Number(navigator.maxTouchPoints) || 0);
    if (touchPoints < 1) return false;
    if (!window.matchMedia) return true;
    return (
      window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(any-pointer: coarse)').matches
    );
  }

  function isPhoneDevice() {
    var ua = String(navigator.userAgent || '');
    var platform = String(navigator.platform || '');
    var touchPoints = Math.max(0, Number(navigator.maxTouchPoints) || 0);
    var isIPad = /iPad/i.test(ua) || (platform === 'MacIntel' && touchPoints > 1);
    if (isIPad) return false;

    if (navigator.userAgentData && navigator.userAgentData.mobile === true) return true;
    if (/iPhone|iPod|Windows Phone|IEMobile|Opera Mini|webOS|BlackBerry/i.test(ua)) return true;
    if (/Android/i.test(ua) && /Mobile/i.test(ua)) return true;

    return (
      window.innerWidth <= 600 &&
      touchPoints > 0 &&
      window.matchMedia &&
      window.matchMedia('(pointer: coarse)').matches
    );
  }

  function wasDismissed() {
    try {
      return sessionStorage.getItem(SESSION_KEY) === '1';
    } catch (err) {
      return false;
    }
  }

  function rememberDismissal() {
    try {
      sessionStorage.setItem(SESSION_KEY, '1');
    } catch (err) {}
  }

  function init() {
    var overlay = document.getElementById('mobileUnsupportedNotice');
    var downloadLink = document.getElementById('mobileUnsupportedDownload');
    var continueButton = document.getElementById('mobileUnsupportedContinue');
    // The HTML link owns release metadata shared with the Today entry.
    if (
      downloadLink &&
      downloadLink.protocol === 'https:' &&
      downloadLink.hostname === 'download.kotobaflow.lol'
    ) {
      var app = window.JPLearn || (window.JPLearn = {});
      app.androidDownload = Object.freeze({
        url: downloadLink.href,
        filename: downloadLink.getAttribute('download') || '',
        version: downloadLink.getAttribute('data-apk-version') || '',
        bytes: Number(downloadLink.getAttribute('data-apk-bytes')) || 0,
        sizeLabel: downloadLink.getAttribute('data-apk-size') || '',
      });
    }
    if (isTouchBrowser()) document.documentElement.setAttribute('data-touch-device', 'true');
    if (!isPhoneDevice()) return;
    document.documentElement.setAttribute('data-phone-device', 'true');
    // iOS phones keep direct access to the web app; this package is Android-only.
    var android =
      /Android/i.test(String(navigator.userAgent || '')) ||
      (navigator.userAgentData && navigator.userAgentData.platform === 'Android');
    if (!android) return;
    if (!overlay || !downloadLink || !continueButton || wasDismissed()) return;

    function close() {
      rememberDismissal();
      overlay.hidden = true;
      document.body.classList.remove('mobile-warning-open');
    }

    overlay.hidden = false;
    document.body.classList.add('mobile-warning-open');
    continueButton.addEventListener('click', close);
    overlay.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      } else if (event.key === 'Tab') {
        event.preventDefault();
        var focusables = [downloadLink, continueButton];
        var currentIndex = focusables.indexOf(document.activeElement);
        var nextIndex = event.shiftKey ? currentIndex - 1 : currentIndex + 1;
        if (currentIndex < 0) nextIndex = 0;
        if (nextIndex < 0) nextIndex = focusables.length - 1;
        if (nextIndex >= focusables.length) nextIndex = 0;
        focusables[nextIndex].focus();
      }
    });
    downloadLink.focus();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
