import { useRef, useState } from "react";
import FloatingDialog from "../floating-dialog/FloatingDialog";

export const MUSE_HOME = "https://muse.ai";

// The hosted build's Real button (owner 2026-11-09): Real runs in the real Meta Muse, not here. This dialog explains the path and hands the
// visitor the connector URL (from /api/info museConnectorUrl, the one place it is set). Opening or closing it changes nothing: the page stays Mock.
export default function MuseDialog({ open, url, onClose }) {
  const urlRef = useRef(null);
  const [copyMsg, setCopyMsg] = useState("");
  const selectUrl = () => {
    const el = urlRef.current;
    const sel = typeof window.getSelection === "function" ? window.getSelection() : null;
    if (el && sel) { sel.removeAllRanges(); sel.selectAllChildren(el); }
  };
  const copy = () => {
    // navigator.clipboard is called inside the click handler (a user gesture); without it, or when refused, the URL is selected instead.
    const fallback = () => { selectUrl(); setCopyMsg("Selected. Press Ctrl+C (Cmd+C on a Mac) to copy it."); };
    try {
      navigator.clipboard.writeText(url).then(() => setCopyMsg("Copied."), fallback);
    } catch { fallback(); }
  };
  const close = () => { setCopyMsg(""); onClose(); };
  return (
    <FloatingDialog isOpen={open} onClose={close} title="Run it for real in Meta Muse" testId="muse-dialog"
      defaultWidth={520} defaultHeight={null} minHeight={200} disablePopOut>
      <div className="muse-dialog">
        <p>Real runs in Meta Muse, not on this hosted page. Your requests go through Agent Connect, then Agent Gateway, which asks PingOne Authorize for a decision before the MCP server is called.</p>
        <p className="muse-dialog__label" id="muse-url-label">Connector URL</p>
        <div className="muse-dialog__url">
          <code ref={urlRef} aria-labelledby="muse-url-label" data-testid="muse-url">{url}</code>
          <button type="button" onClick={copy} data-testid="muse-copy">Copy</button>
        </div>
        <p className="muse-dialog__copied" role="status" data-testid="muse-copy-msg">{copyMsg}</p>
        <ol className="muse-dialog__steps">
          <li>Open muse.ai.</li>
          <li>Go to Connectors.</li>
          <li>Add a custom connector with the URL above.</li>
          <li>Sign in with PingOne when asked.</li>
        </ol>
        <p><a href={MUSE_HOME} target="_blank" rel="noopener noreferrer" data-testid="muse-open">Open muse.ai</a></p>
        <p className="muse-dialog__note">This page stays in Mock.</p>
      </div>
    </FloatingDialog>
  );
}
