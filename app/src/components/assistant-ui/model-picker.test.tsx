import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModelPicker } from "./thread";

describe("ModelPicker", () => {
  it.each(["", "server-model"])("shows server defaults without offering ineffective selections: %j", (model) => {
    render(<ModelPicker model={model} models={[]} onModelChange={vi.fn()} />);

    expect(screen.getByRole("button", {
      name: `选择模型，当前模型 ${model || "服务端默认"}`,
    })).toBeDisabled();
    expect(screen.getByText(model || "服务端默认")).toBeVisible();
  });

  it("lists configured models and reports a new selection", async () => {
    const onModelChange = vi.fn();
    render(
      <ModelPicker
        model="gpt-4.1-mini"
        models={["gpt-4.1-mini", "gpt-5-mini"]}
        onModelChange={onModelChange}
      />,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", {
        name: "选择模型，当前模型 gpt-4.1-mini",
      }),
      { button: 0, ctrlKey: false },
    );

    const option = await screen.findByRole("menuitemradio", {
      name: "gpt-5-mini",
    });
    fireEvent.click(option);

    expect(onModelChange).toHaveBeenCalledOnce();
    expect(onModelChange).toHaveBeenCalledWith("gpt-5-mini");
  });
});
