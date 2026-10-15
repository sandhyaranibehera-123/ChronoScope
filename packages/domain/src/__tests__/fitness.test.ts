import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DOMAIN_SRC_DIR = resolve(__dirname, '..');

const FORBIDDEN_IMPORT_PATTERNS = [
  /@chronoscope\/database/,
  /@chronoscope\/read-store/,
  /@chronoscope\/messaging/,
  /@chronoscope\/testing/,
  /apps\//,
  /mysql2/,
  /mongodb/,
  /redis/,
  /ioredis/,
  /kafkajs/,
  /amqplib/,
  /nats/,
  /fastify/,
  /express/,
];

function getAllTsFiles(dir: string): string[] {
  const files: string[] = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (entry !== '__tests__' && entry !== 'node_modules' && entry !== 'dist') {
        files.push(...getAllTsFiles(fullPath));
      }
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('Architecture Fitness v1 — Rule 2: Pure Domain Isolation', () => {
  it('verifies that domain code never imports database, read-store, messaging, or web packages', () => {
    const tsFiles = getAllTsFiles(DOMAIN_SRC_DIR);
    expect(tsFiles.length).toBeGreaterThan(5);

    const violations: Array<{ file: string; line: string }> = [];

    for (const filePath of tsFiles) {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      for (const line of lines) {
        // match import ... from '...' or import('...')
        if (line.includes('import ') || line.includes('from ') || line.includes('require(')) {
          for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
            if (pattern.test(line)) {
              violations.push({ file: filePath, line: line.trim() });
            }
          }
        }
      }
    }

    expect(
      violations,
      `Rule 2 Violation: Found forbidden imports in packages/domain:\n${violations
        .map((v) => `  ${v.file}: ${v.line}`)
        .join('\n')}`,
    ).toEqual([]);
  });
});
