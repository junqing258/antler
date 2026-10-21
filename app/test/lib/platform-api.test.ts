import { afterEach, describe, expect, it, vi } from "vitest";
import { platformApi } from "@/lib/platform-api";
vi.mock("@/lib/server-info", () => ({
  serverInfo: async () => ({ baseUrl: "http://test", token: "token" }),
  authHeaders: () => ({ "x-antler-token": "token" }),
}));
afterEach(() => {
  vi.unstubAllGlobals();
});
describe("platform API requests", () => {
  it.each(["POST", "DELETE"])(
    "omits JSON Content-Type for bodyless %s requests",
    async (method) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(new Response(null, { status: 204 }));
      vi.stubGlobal("fetch", fetch);
      await platformApi("/agents/id/publish", method);
      expect(fetch).toHaveBeenCalledWith(
        "http://test/api/agents/id/publish",
        expect.objectContaining({
          method,
          headers: { "x-antler-token": "token" },
        }),
      );
      expect(fetch.mock.calls[0]![1]).not.toHaveProperty("body");
    },
  );
  it("sends JSON when a body exists and displays hidden reference diagnostics", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "skill_in_use",
            agents: [{ name: "Visible" }],
            hasHiddenReferences: true,
          }),
          { status: 409 },
        ),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      platformApi("/skills", "POST", { name: "example" }),
    ).rejects.toThrow("另有不可见 Agent 引用");
    expect(fetch.mock.calls[0]![1]).toMatchObject({
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "example" }),
    });
  });
});
