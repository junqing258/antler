import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Probe } from "../../mobile/src/probe";

afterEach(cleanup);

describe("RNW stream probe", () => {
  it("uses the local authentication header when selected", async () => {
    const streamFetch = vi.fn(async () => new Response(""));
    render(<Probe streamFetch={streamFetch} />);
    fireEvent.change(screen.getByLabelText("服务地址"), {
      target: { value: "https://example.com" },
    });
    fireEvent.change(screen.getByLabelText("Run ID"), {
      target: { value: "run-1" },
    });
    fireEvent.change(screen.getByLabelText("访问令牌"), {
      target: { value: "local-token" },
    });
    fireEvent.click(screen.getByText(/鉴权方式/));
    fireEvent.click(screen.getByText("连接"));
    await waitFor(() => expect(streamFetch).toHaveBeenCalled());
    expect(streamFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: { "x-antler-token": "local-token" } }),
    );
  });

  it("sends authentication and cursor, decodes split UTF-8, and aborts", async () => {
    const bytes = new TextEncoder().encode('data: {"delta":"中文"}\n\n');
    const split = bytes.indexOf(0xe4) + 1;
    const streamFetch = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes.slice(0, split));
              controller.enqueue(bytes.slice(split));
            },
          }),
        ),
    );
    render(<Probe streamFetch={streamFetch} />);
    fireEvent.change(screen.getByLabelText("服务地址"), {
      target: { value: "https://example.com" },
    });
    fireEvent.change(screen.getByLabelText("Run ID"), {
      target: { value: "run/1" },
    });
    fireEvent.change(screen.getByLabelText("访问令牌"), {
      target: { value: "test-token" },
    });
    fireEvent.change(screen.getByLabelText("事件游标"), {
      target: { value: "7" },
    });
    fireEvent.click(screen.getByText("连接"));
    await screen.findByText(/中文/);
    expect(streamFetch).toHaveBeenCalledWith(
      "https://example.com/api/runs/run%2F1/events?afterEventId=7",
      expect.objectContaining({
        headers: { Authorization: "Bearer test-token" },
      }),
    );
    const signal = streamFetch.mock.calls[0][1].signal as AbortSignal;
    fireEvent.click(screen.getByText("中止"));
    await waitFor(() => expect(signal.aborted).toBe(true));
    expect(screen.getByRole("region")).toHaveTextContent("已中止");
  });
});
