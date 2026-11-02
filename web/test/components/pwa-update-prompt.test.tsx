import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PwaUpdatePrompt } from "@/components/pwa-update-prompt";

const sw = vi.hoisted(() => ({
  offlineReady: false,
  needRefresh: false,
  update: vi.fn<() => Promise<void>>(),
  register: vi.fn(),
}));

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => {
    sw.register();
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
  sw.update.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("PWA updates", () => {
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
