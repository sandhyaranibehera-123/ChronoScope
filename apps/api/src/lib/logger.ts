import { createLogger } from '@chronoscope/observability';
import { getEnv } from '../config/env.js';

export const logger = createLogger({ name: 'chronoscope-api', level: getEnv().LOG_LEVEL });
