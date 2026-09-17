import { seedBaseline } from '../packages/database/seeds/baseline.js';

seedBaseline().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
