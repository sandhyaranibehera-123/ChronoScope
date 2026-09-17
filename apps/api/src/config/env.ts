import { parseEnv, type Env } from '@chronoscope/contracts';

let cached: Env | undefined;

/** Parses process.env once via the shared Zod contract and caches the result. */
export function getEnv(): Env {
  if (!cached) {
    cached = parseEnv();
  }
  return cached;
}
