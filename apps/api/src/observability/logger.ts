/**
 * Centralized structured logging (PART 00 §22, §29; PART 01 §29).
 *
 * Every log line is JSON with a consistent shape. Sensitive fields are
 * redacted centrally here rather than trusted to be omitted ad hoc at
 * every call site.
 */
import pino from "pino";
import { env } from "../config/env.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.apiKey",
      "*.secret",
      "*.password",
      "*.token",
      "*.razorpayKeySecret",
      "*.webhookSecret",
    ],
    censor: "[REDACTED]",
  },
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" } }
      : undefined,
});

export type Logger = typeof logger;
