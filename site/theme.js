/* BAC Maps: light or dark.
 *
 * Load this in <head>, before the stylesheets apply, so the page never
 * flashes the wrong theme. It sets <html data-theme="light" | "dark">, which
 * tokens.css, app.css, login.css, map-theme.css and the map module all follow.
 *
 * The user's choice (profile, Settings, Appearance) is kept on this device:
 *   "light", "dark", or "system" (the default: follow the device setting)
 *
 *   Theme.get()        -> "light" | "dark" | "system"
 *   Theme.set(choice)
 *   Theme.current()    -> "light" | "dark", what is showing now
 */
(function (global) {
  "use strict";

  var KEY = "cn.theme.v1";
  var root = global.document.documentElement;
  var mq = global.matchMedia ? global.matchMedia("(prefers-color-scheme: dark)") : null;
  var memo = null;   // the choice, if storage is blocked

  function get() {
    try {
      var v = global.localStorage.getItem(KEY);
      return v === "light" || v === "dark" ? v : "system";
    } catch (e) { return memo || "system"; }
  }

  function apply() {
    var choice = get();
    var dark = choice === "dark" || (choice === "system" && !!mq && mq.matches);
    root.setAttribute("data-theme", dark ? "dark" : "light");
  }

  apply();
  // following the device: change when the device does
  if (mq) {
    var onChange = function () { if (get() === "system") apply(); };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }
  // another tab changed the choice
  global.addEventListener("storage", function (e) { if (e.key === KEY) apply(); });

  global.Theme = {
    get: get,
    set: function (choice) {
      try {
        if (choice === "light" || choice === "dark") global.localStorage.setItem(KEY, choice);
        else global.localStorage.removeItem(KEY);
      } catch (e) { /* storage blocked: applies for this visit only */ }
      if (choice !== "light" && choice !== "dark") choice = "system";
      memo = choice;
      apply();
    },
    current: function () { return root.getAttribute("data-theme") || "light"; }
  };
})(window);
