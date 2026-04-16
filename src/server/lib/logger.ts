/**
 * Minimal structured JSON logger for Cloudflare Workers.
 *
 * Workers Tail surfaces `console.log` output as single lines; emitting JSON
 * lets us pivot on `requestId`, `userId`, `action` etc. without a full SDK.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  [key: string]: unknown;
}

export interface Logger {
  debug(msg: string, extra?: LogContext): void;
  info(msg: string, extra?: LogContext): void;
  warn(msg: string, extra?: LogContext): void;
  error(msg: string, extra?: LogContext): void;
  /** Returns a new logger with the given fields merged into every emission. */
  child(extra: LogContext): Logger;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function emit(level: LogLevel, ctx: LogContext, msg: string, extra?: LogContext) {
  // Use console.* so Workers Tail captures it. Level routing keeps `warn`
  // and `error` visible in Cloudflare's default log filter.
  const payload = {
    level,
    time: new Date().toISOString(),
    msg,
    ...ctx,
    ...(extra ?? {}),
  };
  const line = safeStringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj, (_, v) =>
      v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v,
    );
  } catch {
    return JSON.stringify({ level: "error", msg: "log serialization failed" });
  }
}

export function createLogger(
  base: LogContext = {},
  minLevel: LogLevel = "info",
): Logger {
  const threshold = LEVEL_RANK[minLevel];
  const maybeEmit = (level: LogLevel, msg: string, extra?: LogContext) => {
    if (LEVEL_RANK[level] < threshold) return;
    emit(level, base, msg, extra);
  };
  return {
    debug: (m, e) => maybeEmit("debug", m, e),
    info: (m, e) => maybeEmit("info", m, e),
    warn: (m, e) => maybeEmit("warn", m, e),
    error: (m, e) => maybeEmit("error", m, e),
    child: (extra) => createLogger({ ...base, ...extra }, minLevel),
  };
}

/**
 * Deterministic-looking request id. ULID-ish: time + random, so lexical sort
 * ≈ chronological. Not cryptographically rigorous — that's not the point.
 */
export function generateRequestId(): string {
  const time = Date.now().toString(36).padStart(9, "0");
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${time}-${rand}`;
}
