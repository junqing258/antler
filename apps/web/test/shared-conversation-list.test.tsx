import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ConversationList } from "@antler/ui";

afterEach(cleanup);

it("renders conversations with the active one highlighted and reports selection", () => {
  const onSelect = vi.fn();
  render(
    <ConversationList
      conversations={[
        { id: "a", title: "第一个会话" },
        { id: "b", title: "第二个会话" },
      ]}
      activeId="b"
      onSelect={onSelect}
    />,
  );
  const active = screen.getByRole("button", { name: "第二个会话" });
  expect(within(active).getByText("第二个会话")).toHaveStyle({
    fontWeight: "600",
  });
  fireEvent.click(screen.getByRole("button", { name: "第一个会话" }));
  expect(onSelect).toHaveBeenCalledWith("a");
});

it("shows the empty state and offers rename, delete and pagination actions", () => {
  const onRename = vi.fn();
  const onDelete = vi.fn();
  const onLoadMore = vi.fn();
  const { rerender } = render(
    <ConversationList conversations={[]} onSelect={vi.fn()} />,
  );
  expect(screen.getByText("暂无会话")).toBeInTheDocument();
  rerender(
    <ConversationList
      conversations={[{ id: "a", title: "目标会话" }]}
      onSelect={vi.fn()}
      onRename={onRename}
      onDelete={onDelete}
      onLoadMore={onLoadMore}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "重命名 目标会话" }));
  expect(onRename).toHaveBeenCalledWith({ id: "a", title: "目标会话" });
  fireEvent.click(screen.getByRole("button", { name: "删除 目标会话" }));
  expect(onDelete).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "加载更多会话" }));
  expect(onLoadMore).toHaveBeenCalledOnce();
});
