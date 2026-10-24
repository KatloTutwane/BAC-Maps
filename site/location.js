/* BAC Maps: where is the user?
 *
 * Wraps the browser Geolocation API in four states:
 *   asking     waiting for the user to answer the permission prompt
 *   locating   permission given, waiting for a position
 *   found      on campus: { x, y } in map metres, ground floor assumed
 *   fallback   denied, unavailable, timed out or off campus: start at Main Gate
 *
 *   Locator.start(bounds, origin, fn)  fn(state) on every change
 *   Locator.listen(fn)  swap the listener and replay the current state
 *   Locator.stop()
 *   Locator.current()
 *
 * GPS cannot tell floors apart, so a found position is always level 0.
 */
(function (global) {
  "use strict";

  var watchId = null, listener = null, current = { status: "idle" }, permission = null;

  function set(next) {
    current = next;
    if (listener) listener(current);
  }

  function stop() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    if (permission) permission.onchange = null;
    permission = null;
    listener = null;
  }

  function start(bounds, origin, fn) {
    stop();
    listener = fn;

    if (!("geolocation" in navigator) || global.isSecureContext === false) {
      set({ status: "fallback", reason: "unavailable" });
      return;
    }

    set({ status: "asking" });

    // If the browser can tell us the permission is already granted, skip
    // straight to locating; otherwise stay on "asking" until it changes.
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: "geolocation" }).then(function (p) {
        if (!listener) return;
        permission = p;
        function sync() {
          if (current.status !== "asking" && current.status !== "locating") return;
          if (p.state === "granted") set({ status: "locating" });
          else if (p.state === "denied") set({ status: "fallback", reason: "denied" });
        }
        p.onchange = sync;
        sync();
      }).catch(function () {});
    }

    watchId = navigator.geolocation.watchPosition(function (pos) {
      var m = Geo.toMap(pos.coords.latitude, pos.coords.longitude, origin);
      if (Geo.onCampus(m, bounds)) {
        set({ status: "found", x: m.x, y: m.y, level: 0, accuracy: pos.coords.accuracy });
      } else {
        set({ status: "fallback", reason: "off_campus" });
      }
    }, function (err) {
      var reason = err.code === 1 ? "denied" : err.code === 3 ? "timeout" : "unavailable";
      // A timeout after a good fix keeps the last position
      if (reason === "timeout" && current.status === "found") return;
      set({ status: "fallback", reason: reason });
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 });
  }

  function listen(fn) { listener = fn; if (fn) fn(current); }

  global.Locator = { start: start, stop: stop, listen: listen, current: function () { return current; } };
})(window);
