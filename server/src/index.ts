import { createDb, migrate } from './db/index.js';
import { bootstrapDeveloper } from './lib/bootstrap.js';
import { createApp, DEV_DASHBOARD_PATH } from './app.js';
import { loadConfig, dbTarget } from './config.js';
import { attachGameServer, WS_PATH } from './game-server/server.js';
import { httpSiteBridge } from './game-server/bridge.js';
import { siteMaintenance } from './game-server/maintenance.js';

const config = loadConfig();
const db = createDb(dbTarget(config));
await migrate(db);
await bootstrapDeveloper(db);
// Live Sky Crew rooms for the dashboard's online view. Read-only snapshot of the game server's state;
// the game server code itself is not modified. Returns null when the game server is off.
let gameServer: ReturnType<typeof attachGameServer> | null = null;
const liveRooms = () => {
  if (!gameServer) return null;
  return [...gameServer.rooms.values()].map((r: any) => {
    const clients = r.clients instanceof Map ? [...r.clients.values()] : [];
    const host = r.clients instanceof Map ? r.clients.get(r.hostCid) : null;
    return {
      code: String(r.code), host: host?.user?.username ?? null,
      players: clients.filter((c: any) => !c.hidden).length,
      max: null, locked: !!r.locked, route: r.route ?? null, phase: r.phase ?? null,
    };
  });
};
const { app } = createApp(db, {}, { liveRooms });
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const server = app.listen(port, host, () => {
  console.log(`Studio server on http://localhost:${port} [${config.databaseUrl ? 'postgres' : 'sqlite'}]  (developer dashboard: ${DEV_DASHBOARD_PATH})`);
  if (!config.cookieSecure) console.log('WARNING: COOKIE_SECURE is off (local http dev). Use HTTPS + NODE_ENV=production for real deployments.');
});

// A restore upload (POST /api/internal/restore) can take longer than Node's default 5-minute request
// timeout. Only while RESTORE_TOKEN is configured (the restore window) allow up to 2 hours.
if (config.restoreToken && config.restoreToken.length >= 32) {
  server.requestTimeout = Number(process.env.RESTORE_REQUEST_TIMEOUT_MS ?? 2 * 60 * 60 * 1000);
  console.log('RESTORE_TOKEN is set: POST /api/internal/restore is enabled (only works in maintenance mode). Unset it when the restore is done.');
}

if (config.gameServerKey) {
  // The game server verifies players through the site's HTTP API (same as a separate process would).
  gameServer = attachGameServer(server, { bridge: httpSiteBridge(process.env.SITE_URL ?? `http://127.0.0.1:${port}`, config.gameServerKey), isMaintenance: siteMaintenance(db) });
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
