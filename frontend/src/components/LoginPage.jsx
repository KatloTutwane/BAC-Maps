/* Sign in. The BAC number and password are checked against the demo
   database through the local demo server (server/server.py); the accounts
   are dummy data from server/seed.py. Sign in with Microsoft still needs
   BAC's approval and an app registration, so it explains that instead.
   Passwords are never stored in the browser. */
import { useRef, useState } from "react";
import { Icon } from "./common.jsx";

const BASE = import.meta.env.BASE_URL;

export default function LoginPage() {
  const [number, setNumber] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState(null);         // { text, field }
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [noLogo, setNoLogo] = useState(false);
  const numberRef = useRef(null), passwordRef = useRef(null);

  function submit(e) {
    e.preventDefault();
    if (!number.trim()) { setError({ text: "Enter your student or staff number.", field: "number" }); numberRef.current.focus(); return; }
    if (!password) { setError({ text: "Enter your password.", field: "password" }); passwordRef.current.focus(); return; }
    setError(null); setNotice(null); setBusy(true);
    fetch("/api/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: number.trim(), password: password })
    }).then((r) => r.json().catch(() => null).then((data) => {
      if (r.ok && data && data.user) { window.location.href = "index.html"; return; }
      if (r.status === 401 && data) { setError({ text: data.error }); setPassword(""); passwordRef.current.focus(); return; }
      throw new Error("no demo server");
    })).catch(() => {
      setNotice("The demo server isn’t running, so sign in can’t work here. Start it with “python server/server.py” in the project folder, then open http://127.0.0.1:8765/site/login.html.");
    }).then(() => setBusy(false));
  }

  return (
    <main className="login">
      <section className="login-card" aria-labelledby="login-title">
        <a className={"login-brand" + (noLogo ? " no-logo" : "")} href="index.html">
          <img src={BASE + "assets/bac-logo.png"} alt="BAC, Botswana Accountancy College" onError={() => setNoLogo(true)} />
          <span className="logo-fallback" aria-hidden="true">bac</span>
          <span className="login-wordmark">Maps</span>
        </a>

        <h1 className="login-title" id="login-title">Dumela!</h1>
        <p className="login-lede">Sign in to see your profile and timetable. The map works without signing in.</p>
        <p className="login-demo"><strong>Demo build.</strong> Sign in with one of the dummy accounts listed in <code>server/seed.py</code>. Nothing here is connected to BAC.</p>

        <button type="button" className="btn btn-secondary btn-ms" id="ms-signin"
          onClick={() => setNotice("Sign in with Microsoft needs BAC’s approval before it can be connected. For now, use a demo account below, or continue as a guest.")}>
          <Icon name="microsoft" /><span>Sign in with Microsoft</span>
        </button>

        <div className="login-or" role="separator"><span>or use your BAC number</span></div>

        <form className="login-form" id="login-form" noValidate onSubmit={submit}>
          <label className="field">
            <span className="field-label">Student or staff number</span>
            <input type="text" name="username" id="bac-number" autoComplete="username" required ref={numberRef}
              aria-invalid={error && error.field === "number" ? "true" : undefined}
              value={number} onChange={(e) => { setNumber(e.target.value); setError(null); }} />
          </label>
          <label className="field">
            <span className="field-label">Password</span>
            <span className="field-wrap">
              <input type={show ? "text" : "password"} name="password" id="password" autoComplete="current-password" required ref={passwordRef}
                aria-invalid={error && error.field === "password" ? "true" : undefined}
                value={password} onChange={(e) => { setPassword(e.target.value); setError(null); }} />
              <button type="button" className="icon-btn field-reveal" id="reveal" aria-label={show ? "Hide password" : "Show password"} aria-pressed={String(show)}
                onClick={() => { setShow(!show); passwordRef.current.focus(); }}>
                <Icon name={show ? "eye-off" : "eye"} />
              </button>
            </span>
          </label>
          {error && <p className="field-error" id="form-error">{error.text}</p>}
          <button type="submit" className="btn btn-primary btn-wide" disabled={busy}><Icon name="sign-in" /><span>{busy ? "Signing in…" : "Sign in"}</span></button>
        </form>

        {notice && <p className="login-notice" id="notice" role="status">{notice}</p>}

        <a className="login-guest" href="index.html">Continue as guest</a>
      </section>

      <p className="login-foot">Botswana Accountancy College · BAC Maps</p>
    </main>
  );
}
