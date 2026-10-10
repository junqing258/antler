import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";

function formatTimestamp(date: Date) {
  const pad = (value: number, length = 2) =>
    String(value).padStart(length, "0");
  return (
    `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
  );
}

export function createRequestId() {
  const timestamp = formatTimestamp(new Date())
    .slice(0, 19)
    .replace(/[- :]/g, "");
  return `${timestamp}_${randomBytes(8).toString("hex")}`;
}

function supportsColor() {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.NO_COLOR !== undefined ||
    process.env.FORCE_COLOR === "0"
  ) {
    return false;
  }
  // FORCE_COLOR also supports dev runners that pipe the server's output.
  return (
    process.env.FORCE_COLOR !== undefined ||
    (process.stdout.isTTY === true && process.env.TERM !== "dumb")
  );
}

export function registerRequestLogging(app: FastifyInstance) {
  app.addHook("onResponse", async (request, reply) => {
    const useColor = supportsColor();
    const color = (value: string, code: number) =>
      useColor ? `\u001b[${code}m${value}\u001b[0m` : value;
    const statusColor =
      reply.statusCode >= 500 ? 31 :
        reply.statusCode >= 400 ? 33 : reply.statusCode >= 300 ? 36 : 32;
    // EventSource URLs can contain an access token; only log the pathname.
    const path = request.url.split("?", 1)[0];
    console.info(
      `${color(formatTimestamp(new Date()), 90)} ${color("INFO", 32)}     ` +
        `${color("app", 35)} api_request_completed ` +
        `request_id=${request.id} method=${color(request.method, 36)} path=${path} ` +
        `status=${color(String(reply.statusCode), statusColor)} duration_ms=${Math.round(reply.elapsedTime)}`,
    );
  });
}
