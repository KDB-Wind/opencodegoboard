import { getCurrentWindow } from '@tauri-apps/api/window';
import { getName, getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const desktop = {
  platform: navigator.userAgent.includes('Windows') ? 'win32' : 'other',
  getVersion,
  getName,
  minimize: () => getCurrentWindow().minimize(),
  maximize: () => getCurrentWindow().toggleMaximize(),
  isMaximized: () => getCurrentWindow().isMaximized(),
  close: () => invoke<string>('request_close'),
  closeConfirm: (action: string) => invoke<string>('close_confirm', { action }),
  openExternal: (url: string) => invoke<void>('open_external', { url }),
  restartBackend: () => invoke<void>('restart_application'),
  loginOpenCodeSystem: () => invoke<boolean>('open_opencode_login'),
  installUpdate: () => invoke<boolean>('install_update'),
  getTrayMode: () => invoke<boolean>('get_tray_mode'),
  setTrayMode: (enabled: boolean) => invoke<boolean>('set_tray_mode', { enabled }),
  onCloseDialogRequest: (callback: () => void) => {
    let unlisten: (() => void) | undefined;
    void listen('close-dialog-request', callback).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  },
  onMaximizedChange: (callback: (maximized: boolean) => void) => {
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onResized(async () => callback(await getCurrentWindow().isMaximized())).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  },
};
