import { app, BrowserWindow, ipcMain, Menu, nativeImage, shell, Tray } from 'electron';
import path from 'path';
import fs from 'fs';
import { loginStartUrl, startOpenCodeLogin } from './opencode-login';
import { loadOrCreateAuthToken, setDataDir } from './backend/config';
import {
  isBackendRunning,
  restartBackendServer,
  startBackendServer,
  stopBackendServer,
} from './backend/server';

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-features', 'Autofill');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=384');

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let trayMode = false;
let trayConfigured = false;
let savedBounds: Electron.Rectangle | null = null;

const BACKEND_PORT = 8788;
const BACKEND_HOST = '127.0.0.1';
let backendPort = BACKEND_PORT;

const EXTERNAL_LINK_ALLOWLIST = ['opencode.ai', 'github.com'];

// 数据迁移:检测旧版本 userData 目录并整体移动(保留加密密钥与数据库),避免重新登录。
function migrateUserData(): void {
  try {
    const oldDir = path.join(app.getPath('appData'), '68hub');
    const newDir = app.getPath('userData');
    if (oldDir !== newDir && fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
      fs.renameSync(oldDir, newDir);
      console.log(`[migrate] moved userData ${oldDir} -> ${newDir}`);
    }
  } catch (err) {
    console.warn('[migrate] failed:', err);
  }
}

function trayConfigPath(): string {
  return path.join(app.getPath('userData'), 'tray.json');
}

function saveTrayPreference(mode: boolean, configured: boolean) {
  trayMode = mode;
  trayConfigured = configured;
  try {
    fs.mkdirSync(path.dirname(trayConfigPath()), { recursive: true });
    fs.writeFileSync(trayConfigPath(), JSON.stringify({ trayMode: mode, trayConfigured: configured }), 'utf-8');
  } catch {
    // ignore
  }
}

function loadTrayPreference() {
  try {
    const raw = fs.readFileSync(trayConfigPath(), 'utf-8');
    const data = JSON.parse(raw);
    trayMode = data.trayMode === true;
    trayConfigured = data.trayConfigured === true;
  } catch {
    trayMode = false;
    trayConfigured = false;
  }
}

function backendDataDir(): string {
  return path.join(app.getPath('userData'), 'data');
}

async function startBackend() {
  try {
    const result = await startBackendServer({
      host: BACKEND_HOST,
      port: BACKEND_PORT,
      dataDir: backendDataDir(),
    });
    backendPort = result.port;
  } catch (err) {
    console.error('[backend] failed to start:', err);
  }
}

async function stopBackend() {
  try {
    await stopBackendServer();
  } catch (err) {
    console.error('[backend] failed to stop:', err);
  }
}

function createTray() {
  if (!trayMode) return;
  if (tray) return;

  const iconPath = path.join(__dirname, isDev ? '../public/icon.png' : '../dist/icon.png');
  let icon: Electron.NativeImage;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) throw new Error('empty icon');
  } catch {
    icon = nativeImage.createEmpty();
  }
  if (process.platform === 'darwin') {
    icon = icon.resize({ width: 16, height: 16 });
  } else {
    icon = icon.resize({ width: 32, height: 32 });
  }
  tray = new Tray(icon);
  tray.setToolTip('OpenCodeBoard');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        trayMode = false;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  const isWindows = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  mainWindow = new BrowserWindow({
    ...(savedBounds
      ? { x: savedBounds.x, y: savedBounds.y, width: savedBounds.width, height: savedBounds.height }
      : { width: 1100, height: 720 }),
    frame: !isWindows,
    titleBarStyle: isWindows ? 'hidden' : isMac ? 'hiddenInset' : 'default',
    icon: path.join(__dirname, isDev ? '../favicon.ico' : '../dist/favicon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  Menu.setApplicationMenu(null);

  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (isDev && input.key === 'F12') {
      mainWindow?.webContents.toggleDevTools();
    }
  });

  // 托盘模式下关闭窗口 = 销毁窗口释放内存(渲染进程 ~120MB),主进程与后端继续驻留
  mainWindow.on('close', (event) => {
    if (trayMode) {
      event.preventDefault();
      savedBounds = mainWindow?.getBounds() ?? null;
      mainWindow?.destroy();
      mainWindow = null;
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window-maximized-changed', true);
  });

  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window-maximized-changed', false);
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('get-app-name', () => app.getName());
ipcMain.on('get-backend-port', (event) => {
  event.returnValue = backendPort;
});

ipcMain.on('get-backend-token', (event) => {
  setDataDir(backendDataDir());
  event.returnValue = loadOrCreateAuthToken();
});

ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.handle('window-close', async () => {
  if (trayMode) {
    savedBounds = mainWindow?.getBounds() ?? null;
    mainWindow?.destroy();
    mainWindow = null;
    return 'hide';
  }
  mainWindow?.close();
  return 'quit';
});

ipcMain.handle('close-confirm', async (_event, action: string) => {
  if (action === 'hide') {
    saveTrayPreference(true, true);
    createTray();
    savedBounds = mainWindow?.getBounds() ?? null;
    mainWindow?.destroy();
    mainWindow = null;
    return 'hide';
  }
  saveTrayPreference(false, true);
  app.quit();
  return 'quit';
});

ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() ?? false);

ipcMain.handle('open-external', (_event, url: string) => {
  let parsed: URL;
  try {
    parsed = new URL(String(url ?? ''));
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  const allowed = EXTERNAL_LINK_ALLOWLIST.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
  if (!allowed) return false;
  void shell.openExternal(parsed.toString());
  return true;
});

ipcMain.handle('restart-backend', async () => {
  const result = await restartBackendServer({
    host: BACKEND_HOST,
    port: BACKEND_PORT,
    dataDir: backendDataDir(),
  });
  backendPort = result.port;
  return true;
});

ipcMain.handle('opencode-login-start', () =>
  startOpenCodeLogin({ parent: mainWindow }),
);

// 在系统默认浏览器(Edge/Chrome)中打开登录页;
// 登录 cookie 落在浏览器中,需用户手动复制回应用
ipcMain.handle('opencode-login-system', () => {
  void shell.openExternal(loginStartUrl());
  return true;
});

ipcMain.handle('backend-pid', () => {
  return isBackendRunning() ? process.pid : null;
});

ipcMain.handle('get-tray-mode', () => trayMode);

ipcMain.handle('set-tray-mode', (_event, v: boolean) => {
  saveTrayPreference(v, true);
  if (v) {
    createTray();
  } else {
    destroyTray();
  }
  return true;
});

app.whenReady().then(async () => {
  migrateUserData();
  loadTrayPreference();
  await startBackend();
  createWindow();
  if (trayMode) createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow?.show();
    }
  });
});

app.on('window-all-closed', () => {
  if (trayMode) return;
  void stopBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  void stopBackend();
  destroyTray();
});

app.on('will-quit', () => {
  void stopBackend();
  destroyTray();
});
