export type KnowledgePolicy =
  | { mode: "disabled" }
  | { mode: "auto" }
  | { mode: "selected"; knowledgeBaseIds: string[] };

export type KnowledgeHit = {
  citationKey: string;
  title: string;
  locator: Record<string, unknown>;
  snippet: string;
  score: number;
};

export type KnowledgeQuery = {
  projectId: string;
  input: string;
  policy: KnowledgePolicy;
};

export type KnowledgeContext = {
  mode: "disabled" | "lexical" | "lexical_only";
  hits: KnowledgeHit[];
  /** A bounded, untrusted context block for a future knowledge implementation. */
  prompt: string;
};

export type KnowledgeContextPort = {
  retrieve(request: KnowledgeQuery): Promise<KnowledgeContext>;
};

export class EmptyKnowledgeContext implements KnowledgeContextPort {
  async retrieve(_request: KnowledgeQuery): Promise<KnowledgeContext> {
    return { mode: "disabled", hits: [], prompt: "" };
  }
}
