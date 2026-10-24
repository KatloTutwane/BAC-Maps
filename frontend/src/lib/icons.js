/* Inline SVG line icons. Icons.svg(name) returns markup; Icons.hydrate(root)
   fills every element with a data-icon attribute. */
const global = window;

  var PATHS = {
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.4-4.4"/>',
    directory: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r=".6" fill="currentColor"/><circle cx="4" cy="12" r=".6" fill="currentColor"/><circle cx="4" cy="18" r=".6" fill="currentColor"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    close: '<path d="M7 7l10 10M17 7L7 17"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    compass: '<path d="M12 2.5l3.6 9.5H8.4z" fill="currentColor"/><path d="M8.4 12h7.2L12 21.5z"/>',
    "chevron-down": '<path d="M6 9l6 6 6-6"/>',
    "chevron-right": '<path d="M9 6l6 6-6 6"/>',
    directions: '<path d="M12 2.8l9.2 9.2-9.2 9.2L2.8 12z"/><path d="M9.5 14v-2.5a1 1 0 0 1 1-1h4.5"/><path d="M13 8.5l2 2-2 2"/>',
    pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
    "cat-academic": '<path d="M3 9l9-5 9 5"/><path d="M5.5 10.5v7M10 10.5v7M14 10.5v7M18.5 10.5v7M3 20h18"/>',
    "cat-residence": '<path d="M3 18.5V6.5M3 14h18v4.5M21 14v-1.5a3 3 0 0 0-3-3h-7V14"/><circle cx="7" cy="11.2" r="1.7"/>',
    "cat-health": '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/>',
    "cat-food": '<path d="M4.5 10v9.5h15V10"/><path d="M3 9.5L5 4.5h14l2 5c0 1.4-1.1 2.5-2.5 2.5S16 10.9 16 9.5c0 1.4-1.1 2.5-2.5 2.5h-3C9.1 12 8 10.9 8 9.5 8 10.9 6.9 12 5.5 12S3 10.9 3 9.5z"/><path d="M10 19.5v-4h4v4"/>',
    "cat-outdoor": '<path d="M12 21v-5"/><path d="M12 3c-3 0-5.5 2.4-5.5 5.4 0 .7.1 1.3.4 1.9A3.7 3.7 0 0 0 8 16h8a3.7 3.7 0 0 0 1.1-7.2c.3-.6.4-1.2.4-1.9C17.5 5.4 15 3 12 3z"/>',
    "cat-facility": '<path d="M6.5 21V4.5A1.5 1.5 0 0 1 8 3h8a1.5 1.5 0 0 1 1.5 1.5V21"/><path d="M4 21h16"/><circle cx="14.5" cy="12.5" r=".9" fill="currentColor"/>',
    bookmark: '<path d="M7 3.5h10a1 1 0 0 1 1 1V20l-6-4-6 4V4.5a1 1 0 0 1 1-1z"/>',
    "bookmark-filled": '<path d="M7 3.5h10a1 1 0 0 1 1 1V20l-6-4-6 4V4.5a1 1 0 0 1 1-1z" fill="currentColor"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    trash: '<path d="M4.5 7h15M10 7V4.5h4V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    "eye-off": '<path d="M4 4l16 16M10.6 6.1A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-3.2 3.9M6.4 7.6A16 16 0 0 0 2.5 12S6 18 12 18a9 9 0 0 0 4.1-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    "sign-in": '<path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14"/><path d="M4 12h11M11 8l4 4-4 4"/>',
    microsoft: '<rect x="3.5" y="3.5" width="7.5" height="7.5" fill="currentColor" stroke="none"/><rect x="13" y="3.5" width="7.5" height="7.5" fill="currentColor" stroke="none"/><rect x="3.5" y="13" width="7.5" height="7.5" fill="currentColor" stroke="none"/><rect x="13" y="13" width="7.5" height="7.5" fill="currentColor" stroke="none"/>',
    download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
    share: '<path d="M12 3.5v11M8 7.5l4-4 4 4"/><path d="M7.5 11H6.5A1.5 1.5 0 0 0 5 12.5v6A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-6a1.5 1.5 0 0 0-1.5-1.5h-1"/>',
    offline: '<path d="M4 4l16 16"/><path d="M8.5 16.5a5 5 0 0 1 7 0M5 12.6a10 10 0 0 1 4.2-2.4M14.8 10.2A10 10 0 0 1 19 12.6M2 9a14.5 14.5 0 0 1 4.5-2.8M11 5.6A14.5 14.5 0 0 1 22 9"/><circle cx="12" cy="19.5" r=".8" fill="currentColor"/>',
    plus: '<path d="M12 5.5v13M5.5 12h13"/>',
    minus: '<path d="M5.5 12h13"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".6" fill="currentColor"/>',
    user:'<circle cx="12" cy="9" r="3.6"/><path d="M5.5 19.5c1.2-3.3 3.6-5 6.5-5s5.3 1.7 6.5 5"/>',
    location: '<circle cx="12" cy="12" r="3.2" fill="currentColor"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22"/>'
  };

  function svg(name, cls) {
    return '<svg class="icon' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" width="24" height="24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true" focusable="false">' + (PATHS[name] || "") + "</svg>";
  }

  function hydrate(root) {
    (root || document).querySelectorAll("[data-icon]").forEach(function (el) {
      el.innerHTML = svg(el.getAttribute("data-icon"));
    });
  }

  const Icons = { svg: svg, hydrate: hydrate, has: function (n) { return n in PATHS; }, paths: function (n) { return PATHS[n] || ""; } };

window.Icons = Icons;   // for the console and the browser tests
export default Icons;
