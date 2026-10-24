/* BAC Maps: sign in page.
 *
 * BAC number and password are checked against the demo database through
 * the local demo server (server/server.py). The accounts are dummy data from
 * server/seed.py. Sign in with Microsoft still needs BAC's approval and an
 * app registration, so it explains that instead.
 *
 * Opened without the demo server (from disk, or a plain file server), the
 * form says how to start it. Passwords are never stored in the browser.
 */
(function () {
  "use strict";

  Icons.hydrate(document);

  var form = document.getElementById("login-form");
  var number = document.getElementById("bac-number");
  var password = document.getElementById("password");
  var reveal = document.getElementById("reveal");
  var error = document.getElementById("form-error");
  var notice = document.getElementById("notice");
  var submit = form.querySelector('button[type="submit"]');

  function say(text) { notice.textContent = text; notice.hidden = false; }

  document.getElementById("ms-signin").addEventListener("click", function () {
    say("Sign in with Microsoft needs BAC’s approval before it can be connected. " +
      "For now, use a demo account below, or continue as a guest.");
  });

  reveal.addEventListener("click", function () {
    var show = password.type === "password";
    password.type = show ? "text" : "password";
    reveal.setAttribute("aria-pressed", String(show));
    reveal.setAttribute("aria-label", show ? "Hide password" : "Show password");
    reveal.innerHTML = Icons.svg(show ? "eye-off" : "eye");
    password.focus();
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var missing = !number.value.trim() ? number : !password.value ? password : null;
    if (missing) {
      error.textContent = missing === number ? "Enter your student or staff number." : "Enter your password.";
      error.hidden = false;
      missing.setAttribute("aria-invalid", "true");
      missing.focus();
      return;
    }
    error.hidden = true;
    notice.hidden = true;
    number.removeAttribute("aria-invalid");
    password.removeAttribute("aria-invalid");
    submit.disabled = true;
    submit.lastChild.textContent = "Signing in…";

    fetch("/api/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: number.value.trim(), password: password.value })
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (data) {
        if (r.ok && data && data.user) { window.location.href = "index.html"; return; }
        if (r.status === 401 && data) {
          error.textContent = data.error;
          error.hidden = false;
          password.value = "";
          password.focus();
          return;
        }
        throw new Error("no demo server");
      });
    }).catch(function () {
      say("The demo server isn’t running, so sign in can’t work here. " +
        "Start it with “python server/server.py” in the project folder, then open " +
        "http://127.0.0.1:8765/site/login.html.");
    }).then(function () {
      submit.disabled = false;
      submit.lastChild.textContent = "Sign in";
    });
  });

  [number, password].forEach(function (input) {
    input.addEventListener("input", function () { input.removeAttribute("aria-invalid"); error.hidden = true; });
  });
})();
