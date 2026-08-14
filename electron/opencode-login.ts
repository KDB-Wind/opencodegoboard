import { BrowserWindow, session, WebContentsView } from 'electron';
import path from 'path';
import { randomUUID } from 'crypto';
import { resolveWorkspaceId } from './backend/quota';

export type OpenCodeLoginResult =
  | { status: 'ok'; workspace_id: string; auth_cookie: string }
  | { status: 'cancelled' }
  | { status: 'error'; error: string };

const LOGIN_BASE = 'https://auth.opencode.ai/authorize';
const LOGIN_CLIENT_ID = 'app';
const LOGIN_REDIRECT_URI = 'https://opencode.ai/auth/callback';
const AUTH_COOKIE_NAME = 'auth';
const AUTH_COOKIE_URL = 'https://opencode.ai';
const COOKIE_POLL_MS = 500;
const URL_SETTLE_MS = 5000;
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const BAR_HEIGHT = 38;
const BAR_HTML = `<html><head><meta charset="utf-8"></head><body></body></html>`;
const WORKSPACE_URL_RE = /\/workspace\/(wrk_[A-Za-z0-9]+)/;

function isAllowedLoginHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'opencode.ai' || h.endsWith('.opencode.ai');
}

let activeLogin: Promise<OpenCodeLoginResult> | null = null;

export function loginStartUrl(): string {
  const params = new URLSearchParams({
    client_id: LOGIN_CLIENT_ID,
    redirect_uri: LOGIN_REDIRECT_URI,
    response_type: 'code',
    state: randomUUID(),
  });
  return `${LOGIN_BASE}?${params.toString()}`;
}

function readWorkspaceId(url: string): string | null {
  const match = WORKSPACE_URL_RE.exec(url);
  return match ? match[1] : null;
}

export function startOpenCodeLogin(opts: { parent?: BrowserWindow | null } = {}): Promise<OpenCodeLoginResult> {
  if (activeLogin) {
    return Promise.resolve({ status: 'error', error: '已有登录窗口正在打开' });
  }
  activeLogin = runLogin(opts).finally(() => {
    activeLogin = null;
  });
  return activeLogin;
}

function runLogin(opts: { parent?: BrowserWindow | null }): Promise<OpenCodeLoginResult> {
  return new Promise((resolve) => {
    const partition = `opencode-login-${randomUUID()}`;
    const ses = session.fromPartition(partition);
    let done = false;
    let authCookie: string | null = null;
    let urlWorkspace: string | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout>;

    const win = new BrowserWindow({
      width: 1000,
      height: 760,
      frame: false,
      parent: opts.parent ?? undefined,
      modal: false,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    const barView = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'login-bar-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.contentView.addChildView(barView);

    const pageView = new WebContentsView({
      webPreferences: {
        session: ses,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.contentView.addChildView(pageView);

    // 拒绝所有权限请求(摄像头/麦克风/通知等),Electron 默认是全部放行
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);

    // 新窗口一律不打开;白名单内站点改为在当前视图内导航
    pageView.webContents.setWindowOpenHandler(({ url }) => {
      try {
        if (isAllowedLoginHost(new URL(url).hostname)) {
          void pageView.webContents.loadURL(url);
        }
      } catch {
        // ignore malformed url
      }
      return { action: 'deny' };
    });

    // 导航白名单,防止登录过程中被重定向到钓鱼站点
    pageView.webContents.on('will-navigate', (event, url) => {
      try {
        if (!isAllowedLoginHost(new URL(url).hostname)) event.preventDefault();
      } catch {
        event.preventDefault();
      }
    });

    const layout = () => {
      const [width, height] = win.getContentSize();
      barView.setBounds({ x: 0, y: 0, width, height: BAR_HEIGHT });
      pageView.setBounds({ x: 0, y: BAR_HEIGHT, width, height: Math.max(0, height - BAR_HEIGHT) });
    };
    win.on('resize', layout);
    layout();

    win.on('maximize', () => barView.webContents.send('login-bar-maximized', true));
    win.on('unmaximize', () => barView.webContents.send('login-bar-maximized', false));

    let pageLoading = false;
    let barReady = false;
    const setPageLoading = (loading: boolean) => {
      pageLoading = loading;
      if (barReady) {
        barView.webContents.send('login-bar-loading', loading);
      }
    };
    barView.webContents.on('did-finish-load', () => {
      barReady = true;
      barView.webContents.send('login-bar-loading', pageLoading);
    });
    pageView.webContents.on('did-start-loading', () => setPageLoading(true));
    pageView.webContents.on('did-stop-loading', () => setPageLoading(false));

    barView.webContents.on('ipc-message', (_event, channel, action) => {
      if (channel !== 'login-bar' || typeof action !== 'string') return;
      if (action === 'back') {
        pageView.webContents.goBack();
      } else if (action === 'minimize') {
        win.minimize();
      } else if (action === 'maximize') {
        if (win.isMaximized()) {
          win.unmaximize();
        } else {
          win.maximize();
        }
      } else if (action === 'close') {
        win.close();
      }
    });

    const finish = (result: OpenCodeLoginResult) => {
      if (done) return;
      done = true;
      if (pollTimer) clearInterval(pollTimer);
      if (settleTimer) clearTimeout(settleTimer);
      clearTimeout(timeoutTimer);
      if (!win.isDestroyed()) {
        win.destroy();
      }
      // 清理登录分区内存中的 cookie/缓存
      void ses.clearStorageData();
      void ses.clearCache();
      resolve(result);
    };

    timeoutTimer = setTimeout(() => {
      finish({ status: 'error', error: '登录超时，请重试' });
    }, LOGIN_TIMEOUT_MS);

    const checkCookie = async () => {
      try {
        const cookies = await ses.cookies.get({ url: AUTH_COOKIE_URL });
        const auth = cookies.find((c) => c.name === AUTH_COOKIE_NAME && c.value);
        if (!auth) return;
        authCookie = `auth=${auth.value}`;
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        settleTimer = setTimeout(() => {
          void finalize();
        }, URL_SETTLE_MS);
      } catch {
        // ignore transient errors while logging in
      }
    };

    const finalize = async () => {
      try {
        const cookie = authCookie;
        if (!cookie) return;
        let workspaceId = urlWorkspace;
        if (!workspaceId) {
          workspaceId = await resolveWorkspaceId('Default', cookie);
        }
        finish({ status: 'ok', workspace_id: workspaceId, auth_cookie: cookie });
      } catch (exc) {
        finish({ status: 'error', error: String(exc instanceof Error ? exc.message : exc) });
      }
    };

    const onNavigate = (_event: Electron.Event, url: string) => {
      const found = readWorkspaceId(url);
      if (found) urlWorkspace = found;
    };

    pageView.webContents.on('will-navigate', onNavigate);
    pageView.webContents.on('did-navigate', onNavigate);
    pageView.webContents.on('did-navigate-in-page', onNavigate);

    win.on('closed', () => {
      if (!done) {
        finish({ status: 'cancelled' });
      }
    });

    pollTimer = setInterval(() => {
      void checkCookie();
    }, COOKIE_POLL_MS);

    void barView.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(BAR_HTML)}`);
    void pageView.webContents.loadURL(loginStartUrl());
    win.show();
  });
}
