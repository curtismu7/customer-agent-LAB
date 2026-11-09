import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { forgetWorkspace, workspaceId } from "./workspace";
import { catalog, mockApi, RAW, runBody } from "./testFixtures";
import { matchPrompt, normalize } from "./chat";
import { handoffCarry, handoffHref, PROXY_PATHS } from "./handoff";
import { HandoffCard } from "./components/HandoffCard";
import { RouteTag } from "./components/UseCasePicker";
import { HandoffSummary } from "./components/EvidenceColumn";
import { HANDOFF_WHY } from "./chat";
import ExtraPage from "./components/ExtraPage";
import { DEFAULTS, cleanConfig, chooseTab, setView } from "./quickConfig";
import PROMPTS_DATA from "../../data/prompts.json";
import HANDOFF_DATA from "../../data/handoff.json";

// The fixture catalog plus the routes and prompts the Step 1 UI reads. UC2 is a computed hand-off, UC-LEARN2 a guided one.
const ROUTES = { UC1: { route: "Here + go deeper", app: "delegation-lab", basis: "named in lab entry" }, "UC-LEARN2": { route: "Hand off", app: "pingone-mcp-inspector", basis: "named in lab entry" } };
const HANDOFF_UC = { id: "UC2", track: "foundations", title: "A2A delegation", buyerStory: "b", pingOneSolution: "s", trigger: { type: "chip", text: "hand off to a specialist" }, expectedOutcome: "PERMIT", evidence: { tokenChain: [], activity: [] }, maturity: "works", productRoles: {}, primaryTool: null, needs: [], flag: null, opens: "none", linkOut: null, tool: null, live: { status: "idp-only", message: "m" }, guided: false, labInputs: {}, route: { route: "Hand off", app: "a2a-lab", basis: "named in lab entry" } };
const PROMPTS = [
  { uc: "UC1", text: "show my balance", title: "Delegated access (consent only)", track: "foundations", expectedOutcome: "PERMIT", route: "Here + go deeper" },
  { uc: "UC7", text: "transfer $600 from checking to savings", title: "Transfer needs step-up", track: "controls", expectedOutcome: "STEP_UP", route: "Here + go deeper" },
  { uc: "UC5", text: "use the wrong scope", title: "Wrong or insufficient scope", track: "attacks", expectedOutcome: "DENY_403", route: "Here" },
  { uc: "UC2", text: "hand off to a specialist", title: "A2A delegation", track: "foundations", expectedOutcome: "PERMIT", route: "Hand off" },
];
const routed = (vertical) => {
  const c = catalog(vertical);
  c.tracks = c.tracks.map((t) => ({ ...t, usecases: t.usecases.map((u) => ({ ...u, route: ROUTES[u.id] || { route: "Here", app: null, basis: null } })) }));
  const f = c.tracks.find((t) => t.track === "foundations"); f.usecases = [...f.usecases, HANDOFF_UC]; f.count += 1; c.total += 1;
  return c;
};
const STORY_CAST = { castAgent: "concierge-agent", castBrand: "Fabrikam Bank", castUser: "alex.morgan", castUser2: "sam.rivera", castHost: "fabrikam" };
function api(state = {}) {
  const inner = mockApi(state);
  const fn = (url, opts = {}) => {
    const path = String(url).split("?")[0];
    const q = new URLSearchParams(String(url).split("?")[1] || "");
    const json = (status, body) => Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) });
    if (path === "/api/usecases") { inner(url, opts); return json(200, routed(q.get("vertical") || "banking")); }
    if (path === "/api/prompts") { inner(url, opts); const v = q.get("vertical") || "banking"; return json(200, { vertical: v, pack: v === "government" ? "stub" : "full", prompts: v === "government" ? [] : PROMPTS }); }
    if (path === "/api/story") return inner(url, opts).then(async (r) => (r.ok ? json(200, { ...(await r.json()), cast: STORY_CAST }) : r));
    if (path === "/api/brain") { inner(url, opts); return json(200, { schema: "customer-agent-brain/1", configured: false, available: false, label: null, reason: "off", message: "No local model is configured for this lab (CAL_BRAIN_URL is not set).", ...(state.brain || {}) }); }
    if (path === "/api/brain/pick") { inner(url, opts); return json(200, state.pick ? state.pick(JSON.parse(opts.body)) : { ok: false, reason: "off", message: "No local model is configured for this lab (CAL_BRAIN_URL is not set)." }); }
    return inner(url, opts);
  };
  fn.calls = inner.calls; fn.state = inner.state;
  return fn;
}
let A;
const boot = async (state) => {
  A = api(state); vi.stubGlobal("fetch", A);
  const view = render(<App />);
  await screen.findByTestId("uc-UC1");
  await screen.findByTestId("wtt-UC1");
  await waitFor(() => expect(screen.getByTestId("agent-column").textContent).toMatch(/concierge-agent/));
  return view;
};
const posts = (id) => A.calls.filter((c) => c.method === "POST" && c.path === `/api/run/${id}`);

beforeEach(() => { window.location.hash = ""; window.sessionStorage.clear(); window.localStorage.clear(); forgetWorkspace(); document.documentElement.removeAttribute("data-theme"); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.history.replaceState(null, "", "/"); });

describe("Agno layout: setup sidebar, agent column, evidence column", () => {
  test("the shell bar holds the app name, the pill nav, Mock | Real, Quick Config, Reset, Presenter and the theme; the banner comes right after it", async () => {
    await boot();
    const bar = document.querySelector(".shell-bar");
    expect(within(bar).getByRole("heading", { level: 1 }).textContent).toBe("Customer Agent LAB");
    for (const id of ["nav", "mode-mock", "mode-live", "qc-open", "reset", "presenter", "theme"]) expect(within(bar).getByTestId(id)).toBeTruthy();
    expect(bar.nextElementSibling).toBe(screen.getByTestId("banner"));
    expect(screen.getByTestId("banner").getAttribute("role")).toBe("note");
  });

  test("the sidebar has New chat, the gateway line, One agent | Several, agent, brain (llama.cpp off when not configured), vertical, the use cases with route tags, and sessions", async () => {
    await boot();
    const side = screen.getByTestId("setup");
    expect(within(side).getByTestId("new-chat")).toBeTruthy();
    expect(within(side).getByTestId("gateway-status").textContent).toMatch(/gateway\.fabrikam\.example/);
    expect(within(side).getByTestId("mode-one").getAttribute("aria-pressed")).toBe("true");
    expect(within(side).getByTestId("agent-select").value).toBe("concierge-agent");
    const brain = within(side).getByTestId("brain-select");
    expect(brain.value).toBe("scripted");
    expect(within(brain).getByText("llama.cpp · not configured").disabled).toBe(true);
    expect(within(screen.getByTestId("uc-UC1")).getByTestId("route-tag").textContent).toBe("PERMIT +");
    expect(within(screen.getByTestId("uc-UC2")).getByTestId("route-tag").textContent).toBe("Opens a2a-lab");
    expect(within(screen.getByTestId("uc-UC5")).getByTestId("route-tag").textContent).toBe("DENY_403");
    expect(within(side).getByTestId("sessions-empty")).toBeTruthy();
  });

  test("Several narrows the list to the hand-offs and says why", async () => {
    await boot();
    const u = userEvent.setup();
    await u.click(screen.getByTestId("mode-several"));
    expect(screen.getByTestId("several-note").textContent).toMatch(/run in their own apps/);
    expect(screen.queryByTestId("uc-UC1")).toBeNull();
    expect(screen.getByTestId("uc-UC2")).toBeTruthy();
  });
});

describe("What to type and the Scripted brain", () => {
  test("first open shows starter cards and the What to type chips for the vertical; a chip runs its use case and the reply is built from the run", async () => {
    await boot();
    expect(screen.getByTestId("starters")).toBeTruthy();
    expect(screen.getByTestId("wtt-heading").textContent).toBe("What to type · Banking · Fabrikam Bank");
    expect(within(screen.getByTestId("wtt-away")).getAllByRole("button").map((b) => b.textContent)).toEqual(["hand off to a specialist"]);
    expect(within(screen.getByTestId("what-to-type")).getByText("Opens its own app")).toBeTruthy();
    expect(screen.queryByTestId("starter-UC2")).toBeNull(); // starter cards are prompts that run here
    expect(screen.getAllByTestId(/^wtt-UC/).map((b) => b.textContent)).toEqual(PROMPTS.map((p) => p.text));
    const u = userEvent.setup();
    await u.click(screen.getByTestId("wtt-UC1"));
    const turn = await screen.findByTestId("turn");
    await within(turn).findByTestId("turn-answer");
    expect(posts("UC1")).toHaveLength(1);
    expect(posts("UC1")[0].body).toEqual({ vertical: "banking", persona: "standard", said: "show my balance", brain: "scripted" });
    expect(within(turn).getByTestId("turn-said").textContent).toBe("show my balance");
    expect(within(turn).getByTestId("turn-reasoning").textContent).toMatch(/Matched your words to UC1 Delegated access/);
    expect(within(turn).getByTestId("turn-tokens").textContent).toMatch(/sub alex\.morgan/);
    expect(within(turn).getAllByRole("button", { name: /^Hop \d/ })).toHaveLength(4);
    expect(within(turn).getByTestId("turn-outcome").textContent).toBe("PERMIT");
    expect(screen.getByTestId("agent-status").textContent).toBe("Done");
    expect(screen.queryByTestId("starters")).toBeNull();
    expect(screen.getByTestId("what-to-type")).toBeTruthy(); // always visible
  });

  test("typing a prompt (any case, extra spaces) runs its use case; words that match nothing say so and run nothing; typed text stays inert", async () => {
    await boot();
    const u = userEvent.setup();
    await u.type(screen.getByTestId("composer-input"), "  TRANSFER $600 from checking   to savings{Enter}");
    await screen.findByTestId("turn-answer");
    expect(posts("UC7")).toHaveLength(1);
    await u.type(screen.getByTestId("composer-input"), "<img src=x onerror=alert(1)> what is the meaning of life{Enter}");
    await screen.findByTestId("turn-nomatch");
    expect(A.calls.filter((c) => c.method === "POST" && c.path.startsWith("/api/run/"))).toHaveLength(1);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getAllByTestId("turn-said")[1].textContent).toMatch(/^<img src=x/);
  });

  test("hops not in this run get no pill and no count: the turn and the evidence header say +M not in this run", async () => {
    const base = runBody().run.hops;
    const skips = ["step-up", "vault-key-inject"].map((kind, i) => ({ ...base[0], n: base.length + i + 1, kind, label: kind, verdict: "skip", traceparent: undefined, request: {}, response: {} }));
    await boot({ runAnswer: (id) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(runBody(id, { hops: [...base, ...skips] })) }) });
    const u = userEvent.setup();
    await u.click(screen.getByTestId("wtt-UC1"));
    const turn = await screen.findByTestId("turn");
    await within(turn).findByTestId("turn-answer");
    const pills = within(turn).getByTestId("turn-pills");
    expect(within(pills).getAllByRole("button")).toHaveLength(base.length);
    for (const k of skips) expect(within(pills).queryByTestId(`pill-${k.n}`)).toBeNull();
    expect(within(turn).getByTestId("turn-not-run").textContent).toBe("+2 not in this run");
    expect(within(turn).getByTestId("turn-reasoning").textContent).toMatch(new RegExp(`Ran ${base.length} hops in the mock engine`));
    expect(screen.getByTestId("evidence-count").textContent).toMatch(new RegExp(`· ${base.length} hops · \\+2 not in this run`));
  });

  test("a step-up outcome is an approval card that says the hold is simulated, and the header says Waiting for you", async () => {
    await boot({ runAnswer: (id) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(runBody(id, { outcome: "STEP_UP", hops: [...runBody().run.hops.slice(0, 3), { ...runBody().run.hops[3], verdict: "obligation" }] })) }) });
    const u = userEvent.setup();
    await u.click(screen.getByTestId("wtt-UC7"));
    const card = await screen.findByTestId("turn-approval");
    expect(card.textContent).toMatch(/Step-up needed/);
    expect(card.textContent).toMatch(/simulated/);
    expect(screen.queryByTestId("turn-answer")).toBeNull();
    expect(screen.getByTestId("agent-status").textContent).toBe("Waiting for you");
    const pill = screen.getByTestId("pill-4");
    expect(pill.getAttribute("data-state")).toBe("warn");
    expect(pill.textContent).toMatch(/needs approval/);
  });

  test("a stub vertical says it has no demo pack yet and shows no chips", async () => {
    await boot();
    fireEvent.change(screen.getByTestId("vertical"), { target: { value: "government" } });
    await screen.findByTestId("wtt-stub");
    expect(screen.getByTestId("wtt-stub").textContent).toMatch(/no demo pack yet/);
    expect(screen.queryAllByTestId(/^wtt-UC/)).toHaveLength(0);
  });

  test("a tool-call pill opens that hop in the evidence column", async () => {
    await boot();
    const u = userEvent.setup();
    await u.click(screen.getByTestId("wtt-UC1"));
    await screen.findByTestId("turn-answer");
    await u.click(screen.getByTestId("pill-3"));
    const detail = await screen.findByTestId("step-detail");
    expect(detail.getAttribute("aria-label")).toBe("Step 3 detail");
    expect(screen.getByTestId("evtab-sequence").getAttribute("aria-pressed")).toBe("true");
  });

  test("New chat clears the conversation and brings the starter cards back; sessions list this workspace's runs", async () => {
    await boot();
    const u = userEvent.setup();
    await u.click(screen.getByTestId("wtt-UC1"));
    await screen.findByTestId("turn-answer");
    await waitFor(() => expect(screen.getAllByTestId("session-row")).toHaveLength(1));
    expect(screen.getByTestId("session-row").textContent).toMatch(/#1 UC1.*PERMIT/);
    await u.click(screen.getByTestId("new-chat"));
    expect(screen.queryByTestId("turn")).toBeNull();
    expect(screen.getByTestId("starters")).toBeTruthy();
  });
});

describe("the matcher on the real data: every shown prompt runs its use case", () => {
  test("in every vertical each prompt's own text matches its own use case, and nothing matches empty or unrelated text", () => {
    for (const [v, list] of Object.entries(PROMPTS_DATA.verticals)) {
      for (const p of list) expect(matchPrompt(p.text, list)?.uc, `${v} ${p.uc}`).toBe(p.uc);
      for (const p of list) expect(matchPrompt(`  ${p.text.toUpperCase()}!! `, list)?.uc, `${v} ${p.uc} loose`).toBe(p.uc);
      expect(matchPrompt("", list)).toBeNull();
      expect(matchPrompt("tell me a joke about penguins", list)).toBeNull();
    }
  });

  test("a close match needs 80% of a prompt's words and no tie; input is capped and never evaluated", () => {
    const list = PROMPTS_DATA.verticals.banking;
    expect(matchPrompt("please show my mortgage now", list)).toEqual({ uc: "UC33", text: "show my mortgage", how: "close" });
    expect(matchPrompt("show my", list)).toBeNull();
    expect(normalize("x".repeat(5000)).length).toBe(400);
    expect(normalize("Show’s  <b>MY</b>")).toBe("show's b my b");
  });
});

describe("hand-off and go deeper", () => {
  test("a hand-off picked in the sidebar answers in the conversation: reasoning, the card inline, Ready to hand off; ids only, no link off the proxy, and Preview here runs the mock engine", async () => {
    await boot();
    const u = userEvent.setup();
    await u.click(screen.getByTestId("uc-UC2"));
    const turn = screen.getByTestId("turn");
    expect(within(turn).getByTestId("turn-said").textContent).toBe("UC2 A2A delegation (picked from the list)");
    const why = within(turn).getByTestId("turn-reasoning").textContent;
    expect(why).toMatch(/You picked UC2 A2A delegation from the list/);
    expect(why).toMatch(/UC2 needs several agents or the product's own pages, so it runs in its own app/);
    expect(why).toMatch(/Its home is a2a-lab \(routing table: named in lab entry\)/);
    expect(within(turn).getByTestId("turn-handoff-say").textContent).toMatch(/^This one runs in its own app/);
    expect(screen.getByTestId("agent-status").textContent).toBe("Ready to hand off");
    expect(screen.getAllByTestId("handoff-card")).toHaveLength(1); // in the reply, not repeated in the use case panel
    const card = within(turn).getByTestId("handoff-card");
    expect(card.textContent).toMatch(/a2a-lab/);
    expect(card.textContent).toMatch(/named in lab entry/);
    expect(within(card).getByRole("list", { name: "Carried in the link" }).textContent).toBe("from=customer-agentuc=UC2vertical=bankinguser=alex.morgan");
    expect(card.textContent).toMatch(/Never carried: tokens, secrets or keys, cookies/);
    expect(within(card).getByTestId("handoff-open-shelf").textContent).toMatch(/Start a2a-lab from the Shelf/);
    expect(within(card).queryByTestId("handoff-open")).toBeNull();
    expect(screen.getByTestId("handoff-summary").textContent).toMatch(/Hands off · 2/);
    expect(document.querySelectorAll("a[href]")).toHaveLength(0);
    await u.click(within(card).getByTestId("handoff-preview"));
    await waitFor(() => expect(posts("UC2")).toHaveLength(1));
    await screen.findByTestId("turn-answer");
    expect(screen.queryByTestId("handoff-summary")).toBeNull();
  });

  test("the Opens its own app chip answers with the hand-off reply and card, runs nothing, and the status reads Ready to hand off", async () => {
    await boot();
    const u = userEvent.setup();
    await u.click(within(screen.getByTestId("wtt-away")).getByTestId("wtt-UC2"));
    const turn = screen.getByTestId("turn");
    expect(turn.getAttribute("data-status")).toBe("handoff");
    expect(within(turn).getByTestId("turn-reasoning").textContent).toMatch(/Matched your words to UC2 A2A delegation.*runs in its own app/);
    expect(within(turn).getByTestId("handoff-card")).toBeTruthy();
    expect(screen.getByTestId("agent-status").textContent).toBe("Ready to hand off");
    expect(A.calls.filter((c) => c.method === "POST" && c.path.startsWith("/api/run/"))).toHaveLength(0);
  });

  test("a guided hand-off has no Preview here", async () => {
    await boot();
    const u = userEvent.setup();
    await u.type(screen.getByTestId("search"), "inspector");
    await u.click(screen.getByTestId("uc-UC-LEARN2"));
    expect(within(screen.getByTestId("handoff-card")).queryByTestId("handoff-preview")).toBeNull();
  });

  test("under the lab proxy the Open button carries a relative path from the allow-list with ids only", async () => {
    window.history.replaceState(null, "", "/customer-agent/");
    await boot();
    const u = userEvent.setup();
    await u.click(screen.getByTestId("uc-UC2"));
    const open = screen.getByTestId("handoff-open");
    expect(open.textContent).toBe("Open a2a-lab");
    expect(open.getAttribute("data-href")).toBe("../a2a-lab/?from=customer-agent&uc=UC2&vertical=banking&user=alex.morgan");
    // the card lists exactly what the link carries, in order
    const listed = within(screen.getByTestId("handoff-card")).getByRole("list", { name: "Carried in the link" }).querySelectorAll("li");
    expect([...listed].map((li) => li.textContent)).toEqual([...new URLSearchParams(open.getAttribute("data-href").split("?")[1])].map(([k, v]) => `${k}=${v}`));
    const summary = screen.getByTestId("handoff-summary");
    expect([...summary.querySelectorAll("dt")].map((d) => `${d.textContent}=${d.nextElementSibling.textContent}`)).toEqual([...listed].map((li) => li.textContent));
    await u.click(screen.getByTestId("wtt-UC1"));
    await screen.findByTestId("turn-answer");
    expect(within(screen.getAllByTestId("turn")[1]).getByTestId("deeper-open").getAttribute("data-href")).toBe("../delegation-lab/?from=customer-agent&uc=UC1&vertical=banking&user=alex.morgan");
  });

  test("a Here + go deeper reply names the deeper lab; off the proxy it says to start it from the Shelf", async () => {
    await boot();
    const u = userEvent.setup();
    await u.click(screen.getByTestId("wtt-UC1"));
    await screen.findByTestId("turn-answer");
    const deeper = within(screen.getByTestId("turn")).getByTestId("go-deeper");
    expect(deeper.textContent).not.toMatch(/user=/);
    expect(deeper.textContent).toMatch(/Go deeper in delegation-lab/);
    expect(deeper.textContent).toMatch(/Start delegation-lab from the Shelf/);
  });

  test("handoffHref: only under /customer-agent/, only allow-listed apps, only id-shaped values, always relative", () => {
    expect(handoffHref("a2a-lab", "UC2", "banking", "/customer-agent/")).toBe("../a2a-lab/?from=customer-agent&uc=UC2&vertical=banking");
    expect(handoffHref("gateway-suite-lab", "UC-TOOL3", "retail", "/customer-agent/index.html")).toBe("../gateway-suite/?from=customer-agent&uc=UC-TOOL3&vertical=retail");
    expect(handoffHref("a2a-lab", "UC2", "banking", "/")).toBeNull();
    expect(handoffHref("a2a-lab", "UC2", "banking", "/other/customer-agent/")).toBeNull();
    expect(handoffHref("cimd", "UC43", "banking", "/customer-agent/")).toBe("../cimd-lab/?from=customer-agent&uc=UC43&vertical=banking");
    expect(handoffHref("pingfederate", "UC-LOGIN-PF", "banking", "/customer-agent/")).toBe("../pingfederate-lab/?from=customer-agent&uc=UC-LOGIN-PF&vertical=banking"); // owner confirmed 2026-11-09
    expect(handoffHref("id-jag-standalone", "UC40", "banking", "/customer-agent/")).toBe("../id-jag-kit/?from=customer-agent&uc=UC40&vertical=banking");
    expect(handoffHref("muse", "UC48", "banking", "/customer-agent/")).toBeNull(); // no proxy route yet
    expect(handoffHref("a2a-lab", "UC2", "banking", "/customer-agent/", "alex.morgan")).toBe("../a2a-lab/?from=customer-agent&uc=UC2&vertical=banking&user=alex.morgan");
    expect(handoffHref("a2a-lab", "UC2", "banking", "/customer-agent/", "a b&c=d")).toBe("../a2a-lab/?from=customer-agent&uc=UC2&vertical=banking"); // a user that is not an id is left out
    expect(handoffCarry("UC2", "banking", "a b")).toEqual([["from", "customer-agent"], ["uc", "UC2"], ["vertical", "banking"]]);
    expect(handoffCarry("UC2&x", "banking", "alex.morgan")).toBeNull();
    // doubled slashes: the prefix check folds them, and the link still resolves to the other app at the proxy root
    for (const where of ["/customer-agent/", "/customer-agent/index.html", "/customer-agent//", "//customer-agent/", "/customer-agent//index.html"]) {
      const href = handoffHref("a2a-lab", "UC2", "banking", where, "alex.morgan");
      expect(href, where).not.toBeNull();
      expect(new URL(href, `http://lab.example${where}`).pathname, where).toBe("/a2a-lab/");
    }
    expect(handoffHref("__proto__", "UC2", "banking", "/customer-agent/")).toBeNull();
    expect(handoffHref("a2a-lab", "UC2&evil=1", "banking", "/customer-agent/")).toBeNull();
    expect(handoffHref("a2a-lab", "UC2", "//evil.example", "/customer-agent/")).toBeNull();
    for (const p of Object.values(PROXY_PATHS)) expect(p).toMatch(/^\/[a-z0-9-]+\/$/);
    const apps = new Set(Object.values(HANDOFF_DATA.routes).flatMap((r) => [r.app, r.also]).filter(Boolean));
    for (const id of Object.keys(PROXY_PATHS)) expect(apps.has(id), id).toBe(true);
  });

  test("a hand-off with a second app (UC39) offers both: two Open buttons under the proxy, two Shelf lines off it", () => {
    const uc = { id: "UC39", route: { route: "Hand off", app: "agent-kill-switch", also: "agent-registry-demo", basis: "owner decision 2026-11-09" } };
    window.history.replaceState(null, "", "/customer-agent/");
    render(<HandoffCard uc={uc} vertical="banking" userId="alex.morgan" />);
    expect(screen.getByTestId("handoff-card").querySelector("h3").textContent).toMatch(/^agent-kill-switch or agent-registry-demo/);
    expect(screen.getByTestId("handoff-open").getAttribute("data-href")).toBe("../agent-kill-switch/?from=customer-agent&uc=UC39&vertical=banking&user=alex.morgan");
    expect(screen.getByTestId("handoff-open-also").textContent).toBe("Or open agent-registry-demo");
    expect(screen.getByTestId("handoff-open-also").getAttribute("data-href")).toBe("../agent-registry-demo/?from=customer-agent&uc=UC39&vertical=banking&user=alex.morgan");
    cleanup();
    window.history.replaceState(null, "", "/");
    render(<HandoffCard uc={uc} vertical="banking" userId="alex.morgan" />);
    expect(screen.getByTestId("handoff-open-also-shelf").textContent).toMatch(/Start agent-registry-demo from the Shelf/);
    expect(document.querySelectorAll("a[href]")).toHaveLength(0);
  });

  test("the second app is named everywhere the first one is: reasoning, route tag, and the hand-off summary lists rows sharing either app", () => {
    const uc39 = { id: "UC39", title: "Centralized MCP revocation", route: { route: "Hand off", app: "agent-kill-switch", also: "agent-registry-demo", basis: "owner decision 2026-11-09" } };
    const nhi = { id: "UC-NHI2", title: "Registry", route: { route: "Hand off", app: "agent-registry-demo", basis: "named in lab entry" } };
    const other = { id: "UC2", title: "A2A delegation", route: { route: "Hand off", app: "a2a-lab", basis: "named in lab entry" } };
    expect(HANDOFF_WHY(uc39)[1]).toBe("It can open agent-kill-switch or agent-registry-demo (routing table: owner decision 2026-11-09)");
    expect(HANDOFF_WHY(nhi)[1]).toBe("Its home is agent-registry-demo (routing table: named in lab entry)");
    render(<RouteTag u={uc39} />);
    expect(screen.getByTestId("route-tag").textContent).toBe("Opens agent-kill-switch or agent-registry-demo");
    cleanup();
    const catalog = { tracks: [{ usecases: [uc39, nhi, other] }] };
    render(<HandoffSummary uc={nhi} catalog={catalog} vertical="banking" />);
    const listed = (el) => [...el.querySelectorAll(".evsum__list li .mono")].map((s) => s.textContent);
    expect(listed(screen.getByTestId("handoff-summary"))).toEqual(["UC39", "UC-NHI2"]);
    cleanup();
    render(<HandoffSummary uc={uc39} catalog={catalog} vertical="banking" />);
    expect(screen.getByTestId("handoff-summary").textContent).toMatch(/hands to agent-kill-switch or agent-registry-demo/);
    expect(listed(screen.getByTestId("handoff-summary"))).toEqual(["UC39", "UC-NHI2"]);
  });
});

describe("the llama.cpp brain (Step 2)", () => {
  const UP = { configured: true, available: true, label: "llama.cpp at http://host.docker.internal:8090", reason: null, message: null };
  const picks = () => A.calls.filter((c) => c.method === "POST" && c.path === "/api/brain/pick");
  const useLlama = (routing = "fallback") => window.localStorage.setItem(`cal.qc.${workspaceId()}`, JSON.stringify({ brain: "llama", routing }));
  const typeAndSend = async (u, text) => { await u.type(screen.getByTestId("composer-input"), text); await u.click(screen.getByTestId("composer-send")); };

  test("not configured: the llama.cpp option is offered but disabled, and Scripted stays the brain", async () => {
    await boot();
    const opt = [...screen.getByTestId("brain-select").options].find((o) => o.value === "llama");
    expect(opt.disabled).toBe(true);
    expect(opt.textContent).toBe("llama.cpp · not configured");
    expect(screen.getByTestId("brain-select").value).toBe("scripted");
  });

  test("llama.cpp picks the id, the engine runs it, and the reasoning says which brain chose", async () => {
    useLlama();
    await boot({ brain: UP, pick: () => ({ ok: true, uc: "UC1", ms: 700 }) });
    expect(screen.getByTestId("brain-select").value).toBe("llama");
    const u = userEvent.setup();
    await typeAndSend(u, "how much money do I have");
    await waitFor(() => expect(posts("UC1")).toHaveLength(1));
    expect(picks()[0].body).toEqual({ vertical: "banking", text: "how much money do I have" });
    expect(posts("UC1")[0].body).toEqual({ vertical: "banking", persona: "standard", said: "how much money do I have", brain: "llama" });
    await screen.findByTestId("turn-answer");
    expect(screen.getByTestId("turn-reasoning").textContent).toMatch(/llama\.cpp picked UC1 Delegated access \(consent only\) from this vertical's list/);
  });

  test("model down with Routing = Fallback: the agent says it is unavailable and the Scripted brain answers", async () => {
    useLlama("fallback");
    await boot({ brain: { ...UP, available: false, reason: "unreachable", message: "The local model did not answer. Is llama.cpp running?" }, pick: () => ({ ok: false, reason: "unreachable", message: "The local model did not answer. Is llama.cpp running?" }) });
    const u = userEvent.setup();
    await typeAndSend(u, "show my balance");
    await waitFor(() => expect(posts("UC1")).toHaveLength(1));
    expect(posts("UC1")[0].body.brain).toBe("scripted"); // the brain actually used after the fallback
    await screen.findByTestId("turn-answer");
    expect(screen.getByTestId("turn-reasoning").textContent).toMatch(/llama\.cpp brain unavailable: The local model did not answer\. Is llama\.cpp running\? Used the Scripted brain instead\./);
    expect(screen.getByTestId("turn-reasoning").textContent).toMatch(/Matched your words to UC1/);
  });

  test("model down with Routing = LLM only: it says so and nothing runs", async () => {
    useLlama("llm-only");
    await boot({ brain: UP, pick: () => ({ ok: false, reason: "timeout", message: "The local model took too long to answer." }) });
    const u = userEvent.setup();
    await typeAndSend(u, "show my balance");
    await screen.findByTestId("turn-nomatch");
    expect(screen.getByTestId("turn-brain-note").textContent).toBe("llama.cpp brain unavailable: The local model took too long to answer. Routing is LLM only, so nothing ran.");
    expect(A.calls.filter((c) => c.method === "POST" && c.path.startsWith("/api/run/"))).toHaveLength(0);
  });

  test("an id that is not on this vertical's list never runs, even if the server let it through; hostile text is shown as text", async () => {
    useLlama();
    await boot({ brain: UP, pick: () => ({ ok: true, uc: "UC999" }) });
    const u = userEvent.setup();
    await typeAndSend(u, "<img src=x onerror=alert(1)>");
    await screen.findByTestId("turn-nomatch");
    expect(A.calls.filter((c) => c.method === "POST" && c.path.startsWith("/api/run/"))).toHaveLength(0);
    expect(screen.getAllByTestId("turn-said").pop().textContent).toBe("<img src=x onerror=alert(1)>");
    expect(document.querySelector("img[src='x']")).toBeNull();
  });

  test("the model is checked only once llama.cpp is picked; Reset during a pick drops it and nothing runs", async () => {
    await boot({ brain: UP });
    expect(A.calls.filter((c) => c.path === "/api/brain").map((c) => c.url)).toEqual(["/api/brain"]);
    cleanup(); window.localStorage.clear();
    useLlama();
    let release;
    await boot({ brain: UP, pick: () => new Promise(() => {}) });
    expect(A.calls.some((c) => c.url === "/api/brain?check=1")).toBe(true);
    const fn = A;
    const slow = (url, opts) => (String(url).startsWith("/api/brain/pick") ? new Promise((r) => { release = () => r({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, uc: "UC1" }) }); fn(url, opts); }) : fn(url, opts));
    vi.stubGlobal("fetch", slow);
    const u = userEvent.setup();
    await typeAndSend(u, "how much money do I have");
    await waitFor(() => expect(screen.getByTestId("agent-status").textContent).toBe("Running"));
    await u.click(screen.getByTestId("reset"));
    await waitFor(() => expect(screen.getByTestId("agent-status").textContent).not.toBe("Running"));
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(fn.calls.filter((c) => c.method === "POST" && c.path.startsWith("/api/run/"))).toHaveLength(0);
    expect(screen.queryAllByTestId("turn")).toHaveLength(0);
  });

  test("Quick Config: llama.cpp and Routing are selectable when configured; Routing is locked while the brain is Scripted", async () => {
    await boot({ brain: UP });
    const u = userEvent.setup();
    await u.click(screen.getByTestId("qc-open"));
    expect(screen.getByTestId("qc-routing-llm").disabled).toBe(true);
    expect(screen.getByTestId("qc-brain-state").textContent).toMatch(/answered/);
    await u.click(screen.getByTestId("qc-brain-llama"));
    expect(screen.getByTestId("qc-brain-llama").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("qc-routing-llm").disabled).toBe(false);
    await u.click(screen.getByTestId("qc-routing-llm"));
    expect(JSON.parse(window.localStorage.getItem(`cal.qc.${workspaceId()}`))).toMatchObject({ brain: "llama", routing: "llm-only" });
  });
});

describe("Agent to agent page (owner, 2026-11-09: keep it)", () => {
  test("#page-a2a shows the label, what it is, the outcome and only the delegation hops of the run", () => {
    const hops = ["sign-in", "actor-token", "consent", "a2a-exchange-1", "actor-token", "a2a-exchange-2", "gateway-check", "authorize-decision", "tool-dispatched"]
      .map((kind, i) => ({ ...runBody().run.hops[0], n: i + 1, kind, label: kind }));
    const uc = { id: "UC2", title: "A2A delegation", trigger: { type: "chip", text: "hand off to a specialist" }, linkOut: null };
    render(<ExtraPage opens="a2a" entry={{ uc, run: { ...runBody("UC2").run, hops } }} />);
    const page = screen.getByTestId("extra-a2a");
    expect(within(page).getByRole("heading", { level: 2 }).textContent).toBe("Agent to agent");
    expect(page.textContent).toMatch(/Opened by UC2: A2A delegation/);
    expect(page.textContent).toMatch(/agent-card, delegation and trust hops/);
    expect(page.textContent).toMatch(/PERMIT/);
    expect(page.textContent).toMatch(/Hops for this page \(2\)/);
    expect(page.textContent).toMatch(/a2a-exchange-1/);
    expect(page.textContent).toMatch(/a2a-exchange-2/);
    expect(page.textContent).not.toMatch(/gateway-check/);
  });
});

describe("evidence views, Quick Config and the full-page diagrams", () => {
  test("the evidence column defaults to Sequence; the Tokens tab shows the run's MOCK tokens raw and labelled", async () => {
    await boot();
    const u = userEvent.setup();
    expect(screen.getAllByTestId(/^evtab-/).map((b) => b.textContent)).toEqual(["Sequence", "Movie reel", "Topology", "Tokens"]);
    await u.click(screen.getByTestId("wtt-UC1"));
    await screen.findByTestId("turn-answer");
    expect(screen.getByTestId("sequence-view")).toBeTruthy();
    await u.click(screen.getByTestId("evtab-tokens"));
    const tok = screen.getByTestId("evidence-tokens");
    expect(tok.textContent).toMatch(/MOCK token/);
    expect(within(tok).getByTestId("token-raw").textContent).toBe(RAW);
    await u.click(screen.getByTestId("evtab-reel"));
    expect(screen.getByTestId("movie-reel")).toBeTruthy();
  });

  test("Quick Config: Mock | Real (409 with the reason), brain Scripted only, one diagram embedded at a time, text size, presenter; saved per workspace", async () => {
    const view = await boot();
    const u = userEvent.setup();
    await u.click(screen.getByTestId("qc-open"));
    expect(screen.getByTestId("qc-open").getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByTestId("evidence-column")).toBeNull();
    expect(screen.getByTestId("qc-brain-scripted").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("qc-brain-llama").disabled).toBe(true);
    await u.click(screen.getByTestId("qc-mode-real"));
    expect((await screen.findByTestId("mode-msg")).textContent).toMatch(/Real was refused \(HTTP 409\).*CAL_ALLOW_LIVE=1/);
    expect(screen.getByTestId("qc-mode-mock").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("qc-sequence-embedded").getAttribute("aria-pressed")).toBe("true");
    await u.click(screen.getByTestId("qc-reel-embedded"));
    expect(screen.getByTestId("qc-reel-embedded").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("qc-sequence-off").getAttribute("aria-pressed")).toBe("true");
    await u.click(screen.getByTestId("qc-tokens-off"));
    await u.click(screen.getByTestId("qc-text-up"));
    expect(document.querySelector(".app").getAttribute("data-text")).toBe("115");
    await u.click(screen.getByTestId("qc-presenter-on"));
    expect(screen.getByTestId("presenter").getAttribute("aria-pressed")).toBe("true");
    await u.click(screen.getByTestId("qc-presenter-off"));
    const saved = JSON.parse(window.localStorage.getItem(`cal.qc.${workspaceId()}`));
    expect(saved).toMatchObject({ views: { sequence: "off", reel: "embedded", topology: "off", tokens: "off" }, tab: "reel", text: 115 });
    await u.click(screen.getByTestId("qc-close"));
    expect(screen.getAllByTestId(/^evtab-/).map((b) => b.textContent)).toEqual(["Sequence", "Movie reel", "Topology"]);
    expect(screen.getByTestId("evtab-reel").getAttribute("aria-pressed")).toBe("true");
    view.unmount();
    await boot();
    expect(screen.getByTestId("evtab-reel").getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector(".app").getAttribute("data-text")).toBe("115");
  });

  test("a tab click on a diagram embeds it (the same one-at-a-time rule), and a broken or blocked store falls back to the defaults", async () => {
    window.localStorage.setItem(`cal.qc.${workspaceId()}`, "{not json");
    await boot();
    expect(screen.getByTestId("evtab-sequence").getAttribute("aria-pressed")).toBe("true");
    const u = userEvent.setup();
    await u.click(screen.getByTestId("evtab-topology"));
    expect(JSON.parse(window.localStorage.getItem(`cal.qc.${workspaceId()}`)).views).toEqual({ sequence: "off", reel: "off", topology: "embedded", tokens: "embedded" });
    cleanup();
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    await boot();
    expect(screen.getByTestId("evtab-sequence").getAttribute("aria-pressed")).toBe("true");
  });

  test("#sequence is a full page: no chat, a Back to chat button, a slim list of runnable use cases, the big diagram and the step detail below", async () => {
    window.location.hash = "#sequence";
    A = api(); vi.stubGlobal("fetch", A);
    render(<App />);
    await screen.findByTestId("uc-UC1");
    const u = userEvent.setup();
    await screen.findByTestId("page-sequence");
    expect(screen.queryByTestId("agent-column")).toBeNull();
    expect(screen.getByTestId("nav-agent").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("full-empty")).toBeTruthy();
    await u.type(screen.getByTestId("search"), "inspector");
    expect(screen.queryByTestId("uc-UC-LEARN2")).toBeNull(); // guided: no diagram here
    await u.clear(screen.getByTestId("search"));
    await u.click(screen.getByTestId("uc-UC1"));
    await screen.findByTestId("sequence-view");
    expect(posts("UC1")).toHaveLength(1);
    expect(screen.getByTestId("full-outcome").textContent).toBe("PERMIT");
    fireEvent.click(screen.getByTestId("row-2"));
    expect(screen.getByTestId("step-detail")).toBeTruthy();
    await u.click(screen.getByTestId("full-tab-reel"));
    expect(window.location.hash).toBe("#reel");
    expect(screen.getByTestId("movie-reel")).toBeTruthy();
    await u.click(screen.getByTestId("back-to-chat"));
    expect(window.location.hash).toBe("#agent");
    expect(screen.getByTestId("agent-column")).toBeTruthy();
  });
});

describe("quickConfig rules", () => {
  test("embedding a diagram moves the embedded one to Off; Tokens embed alongside; a stored value out of range is ignored", () => {
    let c = cleanConfig(null);
    expect(c).toEqual({ ...DEFAULTS, views: { ...DEFAULTS.views } });
    c = setView(c, "topology", "embedded");
    expect(c.views).toEqual({ sequence: "off", reel: "off", topology: "embedded", tokens: "embedded" });
    expect(c.tab).toBe("topology");
    c = setView(c, "topology", "off");
    expect(c.tab).toBe("tokens");
    c = chooseTab(c, "reel");
    expect(c.views.reel).toBe("embedded");
    expect(cleanConfig({ views: { sequence: "embedded", reel: "embedded", tokens: "popout", __proto__: { x: 1 } }, tab: "evil", text: 999, presenter: "yes" }))
      .toEqual({ ...DEFAULTS, views: { sequence: "embedded", reel: "off", topology: "off", tokens: "embedded" } });
  });
});

describe("resume after a hand-off", () => {
  test("Back from a2a-lab restores the chat (words and outcomes, not the run), adds a note, selects the use case and cleans the address bar", async () => {
    await boot();
    const u = userEvent.setup();
    await u.click(screen.getByTestId("wtt-UC1"));
    await within(await screen.findByTestId("turn")).findByTestId("turn-answer");
    await u.click(within(screen.getByTestId("wtt-away")).getByTestId("wtt-UC2"));
    await waitFor(() => expect(screen.getAllByTestId("turn")).toHaveLength(2));
    const stored = window.sessionStorage.getItem(`cal.resume.${workspaceId()}`);
    expect(stored).not.toMatch(/eyJ|"hops"|"tokens"|"raw"/);
    expect(JSON.parse(stored).turns.map((t) => [t.ucId, t.status, t.outcome])).toEqual([["UC1", "done", "PERMIT"], ["UC2", "handoff", undefined]]);
    cleanup(); // the tab goes to the other app ...
    window.history.replaceState(null, "", "/?returned=a2a-lab&uc=UC2"); // ... and comes Back
    await boot();
    const turns = screen.getAllByTestId("turn");
    expect(turns).toHaveLength(2);
    expect(within(turns[0]).getByTestId("turn-said").textContent).toBe("show my balance");
    expect(within(turns[0]).getByTestId("turn-restored").textContent).toMatch(/From before you left: PERMIT\. The evidence is not kept: run it again to see it\./);
    expect(within(turns[0]).queryByTestId("turn-tokens")).toBeNull();
    expect(within(turns[1]).getByTestId("handoff-card")).toBeTruthy();
    expect(screen.getByTestId("turn-note").textContent).toBe("Back from a2a-lab (UC2)");
    expect(window.location.search).toBe("");
    expect(screen.getByTestId("uc-UC2").getAttribute("aria-pressed")).toBe("true");
    expect(A.calls.filter((c) => c.method === "POST" && c.path.startsWith("/api/run/"))).toHaveLength(0); // nothing re-ran by itself
  });

  test("an unknown returned app adds no note; Reset clears the stored chat", async () => {
    window.history.replaceState(null, "", "/?returned=evil-app&uc=UC1");
    await boot();
    expect(screen.queryByTestId("turn-note")).toBeNull();
    expect(window.location.search).toBe("");
    const u = userEvent.setup();
    await u.click(screen.getByTestId("wtt-UC1"));
    await screen.findByTestId("turn-answer");
    await u.click(screen.getByTestId("reset"));
    await waitFor(() => expect(JSON.parse(window.sessionStorage.getItem(`cal.resume.${workspaceId()}`)).turns).toEqual([]));
  });
});
