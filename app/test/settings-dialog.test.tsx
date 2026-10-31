import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsDialog } from "@/components/settings-dialog";
import { defaultProviderConfig } from "@/lib/provider-config";
vi.mock("@/lib/auth", () => ({
  currentUserProfile: async () => undefined,
  signOut: vi.fn(),
}));
afterEach(cleanup);
it("includes a typed model ID when saving without clicking Add first", () => {
  const onSave = vi.fn();
  render(
    <SettingsDialog
      config={defaultProviderConfig}
      onSave={onSave}
      onClose={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByPlaceholderText("输入供应商支持的模型 ID"), {
    target: { value: " custom-model " },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      models: ["custom-model"],
      model: "custom-model",
    }),
  );
});
it("shows the bound configuration without replacing local defaults", () => {
  render(
    <SettingsDialog
      config={defaultProviderConfig}
      credentialBinding={{
        protocol: "anthropic-messages",
        baseUrl: "https://bound.example",
        model: "bound-model",
      }}
      onSave={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  expect(screen.getByText(/当前会话绑定的配置/)).toBeInTheDocument();
  expect(screen.getByText(/https:\/\/bound.example/)).toHaveTextContent(
    "bound-model",
  );
  expect(
    screen.getByText(/当前会话继续使用上方绑定的模型/),
  ).toBeInTheDocument();
  expect(
    screen.queryByText(/未填写 API Key 时使用服务端默认模型/),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("协议")).toHaveValue("openai-responses");
  expect(screen.getByLabelText("Base URL（可选）")).toHaveValue("");
});
