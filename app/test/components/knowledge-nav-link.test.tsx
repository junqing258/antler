import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KnowledgeNavLink } from "@/components/knowledge-nav-link";

vi.mock("@/lib/server-info", () => ({
  serverInfo: async () => ({ baseUrl: "http://localhost:3210", token: "token" }),
  authHeaders: () => ({ "x-antler-token": "token" }),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("Knowledge navigation", () => {
  it("links to the configured Antler Knowledge service in a new tab", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ragUrl: "https://knowledge.example.com/" }),
    }));
    render(<KnowledgeNavLink />);
    const link = await screen.findByRole("link", { name: "知识库" });
    expect(link).toHaveAttribute("href", "https://knowledge.example.com/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(fireEvent.click(link)).toBe(true);
  });
  it("keeps navigation disabled when no service is configured", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ragUrl: null }),
    }));
    render(<KnowledgeNavLink />);
    expect(await screen.findByTitle(/请先在知识库配置/)).toBeDisabled();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
