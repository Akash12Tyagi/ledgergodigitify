import pino from "pino";

// Section 10.13 — structured logging. Every request log line carries
// { correlationId, userId, path, ms, outcome }; financial mutations
// additionally carry { action, entityId, amountPaise }. Secrets are
// redacted regardless of nesting depth; PII+amount pairs never log at
// info level (debug only, and only in development).
const isDev = process.env.NODE_ENV === "development";

export const logger = pino({
  level: isDev ? "debug" : "info",
  redact: {
    paths: [
      "*.password",
      "*.passwordHash",
      "*.secret",
      "*.token",
      "*.authorization",
      "*.Authorization",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "[REDACTED]",
  },
  ...(isDev ? { transport: { target: "pino-pretty", options: { colorize: true } } } : {}),
});

export type LogFields = {
  correlationId?: string;
  userId?: string;
  path?: string;
  ms?: number;
  outcome?: "success" | "error";
  action?: string;
  entityId?: string;
  amountPaise?: number;
};
