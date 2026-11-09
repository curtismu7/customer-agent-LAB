import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanTurn, loadResume, MAX_BYTES, MAX_TURNS, saveResume, slimTurn, takeReturn } from "./resume";

const jwt = ["eyJhbGciOiJFUzI1NiJ9", "eyJzdWIiOiJhbGV4In0", "c2ln"].join(".");
const runTurn = { id: 3, said: "show my balance", uc: { id: "UC1", title: "t", route: { route: "Here" } }, vertical: "banking", how: "exact", source: "chip", status: "done",
  result: { ok: true, status: 200, body: { run: { outcome: "PERMIT", tokens: [{ label: "agent", raw: jwt, mock: true }], hops: [{ n: 1, request: { headers: { authorization: `Bearer ${jwt}` } } }] } } } };

beforeEach(() => { window.sessionStorage.clear(); window.history.replaceState(null, "", "/"); });
afterEach(() => { vi.restoreAllMocks(); window.history.replaceState(null, "", "/"); });

describe("what resume stores", () => {
  test("a finished run keeps ids, words and the outcome word only: no run, no token", () => {
    expect(slimTurn(runTurn)).toEqual({ said: "show my balance", status: "done", ucId: "UC1", vertical: "banking", how: "exact", source: "chip", outcome: "PERMIT" });
    saveResume("w-a", { turns: [runTurn], selectedId: "UC1", vertical: "banking", persona: "standard" });
    const s = window.sessionStorage.getItem("cal.resume.w-a");
    expect(s).not.toMatch(/eyJ|Bearer|hops|tokens|authorization/);
    expect(JSON.parse(s)).toMatchObject({ v: 1, selectedId: "UC1", vertical: "banking", persona: "standard" });
  });

  test("a refused run is stored as refused, a running one as done without an outcome, a note as its text", () => {
    expect(slimTurn({ said: "x", uc: { id: "UC5" }, status: "done", result: { ok: false, status: 409, body: { detail: "nope" } } })).toMatchObject({ refused: true, ucId: "UC5" });
    expect(slimTurn({ said: "x", uc: { id: "UC5" }, status: "running" })).toEqual({ said: "x", status: "done", ucId: "UC5" });
    expect(slimTurn({ status: "note", said: "Back from a2a-lab (UC2)", extra: jwt })).toEqual({ status: "note", said: "Back from a2a-lab (UC2)" });
  });

  test("a round trip restores the turns, flagged restored, with fresh ids", () => {
    saveResume("w-a", { turns: [runTurn, { id: 9, said: "hand off", uc: { id: "UC2" }, vertical: "banking", how: "exact", status: "handoff" }], selectedId: "UC2", vertical: "banking", persona: "premium" });
    const r = loadResume("w-a");
    expect(r.selectedId).toBe("UC2"); expect(r.persona).toBe("premium");
    expect(r.turns.map((t) => [t.id, t.ucId, t.status, t.restored])).toEqual([[1, "UC1", "done", true], [2, "UC2", "handoff", true]]);
    expect(loadResume("w-other")).toBeNull();
  });

  test("hand-edited or hostile storage is cleaned field by field", () => {
    window.sessionStorage.setItem("cal.resume.w-a", JSON.stringify({ selectedId: "../x", vertical: "<b>", persona: 5, turns: [{ said: "ok", ucId: "UC1 ", status: "evil", how: "x", outcome: "<img>", result: { ok: true, body: { run: { outcome: "PERMIT" } } } }, null, 7, { status: "note" }] }));
    const r = loadResume("w-a");
    expect(r).toMatchObject({ selectedId: null, vertical: null, persona: null });
    expect(r.turns).toEqual([{ id: 1, said: "ok", status: "done", outcome: "PERMIT", restored: true }]);
    window.sessionStorage.setItem("cal.resume.w-a", "{not json");
    expect(loadResume("w-a")).toBeNull();
  });

  test("size-capped: at most MAX_TURNS turns and MAX_BYTES bytes, oldest dropped first", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ id: i, said: `${i} ${"x".repeat(390)}`, uc: { id: "UC1" }, status: "done" }));
    saveResume("w-a", { turns: many, vertical: "banking" });
    const s = window.sessionStorage.getItem("cal.resume.w-a");
    expect(s.length).toBeLessThanOrEqual(MAX_BYTES);
    const kept = JSON.parse(s).turns;
    expect(kept.length).toBeLessThanOrEqual(MAX_TURNS);
    expect(kept.at(-1).said.startsWith("79 ")).toBe(true);
  });

  test("blocked storage: nothing throws, nothing is restored", () => {
    vi.spyOn(window.sessionStorage.__proto__, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(window.sessionStorage.__proto__, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => saveResume("w-a", { turns: [runTurn] })).not.toThrow();
    expect(loadResume("w-a")).toBeNull();
  });
});

describe("takeReturn", () => {
  test("a known app and an id: returned, and the two params leave the address bar (path, other params and hash kept)", () => {
    window.history.replaceState(null, "", "/customer-agent/?returned=a2a-lab&uc=UC47&x=1#reel");
    expect(takeReturn()).toEqual({ app: "a2a-lab", uc: "UC47" });
    expect(window.location.pathname + window.location.search + window.location.hash).toBe("/customer-agent/?x=1#reel");
  });

  test("unknown app, bad ids or repeats: null, and the query is still cleaned", () => {
    for (const q of ["?returned=evil-app&uc=UC1", "?returned=a2a-lab&uc=%3Cimg%3E", "?returned=a2a-lab&uc=UC1&uc=UC2", "?returned=toString&uc=UC1", "?uc=UC1"]) {
      window.history.replaceState(null, "", `/${q}`);
      expect(takeReturn(), q).toBeNull();
      expect(window.location.search, q).toBe("");
    }
    window.history.replaceState(null, "", "/?other=1");
    expect(takeReturn()).toBeNull();
    expect(window.location.search).toBe("?other=1");
  });
});
