import { createDb, migrate } from './db/index.js';
import { bootstrapDeveloper } from './lib/bootstrap.js';
import { ensureBuiltInGames } from './lib/seed-games.js';
import { createApp, DEV_DASHBOARD_PATH } from './app.js';
import { loadConfig, dbTarget } from './config.js';
import { attachGameServer, WS_PATH } from './game-server/server.js';
import { httpSiteBridge } from './game-server/bridge.js';

const config = loadConfig();
const db = createDb(dbTarget(config));
await migrate(db);
await bootstrapDeveloper(db);
await ensureBuiltInGames(db);
const { app } = createApp(db);
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const server = app.listen(port, host, () => {
  console.log(`Studio server on http://localhost:${port} [${config.databaseUrl ? 'postgres' : 'sqlite'}]  (developer dashboard: ${DEV_DASHBOARD_PATH})`);
  if (!config.cookieSecure) console.log('WARNING: COOKIE_SECURE is off (local http dev). Use HTTPS + NODE_ENV=production for real deployments.');
});

if (config.gameServerKey) {
  // The game server verifies players through the site's HTTP API (same as a separate process would).
  attachGameServer(server, { bridge: httpSiteBridge(process.env.SITE_URL ?? `http://127.0.0.1:${port}`, config.gameServerKey) });
  console.log(`Sky Crew game server on ws://localhost:${port}${WS_PATH}`);
} else console.log('GAME_SERVER_KEY not set: co-op game server disabled.');

// Render (and most hosts) send SIGTERM on deploys: finish open requests, then close the DB pool.
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sig, () => {
    console.log(`${sig}: shutting down`);
    server.close(() => void db.destroy().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 8000).unref();
  });
}
