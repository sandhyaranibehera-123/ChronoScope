import pino from 'pino';

export interface LoggerOptions {
  level?: string;
  name?: string;
}

/**
 * Structured JSON logging via Pino, stdout-only.
 *
 * Loki is deliberately excluded from this project's stack — Pino JSON to
 * stdout (`docker compose logs -f <service> | jq`) is enough for a solo
 * lab environment, and it's one fewer container on an 8 GB host.
 *
 * OpenTelemetry is bootstrapped here later (Phase 4, once there's an actual
 * domain event to trace) — Phase 1-3 use Pino only, on purpose.
 */
export function createLogger(options: LoggerOptions = {}): pino.Logger {
  return pino({
    name: options.name ?? 'chronoscope',
    level: options.level ?? process.env['LOG_LEVEL'] ?? 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  });
}

export type { Logger } from 'pino';
