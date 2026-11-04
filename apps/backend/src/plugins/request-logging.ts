import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  color,
  createLogger,
  formatTimestamp,
  supportsColor,
  type LoggerFields,
} from "../logger.js";
import { traceFields } from "../telemetry/tracing.js";

export function createRequestId() {
  const timestamp = formatTimestamp(new Date())
    .slice(0, 19)
    .replace(/[- :]/g, "");
  return `${timestamp}_${randomBytes(8).toString("hex")}`;
}

const logger = createLogger("app");

export function registerRequestLogging(app: FastifyInstance) {
  app.addHook("onResponse", async (request, reply) => {
    const useColor = supportsColor();
    const paint = (value: string, code: number) =>
      useColor ? color(value, code) : value;
    const statusColor =
      reply.statusCode >= 500 ? 31 :
        reply.statusCode >= 400 ? 33 : reply.statusCode >= 300 ? 36 : 32;
    // EventSource URLs can contain an access token; only log the pathname.
    const path = request.url.split("?", 1)[0];
    const fields = traceFields(request.antlerTraceSpan ?? undefined);
    logger.info("api_request_completed", {
      request_id: request.id,
      method: paint(request.method, 36),
      path,
      status: paint(String(reply.statusCode), statusColor),
      ...(fields ?? {}),
      duration_ms: Math.round(reply.elapsedTime),
    } satisfies LoggerFields);
  });
}
