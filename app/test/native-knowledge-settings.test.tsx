import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
// Vite resolves this to react-native-web; the native types live in the mobile workspace.
// @ts-expect-error The app workspace does not directly depend on react-native.
import { Linking } from "react-native";
import {
  getRagConfig,
  resetRagConfig,
  updateRagConfig,
  type RagConfig,
} from "../../mobile/src/lib/rag-config-service";
import { KnowledgeSettings } from "../../mobile/src/views/settings/knowledge-settings";
import {
  defaultNativeConfig,
  type NativeConfig,
} from "../../mobile/src/lib/native-config";

vi.mock("../../mobile/src/lib/rag-config-service", () => ({
  getRagConfig: vi.fn(),
  updateRagConfig: vi.fn(),
  resetRagConfig: vi.fn(),
}));

vi.mock("../../mobile/src/lib/native-platform", () => ({
  createNativePlatform: () => ({
    connection: async () => ({ baseUrl: "https://server.example", headers: {} }),
    request: async () => new Response("{}", { status: 200 }),
    abortController: () => new AbortController(),
    decoder: () => new TextDecoder(),
    schedule: (callback: () => void, ms: number) => {
      const timer = setTimeout(callback, ms);
      return () => clearTimeout(timer);
    },
    initialize: async () => {},
    createId: () => "generated",
    onForeground: () => () => {},
  }),
}));

const getConfigMock = vi.mocked(getRagConfig);
const updateMock = vi.mocked(updateRagConfig);
const resetMock = vi.mocked(resetRagConfig);

const config: NativeConfig = {
  ...defaultNativeConfig,
  serverUrl: "https://server.example",
};

function overridden(next: Partial<RagConfig> = {}): RagConfig {
  return {
    ragUrl: "https://rag.example.com/",
    ragKeyConfigured: true,
    ragConfigOverridden: true,
    ...next,
  };
}

function Harness() {
  return (
    <KnowledgeSettings
      config={config}
      getToken={async () => "token"}
      onUnauthorized={() => {}}
      isCurrent={() => true}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getConfigMock.mockResolvedValue(overridden());
  updateMock.mockImplementation(async (_p, value) =>
    overridden({
      ragUrl: value.ragUrl
        ? `${value.ragUrl.replace(/\/+$/, "")}/`
        : null,
    }),
  );
  resetMock.mockResolvedValue(
    overridden({ ragUrl: null, ragConfigOverridden: false }),
  );
});

afterEach(cleanup);

it("loads the current config and hides the key value", async () => {
  render(<Harness />);
  const url = await screen.findByLabelText("RAG 服务地址");
  expect(url).toHaveValue("https://rag.example.com/");
  expect(getConfigMock).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("RAG API Key")).toHaveValue("");
  expect(screen.getByText("密钥已配置；输入新密钥可替换，留空则保留。")).toBeInTheDocument();
});

it("keeps the existing key when saving with an empty key field", async () => {
  render(<Harness />);
  await screen.findByText("密钥已配置；输入新密钥可替换，留空则保留。");
  fireEvent.click(screen.getByRole("button", { name: "保存知识库配置" }));
  expect(
    await screen.findByText("知识库配置已保存，即时生效。"),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(updateMock).toHaveBeenCalledWith(
      expect.anything(),
      { ragUrl: "https://rag.example.com/" },
    ),
  );
  expect(screen.getByText("知识库配置已保存，即时生效。")).toBeInTheDocument();
});

it("replaces the key when a new one is entered", async () => {
  render(<Harness />);
  await screen.findByText("密钥已配置；输入新密钥可替换，留空则保留。");
  fireEvent.change(screen.getByLabelText("RAG API Key"), {
    target: { value: "sk-next" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存知识库配置" }));
  await waitFor(() =>
    expect(updateMock).toHaveBeenCalledWith(
      expect.anything(),
      { ragUrl: "https://rag.example.com/", ragKey: "sk-next" },
    ),
  );
});

it("sends an empty key only after an explicit clear request", async () => {
  render(<Harness />);
  await screen.findByText("密钥已配置；输入新密钥可替换，留空则保留。");
  fireEvent.click(screen.getByRole("button", { name: "清除密钥" }));
  expect(
    await screen.findByText("保存后将清除现有密钥。"),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "取消清除密钥" }));
  fireEvent.click(screen.getByRole("button", { name: "保存知识库配置" }));
  await waitFor(() =>
    expect(updateMock).toHaveBeenCalledWith(
      expect.anything(),
      { ragUrl: "https://rag.example.com/" },
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "清除密钥" }));
  fireEvent.click(screen.getByRole("button", { name: "保存知识库配置" }));
  await waitFor(() =>
    expect(updateMock).toHaveBeenLastCalledWith(
      expect.anything(),
      { ragUrl: "https://rag.example.com/", ragKey: "" },
    ),
  );
});

it("restores environment defaults only when overridden", async () => {
  render(<Harness />);
  await screen.findByText("密钥已配置；输入新密钥可替换，留空则保留。");
  fireEvent.click(screen.getByRole("button", { name: "恢复环境默认值" }));
  await waitFor(() => expect(resetMock).toHaveBeenCalledTimes(1));
  expect(await screen.findByText("已恢复环境默认值。")).toBeInTheDocument();

  getConfigMock.mockResolvedValue(
    overridden({ ragUrl: null, ragConfigOverridden: false }),
  );
  cleanup();
  render(<Harness />);
  await screen.findByText("尚未配置密钥。");
  const button = screen.getByRole("button", {
    name: "恢复环境默认值",
  });
  expect(button).toHaveAttribute("disabled");
});

it("shows server validation errors and keeps the form", async () => {
  updateMock.mockRejectedValueOnce(
    new Error("RAG 地址必须是 HTTP 或 HTTPS 服务地址，不能包含路径、凭据或查询参数。"),
  );
  render(<Harness />);
  await screen.findByText("密钥已配置；输入新密钥可替换，留空则保留。");
  fireEvent.change(
    screen.getByLabelText("RAG 服务地址"),
    "https://rag.example.com/v1",
  );
  fireEvent.click(screen.getByRole("button", { name: "保存知识库配置" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "RAG 地址必须是 HTTP 或 HTTPS 服务地址",
  );
  expect(screen.getByRole("button", { name: "保存知识库配置" })).not.toHaveAttribute(
    "disabled",
  );
});

it("offers a retry after a failed load", async () => {
  getConfigMock.mockRejectedValueOnce(new Error("无法连接服务端，请检查网络后重试。"));
  render(<Harness />);
  expect(await screen.findByRole("alert")).toHaveTextContent("无法连接服务端");
  fireEvent.click(screen.getByRole("button", { name: "重试读取知识库配置" }));
  expect(await screen.findByLabelText("RAG 服务地址")).toHaveValue(
    "https://rag.example.com/",
  );
});

it("opens the management page over http(s) and reports open failures", async () => {
  const openURL = vi
    .spyOn(Linking, "openURL")
    .mockRejectedValueOnce(new Error("no handler"))
    .mockResolvedValueOnce(undefined as never);
  render(<Harness />);
  await screen.findByLabelText("RAG 服务地址");
  fireEvent.click(screen.getByRole("link", { name: "打开知识库管理页面" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "无法打开知识库页面",
  );
  fireEvent.click(screen.getByRole("link", { name: "打开知识库管理页面" }));
  await waitFor(() => expect(openURL).toHaveBeenCalledTimes(2));
  expect(openURL).toHaveBeenLastCalledWith("https://rag.example.com/");

  getConfigMock.mockResolvedValue(overridden({ ragUrl: "file:///etc" }));
  cleanup();
  render(<Harness />);
  await screen.findByLabelText("RAG 服务地址");
  expect(
    screen.queryByRole("link", { name: "打开知识库管理页面" }),
  ).not.toBeInTheDocument();
});
