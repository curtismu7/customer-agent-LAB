import "./ping-spinner.css";

// The dancing Ping mark, ported from AI-DEMO2's shared PingIdentitySpinner (owner: "we have this
// in other apps"). The same lift/tilt/pulse motion, the same reduced-motion rule, at the sizes a
// lab needs. In-chat (the Agent run tab's "Working on it…") it is 36px with no rings; stand-alone
// it is 56px inside the outer ring. The logo is the official 2026 mark from web/public/branding/.
export default function PingSpinner({ size = 56, label = "Working…", rings = false, className = "" }) {
  return (
    <span className={`ping-spinner ${className}`.trim()} style={{ "--ping-spinner-size": `${size}px` }} role="status" aria-live="polite" aria-label={label}>
      <span className="ping-spinner__visual" aria-hidden="true">
        {rings && <span className="ping-spinner__ring" />}
        <img className="ping-spinner__mark" src="/branding/ping-logo.png" alt=""
          onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
      </span>
      {label && <span className="ping-spinner__label">{label}</span>}
    </span>
  );
}
