import jwt from 'jsonwebtoken';

const VALID_ROLES = ['viewer', 'operator', 'researcher', 'admin'] as const;
type Role = (typeof VALID_ROLES)[number];

/**
 * Mints a local dev JWT. This is the ONLY place a token is ever issued in
 * this project (rule 1.7 of the plan) — there is deliberately no
 * `POST /auth/token` HTTP endpoint, public or otherwise. Persisted
 * users/refresh-sessions and real login are Phase 14.
 */
export function tokenCommand(options: { role: string }): void {
  if (process.env['DEV_AUTH_MODE'] !== 'true') {
    console.error('DEV_AUTH_MODE is not enabled — refusing to mint a token.');
    process.exitCode = 1;
    return;
  }

  if (!VALID_ROLES.includes(options.role as Role)) {
    console.error(`Invalid role '${options.role}'. Must be one of: ${VALID_ROLES.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const secret = process.env['JWT_SECRET'] ?? 'chronoscope-dev-secret-change-me-24chars';
  const expiresIn = process.env['JWT_EXPIRY'] ?? '15m';
  const token = jwt.sign({ role: options.role }, secret, {
    expiresIn: expiresIn as NonNullable<jwt.SignOptions['expiresIn']>,
  });

  console.log(token);
}
