import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProviderConfigForm, type ProviderConfigDraft } from "@antler/ui";

afterEach(cleanup);

const base: ProviderConfigDraft = {
  name: "My Provider",
  protocol: "openai-responses",
  baseUrl: "https://api.example/v1",
  apiKey: "key",
  models: ["m-a", "m-b"],
  model: "m-a",
};

function StatefulForm({
  initial,
  onSubmit,
}: {
  initial: ProviderConfigDraft;
  onSubmit: (next: ProviderConfigDraft) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ProviderConfigForm
      value={value}
      onChange={setValue}
      onSubmit={onSubmit}
    />
  );
}

it("adds and removes models, keeping or clearing the default selection", () => {
  const onSubmit = vi.fn();
  render(<StatefulForm initial={base} onSubmit={onSubmit} />);
  fireEvent.change(screen.getByLabelText("新模型 ID"), {
    target: { value: "m-c" },
  });
  fireEvent.click(screen.getByRole("button", { name: "添加模型" }));
  expect(screen.getByRole("radio", { name: "默认模型 m-c" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "删除 m-b" }));
  expect(screen.queryByRole("radio", { name: "默认模型 m-b" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ models: ["m-a", "m-c"], model: "m-a" }),
  );
});

it("clears the default model when it is removed and normalizes input on save", () => {
  const onSubmit = vi.fn();
  render(
    <StatefulForm
      initial={{ ...base, model: "m-b", name: "  ", apiKey: " key " }}
      onSubmit={onSubmit}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "删除 m-b" }));
  fireEvent.change(screen.getByLabelText("新模型 ID"), {
    target: { value: " m-d " },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "自定义供应商",
      apiKey: "key",
      models: ["m-a", "m-d"],
      model: "m-a",
    }),
  );
});

it("shows the bound credential hint and switches the protocol", () => {
  const onChange = vi.fn();
  render(
    <ProviderConfigForm
      value={base}
      onChange={onChange}
      onSubmit={vi.fn()}
      credentialBinding={{
        protocol: "anthropic-messages",
        baseUrl: "https://bound.example",
        model: "bound-model",
      }}
    />,
  );
  expect(screen.getByText(/当前会话绑定的配置/)).toBeInTheDocument();
  expect(
    screen.queryByText(/未填写 API Key 时使用服务端默认模型/),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "Anthropic Messages" }));
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({ protocol: "anthropic-messages" }),
  );
});
