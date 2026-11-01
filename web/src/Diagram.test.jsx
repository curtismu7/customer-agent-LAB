import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DiagramView from "./components/DiagramView";
import PatternDiagram, { edgeSides, labelOffsets } from "./components/PatternDiagram";
import { DIAGRAM, mockApi, runBody } from "./testFixtures";
import { forgetWorkspace } from "./workspace";

let api;
beforeEach(() => { window.sessionStorage.clear(); forgetWorkspace(); api = mockApi(); vi.stubGlobal("fetch", api); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("the diagram is data loaded by name (rule 17)", () => {
  test("DiagramView asks the server for the diagram by name and vertical, and offers every name the server lists", async () => {
    render(<DiagramView vertical="healthcare" resetSignal={0} lastRun={null} />);
    await screen.findByTestId("diagram-canvas");
    const call = api.calls.find((c) => c.path === "/api/diagram");
    expect(call.query.get("name")).toBe("delegation-chain");
    expect(call.query.get("vertical")).toBe("healthcare");
    expect(screen.getByTestId("dg-delegation-chain")).toBeTruthy();
    expect(screen.getByTestId("dg-gateway-refusals")).toBeTruthy();
    await userEvent.setup().click(screen.getByTestId("dg-gateway-refusals"));
    await waitFor(() => expect(api.calls.filter((c) => c.path === "/api/diagram").at(-1).query.get("name")).toBe("gateway-refusals"));
  });

  test("one box per node, with the label from the data; the title and intro come from the data (the arrows need layout, so the real-browser run checks those)", async () => {
    render(<PatternDiagram diagram={DIAGRAM.diagram} />);
    expect(screen.getByText(DIAGRAM.diagram.title)).toBeTruthy();
    expect(screen.getByText(DIAGRAM.diagram.intro)).toBeTruthy();
    await waitFor(() => expect(document.querySelectorAll(".react-flow__node")).toHaveLength(DIAGRAM.diagram.nodes.length));
    expect([...document.querySelectorAll(".react-flow__node")].map((n) => n.textContent)).toEqual(["Browser", "Identity provider", "Agent gateway"]);
    expect([...document.querySelectorAll(".dnode")].map((n) => n.getAttribute("data-color"))).toEqual(["blue", "red", "dark"]);
  });

  test("a load failure is shown, not hidden", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }));
    render(<DiagramView vertical="banking" resetSignal={0} lastRun={null} />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/Could not load the diagram \(HTTP 500\)/);
  });
});

describe("Simulate, speed, Reset", () => {
  test("Simulate walks the steps in order at the chosen speed and shows the matching hop of your last run", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<PatternDiagram diagram={DIAGRAM.diagram} lastRun={runBody("UC1")} />);
    fireEvent.change(screen.getByTestId("speed"), { target: { value: "800" } });
    fireEvent.click(screen.getByTestId("simulate"));
    expect(screen.getByTestId("diagram-now").textContent).toMatch(/Step 1: Mock sign-in/);
    expect(screen.getByTestId("diagram-hop").textContent).toMatch(/In your last run \(UC1\): hop 1/);
    await act(async () => { vi.advanceTimersByTime(850); });
    expect(screen.getByTestId("diagram-now").textContent).toMatch(/Step 2: Consent/);
    await act(async () => { vi.advanceTimersByTime(850); });
    expect(screen.getByTestId("diagram-now").textContent).toMatch(/Step 3: Gateway check/);
    expect(screen.queryByTestId("diagram-hop")).toBeNull(); // the last run had no gateway-check hop
  });

  test("the speed control offers five step times and is locked while it plays", async () => {
    render(<PatternDiagram diagram={DIAGRAM.diagram} />);
    expect(screen.getByTestId("speed").querySelectorAll("option")).toHaveLength(5);
    fireEvent.click(screen.getByTestId("simulate"));
    expect(screen.getByTestId("speed").disabled).toBe(true);
    fireEvent.click(screen.getByText("Pause"));
    expect(screen.getByTestId("speed").disabled).toBe(false);
  });

  test("Reset stops the walkthrough and Moved goes back to 0", async () => {
    render(<PatternDiagram diagram={DIAGRAM.diagram} />);
    fireEvent.click(screen.getByTestId("simulate"));
    expect(screen.getByTestId("diagram-now")).toBeTruthy();
    fireEvent.click(screen.getByTestId("diagram-reset"));
    expect(screen.queryByTestId("diagram-now")).toBeNull();
    expect(screen.getByTestId("diagram-moved").textContent).toMatch(/Moved: 0 box/);
  });

  test("the page-level Reset (resetSignal) also resets the walkthrough", () => {
    const { rerender } = render(<PatternDiagram diagram={DIAGRAM.diagram} resetSignal={0} />);
    fireEvent.click(screen.getByTestId("simulate"));
    expect(screen.getByTestId("diagram-now")).toBeTruthy();
    rerender(<PatternDiagram diagram={DIAGRAM.diagram} resetSignal={1} />);
    expect(screen.queryByTestId("diagram-now")).toBeNull();
  });
});

describe("label and arrow placement (no overlap)", () => {
  const steps = DIAGRAM.diagram.steps;
  test("steps along the same pair of boxes get different label offsets; a lone step stays in the middle", () => {
    const offs = labelOffsets(steps);
    expect(offs[0]).not.toBe(offs[1]);
    expect(offs[0] + offs[1]).toBe(0);
    expect(offs[2]).toBe(0);
  });
  test("opposite directions on one pair are spread too", () => {
    const o = labelOffsets([{ from: "a", to: "b" }, { from: "b", to: "a" }, { from: "a", to: "b" }]);
    expect(new Set(o).size).toBe(3);
  });
  test("the second arrow along a pair leaves from another side so the two are not drawn on top of each other", () => {
    const pos = Object.fromEntries(DIAGRAM.diagram.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    const first = edgeSides(steps, 0, pos), second = edgeSides(steps, 1, pos);
    expect(first).not.toEqual(second);
    expect(first).toEqual(["b", "t"]);
  });
});
