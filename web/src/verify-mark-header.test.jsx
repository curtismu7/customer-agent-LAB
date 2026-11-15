import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import App from "./App";
import { forgetWorkspace } from "./workspace";
import { mockApi } from "./testFixtures";

// The header shows this lab's own Verified / In progress mark, read from the same /api/shelf call the Shelf link makes (through the lab-proxy that
// call reaches the shelf, whose payload lists every demo with its mark). Opened on its own port the lab's /api/shelf has no demos: no mark then.
const SHELF = "http://shelf.example";
const mark = (status, label, extra = {}) => ({ status, label, note: "", updatedAt: "2026-11-15", source: "shipped", ...extra });
let api;
const boot = async (shelfPayload) => {
  api = mockApi({ info: { shelfUrl: SHELF } });
  const base = api;
  const wrapped = (url, opts = {}) => (String(url).split("?")[0] === "/api/shelf"
    ? (base.calls.push({ method: "GET", url: String(url), path: "/api/shelf", headers: opts.headers || {}, credentials: opts.credentials }), Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(shelfPayload) }))
    : base(url, opts));
  vi.stubGlobal("fetch", wrapped);
  render(<App />);
  await screen.findByTestId("uc-UC1");
  return within(await screen.findByTestId("top-menu"));
};

beforeEach(() => { window.location.hash = ""; window.sessionStorage.clear(); window.localStorage.clear(); forgetWorkspace(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("verification mark in the header", () => {
  test("shows this lab's own mark inside the top menu beside the Shelf link, and no other lab's", async () => {
    const bar = await boot({ shelfUrl: SHELF, demos: [{ id: "other-lab", verification: mark("in-progress", "In progress") }, { id: "customer-agent-lab", verification: mark("verified", "Verified", { note: "All 87 use cases run on the mock" }) }] });
    expect(await bar.findByText("Verified")).toBeInTheDocument();
    expect(bar.getByRole("link", { name: "Shelf" })).toBeInTheDocument();
    expect(bar.queryByText("In progress")).toBeNull();
    expect(document.querySelectorAll(".verify")).toHaveLength(1);
    expect(bar.getByText("Verified").closest(".verify")).toHaveAttribute("title", expect.stringContaining("All 87 use cases run on the mock"));
  });

  test("shows In progress when that is the lab's mark", async () => {
    const bar = await boot({ shelfUrl: SHELF, demos: [{ id: "customer-agent-lab", verification: mark("in-progress", "In progress") }] });
    expect(await bar.findByText("In progress")).toBeInTheDocument();
    expect(bar.queryByText("Verified")).toBeNull();
  });

  test("sends the same x-workspace header as the Shelf link would, with credentials omitted", async () => {
    const bar = await boot({ shelfUrl: SHELF, demos: [{ id: "customer-agent-lab", verification: mark("verified", "Verified") }] });
    await bar.findByText("Verified");
    const call = api.calls.find((c) => c.path === "/api/shelf");
    expect(call.headers["x-workspace"]).toMatch(/^w-[0-9a-f]{16}$/);
    expect(call.credentials).toBe("omit");
  });

  test("shows nothing on its own port (/api/shelf has only shelfUrl), without a mark, or with mark none", async () => {
    for (const payload of [{ shelfUrl: SHELF }, { shelfUrl: SHELF, demos: [{ id: "customer-agent-lab", verification: null }] }, { shelfUrl: SHELF, demos: [{ id: "customer-agent-lab", verification: mark("none", "") }] }]) {
      const bar = await boot(payload);
      expect(bar.getByRole("link", { name: "Shelf" })).toBeInTheDocument(); // the shelf answered, and still no badge
      await waitFor(() => expect(api.calls.some((c) => c.path === "/api/shelf")).toBe(true));
      expect(document.querySelector(".verify")).toBeNull();
      cleanup(); vi.unstubAllGlobals();
    }
  });

  test("App.jsx renders exactly one <VerifyMark> with this lab's shelf id (removing the line must fail this test)", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src", "App.jsx"), "utf8");
    const entry = JSON.parse(fs.readFileSync(path.join(process.cwd(), "..", "docs", "shelf-entry.json"), "utf8"));
    const tags = src.match(/<VerifyMark\b[^\n]*\/>/g) || [];
    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain(`id="${entry.demos[0].id}"`);
  });
});
