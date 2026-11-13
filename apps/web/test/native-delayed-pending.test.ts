import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDelayedPending } from "../../mobile/src/lib/use-delayed-pending";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("keeps quick requests quiet and shows an indicator after 400ms", () => {
  const { result } = renderHook(() => useDelayedPending(true));
  expect(result.current).toBe(false);
  act(() => vi.advanceTimersByTime(399));
  expect(result.current).toBe(false);
  act(() => vi.advanceTimersByTime(1));
  expect(result.current).toBe(true);
});

it("cancels a completed wait and starts a fresh delay for the next request", () => {
  const { result, rerender } = renderHook((pending) => useDelayedPending(pending), { initialProps: true });
  act(() => vi.advanceTimersByTime(200));
  rerender(false);
  act(() => vi.advanceTimersByTime(400));
  expect(result.current).toBe(false);
  rerender(true);
  act(() => vi.advanceTimersByTime(399));
  expect(result.current).toBe(false);
  act(() => vi.advanceTimersByTime(1));
  expect(result.current).toBe(true);
  rerender(false);
  expect(result.current).toBe(false);
});

it("clears its timer when the page unmounts", () => {
  const { unmount } = renderHook(() => useDelayedPending(true));
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
