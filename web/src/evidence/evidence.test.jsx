import { useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import SequenceView from "./SequenceView";
import MovieReel from "./MovieReel";
import StepDetailPanel from "./StepDetailPanel";
import ActorCard from "./ActorCard";
import { actorOf, actorsIn } from "./lanes";
import { TOKENS, UC1_DENY_RUN, UC1_RUN } from "./fixtures";

// The parent composes the screens (Step 1 does it in App.jsx); this harness does the same so a click can be followed
// from a box to the detail it opens.
function Harness({ hops, view = "seq", start = null }) {
  const [sel, setSel] = useState(start);
  return (
    <>
      {view === "seq" ? <SequenceView hops={hops} selected={sel} onSelect={setSel} /> : <MovieReel hops={hops} selected={sel} onSelect={setSel} />}
      <StepDetailPanel hops={hops} selected={sel} onSelect={setSel} onClose={() => setSel(null)} />
    </>
  );
}
const detail = () => screen.getByTestId("step-detail");
const JWT = /[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;
// Every string the page shows or announces: each text node on its own (textContent would glue neighbouring cells into
// false matches), plus the title and aria-label attributes.
function shownStrings() {
  const out = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) out.push(walk.currentNode.nodeValue);
  for (const el of document.body.querySelectorAll("[title],[aria-label]")) out.push(el.getAttribute("title") || "", el.getAttribute("aria-label") || "");
  return out;
}

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("sequence view", () => {
  test("draws a tile, a top and a bottom lifeline box for every actor present, in order of first appearance", () => {
    render(<SequenceView hops={UC1_RUN} selected={null} onSelect={() => {}} />);
    const cast = actorsIn(UC1_RUN);
    expect(cast).toEqual(["browser", "idp", "bff", "gateway", "authorize", "mcp", "agent"]);
    for (const id of cast) {
      const { label } = actorOf(id);
      expect(screen.getByTestId(`actor-${id}`).textContent).toContain(label);
      expect(screen.getByRole("button", { name: `${label} actor details (top)` })).toBeTruthy();
      expect(screen.getByRole("button", { name: `${label} actor details (bottom)` })).toBeTruthy();
    }
    expect(screen.getAllByRole("button", { name: /^Step \d/ })).toHaveLength(UC1_RUN.length);
    // a same-actor hop is drawn as a note box, not an arrow
    expect(screen.getByTestId("row-8").querySelector(".sq-note")).toBeTruthy();
    expect(screen.getByTestId("row-8").querySelector(".sq-msg")).toBeNull();
  });

  test("clicking an arrow row (anywhere on it, also its label) opens that hop's step detail", () => {
    render(<Harness hops={UC1_RUN} />);
    expect(screen.queryByTestId("step-detail")).toBeNull();
    fireEvent.click(screen.getByTestId("row-5"));
    expect(detail().getAttribute("aria-label")).toBe("Step 5 detail");
    expect(within(detail()).getByRole("heading", { name: "Gateway" })).toBeTruthy();
    expect(screen.getByTestId("row-5").getAttribute("aria-current")).toBe("step");
    fireEvent.click(screen.getByTestId("row-4").querySelector("text"));
    expect(detail().getAttribute("aria-label")).toBe("Step 4 detail");
  });

  test("clicking an actor tile opens its actor card; a step in the card opens that step; a lifeline box opens the card too", () => {
    render(<Harness hops={UC1_RUN} />);
    fireEvent.click(screen.getByTestId("actor-gateway"));
    const card = screen.getByRole("dialog", { name: "Gateway actor details" });
    expect(card.textContent).toMatch(/Checks every call before a tool sees it/);
    expect(within(card).getAllByRole("button", { name: /^Open step/ }).map((b) => b.textContent)).toEqual(["5", "6", "7"]);
    expect(screen.getByTestId("actor-gateway").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(card).getByRole("button", { name: "Open step 6, Authorize" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(detail().getAttribute("aria-label")).toBe("Step 6 detail");
    expect(screen.getByTestId("decision").textContent).toContain("PERMIT");
    fireEvent.click(screen.getByRole("button", { name: "Mock IdP actor details (bottom)" }));
    expect(screen.getByRole("dialog", { name: "Mock IdP actor details" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("arrow keys move between hops and move focus with them", () => {
    render(<Harness hops={UC1_RUN} />);
    const row1 = screen.getByTestId("row-1");
    expect(row1.getAttribute("tabindex")).toBe("0");
    row1.focus();
    fireEvent.keyDown(row1, { key: "ArrowDown" });
    expect(detail().getAttribute("aria-label")).toBe("Step 2 detail");
    expect(document.activeElement).toBe(screen.getByTestId("row-2"));
    fireEvent.keyDown(screen.getByTestId("row-2"), { key: "ArrowUp" });
    expect(detail().getAttribute("aria-label")).toBe("Step 1 detail");
    fireEvent.keyDown(screen.getByTestId("row-1"), { key: "End" });
    expect(detail().getAttribute("aria-label")).toBe("Step 8 detail");
    expect(screen.getByTestId("row-8").getAttribute("tabindex")).toBe("0");
    expect(screen.getByTestId("row-1").getAttribute("tabindex")).toBe("-1");
  });

  test("slow mode reveals one step per tick, selects it, and Prev / Next hold it where the presenter puts it", () => {
    vi.useFakeTimers();
    render(<Harness hops={UC1_RUN} />);
    fireEvent.click(screen.getByRole("button", { name: "Slow" }));
    expect(screen.getByTestId("slow-badge").textContent).toBe("Slow mode — 0/8");
    expect(screen.getByTestId("row-3").getAttribute("data-pending")).toBe("true");
    act(() => { vi.advanceTimersByTime(2600); });
    expect(screen.getByTestId("slow-badge").textContent).toBe("Slow mode — 1/8");
    expect(detail().getAttribute("aria-label")).toBe("Step 1 detail");
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(screen.getByRole("button", { name: "Reveal next step" }));
    act(() => { vi.advanceTimersByTime(10000); });
    expect(screen.getByTestId("slow-badge").textContent).toBe("Slow mode — 2/8");
    expect(detail().getAttribute("aria-label")).toBe("Step 2 detail");
    fireEvent.change(screen.getByRole("combobox", { name: "Step speed" }), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByTestId("slow-badge").textContent).toBe("Slow mode — 3/8");
  });

  test("zoom and text size change the drawing and Reset puts them back", () => {
    render(<SequenceView hops={UC1_RUN} selected={null} onSelect={() => {}} />);
    const svg = screen.getByTestId("sequence-svg");
    const w = Number(svg.getAttribute("viewBox").split(" ")[2]);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByTestId("seq-zoom").textContent).toBe("110%");
    expect(Number(svg.getAttribute("width"))).toBeCloseTo(w * 1.1, 5);
    fireEvent.click(screen.getByRole("button", { name: "large text" }));
    expect(screen.getByTestId("sequence-view").getAttribute("data-font")).toBe("large");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(svg.getAttribute("data-zoom")).toBe("fit");
    expect(screen.getByTestId("sequence-view").getAttribute("data-font")).toBe("medium");
  });

  test("the drawing opens fitted to the width (every lane in view); − / + override it and Fit returns to it", () => {
    render(<SequenceView hops={UC1_RUN} selected={null} onSelect={() => {}} />);
    const svg = screen.getByTestId("sequence-svg");
    const w = Number(svg.getAttribute("viewBox").split(" ")[2]);
    expect(svg.getAttribute("data-zoom")).toBe("fit");
    expect(svg.getAttribute("width")).toBeNull();
    expect(svg.style.width).toBe("100%");
    expect(svg.style.maxWidth).toBe(`${w}px`); // never scaled above its natural size
    expect(screen.getByTestId("seq-fit").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(svg.getAttribute("data-zoom")).toBe("90");
    expect(Number(svg.getAttribute("width"))).toBeCloseTo(w * 0.9, 5);
    expect(screen.getByTestId("seq-fit").getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByTestId("seq-zoom"));
    expect(svg.getAttribute("data-zoom")).toBe("100");
    fireEvent.click(screen.getByTestId("seq-fit"));
    expect(svg.getAttribute("data-zoom")).toBe("fit");
    expect(svg.style.width).toBe("100%");
  });
});

describe("movie reel", () => {
  test("one frame per hop with number, lane, title, the one fact and a status word; clicking a frame opens its detail", () => {
    render(<Harness hops={UC1_RUN} view="reel" />);
    const f4 = screen.getByTestId("frame-4");
    expect(f4.textContent).toBe("4Mock IdPExchangescope narrowed 4 → 1done");
    fireEvent.click(f4);
    expect(f4.getAttribute("aria-current")).toBe("step");
    expect(detail().getAttribute("aria-label")).toBe("Step 4 detail");
    const diff = screen.getByTestId("claim-diff");
    const changed = [...diff.querySelectorAll('tr[data-changed="true"] td:first-child')].map((td) => td.textContent);
    expect(changed).toEqual(["aud changed", "scope changed", "azp changed", "client_id changed", "act changed"]);
    expect(diff.textContent).not.toMatch(/\biat\b|\bexp\b/);
  });

  test("arrow keys move between frames; Compact hides the fact", () => {
    render(<Harness hops={UC1_RUN} view="reel" start={1} />);
    screen.getByTestId("frame-1").focus();
    fireEvent.keyDown(screen.getByTestId("frame-1"), { key: "ArrowRight" });
    expect(detail().getAttribute("aria-label")).toBe("Step 2 detail");
    expect(document.activeElement).toBe(screen.getByTestId("frame-2"));
    fireEvent.keyDown(screen.getByTestId("frame-2"), { key: "ArrowLeft" });
    expect(detail().getAttribute("aria-label")).toBe("Step 1 detail");
    fireEvent.click(screen.getByRole("button", { name: "Compact" }));
    expect(screen.getByTestId("frame-4").textContent).not.toContain("scope narrowed");
  });

  test("Run walks the frames at the chosen speed and stops on the last one; then it offers Replay", () => {
    vi.useFakeTimers();
    render(<Harness hops={UC1_RUN} view="reel" />);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(detail().getAttribute("aria-label")).toBe("Step 1 detail");
    act(() => { vi.advanceTimersByTime(400); });
    expect(detail().getAttribute("aria-label")).toBe("Step 2 detail");
    // one tick per act(), so React renders between ticks the way a browser does
    for (let i = 0; i < 10; i += 1) act(() => { vi.advanceTimersByTime(400); });
    expect(detail().getAttribute("aria-label")).toBe("Step 8 detail");
    expect(screen.getByRole("button", { name: "Replay" })).toBeTruthy();
  });

  test("a hop that did not run sits behind a chip and is shown faint when asked", () => {
    render(<MovieReel hops={UC1_DENY_RUN} selected={null} onSelect={() => {}} />);
    expect(screen.queryByTestId("frame-7")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "+ 1 hops not in this run" }));
    expect(screen.getByTestId("frame-7").getAttribute("data-verdict")).toBe("skip");
    expect(screen.getByTestId("frame-7").textContent).toContain("not in this path");
  });
});

describe("step detail", () => {
  test("a gateway hop shows its filter chain; a deny marks where it stopped, in words", () => {
    render(<StepDetailPanel hops={UC1_DENY_RUN} selected={5} onSelect={() => {}} />);
    expect(screen.getByTestId("sdp-status").textContent).toBe("denied");
    const items = [...screen.getByTestId("stages").querySelectorAll("li")].map((li) => li.textContent);
    expect(items[2]).toBe("failScopethe token does not carry accounts:read (stopped here)");
    expect(items.filter((t) => t.includes("stopped here"))).toHaveLength(1);
    expect(screen.getByLabelText("Step 5 response").textContent).toMatch(/^HTTP 403/);
  });

  test("a stage note that already says it stopped there (the engine writes that) is not doubled", () => {
    const hops = [{ ...UC1_DENY_RUN[4], stages: [{ name: "Scope", result: "fail", note: "the token does not carry accounts:read (stopped here)" }] }];
    render(<StepDetailPanel hops={hops} selected={5} onSelect={() => {}} />);
    expect(screen.getByTestId("stages").textContent).toBe("failScopethe token does not carry accounts:read (stopped here)");
  });

  test("a hop that alters nothing says so", () => {
    render(<StepDetailPanel hops={UC1_RUN} selected={5} onSelect={() => {}} />);
    expect(screen.getByTestId("nothing-changed").textContent).toBe("Nothing changed — this hop carries the request without altering it.");
  });

  test("spec.none says no specification governs the hop, with why and the failure mode", () => {
    render(<StepDetailPanel hops={UC1_RUN} selected={8} onSelect={() => {}} />);
    const col = screen.getByTestId("rfc-column");
    expect(screen.getByTestId("spec-none").textContent).toBe("No specification governs this hop.");
    expect(col.textContent).toContain(UC1_RUN[7].spec.why);
    expect(col.textContent).toContain(UC1_RUN[7].spec.failure);
    expect(col.textContent).not.toContain("What the specification requires");
  });

  test("the RFC column carries why, the mandate with its references (labels, no links) and the failure", () => {
    render(<StepDetailPanel hops={UC1_RUN} selected={4} onSelect={() => {}} />);
    const col = screen.getByTestId("rfc-column");
    for (const h of ["Why it works this way", "What the specification requires", "Common failure mode"]) expect(within(col).getByRole("heading", { name: h })).toBeTruthy();
    const refs = within(col).getAllByRole("listitem").map((li) => li.firstChild.textContent);
    expect(refs).toEqual(["RFC 8693 §2.1", "RFC 8693 §4.1"]);
    for (const li of within(col).getAllByRole("listitem")) expect(li.querySelector(".ev-ref-url").textContent).toMatch(/https:\/\//);
    expect(col.querySelector("a")).toBeNull();
  });

  test("Prev / Next step through the run and close calls onClose", () => {
    const onClose = vi.fn();
    function P() { const [s, setS] = useState(1); return <StepDetailPanel hops={UC1_RUN} selected={s} onSelect={setS} onClose={onClose} />; }
    render(<P />);
    expect(screen.getByRole("button", { name: "Previous step" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(detail().getAttribute("aria-label")).toBe("Step 2 detail");
    fireEvent.click(screen.getByRole("button", { name: "Larger text" }));
    expect(screen.getByTestId("sdp-zoom").textContent).toBe("130%");
    fireEvent.click(screen.getByRole("button", { name: "Close step detail" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("the RFC info toggle is remembered across mounts", () => {
    const { unmount } = render(<StepDetailPanel hops={UC1_RUN} selected={4} onSelect={() => {}} />);
    const btn = screen.getByTestId("rfc-toggle");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByTestId("rfc-column")).toBeNull();
    expect(window.localStorage.getItem("cal.ev.rfcInfo")).toBe("0");
    unmount();
    render(<StepDetailPanel hops={UC1_RUN} selected={4} onSelect={() => {}} />);
    expect(screen.getByTestId("rfc-toggle").getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByTestId("rfc-column")).toBeNull();
  });

  test("the RFC info toggle still works when storage throws on every access", () => {
    const own = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new Error("SecurityError: storage disabled"); } });
    try {
      render(<Harness hops={UC1_RUN} start={4} />);
      const btn = screen.getByTestId("rfc-toggle");
      expect(btn.getAttribute("aria-pressed")).toBe("true");
      fireEvent.click(btn);
      expect(btn.getAttribute("aria-pressed")).toBe("false");
      fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
      fireEvent.click(screen.getByRole("button", { name: "Larger text" }));
      expect(screen.getByTestId("seq-zoom").textContent).toBe("110%");
    } finally {
      if (own) Object.defineProperty(window, "localStorage", own); else delete window.localStorage;
    }
  });
});

describe("actor card", () => {
  test("an actor no table describes still gets a card with its steps", () => {
    const hops = [{ ...UC1_RUN[0], to: "lab-widget" }];
    render(<ActorCard actorId="lab-widget" hops={hops} onSelect={() => {}} onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "lab-widget actor details" }).textContent).toContain("An actor this lab does not describe.");
    expect(screen.getByRole("button", { name: "Open step 1, Sign-in" })).toBeTruthy();
  });
});

describe("no token the fixture redacted is rendered", () => {
  test.each([["UC1", UC1_RUN]])("%s: every view, every hop and every actor card, no JWT-shaped string", (_, hops) => {
    for (const view of ["seq", "reel"]) {
      render(<Harness hops={hops} view={view} />);
      const seen = [];
      for (const h of hops) {
        const box = view === "seq" ? screen.queryByTestId(`row-${h.n}`) : screen.queryByTestId(`frame-${h.n}`);
        if (!box) continue;
        fireEvent.click(box);
        seen.push(...shownStrings());
      }
      if (view === "seq") for (const id of actorsIn(hops.filter((h) => h.verdict !== "skip"))) { fireEvent.click(screen.getByTestId(`actor-${id}`)); seen.push(...shownStrings()); }
      for (const t of seen) {
        expect(t.match(JWT)?.[0]).toBeUndefined();
        for (const raw of Object.values(TOKENS)) expect(t).not.toContain(raw);
      }
      cleanup();
    }
  });
});

describe("the screens show what the server sent", () => {
  test("a token the server left in (Mock keeps MOCK tokens raw) is shown as sent, not rewritten", () => {
    const hop = UC1_DENY_RUN.find((h) => h.n === 6);
    const raw = hop.response.body.leaked;
    render(<StepDetailPanel hops={UC1_DENY_RUN} selected={6} onSelect={() => {}} />);
    expect(screen.getByLabelText("Step 6 response").textContent).toContain(`"leaked": "${raw}"`);
  });
});

describe("review fixes", () => {
  test("closing the actor card returns focus to the tile that opened it", () => {
    render(<Harness hops={UC1_RUN} />);
    const tile = screen.getByTestId("actor-gateway");
    tile.focus();
    fireEvent.click(tile);
    expect(document.activeElement.getAttribute("aria-label")).toBe("Close Gateway details");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(document.activeElement).toBe(screen.getByTestId("actor-gateway"));
  });

  test("inherited object keys are not actors", () => {
    for (const id of ["__proto__", "constructor", "toString"]) {
      const a = actorOf(id);
      expect(a.lane).toBe("neutral");
      expect(a.label).toBe(id);
    }
  });

  test("lifeline boxes stay clickable but are not extra tab stops", () => {
    render(<Harness hops={UC1_RUN} />);
    const boxes = screen.getAllByRole("button", { name: /actor details \((top|bottom)\)/ });
    expect(boxes.length).toBeGreaterThan(0);
    for (const b of boxes) expect(b.getAttribute("tabindex")).toBe("-1");
  });

  test("spec references show their URL as text, reachable without hover", () => {
    const ex = UC1_RUN.find((h) => h.spec?.refs?.length);
    render(<StepDetailPanel hops={UC1_RUN} selected={ex.n} onSelect={() => {}} />);
    const list = screen.getByRole("list", { name: "Specification references" });
    expect(list.textContent).toContain(ex.spec.refs[0].url);
  });
});
