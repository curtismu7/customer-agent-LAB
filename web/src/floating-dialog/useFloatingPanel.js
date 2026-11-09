// Vendored from AI-DEMO-Standalone shared/floating-dialog @ 86db9be; edit there, not here.
// Drag + resize state for a fixed-position panel. Port of AI-DEMO2's useDraggablePanel (demo_api_ui/src/hooks), with a
// keyboard path added and the app-zoom step removed. Live pointer dragging is unclamped (a panel may go onto a second
// monitor); a position restored from storage, or moved with the keyboard, is clamped back into the viewport.
import { useCallback, useEffect, useRef, useState } from "react";
import { clampToViewport, keyboardStep, resizeRect } from "./geometry.js";

const viewport = () => (typeof window === "undefined" ? null : { w: window.innerWidth, h: window.innerHeight });

function readStored(storageKey) {
  if (!storageKey) return null;
  try {
    const s = JSON.parse(window.localStorage.getItem(storageKey) || "null");
    return s && typeof s === "object" ? s : null;
  } catch { return null; }
}

/**
 * @param {(() => {x:number,y:number}) | {x:number,y:number}} initialPos  lazy initialiser or plain object
 * @param {{ w: number, h: number|null }} initialSize  h null = auto height until the user resizes
 * @param {{ storageKey?: string|null, minW?: number, minH?: number, disabled?: boolean, panelRef?: {current: HTMLElement|null} }} [options]
 *   disabled: drag, resize and keyboard moves do nothing (the narrow-screen sheet)
 */
export function useFloatingPanel(initialPos, initialSize, options = {}) {
  const { storageKey = null, minW = 280, minH = 180, disabled = false, panelRef } = options;

  const [pos, setPos] = useState(() => {
    const s = readStored(storageKey);
    if (s?.pos && Number.isFinite(s.pos.x) && Number.isFinite(s.pos.y)) {
      return clampToViewport(s.pos, s.size || initialSize, viewport());
    }
    return typeof initialPos === "function" ? initialPos() : initialPos;
  });
  const [size, setSize] = useState(() => {
    const s = readStored(storageKey);
    return s?.size && Number.isFinite(s.size.w) ? s.size : initialSize;
  });

  // Handlers read the latest values through refs, so a drag never works from a stale closure.
  const posRef = useRef(pos);
  const sizeRef = useRef(size);
  posRef.current = pos;
  sizeRef.current = size;

  const save = useCallback(() => {
    if (!storageKey) return;
    try { window.localStorage.setItem(storageKey, JSON.stringify({ pos: posRef.current, size: sizeRef.current })); } catch { /* private window or blocked storage */ }
  }, [storageKey]);

  // In-flight listeners, torn down on unmount even if pointerup never fired (the panel closed mid-drag).
  const activeRef = useRef(null);
  const stop = () => {
    const a = activeRef.current;
    if (!a) return;
    a.target.removeEventListener("pointermove", a.onMove);
    a.target.removeEventListener("pointerup", a.onUp);
    a.target.removeEventListener("pointercancel", a.onUp);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    activeRef.current = null;
  };
  useEffect(() => stop, []);

  const track = (target, onMove) => {
    stop();
    const onUp = () => { stop(); save(); };
    document.body.style.userSelect = "none";
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
    activeRef.current = { target, onMove, onUp };
  };

  /** Drag from the title bar (pointerdown). Buttons and form controls inside it keep their own clicks. */
  const handleDragStart = useCallback((e) => {
    if (disabled || e.button !== 0) return;
    if (e.target.closest("button, input, textarea, select, a")) return;
    e.preventDefault();
    const offX = e.clientX - posRef.current.x;
    const offY = e.clientY - posRef.current.y;
    const target = e.currentTarget;
    if (target.setPointerCapture && e.pointerId != null) { try { target.setPointerCapture(e.pointerId); } catch { /* synthetic event */ } }
    track(target, (ev) => setPos({ x: ev.clientX - offX, y: ev.clientY - offY }));
  }, [disabled, save]); // eslint-disable-line react-hooks/exhaustive-deps

  const measuredSize = () => {
    const s = sizeRef.current;
    if (s.h != null) return s;
    const r = panelRef?.current?.getBoundingClientRect?.();
    return { w: s.w, h: r && r.height ? r.height : minH };
  };

  /** 8-direction resize: n, ne, e, se, s, sw, w, nw. */
  const handleResizeStart = useCallback((e, dir = "se") => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const sz = measuredSize();
    const start = { x: posRef.current.x, y: posRef.current.y, w: sz.w, h: sz.h };
    const sx = e.clientX;
    const sy = e.clientY;
    document.body.style.cursor = `${dir}-resize`;
    track(document, (ev) => {
      const r = resizeRect(start, dir, ev.clientX - sx, ev.clientY - sy, { w: minW, h: minH });
      setSize({ w: r.w, h: r.h });
      setPos({ x: r.x, y: r.y });
    });
  }, [disabled, minW, minH, save]); // eslint-disable-line react-hooks/exhaustive-deps

  const createResizeHandler = useCallback((dir) => (e) => handleResizeStart(e, dir), [handleResizeStart]);

  /** Keyboard on the focused title bar: arrows move, Shift = 50px, Alt+arrows resize. Returns true when handled. */
  const handleKey = useCallback((e) => {
    if (disabled) return false;
    const step = keyboardStep(e.key, e);
    if (!step) return false;
    e.preventDefault();
    if (step.kind === "move") {
      const next = clampToViewport({ x: posRef.current.x + step.dx, y: posRef.current.y + step.dy }, measuredSize(), viewport());
      posRef.current = next;
      setPos(next);
    } else {
      const sz = measuredSize();
      const r = resizeRect({ ...posRef.current, ...sz }, "se", step.dx, step.dy, { w: minW, h: minH });
      sizeRef.current = { w: r.w, h: r.h };
      setSize(sizeRef.current);
    }
    save();
    return true;
  }, [disabled, minW, minH, save]); // eslint-disable-line react-hooks/exhaustive-deps

  return { pos, size, handleDragStart, handleResizeStart, createResizeHandler, handleKey };
}
