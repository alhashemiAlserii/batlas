import { createDb, migrate } from '../db/index.js';
import { loadConfig, dbTarget } from '../config.js';
const db = createDb(dbTarget());
await migrate(db);
console.log('Migrations up to date.');
await db.destroy();
