/* BAC Maps: installable app helpers, shared by both pages.
 *
 * Registers the service worker (sw.js) and tracks how the app can be
 * installed:
 *   Android and desktop Chrome: the browser fires beforeinstallprompt; we keep
 *     it and show our own "Install app" row, which calls PWA.install().
 *   iOS Safari: there is no prompt, so we show a one time hint to use
 *     Share, then Add to Home Screen.
 * Neither shows once the app is running standalone (installed).
 *
 *   PWA.standalone()     running as an installed app
 *   PWA.canInstall()     the browser offered an install prompt
 *   PWA.install()        promise; shows the browser's install dialog
 *   PWA.showIosHint()    iOS Safari, not installed, hint not dismissed
 *   PWA.dismissIosHint()
 *   PWA.on(fn)           fn() whenever any of the above may have changed
 */
const global = window;

  var HINT_KEY = "cn.iosInstallHint.dismissed";
  var deferred = null, listeners = [];

  function emit() { listeners.slice().forEach(function (fn) { fn(); }); }

  function standalone() {
    return (global.matchMedia && global.matchMedia("(display-mode: standalone)").matches) ||
      global.navigator.standalone === true;
  }

  function isIosSafari() {
    var ua = global.navigator.userAgent;
    var ios = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && global.navigator.maxTouchPoints > 1);
    // Chrome, Firefox and Edge on iOS can't add to the home screen the same way
    return ios && /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
  }

  function hintDismissed() {
    try { return global.localStorage.getItem(HINT_KEY) === "1"; } catch (e) { return false; }
  }

  // Service worker: needs http(s); localhost counts as secure for testing
  if ("serviceWorker" in global.navigator && /^https?:$/.test(global.location.protocol)) {
    global.addEventListener("load", function () {
      global.navigator.serviceWorker.register("sw.js").catch(function (err) {
        console.warn("Service worker not registered:", err);
      });
    });
  }

  global.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();          // we show our own row instead of the mini bar
    deferred = e;
    emit();
  });
  global.addEventListener("appinstalled", function () { deferred = null; emit(); });
  if (global.matchMedia) {
    var mq = global.matchMedia("(display-mode: standalone)");
    if (mq.addEventListener) mq.addEventListener("change", emit);
  }

  const PWA = {
    standalone: standalone,
    canInstall: function () { return !!deferred && !standalone(); },
    install: function () {
      if (!deferred) return Promise.resolve(false);
      var e = deferred;
      deferred = null;
      e.prompt();
      return e.userChoice.then(function (choice) {
        emit();
        return choice.outcome === "accepted";
      });
    },
    showIosHint: function () { return isIosSafari() && !standalone() && !hintDismissed(); },
    dismissIosHint: function () {
      try { global.localStorage.setItem(HINT_KEY, "1"); } catch (e) { /* storage blocked */ }
      emit();
    },
    on: function (fn) { listeners.push(fn); }
  };

window.PWA = PWA;   // for the console and the browser tests
export default PWA;
