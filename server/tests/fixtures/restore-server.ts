// Child process for the restore memory test: a real server on an empty database.
// Env: TARGET (sqlite file or postgres URL), PG_SCHEMA (optional), RESTORE_TOKEN, MAINTENANCE_MODE=true.
import { createDb, migrate } from '../../src/db/index.js';
import { createApp } from '../../src/app.js';

const db = createDb(process.env.TARGET!, process.env.PG_SCHEMA ? { schema: process.env.PG_SCHEMA } : {});
await migrate(db);
const { app } = createApp(db, { cookieSecure: false, restoreRateLimit: 100 });
const server = app.listen(0, '127.0.0.1', () => {
  const a = server.address();
  console.log(`PORT ${typeof a === 'object' && a ? a.port : 0}`);
});
server.requestTimeout = 0;
process.on('SIGTERM', () => server.close(() => void db.destroy().finally(() => process.exit(0))));
