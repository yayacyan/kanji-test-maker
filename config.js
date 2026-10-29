/* 応援リンクは、ここだけを書き換えます。空のあいだは、画面のどこにも出しません。
   例: SPONSOR_URL = 'https://ko-fi.com/……'
   ストアのアプリでは、外の応援リンクは出しません（ストアの決まり）。
   アプリ内の応援は ENABLE_IAP_TIPS を true にする前に、
   TODO: Google Play Billing と StoreKit をつないでください。 */
(function (global) {
  var SPONSOR_URL = '';
  var ENABLE_IAP_TIPS = false;

  function isNativeApp() {
    return !!(global.Capacitor && typeof global.Capacitor.isNativePlatform === 'function' && global.Capacitor.isNativePlatform());
  }

  function sponsorUrl() {
    return String((global.KanjiConfig && global.KanjiConfig.SPONSOR_URL) || '').trim();
  }

  function sponsorVisible() {
    return !!sponsorUrl() && !isNativeApp();
  }

  function iapVisible() {
    return isNativeApp() && !!(global.KanjiConfig && global.KanjiConfig.ENABLE_IAP_TIPS);
  }

  function applySponsor(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var show = sponsorVisible();
    var url = sponsorUrl();
    scope.querySelectorAll('[data-sponsor]').forEach(function (el) {
      if (show) el.removeAttribute('hidden');
      else el.setAttribute('hidden', '');
      el.querySelectorAll('a[data-sponsor-link]').forEach(function (a) { a.href = url || '#'; });
    });
    var screen = document.getElementById('supportScreen');
    if (screen) {
      if (iapVisible()) screen.removeAttribute('hidden');
      else screen.setAttribute('hidden', '');
    }
    document.documentElement.classList.toggle('is-native', isNativeApp());
  }

  global.KanjiConfig = {
    SPONSOR_URL: SPONSOR_URL,
    ENABLE_IAP_TIPS: ENABLE_IAP_TIPS,
    isNativeApp: isNativeApp,
    sponsorVisible: sponsorVisible,
    applySponsor: applySponsor
  };
})(window);
