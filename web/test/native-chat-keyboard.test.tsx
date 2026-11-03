import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChatKeyboardAvoidingView } from "../../mobile/src/views/chat/chat-keyboard-avoiding-view";

const capture = vi.hoisted(() => ({ avoidingView: vi.fn() }));

vi.mock("react-native-keyboard-controller", () => ({
  KeyboardProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  KeyboardAvoidingView: ({ children, ...props }: { children: ReactNode }) => {
    capture.avoidingView(props);
    return <>{children}</>;
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("measures the Android chat in window coordinates inside the route safe area", () => {
  render(<ChatKeyboardAvoidingView><div>聊天输入区</div></ChatKeyboardAvoidingView>);

  expect(screen.getByText("聊天输入区")).toBeTruthy();
  // Parent-relative onLayout coordinates omit the route's safe-area top inset.
  // Let the native controller measure it, keeping the offset purely additive.
  expect(capture.avoidingView).toHaveBeenLastCalledWith(expect.objectContaining({
    automaticOffset: true,
    behavior: "padding",
    keyboardVerticalOffset: 8,
  }));
});
