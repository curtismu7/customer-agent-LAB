import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import SignInDialog from "./SignInDialog.jsx";

test("the dialog fits its content, opens near the top, and keeps Sign in in the footer outside the scrolling body (owner 2026-11-14)", () => {
  render(<SignInDialog isOpen username="lab-demo-user" onClose={() => {}} />);
  const dlg = screen.getByTestId("signin-dialog");
  const style = dlg.getAttribute("style") || "";
  // Fit to content (not a fixed height that hid the Password field), and opened at the top: a fit-to-content dialog otherwise opens with
  // its top at the middle of the window and the error line pushes the button off the bottom.
  expect(style).toContain("--fd-h: auto");
  expect(style).toContain("--fd-y: 16px");
  const submit = screen.getByTestId("signin-submit");
  expect(dlg.querySelector(".fd-footer").contains(submit)).toBe(true);
  expect(dlg.querySelector(".fd-body").contains(submit)).toBe(false);
  expect(dlg.querySelector(".fd-footer").contains(screen.getByTestId("signin-cancel"))).toBe(true);
  expect(submit.getAttribute("form")).toBe(screen.getByTestId("signin-form").id);
});
