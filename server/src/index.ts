import { createDb, migrate } from './db/index.js';
import { createApp, DEV_DASHBOARD_PATH } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const db = createDb(config.dbFile);
await migrate(db);
const { app } = createApp(db);
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
app.listen(port, host, () => {
  console.log(`Studio server on http://localhost:${port}  (developer dashboard: ${DEV_DASHBOARD_PATH})`);
  if (!config.cookieSecure) console.log('WARNING: COOKIE_SECURE is off (local http dev). Use HTTPS + NODE_ENV=production for real deployments.');
});
