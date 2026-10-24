/* BAC Maps: the user's account, saved places and class timetable.
 *
 * Signed in (demo database, server/server.py): everything comes from and
 * goes to the API. Guest, or no server running: saved places stay in this
 * browser's localStorage, and there is no timetable (it needs an account). Views read from an
 * in-memory copy, so reads are instant; writes update it and then call
 * the API, and every change notifies Store.on listeners.
 *
 *   Store.ready                 promise, resolves once the account is known
 *   Store.loaded()              true once it has; until then the profile shows a loading state
 *   Store.timetableState()      "loading", "ok" or "error" for data/timetables.json; retryTimetables()
 *   Store.dataError()           signed in, but the account's classes or saved places didn't load
 *   Store.account()             { bacNumber, name, role, programme, year, demo } or null
 *   Store.signOut()             promise
 *   Store.saved.list() / has(id) / toggle(id)
 *   Store.groups()              [{ code, programme }] from data/timetables.json
 *   Store.group() / setGroup(code)   the user's class group, e.g. "CSE3-2" (promise)
 *   Store.timetableInfo()       { term, source } or null
 *   Store.classes.list() / get(id) / onDay(day) / next(now)   own classes plus the group's
 *   Store.classes.own()         only the classes the user added
 *   Store.classes.save(cls)     promise -> saved class (rejects with a message)
 *   Store.classes.remove(id)    promise
 *   Store.on(fn)                -> unsubscribe
 *
 * A class: { id, title, placeId, days: [1, 3], start: "10:00", end: "11:00" }
 * Group classes add { readOnly: true, group, course, room, roomLabel, lecturer, with }
 * and come from site/data/timetables.json (real timetables, built by
 * tools/build_timetables.py). Days: 0 Sunday ... 6 Saturday.
 */
const global = window;

  var KEYS = { saved: "cn.saved.v1", classes: "cn.classes.v1", group: "cn.group.v1" };
  var API = "/api/";
  var listeners = [];
  var account = null;
  var cache = { saved: [], classes: [] };
  var timetables = null;     // contents of data/timetables.json
  var guestGroup = null;

  function notify() { listeners.slice().forEach(function (fn) { fn(); }); }

  /* ---------------- guest storage, guarded ---------------- */
  function readLocal(key) {
    try {
      var v = JSON.parse(global.localStorage.getItem(key) || "[]");
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function writeLocal(key, value) {
    try { global.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage blocked */ }
  }
  function loadGuest() {
    cache.saved = readLocal(KEYS.saved);
    cache.classes = readLocal(KEYS.classes);
    try { guestGroup = global.localStorage.getItem(KEYS.group) || null; } catch (e) { guestGroup = null; }
  }

  /* ---------------- demo API ---------------- */
  function api(method, path, body) {
    return fetch(API + path, {
      method: method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) {
          var err = new Error(data.error || "The demo server didn't answer.");
          err.status = r.status;
          throw err;
        }
        return data;
      });
    });
  }

  loadGuest();

  // Who is signed in? Opened from disk or from a plain file server, /api/me
  // fails and the page simply runs as a guest.
  // A failure to load the account's classes or saved places keeps the user
  // signed in and is reported (dataError), rather than turning them into a guest.
  var loaded = false, dataError = false, timetableState = "loading";
  var signedIn = api("GET", "me").then(function (d) {
    account = d.user;
    return Promise.all([api("GET", "classes"), api("GET", "saved")]).then(function (r) {
      cache.classes = r[0].classes;
      cache.saved = r[1].saved;
    }, function () { dataError = true; });
  }).catch(function () {
    account = null;
  });
  // Class group timetables: a static file, so they work for guests, on a
  // static host and offline (the service worker caches it)
  function fetchTimetables() {
    timetableState = "loading";
    return fetch("data/timetables.json").then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(function (d) {
      if (!d || !Array.isArray(d.groups)) throw new Error("format");
      timetables = d; timetableState = "ok";
    }).catch(function () { timetables = null; timetableState = "error"; });
  }
  var ready = Promise.all([signedIn, fetchTimetables()]).then(function () { loaded = true; notify(); });

  // The timetable is only for signed in students: guests have no group
  function groupCode() { return account ? account.group || null : null; }

  /* The chosen group's classes, in the same shape as the user's own */
  function groupClasses() {
    var code = groupCode();
    if (!timetables || !code) return [];
    var g = timetables.groups.filter(function (x) { return x.code === code; })[0];
    if (!g) return [];
    return g.classes.map(function (c, i) {
      var room = timetables.rooms[c.room] || { label: c.room, placeId: null };
      return {
        id: "g:" + code + ":" + i,
        title: (timetables.courses && timetables.courses[c.course]) || c.course,
        course: c.course,
        placeId: room.placeId,
        room: c.room,
        roomLabel: room.label,
        lecturer: c.lecturer,
        "with": c["with"] || [],
        days: [c.day],
        start: c.start,
        end: c.end,
        group: code,
        readOnly: true
      };
    });
  }

  /* ---------------- timetable helpers ---------------- */
  function minutes(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || "");
    return m ? +m[1] * 60 + +m[2] : NaN;
  }
  function byStart(a, b) { return minutes(a.start) - minutes(b.start); }
  function upsert(list, cls) {
    var i = list.findIndex(function (c) { return c.id === cls.id; });
    if (i >= 0) list[i] = cls; else list.push(cls);
  }

  /* ---------------- saved places ---------------- */
  var saved = {
    list: function () { return cache.saved.slice(); },
    has: function (id) { return cache.saved.indexOf(id) >= 0; },
    toggle: function (id) {
      var on = !saved.has(id);
      if (on) cache.saved.unshift(id);
      else cache.saved = cache.saved.filter(function (s) { return s !== id; });
      if (account) {
        api(on ? "PUT" : "DELETE", "saved/" + encodeURIComponent(id)).catch(function () {
          // put it back the way it was and tell the views
          if (on) cache.saved = cache.saved.filter(function (s) { return s !== id; });
          else cache.saved.unshift(id);
          notify();
        });
      } else {
        writeLocal(KEYS.saved, cache.saved);
      }
      notify();
      return on;
    }
  };

  /* ---------------- timetable ---------------- */
  var classes = {
    list: function () { return account ? cache.classes.concat(groupClasses()) : []; },
    own: function () { return account ? cache.classes.slice() : []; },
    get: function (id) {
      return classes.list().filter(function (c) { return c.id === id; })[0] || null;
    },
    save: function (cls) {
      if (!account) return Promise.reject(new Error("Sign in to keep a timetable."));
      if (account) {
        return api("POST", "classes", cls).then(function (d) {
          upsert(cache.classes, d["class"]);
          notify();
          return d["class"];
        });
      }
      if (!cls.id) cls.id = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      upsert(cache.classes, cls);
      writeLocal(KEYS.classes, cache.classes);
      notify();
      return Promise.resolve(cls);
    },
    remove: function (id) {
      var done = account ? api("DELETE", "classes/" + encodeURIComponent(id)) : Promise.resolve();
      return done.then(function () {
        cache.classes = cache.classes.filter(function (c) { return c.id !== id; });
        if (!account) writeLocal(KEYS.classes, cache.classes);
        notify();
      });
    },
    onDay: function (day) {
      return classes.list().filter(function (c) { return (c.days || []).indexOf(day) >= 0; }).sort(byStart);
    },
    /* What's next from `now`: a class happening now, the next one today, or
       the first one on the next day that has any, up to the same weekday next
       week (dayOffset 7). */
    next: function (now) {
      now = now || new Date();
      var nowMin = now.getHours() * 60 + now.getMinutes();
      for (var offset = 0; offset <= 7; offset++) {
        var day = (now.getDay() + offset) % 7;
        var list = classes.onDay(day);
        for (var i = 0; i < list.length; i++) {
          var s = minutes(list[i].start), e = minutes(list[i].end);
          if (offset === 0) {
            if (e <= nowMin) continue;
            if (s <= nowMin) return { cls: list[i], status: "now", minutes: e - nowMin, dayOffset: 0 };
            return { cls: list[i], status: "later", minutes: s - nowMin, dayOffset: 0 };
          }
          return { cls: list[i], status: "day", minutes: null, dayOffset: offset };
        }
      }
      return null;
    }
  };

  const Store = {
    ready: ready,
    loaded: function () { return loaded; },
    dataError: function () { return dataError; },
    timetableState: function () { return timetableState; },
    retryTimetables: function () {
      var p = fetchTimetables().then(notify);
      notify();
      return p;
    },
    account: function () { return account; },
    signOut: function () {
      return api("POST", "logout").catch(function () {}).then(function () {
        account = null;
        loadGuest();
        notify();
      });
    },
    groups: function () {
      return timetables ? timetables.groups.map(function (g) { return { code: g.code, programme: g.programme }; }) : [];
    },
    group: groupCode,
    setGroup: function (code) {
      code = code || null;
      if (!account) return Promise.reject(new Error("Sign in to choose a class group."));
      if (account) {
        return api("PUT", "me/group", { group: code }).then(function (d) { account = d.user; notify(); });
      }
      guestGroup = code;
      try {
        if (code) global.localStorage.setItem(KEYS.group, code);
        else global.localStorage.removeItem(KEYS.group);
      } catch (e) { /* storage blocked: kept for this visit only */ }
      notify();
      return Promise.resolve();
    },
    timetableInfo: function () { return timetables ? { term: timetables.term, source: timetables.source } : null; },
    saved: saved,
    classes: classes,
    minutes: minutes,
    on: function (fn) {
      listeners.push(fn);
      return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
    }
  };

window.Store = Store;   // for the console and the browser tests
export default Store;
