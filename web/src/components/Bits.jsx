import { useRef } from "react";
import { visible } from "../safeText";

// Raw JSON or text, rendered as text only (never markup). Control and bidirectional-format characters are shown as visible escapes.
export function Json({ value, label, testId }) {
  return <pre className="json" tabIndex={0} aria-label={label} data-testid={testId}>{visible(typeof value === "string" ? value : JSON.stringify(value, null, 2))}</pre>;
}

// A small word-tag. The state only colours the border; the words carry the meaning.
export const Tag = ({ state = "info", children, title, testId }) => <span className="tag" data-state={state} title={title} data-testid={testId}>{children}</span>;

// Where a hop ran (rule 19: REAL or MOCK by what actually ran, never mixed within a hop; NOT RUN when it did not run at all).
export const RealTag = () => <Tag state="ok" testId="real-tag" title="A real call to a real server (PingOne or the Agent Gateway), not produced by this lab">REAL</Tag>;
export const NotRunTag = () => <Tag state="info" testId="notrun-tag" title="This step did not run in this run">NOT RUN</Tag>;
export function SourceTag({ source }) {
  if (source === "real") return <RealTag />;
  if (source === "not-run") return <NotRunTag />;
  if (source === "mock") return <MockTag />;
  return null;
}
export const MockTag = () => <Tag state="info" testId="mock-tag" title="Issued or produced by this lab, not by a real system">MOCK</Tag>;
export const LiveTag = () => <Tag state="ok" testId="live-tag" title="A real call to your PingOne environment, not produced by this lab">LIVE</Tag>;
export const InventedTag = ({ children = "LAB-INVENTED" }) => <Tag state="warn" testId="invented-tag" title="The catalog does not say this; the lab made it up so the engine has something to compute">{children}</Tag>;

// Stale-response guard: run() returns a function that says whether a newer request has started since.
export function useSeq() {
  const seq = useRef(0);
  return () => { const mine = ++seq.current; return () => mine === seq.current; };
}
