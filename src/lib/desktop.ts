import { getCurrentWindow } from '@tauri-apps/api/window';
import { getName, getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const electron = typeof window !== 'undefined' ? window.electronAPI : undefined;

export const desktop = {
  platform: isTauri ? 'win32' : electron?.platform ?? 'web',
  getVersion: () => isTauri ? getVersion() : electron?.getVersion() ?? Promise.resolve('dev'),
  getName: () => isTauri ? getName() : electron?.getName() ?? Promise.resolve('OpenCodeGoBoard'),
  minimize: () => isTauri ? getCurrentWindow().minimize() : electron?.window.minimize(),
  maximize: async () => { if (isTauri) return getCurrentWindow().toggleMaximize(); electron?.window.maximize(); },
  isMaximized: () => isTauri ? getCurrentWindow().isMaximized() : electron?.window.isMaximized() ?? Promise.resolve(false),
  close: () => isTauri ? invoke<string>('request_close') : electron?.window.close() ?? Promise.resolve('quit'),
  closeConfirm: (action: string) => isTauri ? invoke<string>('close_confirm', { action }) : electron?.closeConfirm(action) ?? Promise.resolve(action),
  openExternal: (url: string) => isTauri ? invoke<void>('open_external', { url }) : electron?.openExternal(url) ?? Promise.resolve(),
  restartBackend: () => isTauri ? Promise.resolve(true) : electron?.restartBackend() ?? Promise.resolve(false),
  loginOpenCode: () => isTauri
    ? Promise.resolve({ status: 'error', error: '请使用系统浏览器登录并手动粘贴凭据' } as const)
    : electron?.loginOpenCode() ?? Promise.resolve({ status: 'error', error: 'desktop API unavailable' } as const),
  loginOpenCodeSystem: () => isTauri ? invoke<boolean>('open_opencode_login') : electron?.loginOpenCodeSystem() ?? Promise.resolve(false),
  getTrayMode: () => isTauri ? invoke<boolean>('get_tray_mode') : electron?.getTrayMode() ?? Promise.resolve(false),
  setTrayMode: (enabled: boolean) => isTauri ? invoke<boolean>('set_tray_mode', { enabled }) : electron?.setTrayMode(enabled) ?? Promise.resolve(false),
  onCloseDialogRequest: (callback: () => void) => {
    if (isTauri) {
      let unlisten: (() => void) | undefined;
      void listen('close-dialog-request', callback).then((fn) => { unlisten = fn; });
      return () => unlisten?.();
    }
    return electron?.onCloseDialogRequest(callback) ?? (() => {});
  },
  onMaximizedChange: (callback: (maximized: boolean) => void) => {
    if (isTauri) {
      let unlisten: (() => void) | undefined;
      void getCurrentWindow().onResized(async () => callback(await getCurrentWindow().isMaximized())).then((fn) => { unlisten = fn; });
      return () => unlisten?.();
    }
    return electron?.onMaximizedChange(callback) ?? (() => {});
  },
};
