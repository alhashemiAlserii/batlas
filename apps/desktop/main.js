// Batlas desktop: opens the live site in a locked-down Electron window.
// Override the site with BATLAS_URL=https://... (e.g. a custom domain or http://localhost:3400 for testing).
const { app, BrowserWindow, shell, session } = require('electron');
const path = require('node:path');

const SITE = new URL(process.env.BATLAS_URL || 'https://batlas-2je9.onrender.com');
const sameSite = (u) => { try { return new URL(u).origin === SITE.origin; } catch { return false; } };

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 360, minHeight: 600,
    backgroundColor: '#020a24', title: 'Batlas',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  });
  // Stay on the Batlas origin; everything else (YouTube, links out) opens in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => { if (!sameSite(url)) shell.openExternal(url); return { action: sameSite(url) ? 'allow' : 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!sameSite(url)) { e.preventDefault(); shell.openExternal(url); } });
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (isMain && code !== -3) win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<body style="background:#020a24;color:#fff;font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h1>Batlas is unreachable</h1><p>${desc}. Check your connection.</p><p><a style="color:#19d3e6" href="${SITE.href}">Try again</a></p></div></body>`)}`);
  });
  win.loadURL(SITE.href);
}

app.whenReady().then(() => {
  // No camera/mic/geolocation etc. for the wrapper.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'fullscreen'));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
