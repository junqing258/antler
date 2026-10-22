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
