import { beforeEach, describe, expect, test } from "vitest";
import { forgetWorkspace, workspaceId } from "./workspace";

describe("workspace id", () => {
  beforeEach(() => { window.sessionStorage.clear(); forgetWorkspace(); });
  test("w- plus 16 hex digits whose first digit is a letter, so it is never 16 digits (a Luhn pass could look like a card number to the server)", () => {
    const seen = new Set();
    for (let i = 0; i < 500; i += 1) {
      window.sessionStorage.clear(); forgetWorkspace();
      const id = workspaceId();
      expect(id).toMatch(/^w-[a-f][0-9a-f]{15}$/);
      seen.add(id);
    }
    expect(seen.size).toBe(500);
  });
  test("the id is kept for the tab", () => {
    const a = workspaceId(); forgetWorkspace();
    expect(workspaceId()).toBe(a);
  });
});
