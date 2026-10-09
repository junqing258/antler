import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KnowledgeConfigurationLink } from "./knowledge-configuration-link";
import { openUrl } from "@tauri-apps/plugin-opener";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));
const getServerInfo = async () => ({
  baseUrl: "http://127.0.0.1:3210",
  token: "test-token",
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

describe("knowledge configuration link", () => {
  it("opens the backend-configured URL in a new tab without local knowledge UI", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({ ragUrl: "https://rag.example.com/" }),
      });
    vi.stubGlobal("fetch", fetchMock);
    render(<KnowledgeConfigurationLink getServerInfo={getServerInfo} />);
    const link = await screen.findByRole("link", { name: "知识库配置" });
    expect(link).toHaveAttribute("href", "https://rag.example.com/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3210/api/config",
      expect.objectContaining({ headers: { "x-antler-token": "test-token" } }),
    );
    expect(screen.queryByText("新建")).not.toBeInTheDocument();
  });

  it("explains how to configure a missing RAG URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ ragUrl: null }) }),
    );
    render(<KnowledgeConfigurationLink getServerInfo={getServerInfo} />);
    const button = screen.getByRole("button", { name: "知识库配置" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(screen.getByRole("alert")).toHaveTextContent("ANTLER_RAG_URL");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows a connection error when the backend configuration cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    render(<KnowledgeConfigurationLink getServerInfo={getServerInfo} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "检查 backend 服务连接",
    );
  });

  it("opens the configured page in the system browser on desktop", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({
          ok: true,
          json: async () => ({ ragUrl: "https://rag.example.com/" }),
        }),
    );
    render(<KnowledgeConfigurationLink getServerInfo={getServerInfo} />);
    fireEvent.click(await screen.findByRole("link", { name: "知识库配置" }));
    expect(openUrl).toHaveBeenCalledWith("https://rag.example.com/");
  });
});
