import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KnowledgeConfigurationLink } from "../../src/components/knowledge-configuration-link";
import { openUrl } from "@tauri-apps/plugin-opener";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));
const getServerInfo = async () => ({
  baseUrl: "http://127.0.0.1:3210",
  token: "test-token",
});
const defaults: {
  ragUrl: string | null;
  ragKeyConfigured: boolean;
  ragConfigOverridden: boolean;
} = {
  ragUrl: "https://rag.example.com/",
  ragKeyConfigured: true,
  ragConfigOverridden: false,
};
const response = (config = defaults) => ({
  ok: true,
  json: async () => config,
});

async function openConfiguration() {
  render(<KnowledgeConfigurationLink getServerInfo={getServerInfo} />);
  fireEvent.click(screen.getByRole("button", { name: "知识库配置" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "保存配置" })).toBeEnabled(),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

describe("knowledge configuration", () => {
  it("provides a separate service-address link beside the settings button", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
    render(<KnowledgeConfigurationLink getServerInfo={getServerInfo} />);
    const link = await screen.findByRole("link", {
      name: "打开知识库服务地址",
    });
    expect(link).toHaveAttribute("href", defaults.ragUrl);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link.parentElement).toContainElement(
      screen.getByRole("button", { name: "知识库配置" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("disables the service link when no address is configured", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({ ...defaults, ragUrl: null })),
    );
    render(<KnowledgeConfigurationLink getServerInfo={getServerInfo} />);
    const button = screen.getByRole("button", { name: "打开知识库服务地址" });
    await waitFor(() =>
      expect(button).toHaveAttribute(
        "title",
        "未配置服务地址，请先配置知识库。",
      ),
    );
    expect(button).toBeDisabled();
    expect(
      screen.queryByRole("link", { name: "打开知识库服务地址" }),
    ).not.toBeInTheDocument();
  });

  it("loads environment defaults without returning or displaying the existing key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal("fetch", fetchMock);
    await openConfiguration();
    expect(screen.getByLabelText("RAG 服务地址", { exact: false })).toHaveValue(
      defaults.ragUrl,
    );
    expect(screen.getByLabelText("RAG API Key", { exact: false })).toHaveValue(
      "",
    );
    expect(
      screen.getByPlaceholderText("已配置，留空保留现有密钥"),
    ).toHaveAttribute("type", "password");
    expect(
      screen.getByRole("button", { name: "恢复环境默认值" }),
    ).toBeDisabled();
    const link = screen.getByRole("link", { name: "打开知识库管理页面" });
    expect(link).toHaveAttribute("href", defaults.ragUrl);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3210/api/config",
      expect.objectContaining({ headers: { "x-antler-token": "test-token" } }),
    );
  });

  it("saves URL and key, clears the draft key, and updates the management link", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({ ...defaults, ragUrl: null, ragKeyConfigured: false }),
      )
      .mockResolvedValueOnce(
        response({ ...defaults, ragUrl: null, ragKeyConfigured: false }),
      )
      .mockResolvedValueOnce(
        response({
          ...defaults,
          ragUrl: "https://custom.example.com/",
          ragConfigOverridden: true,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await openConfiguration();
    fireEvent.change(screen.getByLabelText("RAG 服务地址", { exact: false }), {
      target: { value: "https://custom.example.com" },
    });
    fireEvent.change(screen.getByLabelText("RAG API Key", { exact: false }), {
      target: { value: "custom-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    await screen.findByText("知识库配置已保存，即时生效。");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://127.0.0.1:3210/api/config/rag",
      {
        method: "PUT",
        headers: {
          "x-antler-token": "test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ragUrl: "https://custom.example.com",
          ragKey: "custom-key",
        }),
      },
    );
    expect(screen.getByLabelText("RAG API Key", { exact: false })).toHaveValue(
      "",
    );
    expect(
      screen.getByRole("link", { name: "打开知识库管理页面" }),
    ).toHaveAttribute("href", "https://custom.example.com/");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(
      await screen.findByRole("link", { name: "打开知识库服务地址" }),
    ).toHaveAttribute("href", "https://custom.example.com/");
  });

  it("preserves the existing key when blank and only clears it explicitly", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(response({ ...defaults, ragConfigOverridden: true }));
    vi.stubGlobal("fetch", fetchMock);
    await openConfiguration();
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    await screen.findByText("知识库配置已保存，即时生效。");
    expect(JSON.parse(fetchMock.mock.lastCall![1].body)).toEqual({
      ragUrl: defaults.ragUrl,
    });
    fireEvent.click(screen.getByRole("button", { name: "清除密钥" }));
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(JSON.parse(fetchMock.mock.lastCall![1].body)).toEqual({
      ragUrl: defaults.ragUrl,
      ragKey: "",
    });
  });

  it("restores the environment defaults and reloads the form", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          ...defaults,
          ragUrl: "https://custom.example.com/",
          ragConfigOverridden: true,
        }),
      )
      .mockResolvedValueOnce(
        response({
          ...defaults,
          ragUrl: "https://custom.example.com/",
          ragConfigOverridden: true,
        }),
      )
      .mockResolvedValueOnce(response());
    vi.stubGlobal("fetch", fetchMock);
    await openConfiguration();
    fireEvent.click(screen.getByRole("button", { name: "恢复环境默认值" }));
    await screen.findByText("已恢复环境默认值。");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://127.0.0.1:3210/api/config/rag",
      { method: "DELETE", headers: { "x-antler-token": "test-token" } },
    );
    expect(screen.getByLabelText("RAG 服务地址", { exact: false })).toHaveValue(
      defaults.ragUrl,
    );
    expect(
      screen.getByRole("button", { name: "恢复环境默认值" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(
      await screen.findByRole("link", { name: "打开知识库服务地址" }),
    ).toHaveAttribute("href", defaults.ragUrl);
  });

  it("shows backend validation failures without losing the draft", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response())
        .mockResolvedValueOnce(response())
        .mockResolvedValueOnce({
          ok: false,
          json: async () => ({ error: "RAG 地址不能包含路径。" }),
        }),
    );
    await openConfiguration();
    fireEvent.change(screen.getByLabelText("RAG 服务地址", { exact: false }), {
      target: { value: "https://rag.example.com/api" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "RAG 地址不能包含路径。",
    );
    expect(screen.getByLabelText("RAG 服务地址", { exact: false })).toHaveValue(
      "https://rag.example.com/api",
    );
    expect(screen.getByRole("button", { name: "保存配置" })).toBeEnabled();
  });

  it("lets the user retry a failed configuration load", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce(response()),
    );
    render(<KnowledgeConfigurationLink getServerInfo={getServerInfo} />);
    fireEvent.click(screen.getByRole("button", { name: "知识库配置" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "检查 backend 服务连接",
    );
    expect(screen.getByRole("button", { name: "保存配置" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "保存配置" })).toBeEnabled(),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("opens the management page in the system browser on desktop", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
    await openConfiguration();
    fireEvent.click(screen.getByRole("link", { name: "打开知识库管理页面" }));
    expect(openUrl).toHaveBeenCalledWith(defaults.ragUrl);
  });

  it("opens the sidebar service entry in the system browser on desktop", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
    render(<KnowledgeConfigurationLink getServerInfo={getServerInfo} />);
    fireEvent.click(
      await screen.findByRole("link", { name: "打开知识库服务地址" }),
    );
    expect(openUrl).toHaveBeenCalledWith(defaults.ragUrl);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
