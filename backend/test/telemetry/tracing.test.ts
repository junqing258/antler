import { setTimeout } from "node:timers/promises";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { context, propagation, SpanStatusCode, trace } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { registerRequestLogging } from "../../src/plugins/request-logging.js";
import { registerRequestTracing } from "../../src/plugins/request-tracing.js";
import { initializeTracing, RunTracing } from "../../src/telemetry/tracing.js";

describe("tracing", () => {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  let app: FastifyInstance;
  let log: ReturnType<typeof vi.spyOn>;
  beforeAll(() => provider.register());
  beforeEach(() => {
    log = vi.spyOn(console, "info").mockImplementation(() => {});
    app = Fastify();
    registerRequestTracing(app);
    registerRequestLogging(app);
  });
  afterEach(async () => {
    await app.close();
    await provider.forceFlush();
    exporter.reset();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await provider.shutdown();
    trace.disable();
    context.disable();
    propagation.disable();
  });

  it("preserves upstream context through async handlers, runs, model calls and tools without exporting content", async () => {
    app.post("/runs/:id", async () => {
      await setTimeout(1);
      const run = new RunTracing({ id: "run-1" }, (value) => value.replaceAll("secret", "[REDACTED]"));
      await run.withContext(async () => {
        await setTimeout(1);
        run.observe({ type: "turn_start" });
        run.observe({
          type: "message_end",
          message: {
            role: "assistant", provider: "test", model: "model-secret", stopReason: "toolUse",
            content: [{ type: "text", text: "private-prompt" }],
            usage: { input: 12, output: 3, cacheRead: 2, cacheWrite: 0 },
          },
        } as AgentEvent);
        run.observe({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "read_file", args: { path: "private-path" } });
        run.observe({ type: "tool_execution_end", toolCallId: "tool-1", toolName: "read_file", result: "private-result", isError: false });
      });
      run.finish("completed");
      run.finish("completed");
      return { ok: true };
    });
    const traceId = "0123456789abcdef0123456789abcdef";
    const response = await app.inject({
      method: "POST", url: "/runs/1?token=private-query",
      headers: { traceparent: `00-${traceId}-0123456789abcdef-01`, authorization: "Bearer private-header" },
      payload: { prompt: "private-body" },
    });
    await provider.forceFlush();
    expect(response.statusCode).toBe(200);
    expect(response.headers["x-trace-id"]).toBe(traceId);
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(4);
    const request = spans.find((span) => span.name === "POST /runs/:id")!;
    const run = spans.find((span) => span.name === "agent.run")!;
    const model = spans.find((span) => span.name === "gen_ai.chat")!;
    const tool = spans.find((span) => span.name === "tool.execute")!;
    expect(request.parentSpanContext?.spanId).toBe("0123456789abcdef");
    expect(run.parentSpanContext?.spanId).toBe(request.spanContext().spanId);
    for (const span of [model, tool]) expect(span.parentSpanContext?.spanId).toBe(run.spanContext().spanId);
    expect(spans.every((span) => span.spanContext().traceId === traceId)).toBe(true);
    expect(model.attributes["gen_ai.usage.input_tokens"]).toBe(12);
    expect(model.attributes["gen_ai.request.model"]).toBe("model-[REDACTED]");
    const exported = JSON.stringify(spans.map((span) => ({ name: span.name, attributes: span.attributes, events: span.events })));
    for (const secret of ["private-prompt", "private-path", "private-result", "private-query", "private-header", "private-body", "model-secret"])
      expect(exported).not.toContain(secret);
    expect(log.mock.calls.flat().join("\n")).toContain(`trace_id=${traceId}`);
    expect(log.mock.calls.flat().join("\n")).not.toContain("private-query");
  });

  it("keeps concurrent request contexts separate and ends each request once", async () => {
    app.get("/work/:id", async (request) => {
      await setTimeout(5);
      const run = new RunTracing({ id: request.id });
      await run.withContext(() => setTimeout(2));
      run.finish("completed");
      return { id: request.id };
    });
    await Promise.all(Array.from({ length: 8 }, (_, i) => app.inject(`/work/${i}`)));
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(16);
    for (const run of spans.filter((span) => span.name === "agent.run")) {
      const parent = spans.find((span) => span.spanContext().spanId === run.parentSpanContext?.spanId)!;
      expect(parent).toBeDefined();
      expect(parent.attributes["antler.request.id"]).toBe(run.attributes["antler.run.id"]);
      expect(parent.spanContext().traceId).toBe(run.spanContext().traceId);
    }
    expect(new Set(spans.map((span) => span.spanContext().traceId)).size).toBe(8);
  });

  it.each(["interrupted", "cancelled"])("marks failed HTTP responses and closes %s model/tool spans", async (status) => {
    app.get("/fail", async () => { throw new Error("private-error-message"); });
    await app.inject("/fail");
    const run = new RunTracing({ id: "cancelled" });
    run.observe({ type: "turn_start" });
    run.observe({ type: "tool_execution_start", toolCallId: "tool-2", toolName: "test", args: {} });
    run.finish(status, "cancelled");
    run.observe({ type: "turn_start" });
    run.finish("completed");
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(4);
    expect(spans.every((span) => span.status.code === SpanStatusCode.ERROR)).toBe(true);
    expect(spans.filter((span) => span.attributes["antler.span.incomplete"])).toHaveLength(2);
    expect(JSON.stringify(spans.map((span) => span.attributes))).not.toContain("private-error-message");
  });

  it.each([
    { method: "GET" as const, url: "/health" },
    { method: "GET" as const, url: "/health?probe=ready" },
    { method: "HEAD" as const, url: "/health" },
    { method: "HEAD" as const, url: "/health?probe=ready" },
  ])("excludes $method $url from traces even with a sampled upstream parent", async ({ method, url }) => {
    app.get("/health", async () => ({ status: "ok" }));
    const response = await app.inject({
      method, url,
      headers: { traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01" },
    });
    await provider.forceFlush();
    expect(response.statusCode).toBe(200);
    expect(response.headers["x-trace-id"]).toBeUndefined();
    expect(exporter.getFinishedSpans()).toHaveLength(0);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain("path=/health status=200");
    expect(log.mock.calls[0][0]).not.toContain("trace_id=");
  });

  it("continues tracing business routes with a health prefix", async () => {
    app.get("/health/report", async () => ({ status: "ok" }));
    const response = await app.inject("/health/report");
    expect(response.statusCode).toBe(200);
    expect(response.headers["x-trace-id"]).toBeDefined();
    expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual(["GET /health/report"]);
  });

  it("defaults off and rejects invalid enabled exporter configuration", () => {
    expect(initializeTracing({})).toBeUndefined();
    expect(initializeTracing({ ANTLER_TRACING_ENABLED: "true", OTEL_SDK_DISABLED: "true" })).toBeUndefined();
    expect(() => initializeTracing({ ANTLER_TRACING_ENABLED: "true" })).toThrow("requires");
    expect(() => initializeTracing({ ANTLER_TRACING_ENABLED: "true", OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://user:secret@host/v1/traces" })).toThrow("without credentials");
    expect(() => initializeTracing({ ANTLER_TRACING_ENABLED: "true", OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://host/v1/traces", ANTLER_TRACE_SAMPLE_RATIO: "2" })).toThrow("between 0 and 1");
  });
});
