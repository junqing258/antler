import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProviderConfigForm, type ProviderConfigDraft } from "@antler/ui";

// Exercise Metro's native controls against Expo UI's renderable web implementations.
vi.mock(
  "../../../packages/ui/src/form-controls",
  () => import("../../../packages/ui/src/form-controls.native"),
);
vi.mock(
  "../../../packages/ui/node_modules/@expo/ui/build/swift-ui/modifiers/index.js",
  () => ({
    accessibilityLabel: (label: string) => ({
      $type: "accessibilityLabel",
      label,
    }),
    textFieldStyle: (style: string) => ({ $type: "textFieldStyle", style }),
  }),
);
vi.mock(
  "../../../packages/ui/node_modules/@expo/ui/build/jetpack-compose/modifiers/index.js",
  () => ({
    semantics: (params: unknown) => ({ $type: "semantics", params }),
  }),
);

afterEach(cleanup);

const initial: ProviderConfigDraft = {
  name: "自定义供应商",
  protocol: "openai-responses",
  baseUrl: "",
  apiKey: "secret",
  models: ["m-a", "m-b"],
  model: "m-a",
};

function StatefulForm({
  onSubmit,
}: {
  onSubmit: (value: ProviderConfigDraft) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ProviderConfigForm
      value={value}
      onChange={setValue}
      onSubmit={onSubmit}
      onReset={() => setValue({ ...initial, apiKey: "" })}
    />
  );
}

it("edits native inputs, switches protocol and manages models before saving", () => {
  const submit = vi.fn();
  render(<StatefulForm onSubmit={submit} />);
  fireEvent.change(screen.getByLabelText("名称"), {
    target: { value: " 原生供应商 " },
  });
  fireEvent.change(screen.getByLabelText("Base URL（可选）"), {
    target: { value: " https://api.example/v1 " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Anthropic Messages" }));
  fireEvent.change(screen.getByLabelText("新模型 ID"), {
    target: { value: " m-c " },
  });
  fireEvent.click(screen.getByRole("button", { name: "添加模型" }));
  expect(screen.getByLabelText("新模型 ID")).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "m-c" }));
  fireEvent.click(screen.getAllByRole("button", { name: "删除" })[1]);
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(submit).toHaveBeenCalledWith({
    ...initial,
    name: "原生供应商",
    protocol: "anthropic-messages",
    baseUrl: "https://api.example/v1",
    models: ["m-a", "m-c"],
    model: "m-c",
  });
});

it("syncs reset values into native inputs and clears an unsubmitted model", () => {
  const submit = vi.fn();
  render(<StatefulForm onSubmit={submit} />);
  expect(screen.getByLabelText("API Key")).toHaveAttribute("type", "password");
  fireEvent.change(screen.getByLabelText("名称"), {
    target: { value: "临时名称" },
  });
  fireEvent.change(screen.getByLabelText("新模型 ID"), {
    target: { value: "unsaved-model" },
  });
  fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));
  expect(screen.getByLabelText("名称")).toHaveValue(initial.name);
  expect(screen.getByLabelText("API Key")).toHaveValue("");
  expect(screen.getByLabelText("新模型 ID")).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(submit).toHaveBeenCalledWith({ ...initial, apiKey: "" });
});

it("disables native fields and actions while saving", () => {
  const change = vi.fn();
  const submit = vi.fn();
  render(
    <ProviderConfigForm
      value={initial}
      onChange={change}
      onSubmit={submit}
      busy
      onReset={vi.fn()}
    />,
  );
  expect(screen.getByLabelText("名称")).toHaveAttribute("readonly");
  expect(screen.getByLabelText("API Key")).toHaveAttribute("readonly");
  for (const button of screen.getAllByRole("button"))
    expect(button).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "请稍候…" }));
  expect(change).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
});
