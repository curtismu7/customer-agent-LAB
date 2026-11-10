// Full Real in the page (owner, 2026-11-10): the standard Sign in modal (pi.flow only, no redirect, the username filled in, the password typed),
// REAL / MOCK / NOT RUN labels per hop, and the replies the real servers' answers map to.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { forgetWorkspace } from "./workspace";
import { FULL_INFO, INFO, denyBody, mockApi, mockInRealBody, realBody } from "./testFixtures";

const PASSWORD = ["typed", "-by-", "the-", "person-", "7"].join("");
let api;
const boot = async (state = {}) => {
  api = mockApi({ live: "allowed", full: true, password: PASSWORD, info: { ...INFO, ...FULL_INFO }, ...state });
  vi.stubGlobal("fetch", api);
  render(<App />);
  await screen.findByTestId("uc-UC1");
  const u = userEvent.setup();
  await u.click(screen.getByTestId("mode-live"));
  await waitFor(() => expect(screen.getByTestId("mode").textContent).toMatch(/Mode: live \(real: sign-in, token exchange, Agent Gateway\)/));
  return u;
};
const runIt = async (u) => { await u.click(screen.getByTestId("run")); await screen.findByTestId(/^(result|refusal)$/); };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); forgetWorkspace(); try { window.localStorage.clear(); window.sessionStorage.clear(); } catch { /* ignore */ } });

describe("the Sign in modal (pi.flow only)", () => {
  test("Real shows Sign in; the modal is the standard dialog with the username filled in and read-only and a password field; it posts the password to the lab server only", async () => {
    const u = await boot();
    const href = window.location.href;
    await u.click(screen.getByTestId("signin-open"));
    const dlg = await screen.findByTestId("signin-dialog");
    expect(dlg.getAttribute("role")).toBe("dialog");
    expect(within(dlg).getByTestId("fd-titlebar").textContent).toMatch(/Sign in/);
    const user = within(dlg).getByTestId("signin-username");
    expect(user.value).toBe("lab-demo-user"); expect(user.readOnly).toBe(true);
    const pw = within(dlg).getByTestId("signin-password");
    expect(pw.getAttribute("type")).toBe("password");
    expect(within(dlg).getByTestId("signin-method").textContent).toMatch(/pi\.flow.*No redirect/);
    expect(within(dlg).queryByRole("link")).toBeNull();
    await u.type(pw, PASSWORD);
    await u.click(within(dlg).getByTestId("signin-submit"));
    await waitFor(() => expect(screen.queryByTestId("signin-dialog")).toBeNull());
    expect(screen.getByTestId("signed-in-user").textContent).toMatch(/Signed in: lab-demo-user/);
    const posts = api.calls.filter((c) => c.path === "/api/signin" && c.method === "POST");
    expect(posts).toHaveLength(1); expect(posts[0].body).toEqual({ password: PASSWORD });
    expect(api.calls.every((c) => c.url.startsWith("/api/")), "every call goes to this lab's own server: no redirect, no other origin").toBe(true);
    expect(window.location.href).toBe(href);
    expect(document.body.innerHTML.includes(PASSWORD)).toBe(false);
  });

  test("a wrong password shows PingOne's refusal in the dialog and clears the field; the password is never shown back", async () => {
    const u = await boot();
    await u.click(screen.getByTestId("signin-open"));
    const pw = await screen.findByTestId("signin-password");
    await u.type(pw, "wrong-one-123");
    await u.click(screen.getByTestId("signin-submit"));
    const err = await screen.findByTestId("signin-error");
    expect(err.textContent).toMatch(/did not accept the username or password.*HTTP 401/);
    expect(screen.getByTestId("signin-password").value).toBe("");
    expect(document.body.innerHTML.includes("wrong-one-123")).toBe(false);
  });

  test("a Real run before sign-in opens the dialog, and the run goes again once signed in; Sign out works", async () => {
    const u = await boot();
    await u.click(screen.getByTestId("uc-UC1"));
    await runIt(u);
    await screen.findByTestId("signin-dialog");
    await u.type(screen.getByTestId("signin-password"), PASSWORD);
    await u.click(screen.getByTestId("signin-submit"));
    await waitFor(() => expect(screen.getByTestId("outcome").textContent).toBe("REAL_PERMIT"));
    expect(api.calls.filter((c) => c.path === "/api/run/UC1")).toHaveLength(2);
    await u.click(screen.getByTestId("signout"));
    await screen.findByTestId("signin-open");
  });
});

describe("REAL / MOCK labels and the replies", () => {
  test("a Real run: every hop REAL in the hop list and in Where each hop ran; real tokens raw; the reply is the tool result in the Agent's voice", async () => {
    const u = await boot({ signedIn: true });
    await u.click(screen.getByTestId("uc-UC1"));
    await runIt(u);
    const hops = screen.getByTestId("hops");
    expect(within(hops).getAllByTestId("real-tag")).toHaveLength(8);
    expect(within(hops).queryByTestId("mock-tag")).toBeNull();
    const src = screen.getByTestId("hop-sources");
    expect(within(src).getAllByTestId("hop-source").map((x) => x.getAttribute("data-source"))).toEqual(Array(8).fill("real"));
    expect(within(src).getAllByTestId("hop-source").map((x) => x.textContent)).toEqual(["Sign-in", "Agent token", "Token exchange", "Agent Gateway", "Authorize decision", "MCP tool", "API", "Agent reply"].map((t, i) => `${i + 1} ${t} REAL`));
    expect(screen.getByTestId("real-note-tag").textContent).toMatch(/Real: sign-in, token exchange, Agent Gateway/);
    expect(screen.getAllByTestId("token-raw")[0].textContent).toBe(realBody().run.tokens[0].raw);
    const turn = screen.getAllByTestId("turn").pop();
    expect(within(turn).getByTestId("turn-who").textContent).toBe("Agent");
    expect(within(turn).getByTestId("turn-answer-text").textContent).toMatch(/balance 1200\.5/);
    expect(screen.getByTestId("evidence-count").textContent).toMatch(/REAL/);
  });

  test("a 403 from the gateway is an Authorize DENY reply; the hops after it say NOT RUN, never REAL", async () => {
    const u = await boot({ signedIn: true, realAnswer: (id) => denyBody(id) });
    await u.click(screen.getByTestId("uc-UC1"));
    await runIt(u);
    const turn = screen.getAllByTestId("turn").pop();
    expect(within(turn).getByTestId("turn-who").textContent).toBe("Authorize");
    expect(within(turn).getByTestId("turn-answer-text").textContent).toMatch(/^Authorize denied this request \(HTTP 403/);
    expect(within(turn).getByTestId("turn-outcome").textContent).toBe("REAL_DENY");
    const srcs = within(screen.getByTestId("hop-sources")).getAllByTestId("hop-source").map((x) => x.getAttribute("data-source"));
    expect(srcs).toEqual(["real", "real", "real", "real", "real", "not-run", "not-run", "not-run"]);
  });

  test("a held call (428) is an approval card that says the hold is real and the approval simulated", async () => {
    const u = await boot({ signedIn: true, realAnswer: (id) => realBody(id, { stopAt: 5, outcome: "REAL_HOLD", reply: { who: "Authorize", approval: { head: "Held for approval (REAL)", body: "The hold is real; in this lab the approval is simulated." } } }) });
    await u.click(screen.getByTestId("uc-UC1"));
    await runIt(u);
    const card = screen.getByTestId("turn-approval");
    expect(card.textContent).toMatch(/REAL_HOLD.*Held for approval \(REAL\).*approval is simulated/);
  });

  test("a use case that stays Mock in Real mode says MOCK on every hop and why", async () => {
    const u = await boot({ signedIn: true, realAnswer: (id) => mockInRealBody(id) });
    await u.click(screen.getByTestId("uc-UC1"));
    await runIt(u);
    expect(screen.getByTestId("hop-sources-why").textContent).toMatch(/runs Mock: agent-to-agent/);
    expect(within(screen.getByTestId("hop-sources")).getAllByTestId("hop-source").every((x) => x.getAttribute("data-source") === "mock")).toBe(true);
    expect(screen.getByTestId("mock-in-real").textContent).toMatch(/runs Mock/);
    expect(within(screen.getByTestId("hops")).queryByTestId("real-tag")).toBeNull();
  });
});
