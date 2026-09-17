#!/usr/bin/env node
import { Command } from 'commander';
import { doctorCommand } from './commands/doctor.js';
import { tokenCommand } from './commands/token.js';

const program = new Command();

program.name('chronoscope').description('CHRONOSCOPE CLI').version('0.1.0');

// Grows incrementally: rebuild-projection (Phase 5+), replay (Phase 6+),
// branch (Phase 7+), seed/benchmark (Phase 13+), audit (Phase 16 full scope).
// Only doctor + token ship in Phase 1 — don't build ahead of the backing capability.

program
  .command('doctor')
  .description('Check infrastructure health (mode-aware)')
  .action(async () => {
    await doctorCommand();
  });

program
  .command('token')
  .description('Mint a local dev JWT (requires DEV_AUTH_MODE=true)')
  .requiredOption('--role <role>', 'viewer | operator | researcher | admin')
  .action((options: { role: string }) => {
    tokenCommand(options);
  });

program.parse();
