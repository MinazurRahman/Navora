// Used by the Knex CLI (npm run migrate:latest, etc.). Same settings as the running app.
import { env } from './src/config/env.js';
import { buildKnexConfig } from './src/config/database.js';

export default buildKnexConfig(env);
