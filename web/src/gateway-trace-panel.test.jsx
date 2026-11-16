// "What Privilege did" (Rule 25) in the lab's page: the shared panel under the Run result, in Mock and in Real, drawn from the run's `gatewayTrace`.
// The vendored component's own test is gateway-trace/gateway-trace.test.jsx; this one proves the lab wires it in.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { forgetWorkspace } from "./workspace";
import { setJsonView } from "./components/JsonPane";
import { FULL_INFO, INFO, guidedBody, mockApi, realBody, runBody } from "./testFixtures";

const req = (body, headers = {}) => ({ method: "POST", url: "https://gateway.example.invalid/mcp", headers, body });
const mockTrace = {
  source: "mock",
  request: req({ jsonrpc: "2.0", method: "tools/call", params: { name: "get_account_balance" } }, { authorization: "Bearer mock.token.value", traceparent: "00-aa-bb-01" }),
  response: { status: 200, headers: {}, body: { forwarded: true } },
  decisions: [
    { id: "signature-0", label: "Signature", outcome: "pass", basis: "checked", evidence: "mock key" },
    { id: "scope-1", label: "Scope", outcome: "fail", basis: "checked", evidence: "the token does not carry tools:get_account_balance (stopped here)" },
  ],
  record: null,
};
const realTrace = {
  source: "real",
  request: req({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, { authorization: "Bearer <token, 10 characters, kept on the server>" }),
  response: { status: 200, headers: {}, body: { jsonrpc: "2.0", id: 2, result: { tools: [{ name: "get_account_balance" }] } } },
  decisions: [{ id: "authenticated", label: "Authentication", outcome: "pass", basis: "inferred", evidence: "HTTP 200" }],
  record: null,
};

let api;
const answer = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
const runIt = async (u) => { await u.click(screen.getByTestId("run")); await screen.findByTestId(/^(result|refusal)$/); };
beforeEach(() => { setJsonView("raw"); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); forgetWorkspace(); try { window.localStorage.clear(); window.sessionStorage.clear(); } catch { /* ignore */ } });

describe("What Privilege did under the Run result", () => {
  test("Mock: a run with gateway calls shows the panel, one exchange per call, the simulated-gateway wording and the checked decisions", async () => {
    api = mockApi({ runAnswer: (id) => answer(runBody(id, { gatewayTrace: [{ step: 1, title: "Gateway check", status: 200, trace: mockTrace }] })) });
    vi.stubGlobal("fetch", api);
    render(<App />);
    await screen.findByTestId("uc-UC1");
    const u = userEvent.setup();
    expect(screen.queryByTestId("gateway-trace")).toBeNull();
    await u.click(screen.getByTestId("uc-UC1"));
    await runIt(u);
    const panel = await screen.findByTestId("gateway-trace");
    expect(within(screen.getByTestId("result")).getByTestId("gateway-trace")).toBe(panel);
    expect(screen.getByTestId("gateway-trace-basis").textContent).toMatch(/^Simulated: the lab's in-process gateway/);
    const ex = within(panel).getByTestId("trace-1");
    expect(within(ex).getByTestId("trace-1-decisions").textContent).toMatch(/Signature.*Scope.*stopped here/);
    expect(within(ex).getByTestId("trace-1-request-body").textContent).toMatch(/tools\/call/);
    expect(within(ex).getByTestId("trace-1-response-body").textContent).toMatch(/forwarded/);
  });

  test("a run with no gateway call (guided) shows no panel", async () => {
    api = mockApi({ runAnswer: (id) => answer(guidedBody(id)) });
    vi.stubGlobal("fetch", api);
    render(<App />);
    await screen.findByTestId("uc-UC1");
    const u = userEvent.setup();
    await u.click(screen.getByTestId("uc-UC1"));
    await runIt(u);
    expect(screen.queryByTestId("gateway-trace")).toBeNull();
  });

  test("Real: the panel says it is the real gateway and marks decisions as read from the outcome, never as checked", async () => {
    api = mockApi({ live: "allowed", full: true, signedIn: true, info: { ...INFO, ...FULL_INFO }, realAnswer: (id) => { const b = realBody(id); b.run.gatewayTrace = [{ step: 1, title: "tools/list", status: 200, trace: realTrace }]; return b; } });
    vi.stubGlobal("fetch", api);
    render(<App />);
    await screen.findByTestId("uc-UC1");
    const u = userEvent.setup();
    await u.selectOptions(screen.getByTestId("mode-select"), "real");
    await waitFor(() => expect(screen.getByTestId("mode").textContent).toMatch(/Mode: live \(real/));
    await u.click(screen.getByTestId("uc-UC1"));
    await runIt(u);
    const panel = await screen.findByTestId("gateway-trace");
    expect(screen.getByTestId("gateway-trace-basis").textContent).toMatch(/^Real gateway\./);
    expect(panel.textContent).toMatch(/inferred from the outcome/);
    expect(panel.textContent).not.toMatch(/computed by|checked/i);
    expect(within(panel).getByTestId("trace-1-response-body").textContent).toMatch(/get_account_balance/);
  });
});
