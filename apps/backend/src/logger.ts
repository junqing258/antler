/**
 * 统一日志组件：单行结构化文本，格式由 request-logging 测试固定：
 * `<ts> <LEVEL> <tag> <message> key=value...`；Error 字段内联摘要、堆栈另起一行。
 */

const LEVEL_WEIGHT = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type LogLevel = keyof typeof LEVEL_WEIGHT;
export type LoggerFields = Record<string, unknown>;

const LEVEL_COLORS: Record<LogLevel, number> = {
  debug: 90,
  info: 32,
  warn: 33,
  error: 31,
};
const SINKS: Record<LogLevel, (line: string) => void> = {
  debug: (line) => console.debug(line),
  info: (line) => console.info(line),
  warn: (line) => console.warn(line),
  error: (line) => console.error(line),
};

function parseLevel(value: string | undefined): LogLevel {
  return value === "debug" ||
    value === "info" ||
    value === "warn" ||
    value === "error"
    ? value
    : "info";
}
const THRESHOLD = LEVEL_WEIGHT[parseLevel(process.env.LOG_LEVEL)];

export function supportsColor() {
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

export function color(value: string, code: number) {
  return `\u001b[${code}m${value}\u001b[0m`;
}

export function formatTimestamp(date: Date) {
  const pad = (value: number, length = 2) => String(value).padStart(length, "0");
  return (
    `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
  );
}

function formatScalar(value: unknown): string {
  if (typeof value === "string") return /\s/.test(value) ? JSON.stringify(value) : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export interface Logger {
  debug(message: string, fields?: LoggerFields): void;
  info(message: string, fields?: LoggerFields): void;
  warn(message: string, fields?: LoggerFields): void;
  error(message: string, fields?: LoggerFields): void;
  /** 同名 tag、预置附加字段的子 logger（如按 runId/conversationId 绑定）。 */
  child(fields: LoggerFields): Logger;
}

export function createLogger(tag: string, base?: LoggerFields): Logger {
  const emit = (level: LogLevel, message: string, fields?: LoggerFields) => {
    if (LEVEL_WEIGHT[level] < THRESHOLD) return;
    const merged = { ...base, ...fields };
    const parts: string[] = [];
    let stack: string | undefined;
    for (const [key, value] of Object.entries(merged)) {
      if (value === undefined) continue;
      if (value instanceof Error && stack === undefined) stack = value.stack;
      parts.push(`${key}=${formatScalar(value)}`);
    }
    const useColor = supportsColor();
    const paint = (value: string, code: number) =>
      useColor ? color(value, code) : value;
    const levelText = level.toUpperCase();
    const line =
      `${paint(formatTimestamp(new Date()), 90)} ` +
      `${paint(levelText, LEVEL_COLORS[level])} ` +
      `${paint(tag, 35)} ${message}${parts.length ? ` ${parts.join(" ")}` : ""}`;
    SINKS[level](stack ? `${line}\n${stack}` : line);
  };
  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
    child: (fields) => createLogger(tag, { ...base, ...fields }),
  };
}
