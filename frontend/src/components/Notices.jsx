/* Installable app and offline notices, at the foot of the card */
import { useEffect, useReducer } from "react";
import PWA from "../lib/pwa.js";
import { Icon } from "./common.jsx";

export default function Notices() {
  const [, bump] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    window.addEventListener("online", bump);
    window.addEventListener("offline", bump);
    PWA.on(bump);
    return () => { window.removeEventListener("online", bump); window.removeEventListener("offline", bump); };
  }, []);

  const offline = !navigator.onLine, install = PWA.canInstall(), ios = !install && PWA.showIosHint();
  return (
    <div className="card-notices" id="card-notices" hidden={!offline && !install && !ios}>
      {offline && (
        <p className="notice notice-offline" role="status">
          <Icon name="offline" /><span>You’re offline. The map still works; sign in needs a connection.</span>
        </p>
      )}
      {install && (
        <div className="notice notice-install">
          <span className="notice-icon"><Icon name="download" /></span>
          <span className="notice-text"><strong>Install app</strong><span>Open BAC Maps from your home screen, even offline.</span></span>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => PWA.install()}>Install</button>
        </div>
      )}
      {ios && (
        <div className="notice notice-ios">
          <span className="notice-icon"><Icon name="share" /></span>
          <span className="notice-text">Install: tap Share, then Add to Home Screen.</span>
          <button type="button" className="icon-btn notice-dismiss" aria-label="Dismiss install hint" onClick={() => PWA.dismissIosHint()}><Icon name="close" /></button>
        </div>
      )}
    </div>
  );
}
