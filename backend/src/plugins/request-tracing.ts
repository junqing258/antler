import { context, propagation, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { tracer, traceFields } from "../telemetry/tracing.js";

declare module "fastify" {
  interface FastifyRequest {
    antlerTraceSpan: Span | null;
  }
}

export function registerRequestTracing(app: FastifyInstance) {
  const finishers = new WeakMap<FastifyRequest, (aborted: boolean) => void>();
  app.decorateRequest("antlerTraceSpan", null);
  app.addHook("onRequest", (request, reply, done) => {
    // Health probes stay available and logged without creating trace spans.
    if (request.url.split("?", 1)[0] === "/health") {
      done();
      return;
    }
    // Extract trace context only; do not collect baggage, authentication or query strings.
    const parent = propagation.extract(ROOT_CONTEXT, {
      traceparent: request.headers.traceparent,
      tracestate: request.headers.tracestate,
    });
    const span = tracer().startSpan(`HTTP ${request.method}`, {
      kind: SpanKind.SERVER,
      attributes: { "http.request.method": request.method, "antler.request.id": request.id },
    }, parent);
    request.antlerTraceSpan = span;
    const fields = traceFields(span);
    if (fields) reply.header("x-trace-id", fields.trace_id);
    let ended = false;
    const finish = (aborted: boolean) => {
      if (ended) return;
      ended = true;
      finishers.delete(request);
      reply.raw.removeListener("finish", onFinish);
      reply.raw.removeListener("close", onClose);
      const route = request.routeOptions.url ?? "unmatched";
      span.updateName(`${request.method} ${route}`);
      span.setAttributes({ "http.route": route, "http.response.status_code": reply.statusCode });
      if (aborted) span.setAttribute("antler.request.aborted", true);
      if (reply.statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
    };
    const onFinish = () => finish(false);
    const onClose = () => finish(!reply.raw.writableFinished);
    finishers.set(request, finish);
    reply.raw.once("finish", onFinish);
    reply.raw.once("close", onClose);
    context.with(trace.setSpan(parent, span), done);
  });
  // inject() does not emit the same socket lifecycle as a real response.
  app.addHook("onResponse", async (request) => {
    finishers.get(request)?.(false);
  });
}
