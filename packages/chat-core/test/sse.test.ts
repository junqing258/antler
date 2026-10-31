import { expect, it } from "vitest";
import { SseParser } from "../src";

it("frames fragmented CRLF, multiline data, and heartbeats without merging events", () => {
  const parser = new SseParser();
  expect(
    parser.push(
      ': heartbeat\r\n\r\nid: 7\r\nevent: update\r\ndata: {"text":\r\n',
    ),
  ).toEqual([]);
  expect(parser.push('data: "你好"}\r\n\r\nid: 8\ndata: next\n\n')).toEqual([
    { id: "7", event: "update", data: '{"text":\n"你好"}' },
    { id: "8", event: undefined, data: "next" },
  ]);
});
