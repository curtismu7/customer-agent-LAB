import { Json, LiveTag, MockTag } from "./Bits";

// Mock tokens are shown raw (rule 4: education), labelled MOCK, with the decoded header and claims. They are signed with a public mock key.
// A LIVE token (step 3) is shown masked (first 6 and last 4 characters): the server never sends the raw value; the decoded header and claims are shown.
export default function TokenView({ tokens }) {
  if (!tokens?.length) return <p className="muted" data-testid="no-tokens">This run minted no token.</p>;
  return (
    <div className="tokens" data-testid="tokens">
      {tokens.map((t, i) => (
        <article key={`${t.label}-${i}`} className="panel panel--inner" data-testid="token">
          <h4 className="panel__sub">{t.label} {t.mock && <MockTag />}{t.live && <LiveTag />}</h4>
          {t.notice && <p className="muted">{t.notice}</p>}
          <p className="field-label">{t.live ? "Token (masked)" : "Raw token"}</p>
          <Json value={t.raw} label={`${t.label} raw`} testId="token-raw" />
          <p className="field-label">Decoded header</p>
          <Json value={t.header} label={`${t.label} header`} />
          <p className="field-label">Decoded claims</p>
          <Json value={t.claims} label={`${t.label} claims`} testId="token-claims" />
        </article>
      ))}
    </div>
  );
}
