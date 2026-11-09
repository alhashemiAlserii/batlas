import { createDb, migrate } from '../db/index.js';
import { loadConfig } from '../config.js';
const db = createDb(loadConfig().dbFile);
await migrate(db);
console.log('Migrations up to date.');
await db.destroy();
