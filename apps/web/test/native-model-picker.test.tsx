import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ModelPicker } from "../../../packages/ui/src/model-picker.native";

afterEach(cleanup);

it("opens an actionable explanation when no models are configured", () => {
  const configure = vi.fn();
  render(
    <ModelPicker
      model="server-model"
      models={[]}
      onModelChange={vi.fn()}
      onConfigure={configure}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "选择模型" }));
  expect(screen.getByText(/当前使用服务端默认模型/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "配置模型" }));
  expect(configure).toHaveBeenCalledOnce();
});

it("selects a different model", () => {
  const change = vi.fn();
  render(
    <ModelPicker
      model="first"
      models={["first", "second"]}
      onModelChange={change}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "选择模型" }));
  fireEvent.click(screen.getByRole("button", { name: "second" }));
  expect(change).toHaveBeenCalledWith("second");
});
