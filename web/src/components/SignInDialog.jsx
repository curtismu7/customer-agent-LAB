import { useEffect, useRef, useState } from "react";
import FloatingDialog from "../floating-dialog/FloatingDialog";
import { postJson } from "../api";
import { newTraceparent } from "../lib";
import { visible } from "../safeText";

// The standard Sign in modal for full Real (owner rules: the password step is this modal, never an inline form; login is pi.flow only, never a
// redirect). The lab's server drives PingOne's pi.flow: authorize (response_mode=pi.flow, PKCE S256), the flows API username/password step,
// then the code for tokens. The username comes from the server (CAL_DEMO_USERNAME) and is read-only here. The password lives in this component's
// state only while the dialog is open: it is cleared the moment it is sent, on close and on unmount, and the page never shows it back.
export default function SignInDialog({ isOpen, username, onClose, onSignedIn }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pwRef = useRef(null);
  useEffect(() => { if (!isOpen) { setPassword(""); setError(null); setBusy(false); } }, [isOpen]);
  useEffect(() => () => setPassword(""), []);
  const submit = async (e) => {
    e.preventDefault();
    if (busy || !password) return;
    const sent = password;
    setPassword(""); // cleared at once: nothing keeps the password after it is sent
    setBusy(true); setError(null);
    const res = await postJson("/api/signin", { password: sent }, { traceparent: newTraceparent() }).catch(() => ({ ok: false, status: 0, body: { message: "The server did not answer." } }));
    setBusy(false);
    if (res.ok && res.body?.signedIn) { onSignedIn?.(res.body); return; }
    setError(`${res.body?.message || res.body?.detail || "Sign-in failed."}${res.status ? ` (HTTP ${res.status})` : ""}`);
    pwRef.current?.focus();
  };
  return (
    <FloatingDialog isOpen={isOpen} onClose={() => { setPassword(""); onClose?.(); }} title="Sign in" ariaLabel="Sign in" defaultWidth={420} defaultHeight={430} testId="signin-dialog" storageKey="cal.signin">
      <form className="stack" onSubmit={submit} data-testid="signin-form">
        <p className="muted" data-testid="signin-method">Real sign-in with PingOne, <strong>pi.flow</strong>: this lab's server sends your password once to PingOne's flows API. No redirect, and the password is never stored, logged or shown.</p>
        <label className="field">
          <span className="field-label">Username</span>
          <input type="text" name="username" value={username || ""} readOnly autoComplete="username" data-testid="signin-username" aria-describedby="signin-username-note" />
        </label>
        <p className="muted" id="signin-username-note">Filled in from this lab's settings (CAL_DEMO_USERNAME).</p>
        <label className="field">
          <span className="field-label">Password</span>
          <input ref={pwRef} type="password" name="password" value={password} onChange={(e) => setPassword(e.target.value.slice(0, 256))} autoComplete="current-password" required maxLength={256} data-testid="signin-password" autoFocus />
        </label>
        {error && <p className="field-error" role="alert" data-testid="signin-error">{visible(error)}</p>}
        <div className="seg">
          <button type="submit" className="primary" disabled={busy || !password} data-testid="signin-submit">{busy ? "Signing in..." : "Sign in"}</button>
          <button type="button" onClick={() => { setPassword(""); onClose?.(); }} data-testid="signin-cancel">Cancel</button>
        </div>
      </form>
    </FloatingDialog>
  );
}
