import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App, { BANNER_UNKNOWN, BASE_NAV } from "./App";
import { forgetWorkspace } from "./workspace";
import { catalog, mockApi, RAW, runBody } from "./testFixtures";

let api;
const boot = async (state) => {
  api = mockApi(state);
  vi.stubGlobal("fetch", api);
  const view = render(<App />);
  await screen.findByTestId("uc-UC1");
  await waitFor(() => expect(screen.getByTestId("banner").textContent).toMatch(/^SIMULATED, MOCK mode/));
  return view;
};
const pick = async (id) => { const u = userEvent.setup(); await u.click(screen.getByTestId(`uc-${id}`)); return u; };
const search = async (u, text) => { await u.clear(screen.getByTestId("search")); if (text) await u.type(screen.getByTestId("search"), text); };
const runIt = async (u) => { await u.click(screen.getByTestId("run")); await screen.findByTestId(/^(result|refusal)$/); };

beforeEach(() => { window.location.hash = ""; window.sessionStorage.clear(); window.localStorage.clear(); forgetWorkspace(); document.documentElement.removeAttribute("data-theme"); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("header, banner and side nav", () => {
  test("the banner is never blank and does not claim a mode before it knows", async () => {
    api = mockApi(); vi.stubGlobal("fetch", () => new Promise(() => {}));
    render(<App />);
    expect(screen.getByTestId("banner").textContent).toBe(BANNER_UNKNOWN);
    expect(BANNER_UNKNOWN).toMatch(/MOCK mode, REAL only in LIVE mode/);
  });

  test("header: app name, Mock | Live toggle, mode chip, workspace id, theme picker, Reset, Presenter", async () => {
    await boot();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Customer Agent LAB");
    expect(screen.getByTestId("mode-mock").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("mode-live").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("mode").textContent).toMatch(/Mode: mock/);
    expect(screen.getByTestId("workspace").textContent).toMatch(/^Workspace: w-[0-9a-f]{16}$/);
    for (const t of ["auto", "light", "dark"]) expect(screen.getByTestId(`theme-${t}`)).toBeTruthy();
    expect(screen.getByTestId("reset")).toBeTruthy();
    expect(screen.getByTestId("presenter").textContent).toBe("Presenter (P)");
  });

  test("the side nav holds only the agent's own areas by default, and every API call carries the workspace id", async () => {
    await boot();
    const tabs = within(screen.getByTestId("nav")).getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(BASE_NAV.map((n) => n.label));
    expect(tabs).toEqual(["Agent", "Run history", "Diagram", "Talk track"]);
    const id = screen.getByTestId("workspace").textContent.replace("Workspace: ", "");
    expect(api.calls.length).toBeGreaterThan(2);
    for (const c of api.calls) expect(c.headers["x-workspace"]).toBe(id);
  });

  test("the nav is a tablist you can walk with the arrow keys", async () => {
    await boot();
    const u = userEvent.setup();
    screen.getByTestId("nav-agent").focus();
    await u.keyboard("{ArrowDown}");
    expect(screen.getByTestId("nav-runs").getAttribute("aria-selected")).toBe("true");
    await u.keyboard("{ArrowUp}");
    expect(screen.getByTestId("nav-agent").getAttribute("aria-selected")).toBe("true");
  });
});

describe("use case picker", () => {
  test("use cases are grouped by track, with needs, flag, guided/computed and opens badges", async () => {
    await boot();
    const tracks = screen.getAllByTestId(/^track-/).map((t) => t.getAttribute("data-testid"));
    expect(tracks).toEqual(["track-foundations", "track-learn", "track-controls", "track-attacks"]);
    const row = screen.getByTestId("uc-UC9");
    expect(within(row).getByText("flag: ff_authorize_group_policy")).toBeTruthy();
    expect(within(row).getByText("authz")).toBeTruthy();
    expect(within(row).getByText("computed")).toBeTruthy();
    expect(within(row).getByText("opens: Group policy")).toBeTruthy();
    expect(within(screen.getByTestId("uc-UC-LEARN2")).getByText("guided")).toBeTruthy();
  });

  test("search narrows the list and says how many match; no match gives an honest message", async () => {
    await boot();
    const u = userEvent.setup();
    expect(screen.getByTestId("search-count").textContent).toBe("6 use cases in 8 tracks");
    await search(u, "step-up");
    expect(screen.queryByTestId("uc-UC1")).toBeNull();
    expect(screen.getByTestId("uc-UC7")).toBeTruthy();
    expect(screen.getByTestId("search-count").textContent).toBe("1 of 6 match");
    await search(u, "ff_authorize");
    expect(screen.getByTestId("uc-UC9")).toBeTruthy();
    await search(u, "nothing-like-this");
    expect(screen.getByTestId("no-match")).toBeTruthy();
    await search(u, "");
    expect(screen.getByTestId("search-count").textContent).toBe("6 use cases in 8 tracks");
  });

  test("a search hit inside a collapsed track opens that track", async () => {
    await boot();
    const u = userEvent.setup();
    expect(screen.getByTestId("track-attacks").hasAttribute("open")).toBe(false);
    await search(u, "scope");
    expect(screen.getByTestId("track-attacks").hasAttribute("open")).toBe(true);
    expect(screen.getByTestId("uc-UC5")).toBeTruthy();
  });

  test("the vertical selector lists the full packs and the stubs, and refetches the catalog for the choice", async () => {
    await boot();
    const sel = screen.getByTestId("vertical");
    expect([...sel.querySelectorAll("optgroup")].map((g) => g.label)).toEqual(["Full packs", "Stubs (not built)"]);
    expect(within(sel).getByText("Government (stub, not built)")).toBeTruthy();
    fireEvent.change(sel, { target: { value: "healthcare" } });
    await waitFor(() => expect(api.calls.some((c) => c.path === "/api/usecases" && c.query.get("vertical") === "healthcare")).toBe(true));
  });
});

describe("run view", () => {
  test("Run posts the use case, vertical, persona and a W3C traceparent, then shows outcome, hops, and MOCK tokens raw and decoded", async () => {
    await boot();
    const u = await pick("UC1");
    expect(screen.getByTestId("run-title").textContent).toBe("Delegated access (consent only)");
    await u.selectOptions(screen.getByTestId("persona"), "premium");
    await runIt(u);
    const post = api.calls.find((c) => c.method === "POST" && c.path === "/api/run/UC1");
    expect(post.body).toEqual({ vertical: "banking", persona: "premium" });
    expect(post.headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(screen.getByTestId("outcome").textContent).toBe("PERMIT");
    expect(screen.getByTestId("matches").textContent).toBe("engine result matches the catalog label");
    expect(screen.getAllByTestId("hop")).toHaveLength(4);
    expect(screen.getAllByTestId("hop").map((h) => h.textContent.match(/^\d+\./)[0])).toEqual(["1.", "2.", "3.", "4."]);
    expect(screen.getByTestId("run-traceparent").textContent).toMatch(/^00-a{32}-b{16}-01$/);
    const token = screen.getByTestId("token");
    expect(within(token).getByTestId("mock-tag").textContent).toBe("MOCK");
    expect(within(token).getByTestId("token-raw").textContent).toBe(RAW);
    expect(within(token).getByTestId("token-claims").textContent).toContain('"sub": "alex.morgan"');
  });

  test("each hop shows its raw request, raw response and its own traceparent", async () => {
    await boot();
    const u = await pick("UC1");
    await runIt(u);
    await u.click(screen.getByTestId("hops-toggle"));
    const first = screen.getAllByTestId("hop")[0];
    expect(first.hasAttribute("open")).toBe(true);
    expect(first.textContent).toContain("https://idp.mock.example/as");
    expect(first.textContent).toMatch(/traceparent: 00-a{32}-0{15}1-01/);
    expect(screen.getByTestId("hops-toggle").textContent).toBe("Collapse all hops");
  });

  test("a guided run says guided, not computed, and never shows matchesExpected as verified", async () => {
    await boot();
    const u = userEvent.setup();
    await search(u, "inspector");
    await u.click(screen.getByTestId("uc-UC-LEARN2"));
    await runIt(u);
    expect(screen.getByTestId("guided-note").textContent).toBe("guided, not computed");
    expect(screen.queryByTestId("matches")).toBeNull();
    const text = screen.getByTestId("result").textContent;
    expect(text).not.toMatch(/matches the catalog/i);
    expect(text).not.toMatch(/verified(?! that)/i);
    expect(screen.getByTestId("guided-explain").textContent).toMatch(/did not run or verify/);
    expect(screen.getByTestId("no-tokens")).toBeTruthy();
  });

  test("a computed run that differs from the catalog label says so", async () => {
    await boot({ runAnswer: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, run: { ...runBody().run, outcome: "DENY", matchesExpected: false } }) }) });
    const u = await pick("UC1");
    await runIt(u);
    expect(screen.getByTestId("matches").textContent).toBe("engine result differs from the catalog label");
    expect(screen.getByTestId("outcome").getAttribute("data-state")).toBe("bad");
  });

  test("lab-invented inputs are labelled LAB-INVENTED, and so is the persona", async () => {
    await boot();
    const u = await pick("UC7");
    const inputs = screen.getByTestId("lab-inputs");
    expect(inputs.textContent).toContain("amount");
    expect(inputs.textContent).toContain("600");
    expect(within(inputs).getAllByTestId("invented-tag")).toHaveLength(2); // the heading's and the amount's
    expect(within(inputs).getAllByTestId("invented-tag")[0].textContent).toBe("LAB-INVENTED");
    expect(screen.getByTestId("run-panel").textContent).toMatch(/Persona\s*LAB-INVENTED/);
    await u.click(screen.getByTestId("uc-UC1"));
    expect(screen.getByTestId("lab-inputs").textContent).toMatch(/Nothing special/);
  });

  test("a flag-gated use case names the live feature it needs", async () => {
    await boot();
    await pick("UC9");
    expect(screen.getByTestId("flag-note").textContent).toMatch(/Needs live feature ff_authorize_group_policy/);
  });

  test("a stub vertical shows the honest not built state when the API answers 501", async () => {
    await boot();
    const u = await pick("UC1");
    await u.selectOptions(screen.getByTestId("vertical"), "government");
    expect(screen.getByTestId("stub-hint")).toBeTruthy();
    await runIt(u);
    const r = screen.getByTestId("refusal");
    expect(r.getAttribute("data-code")).toBe("vertical_stub");
    expect(r.textContent).toMatch(/Not built/);
    expect(r.textContent).toMatch(/HTTP 501/);
    expect(r.textContent).toMatch(/data stub/);
    expect(screen.queryByTestId("result")).toBeNull();
    // the story for a stub is 501 as well: the last good banner stays
    expect(screen.getByTestId("banner").textContent).toMatch(/^SIMULATED, MOCK mode/);
  });

  test("a trigger that is a link in the product is shown as a plain label, never as a link", async () => {
    await boot();
    const u = userEvent.setup();
    await search(u, "inspector");
    await u.click(screen.getByTestId("uc-UC-LEARN2"));
    expect(screen.getByTestId("run-panel").textContent).toContain("AI-DEMO2 page (label only): /pingone-mcp");
    await runIt(u);
    expect(document.querySelectorAll("a[href]")).toHaveLength(0);
  });

  test("results are kept per use case, vertical and persona", async () => {
    await boot();
    const u = await pick("UC1");
    await runIt(u);
    await u.selectOptions(screen.getByTestId("persona"), "premium");
    expect(screen.queryByTestId("result")).toBeNull();
    await u.selectOptions(screen.getByTestId("persona"), "standard");
    expect(screen.getByTestId("result")).toBeTruthy();
  });

  test("a network failure is shown as a refusal, not a crash", async () => {
    await boot({ runAnswer: () => Promise.reject(new Error("down")) });
    const u = await pick("UC1");
    await runIt(u);
    expect(screen.getByTestId("refusal").textContent).toMatch(/did not answer/);
  });
});

describe("extra pages (opens)", () => {
  test("a use case that opens a page adds it to the nav; one that opens nothing does not", async () => {
    await boot();
    const u = userEvent.setup();
    await search(u, "scope");
    await u.click(screen.getByTestId("uc-UC5"));
    await runIt(u);
    expect(within(screen.getByTestId("nav")).getAllByRole("tab")).toHaveLength(4);
    await search(u, "");
    await u.click(screen.getByTestId("uc-UC1"));
    await runIt(u);
    expect(within(screen.getByTestId("nav")).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Agent", "Run history", "Diagram", "Talk track", "Consent and step-up"]);
    expect(screen.getByTestId("nav-page-consent").getAttribute("data-extra")).toBe("true");
  });

  test("the extra page shows the hops that belong to it, the product page as a label, and goes away on Reset", async () => {
    await boot();
    const u = await pick("UC1");
    await runIt(u);
    await u.click(screen.getByTestId("nav-page-consent"));
    const page = screen.getByTestId("extra-consent");
    expect(page.textContent).toMatch(/Opened by UC1/);
    expect(page.textContent).toMatch(/chat chip: "show my balance"/);
    expect(within(page).getAllByTestId("hop").map((h) => h.textContent)).toEqual([expect.stringContaining("Hop 1 sign-in"), expect.stringContaining("Hop 2 consent")]);
    expect(window.location.hash).toBe("#page-consent");
    await u.click(screen.getByTestId("reset"));
    await waitFor(() => expect(screen.queryByTestId("nav-page-consent")).toBeNull());
    expect(screen.queryByTestId("extra-consent")).toBeNull();
    expect(screen.getByTestId("nav-agent").getAttribute("aria-selected")).toBe("true");
    expect(api.calls.some((c) => c.method === "POST" && c.path === "/api/reset")).toBe(true);
  });

  test("a hash for an extra page that is not open falls back to the agent page", async () => {
    window.location.hash = "#page-approval";
    await boot();
    expect(screen.getByTestId("nav-agent").getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByTestId("extra-approval")).toBeNull();
  });

  test("a learning page shows the sibling standalone as a name only", async () => {
    await boot();
    const u = userEvent.setup();
    await search(u, "inspector");
    await u.click(screen.getByTestId("uc-UC-LEARN2"));
    await runIt(u);
    await u.click(screen.getByTestId("nav-page-learning-link"));
    expect(screen.getByTestId("extra-linkout").textContent).toMatch(/pingone-mcp-inspector/);
    expect(document.querySelectorAll("a[href]")).toHaveLength(0);
  });
});

describe("mode toggle", () => {
  test("Live is refused with the server's own message and the page stays in Mock", async () => {
    await boot();
    const u = userEvent.setup();
    await u.click(screen.getByTestId("mode-live"));
    const msg = await screen.findByTestId("mode-msg");
    expect(msg.textContent).toMatch(/Live was refused \(HTTP 403\)/);
    expect(msg.textContent).toMatch(/CAL_ALLOW_LIVE=1/);
    expect(screen.getByTestId("mode-mock").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("banner").getAttribute("data-state")).toBe("mock");
  });

  test("when the guards hold, Live is selected, the banner and chip say live, and a run shows real hops, a masked token and the steps it did not run", async () => {
    await boot({ live: "allowed" });
    const u = userEvent.setup();
    await u.click(screen.getByTestId("mode-live"));
    await waitFor(() => expect(screen.getByTestId("mode").textContent).toMatch(/Mode: live/));
    expect(screen.getByTestId("mode").textContent).toMatch(/identity provider only/);
    expect(screen.getByTestId("banner").textContent).toMatch(/^LIVE mode/);
    expect(screen.getByTestId("banner").getAttribute("data-state")).toBe("live");
    expect(screen.getByTestId("mode-msg").textContent).toMatch(/two real calls to your PingOne environment/);
    await u.click(screen.getByTestId("uc-UC1"));
    expect(screen.getByTestId("live-persona-note")).toBeTruthy();
    expect(screen.queryByTestId("persona")).toBeNull(); expect(screen.queryByTestId("lab-inputs")).toBeNull();
    await runIt(u);
    expect(screen.getByTestId("outcome").textContent).toBe("LIVE_OK");
    expect(screen.getByTestId("live-note-tag").textContent).toBe("live, identity provider only");
    expect(screen.queryByTestId("matches")).toBeNull(); expect(screen.queryByTestId("guided-note")).toBeNull();
    expect(screen.getAllByTestId("hop")).toHaveLength(2);
    expect(within(screen.getByTestId("hops")).getAllByTestId("live-tag")).toHaveLength(2);
    expect(within(screen.getByTestId("hops")).queryByTestId("mock-tag")).toBeNull();
    const not = screen.getByTestId("not-run");
    expect(not.textContent).toMatch(/Not run in live mode \(3 steps/); expect(not.textContent).toMatch(/identity provider only/); expect(within(not).getAllByRole("listitem").map((x) => x.textContent)).toEqual(["user-token", "token-exchange", "tool-dispatched"]);
    expect(within(screen.getByTestId("token")).getByTestId("live-tag")).toBeTruthy(); expect(within(screen.getByTestId("token")).queryByTestId("mock-tag")).toBeNull();
    expect(screen.getByTestId("tokens").textContent).toMatch(/Token \(masked\)/); expect(screen.getByTestId("token-raw").textContent).toBe("eyJhbG...ab12");
    expect(screen.getByTestId("run-announce").textContent).toBe("UC1 finished: LIVE_OK, live, identity provider only.");
    await u.click(screen.getByTestId("nav-runs"));
    expect(screen.getByTestId("history-row").textContent).toMatch(/n\/a \(live\).*LIVE_OK.*live, identity provider only/);
    await u.click(screen.getByTestId("mode-mock"));
    await waitFor(() => expect(screen.getByTestId("mode").textContent).toMatch(/Mode: mock/));
  });

  test("a live run is not mixed up with a mock run of the same use case, and a live run opens no extra page", async () => {
    await boot({ live: "allowed" });
    const u = userEvent.setup();
    await u.click(screen.getByTestId("uc-UC1"));
    await runIt(u);
    expect(screen.getByTestId("outcome").textContent).toBe("PERMIT");
    const tabsAfterMock = within(screen.getByTestId("nav")).getAllByRole("tab").length;
    await u.click(screen.getByTestId("mode-live"));
    await waitFor(() => expect(screen.getByTestId("mode").textContent).toMatch(/Mode: live/));
    expect(screen.queryByTestId("result")).toBeNull();
    await runIt(u);
    expect(screen.getByTestId("outcome").textContent).toBe("LIVE_OK");
    await u.click(screen.getByTestId("uc-UC7")); // opens the Human approval page when a MOCK run of it succeeds
    await runIt(u);
    expect(screen.getByTestId("outcome").textContent).toBe("LIVE_OK");
    expect(within(screen.getByTestId("nav")).getAllByRole("tab")).toHaveLength(tabsAfterMock);
    expect(screen.queryByTestId("nav-page-approval")).toBeNull();
  });

  test("a live run the lab cannot make says why in the server's words (not set up: 503)", async () => {
    await boot({ live: "allowed", liveConfigured: false });
    const u = userEvent.setup();
    await u.click(screen.getByTestId("mode-live"));
    await waitFor(() => expect(screen.getByTestId("mode").textContent).toMatch(/Mode: live/));
    await u.click(screen.getByTestId("uc-UC1"));
    await runIt(u);
    const r = screen.getByTestId("refusal");
    expect(r.getAttribute("data-code")).toBe("live_not_configured"); expect(r.getAttribute("data-state")).toBe("warn");
    expect(r.textContent).toMatch(/Live is not set up.*HTTP 503.*PINGONE_ENVIRONMENT_ID/);
  });
});

describe("theme, presenter, reset", () => {
  test("the theme picker only sets data-theme on the root, and remembers the choice", async () => {
    await boot();
    const u = userEvent.setup();
    await u.click(screen.getByTestId("theme-dark"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem("cal.theme")).toBe("dark");
    await u.click(screen.getByTestId("theme-light"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    await u.click(screen.getByTestId("theme-auto"));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(screen.getByTestId("theme-auto").getAttribute("aria-pressed")).toBe("true");
  });

  test("a saved theme is applied on load", async () => {
    window.localStorage.setItem("cal.theme", "dark");
    await boot();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  test("Presenter (P) hides the nav, keeps the banner, shows the talk-track line, and Esc leaves it; P is ignored while typing", async () => {
    await boot();
    const u = userEvent.setup();
    await u.keyboard("p");
    expect(screen.queryByTestId("nav")).toBeNull();
    expect(screen.getByTestId("banner").textContent).toMatch(/^SIMULATED, MOCK mode/);
    expect(screen.getByTestId("banner")).toBeVisible();
    expect(screen.getByTestId("presenter").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("presenter-say").textContent).toMatch(/Start with the question/);
    await u.keyboard("{Escape}");
    expect(screen.getByTestId("nav")).toBeTruthy();
    await u.click(screen.getByTestId("search"));
    await u.keyboard("p");
    expect(screen.getByTestId("nav")).toBeTruthy();
    expect(screen.getByTestId("search").value).toBe("p");
  });

  test("the banner is on every page", async () => {
    await boot();
    const u = userEvent.setup();
    for (const id of ["runs", "diagram", "talk", "agent"]) {
      await u.click(screen.getByTestId(`nav-${id}`));
      expect(screen.getByTestId("banner").textContent).toMatch(/SIMULATED, MOCK mode/);
    }
  });

  test("Reset clears results and the run history, and asks the server to reset this workspace", async () => {
    await boot();
    const u = await pick("UC1");
    await runIt(u);
    await u.click(screen.getByTestId("nav-runs"));
    expect((await screen.findAllByTestId("history-row")).length).toBe(1);
    await u.click(screen.getByTestId("reset"));
    await screen.findByTestId("history-empty");
    await u.click(screen.getByTestId("nav-agent"));
    expect(screen.queryByTestId("result")).toBeNull();
  });

  test("a Reset during a run drops the late answer", async () => {
    let release;
    await boot({ runAnswer: (id) => new Promise((r) => { release = () => r({ ok: true, status: 200, json: () => Promise.resolve(runBody(id)) }); }) });
    const u = await pick("UC1");
    await u.click(screen.getByTestId("run"));
    await u.click(screen.getByTestId("reset"));
    await waitFor(() => expect(api.calls.some((c) => c.path === "/api/reset")).toBe(true));
    release();
    await new Promise((r) => { setTimeout(r, 50); });
    expect(screen.queryByTestId("result")).toBeNull();
    expect(screen.queryByTestId("nav-page-consent")).toBeNull();
  });
});

describe("run history and talk track", () => {
  test("history lists the server's run summaries and says guided runs were not computed", async () => {
    await boot();
    const u = userEvent.setup();
    await u.click(screen.getByTestId("uc-UC1"));
    await runIt(u);
    await search(u, "inspector");
    await u.click(screen.getByTestId("uc-UC-LEARN2"));
    await runIt(u);
    await u.click(screen.getByTestId("nav-runs"));
    const rows = await screen.findAllByTestId("history-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toMatch(/matches the catalog label/);
    expect(rows[1].textContent).toMatch(/guided, not computed/);
  });

  test("the talk track page lists every entry from the story", async () => {
    await boot();
    const u = userEvent.setup();
    await u.click(screen.getByTestId("nav-talk"));
    expect(within(screen.getByTestId("talk-track")).getAllByRole("listitem")).toHaveLength(6);
  });
});


describe("fix pass 2026-11-01", () => {
  test("UC21 selects the premium persona it needs, so the first Run sends premium; UC9 selects standard; the visitor can still change it", async () => {
    await boot();
    const u = await pick("UC21");
    expect(screen.getByTestId("persona").value).toBe("premium");
    expect(screen.getByTestId("lab-inputs").textContent).toMatch(/persona.*premium/);
    await runIt(u);
    expect(api.calls.find((c) => c.method === "POST" && c.path === "/api/run/UC21").body).toEqual({ vertical: "banking", persona: "premium" });
    await u.click(screen.getByTestId("uc-UC9"));
    expect(screen.getByTestId("persona").value).toBe("standard");
    await runIt(u);
    expect(api.calls.find((c) => c.method === "POST" && c.path === "/api/run/UC9").body).toEqual({ vertical: "banking", persona: "standard" });
    await u.click(screen.getByTestId("uc-UC21"));
    await u.selectOptions(screen.getByTestId("persona"), "standard");
    expect(screen.getByTestId("persona").value).toBe("standard");
  });

  test("a use case with no persona in its lab inputs leaves the visitor's persona alone", async () => {
    await boot();
    const u = await pick("UC1");
    await u.selectOptions(screen.getByTestId("persona"), "premium");
    await u.click(screen.getByTestId("uc-UC7"));
    expect(screen.getByTestId("persona").value).toBe("premium");
  });

  test("the page has a main landmark with the tabpanel inside it, and a skip button that is the first Tab stop and moves focus to main", async () => {
    await boot();
    const main = screen.getByRole("main");
    const panel = within(main).getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe("tab-agent");
    expect(main.getAttribute("role")).toBeNull();
    const u = userEvent.setup();
    await u.tab();
    expect(document.activeElement).toBe(screen.getByTestId("skip"));
    await u.keyboard("{Enter}");
    expect(document.activeElement).toBe(main);
  });

  test("aria-controls is only on the selected tab, and always points at an element that exists", async () => {
    await boot();
    const u = await pick("UC1");
    await runIt(u);
    for (const id of ["agent", "page-consent", "diagram"]) {
      await u.click(screen.getByTestId(`nav-${id}`));
      for (const tab of within(screen.getByTestId("nav")).getAllByRole("tab")) {
        const c = tab.getAttribute("aria-controls");
        if (tab.getAttribute("aria-selected") === "true") expect(document.getElementById(c)).not.toBeNull();
        else expect(c).toBeNull();
      }
    }
  });

  test("Cmd/Ctrl/Alt+P is not the presenter hotkey; a bare P still is", async () => {
    await boot();
    const u = userEvent.setup();
    await u.keyboard("{Control>}p{/Control}");
    await u.keyboard("{Meta>}p{/Meta}");
    await u.keyboard("{Alt>}p{/Alt}");
    expect(screen.getByTestId("presenter").getAttribute("aria-pressed")).toBe("false");
    await u.keyboard("p");
    expect(screen.getByTestId("presenter").getAttribute("aria-pressed")).toBe("true");
  });

  test("keyboard focus stays on the Run button while the run is in flight and after it, and a second press does nothing", async () => {
    let release;
    await boot({ runAnswer: (id) => new Promise((r) => { release = () => r({ ok: true, status: 200, json: () => Promise.resolve(runBody(id)) }); }) });
    const u = await pick("UC1");
    const btn = screen.getByTestId("run");
    btn.focus();
    await u.keyboard("{Enter}");
    await waitFor(() => expect(btn.textContent).toBe("Running..."));
    expect(document.activeElement).toBe(btn);
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    await u.keyboard("{Enter}");
    expect(api.calls.filter((c) => c.path === "/api/run/UC1")).toHaveLength(1);
    release();
    await screen.findByTestId("result");
    expect(document.activeElement).toBe(btn);
    expect(btn.getAttribute("aria-disabled")).toBeNull();
  });

  test("only the outcome is in the live region; the hop and token dump is not", async () => {
    await boot();
    const u = await pick("UC1");
    await runIt(u);
    const live = screen.getByTestId("run-announce");
    expect(live.textContent).toBe("UC1 finished: PERMIT, matches the catalog label.");
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(screen.getByTestId("result").closest("[aria-live]")).toBeNull();
  });

  test("when the API is unreachable the page says so: unknown mode, no loading text, the unknown banner", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    render(<App />);
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toMatch(/Could not load the lab \(Failed to fetch\)/);
    await waitFor(() => expect(screen.getByTestId("mode").textContent).toMatch(/Mode: unknown \(server did not answer\)/));
    expect(screen.getByTestId("mode").textContent).not.toMatch(/mock/);
    expect(screen.getByTestId("search-count").textContent).toBe("Use cases unavailable");
    expect(screen.getByTestId("catalog-failed")).toBeTruthy();
    expect(screen.queryByText(/Loading the use cases/)).toBeNull();
    expect(screen.getByTestId("banner").textContent).toBe(BANNER_UNKNOWN);
    expect(screen.getByTestId("mode-mock").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("mode-live").getAttribute("aria-pressed")).toBe("false");
  });

  test("a dead server on Run says no answer, never 'HTTP 0' or 'Refused'", async () => {
    await boot({ runAnswer: () => Promise.reject(new Error("down")) });
    const u = await pick("UC1");
    await runIt(u);
    const r = screen.getByTestId("refusal");
    expect(r.getAttribute("data-code")).toBe("network");
    expect(r.textContent).toMatch(/No answer from the server/);
    expect(r.textContent).toMatch(/no HTTP answer/);
    expect(r.textContent).not.toMatch(/HTTP 0|Refused/);
  });

  test("Reset asks the server for the mode again: a Live-selected page goes back to Mock (W15)", async () => {
    await boot({ live: "allowed" });
    const u = userEvent.setup();
    await u.click(screen.getByTestId("mode-live"));
    await waitFor(() => expect(screen.getByTestId("mode").textContent).toMatch(/Mode: live/));
    await u.click(screen.getByTestId("reset"));
    await waitFor(() => expect(screen.getByTestId("mode").textContent).toMatch(/Mode: mock/));
    expect(screen.getByTestId("mode-mock").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("banner").getAttribute("data-state")).toBe("mock");
  });

  test("a late catalog for a vertical the visitor has left is dropped (W6)", async () => {
    const inner = mockApi();
    let land;
    const fetchHeld = (url, opts) => {
      const q = new URLSearchParams(String(url).split("?")[1] || "");
      if (String(url).startsWith("/api/usecases") && q.get("vertical") === "healthcare") {
        // held until the test lets it land; it carries only the first track, so a stale overwrite would be visible
        return new Promise((r) => { land = () => r({ ok: true, status: 200, json: () => Promise.resolve({ ...catalog("healthcare"), tracks: catalog("healthcare").tracks.slice(0, 1) }) }); });
      }
      return inner(url, opts);
    };
    vi.stubGlobal("fetch", fetchHeld);
    render(<App />);
    await screen.findByTestId("uc-UC1");
    fireEvent.change(screen.getByTestId("vertical"), { target: { value: "healthcare" } });
    await waitFor(() => expect(typeof land).toBe("function"));
    fireEvent.change(screen.getByTestId("vertical"), { target: { value: "banking" } });
    land();
    await new Promise((r) => { setTimeout(r, 50); });
    await screen.findByTestId("uc-UC1");
    expect(await screen.findByTestId("uc-UC21")).toBeTruthy();
  });
});
