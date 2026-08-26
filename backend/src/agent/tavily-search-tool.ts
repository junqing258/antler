import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

const parameters = Type.Object({
  query: Type.String({ minLength: 1, maxLength: 500, description: "The web search query." }),
  maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 5, description: "Number of sources to return (1-5)." })),
});

type TavilyResponse = {
  answer?: string;
  results?: Array<{ title?: string; url?: string; content?: string }>;
};

function truncate(text: string, maxLength: number) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

export function createTavilySearchTool(apiKey: string): AgentTool<typeof parameters> {
  return {
    name: "web_search",
    label: "Web search",
    description: "Search the public web for current information. Use it when the answer depends on recent, factual, or externally verifiable information. Cite the returned source URLs in your response.",
    parameters,
    async execute(_toolCallId, { query, maxResults = 5 }, signal) {
      const timeout = AbortSignal.timeout(15_000);
      const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          query: query.trim(),
          search_depth: "basic",
          max_results: maxResults,
          include_answer: true,
          include_raw_content: false,
        }),
        signal: combinedSignal,
      });
      if (!response.ok) throw new Error(`Tavily 搜索失败（HTTP ${response.status}）。`);

      const result = (await response.json()) as TavilyResponse;
      const sources = (result.results ?? []).slice(0, maxResults).map((item, index) => {
        const title = truncate(item.title?.trim() || "Untitled source", 200);
        const url = item.url?.trim() || "URL unavailable";
        const content = truncate(item.content?.trim() || "No summary available.", 1_200);
        return `${index + 1}. ${title}\n${url}\n${content}`;
      });
      const text = [
        result.answer ? `Summary: ${truncate(result.answer, 1_500)}` : undefined,
        sources.length > 0 ? `Sources:\n${sources.join("\n\n")}` : "No sources found.",
      ].filter(Boolean).join("\n\n");
      return { content: [{ type: "text", text }], details: { resultCount: sources.length } };
    },
  };
}
