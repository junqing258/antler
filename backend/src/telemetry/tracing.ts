import {
  context,
  isSpanContextValid,
  SpanKind,
  SpanStatusCode,
  trace,
  type Context,
  type Span,
} from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import type { AgentEvent } from "@earendil-works/pi-agent-core";

const activeRuns = new Set<RunTracing>();

export function initializeTracing(environment = process.env) {
  if (
    environment.ANTLER_TRACING_ENABLED !== "true" ||
    environment.OTEL_SDK_DISABLED === "true"
  ) return undefined;

  const endpoint = environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  if (!endpoint) throw new Error("Tracing requires OTEL_EXPORTER_OTLP_TRACES_ENDPOINT");
  const url = new URL(endpoint);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error("The tracing endpoint must be an HTTP(S) URL without credentials or query parameters");
  const ratio = Number(environment.ANTLER_TRACE_SAMPLE_RATIO ?? "1");
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1)
    throw new Error("ANTLER_TRACE_SAMPLE_RATIO must be between 0 and 1");

  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      "service.name": environment.OTEL_SERVICE_NAME ?? "antler-backend",
      "service.version": environment.OTEL_SERVICE_VERSION ?? "development",
      "deployment.environment.name": environment.NODE_ENV ?? "development",
    }),
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(ratio) }),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({
      url: url.toString(),
      timeoutMillis: 5_000,
    }), {
      maxQueueSize: 2_048,
      maxExportBatchSize: 256,
      scheduledDelayMillis: 1_000,
      exportTimeoutMillis: 5_000,
    })],
  });
  provider.register();
  return {
    async shutdown() {
      for (const run of [...activeRuns]) run.finish("interrupted", "process_shutdown");
      await provider.shutdown();
    },
  };
}

export function tracer() {
  return trace.getTracer("antler");
}

export function traceFields(span?: Span) {
  const value = span?.spanContext();
  return value && isSpanContextValid(value)
    ? { trace_id: value.traceId, span_id: value.spanId }
    : undefined;
}

/** Metadata only: never export prompts, arguments, results, headers or exception messages. */
export class RunTracing {
  readonly context: Context;
  private readonly span: Span;
  private model?: Span;
  private readonly tools = new Map<string, Span>();
  private closed = false;

  constructor(
    private readonly run: { id: string },
    private readonly redact: (value: string) => string = (value) => value,
  ) {
    this.span = tracer().startSpan("agent.run", {
      attributes: { "antler.run.id": run.id, "gen_ai.operation.name": "invoke_agent" },
    });
    this.context = trace.setSpan(context.active(), this.span);
    if (traceFields(this.span)) activeRuns.add(this);
  }

  withContext<T>(callback: () => T): T {
    return context.with(this.context, callback);
  }

  observe(event: AgentEvent) {
    if (this.closed) return;
    if (event.type === "turn_start") {
      if (this.model) {
        this.model.setAttribute("antler.span.incomplete", true);
        this.model.end();
      }
      this.model = tracer().startSpan("gen_ai.chat", {
        kind: SpanKind.CLIENT,
        attributes: { "antler.run.id": this.run.id, "gen_ai.operation.name": "chat" },
      }, this.context);
    } else if (event.type === "message_end" && event.message.role === "assistant") {
      const message = event.message;
      if (this.model) {
        if (typeof message.provider === "string")
          this.model.setAttribute("gen_ai.provider.name", this.redact(message.provider).slice(0, 128));
        if (typeof message.model === "string")
          this.model.setAttribute("gen_ai.request.model", this.redact(message.model).slice(0, 128));
        if (typeof message.stopReason === "string")
          this.model.setAttribute("gen_ai.response.finish_reasons", [message.stopReason]);
        const usage = message.usage;
        for (const [key, value] of Object.entries({
          "gen_ai.usage.input_tokens": usage?.input,
          "gen_ai.usage.output_tokens": usage?.output,
          "gen_ai.usage.cache_read.input_tokens": usage?.cacheRead,
          "gen_ai.usage.cache_creation.input_tokens": usage?.cacheWrite,
        })) {
          if (typeof value === "number" && Number.isFinite(value) && value >= 0)
            this.model.setAttribute(key, value);
        }
        if (message.stopReason === "error" || message.stopReason === "aborted")
          this.model.setStatus({ code: SpanStatusCode.ERROR });
        this.model.end();
        this.model = undefined;
      }
    } else if (event.type === "tool_execution_start") {
      this.tools.get(event.toolCallId)?.end();
      this.tools.set(event.toolCallId, tracer().startSpan("tool.execute", {
        attributes: {
          "antler.run.id": this.run.id,
          "gen_ai.operation.name": "execute_tool",
          "gen_ai.tool.name": this.redact(event.toolName).slice(0, 128),
        },
      }, this.context));
    } else if (event.type === "tool_execution_end") {
      const span = this.tools.get(event.toolCallId);
      if (span) {
        span.setAttribute("antler.tool.is_error", event.isError);
        if (event.isError) span.setStatus({ code: SpanStatusCode.ERROR });
        span.end();
        this.tools.delete(event.toolCallId);
      }
    }
  }

  finish(status: string, errorCode?: string) {
    if (this.closed) return;
    this.closed = true;
    const failed = status === "failed" || status === "interrupted" || status === "cancelled";
    const incomplete = [...this.tools.values(), ...(this.model ? [this.model] : [])];
    for (const span of incomplete) {
      span.setAttribute("antler.span.incomplete", true);
      if (failed) span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
    }
    this.tools.clear();
    this.model = undefined;
    this.span.setAttribute("antler.run.status", status);
    if (errorCode) this.span.setAttribute("error.type", this.redact(errorCode).slice(0, 128));
    if (failed) this.span.setStatus({ code: SpanStatusCode.ERROR });
    this.span.end();
    activeRuns.delete(this);
    const fields = traceFields(this.span);
    if (fields) console.info(
      `run_trace_completed run_id=${this.run.id} trace_id=${fields.trace_id} span_id=${fields.span_id} status=${status}`,
    );
  }
}
