import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PwaUpdatePrompt } from "@/components/pwa-update-prompt";

const sw = vi.hoisted(() => ({
  offlineReady: false,
  needRefresh: false,
  update: vi.fn<() => Promise<void>>(),
  register: vi.fn(),
  onRegistered: undefined as ((url: string, registration: ServiceWorkerRegistration | undefined) => void) | undefined,
}));

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: (options: { onRegisteredSW: typeof sw.onRegistered }) => {
    sw.register();
    sw.onRegistered = options.onRegisteredSW;
    return {
      offlineReady: useState(sw.offlineReady),
      needRefresh: useState(sw.needRefresh),
      updateServiceWorker: sw.update,
    };
  },
}));

beforeEach(() => {
  vi.stubEnv("PROD", true);
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("navigator", { serviceWorker: {} });
  sw.offlineReady = false;
  sw.needRefresh = false;
  sw.register.mockClear();
  sw.onRegistered = undefined;
  sw.update.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("PWA updates", () => {
  it("checks for updates when the page resumes and reminds about a waiting version", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const registration = { update, waiting: {} } as unknown as ServiceWorkerRegistration;
    const view = render(<PwaUpdatePrompt />);
    act(() => sw.onRegistered?.("/sw.js", registration));
    fireEvent(document, new Event("visibilitychange"));
    expect(update).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("有新版本");
    fireEvent.click(screen.getByRole("button", { name: "稍后" }));
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    fireEvent(window, new Event("pageshow"));
    expect(screen.getByRole("status")).toHaveTextContent("有新版本");
    view.unmount();
    await act(async () => {});
    fireEvent(window, new Event("online"));
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("throttles checks across resume and online events for one minute", async () => {
    let now = 1_000_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    const update = vi.fn().mockResolvedValue(undefined);
    const view = render(<PwaUpdatePrompt />);
    act(() => sw.onRegistered?.("/sw.js", { update } as unknown as ServiceWorkerRegistration));
    fireEvent(document, new Event("visibilitychange"));
    await act(async () => {});
    now += 59_999;
    fireEvent(window, new Event("online"));
    fireEvent(window, new Event("pageshow"));
    expect(update).toHaveBeenCalledTimes(1);
    now += 1;
    fireEvent(window, new Event("online"));
    expect(update).toHaveBeenCalledTimes(2);
    view.unmount();
    clock.mockRestore();
  });

  it("does not check for updates while the page is hidden", () => {
    const update = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    render(<PwaUpdatePrompt />);
    act(() => sw.onRegistered?.("/sw.js", { update } as unknown as ServiceWorkerRegistration));
    fireEvent(document, new Event("visibilitychange"));
    expect(update).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
  it("waits for the user before applying a new version", () => {
    sw.needRefresh = true;
    render(<PwaUpdatePrompt />);
    expect(screen.getByRole("status")).toHaveTextContent("当前任务结束后");
    expect(sw.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "刷新更新" }));
    expect(sw.update).toHaveBeenCalledWith(true);
  });

  it("allows postponing an update without reloading", () => {
    sw.needRefresh = true;
    render(<PwaUpdatePrompt />);
    fireEvent.click(screen.getByRole("button", { name: "稍后" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(sw.update).not.toHaveBeenCalled();
  });

  it("explains that offline caching still requires network for messages", () => {
    sw.offlineReady = true;
    render(<PwaUpdatePrompt />);
    expect(screen.getByRole("status")).toHaveTextContent("发送消息仍需网络连接");
    expect(screen.queryByRole("button", { name: "刷新更新" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "知道了" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("allows retrying an update after failure", async () => {
    sw.needRefresh = true;
    sw.update.mockRejectedValueOnce(new Error("offline"));
    render(<PwaUpdatePrompt />);
    fireEvent.click(screen.getByRole("button", { name: "刷新更新" }));
    expect(await screen.findByText("更新失败，请稍后重试。")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "刷新更新" }));
    expect(sw.update).toHaveBeenCalledTimes(2);
  });

  it.each(["development", "insecure", "unsupported"])(
    "does not register a worker in %s environments",
    (environment) => {
      if (environment === "development") vi.stubEnv("PROD", false);
      if (environment === "insecure") vi.stubGlobal("isSecureContext", false);
      if (environment === "unsupported") vi.stubGlobal("navigator", {});
      render(<PwaUpdatePrompt />);
      expect(sw.register).not.toHaveBeenCalled();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    },
  );
});
