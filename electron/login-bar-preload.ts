import { ipcRenderer } from 'electron';

declare const document: any;

const BAR_HEIGHT = 38;
const isWindows = process.platform === 'win32';

const icons = {
  back: '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M7.5 1L2.5 5l5 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  minimize: '<svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="4.5" width="8" height="1" fill="currentColor"/></svg>',
  maximize: '<svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  restore: '<svg width="10" height="10" viewBox="0 0 10 10"><rect x="2.5" y="0.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M0.5 2.5v7h7" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  close: '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  lightClose: '<svg width="8" height="8" viewBox="0 0 8 8"><path d="M1.6 1.6l4.8 4.8M6.4 1.6l-4.8 4.8" stroke="#3b0000" stroke-width="1" stroke-linecap="round"/></svg>',
  lightMinimize: '<svg width="8" height="8" viewBox="0 0 8 8"><rect x="1" y="3.5" width="6" height="1" fill="#4d1f00"/></svg>',
  lightMaximize: '<svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 1h6v6H1z" fill="none" stroke="#003d12" stroke-width="1"/></svg>',
  lightRestore: '<svg width="8" height="8" viewBox="0 0 8 8"><rect x="2" y="0.5" width="5" height="5" fill="none" stroke="#003d12" stroke-width="1"/><path d="M0.5 2.5v5h5" fill="none" stroke="#003d12" stroke-width="1"/></svg>',
};

let maxButton: any = null;
let macMaxLight: any = null;
let loadingBar: any = null;

ipcRenderer.on('login-bar-maximized', (_event, maximized: boolean) => {
  if (maxButton) {
    maxButton.innerHTML = maximized ? icons.restore : icons.maximize;
    maxButton.title = maximized ? '还原' : '最大化';
  }
  if (macMaxLight) {
    macMaxLight.querySelector('span').innerHTML = maximized ? icons.lightRestore : icons.lightMaximize;
    macMaxLight.title = maximized ? '还原' : '最大化';
  }
});

ipcRenderer.on('login-bar-loading', (_event, loading: boolean) => {
  if (!loadingBar) return;
  loadingBar.style.display = loading ? 'block' : 'none';
});

function inlineStyle(entries: Array<[string, string]>): string {
  return entries.map(([key, value]) => `${key}:${value}`).join(';');
}

function makeButton(action: string, tooltip: string, html: string, danger = false, width = '46px'): any {
  const button = document.createElement('button');
  button.type = 'button';
  button.title = tooltip;
  button.innerHTML = html;
  button.style.cssText = inlineStyle([
    ['width', width],
    ['height', '100%'],
    ['border', 'none'],
    ['outline', 'none'],
    ['background', 'transparent'],
    ['color', 'rgba(0,0,0,0.55)'],
    ['cursor', 'pointer'],
    ['display', 'flex'],
    ['align-items', 'center'],
    ['justify-content', 'center'],
    ['-webkit-app-region', 'no-drag'],
  ]);
  button.addEventListener('mouseenter', () => {
    button.style.background = danger ? '#e81123' : 'rgba(0,0,0,0.06)';
    if (danger) button.style.color = '#ffffff';
  });
  button.addEventListener('mouseleave', () => {
    button.style.background = 'transparent';
    button.style.color = 'rgba(0,0,0,0.55)';
  });
  button.addEventListener('click', () => ipcRenderer.send('login-bar', action));
  return button;
}

function buildWindowsGroup(): any {
  const group = document.createElement('div');
  group.style.cssText = inlineStyle([
    ['display', 'flex'],
    ['height', '100%'],
    ['-webkit-app-region', 'no-drag'],
  ]);
  maxButton = makeButton('maximize', '最大化', icons.maximize);
  group.append(
    makeButton('back', '返回上一步', icons.back),
    makeButton('minimize', '最小化', icons.minimize),
    maxButton,
    makeButton('close', '关闭', icons.close, true),
  );
  return group;
}

function buildMacLights(): any {
  const container = document.createElement('div');
  container.style.cssText = inlineStyle([
    ['display', 'flex'],
    ['align-items', 'center'],
    ['height', '100%'],
    ['padding-left', '12px'],
    ['gap', '8px'],
    ['-webkit-app-region', 'no-drag'],
  ]);

  const light = (action: string, tooltip: string, color: string, icon: string): any => {
    const button = document.createElement('button');
    button.type = 'button';
    button.title = tooltip;
    button.style.cssText = inlineStyle([
      ['width', '12px'],
      ['height', '12px'],
      ['border', 'none'],
      ['border-radius', '50%'],
      ['background', color],
      ['padding', '0'],
      ['display', 'flex'],
      ['align-items', 'center'],
      ['justify-content', 'center'],
      ['cursor', 'default'],
      ['-webkit-app-region', 'no-drag'],
    ]);
    const iconEl = document.createElement('span');
    iconEl.innerHTML = icon;
    iconEl.style.cssText = inlineStyle([
      ['width', '8px'],
      ['height', '8px'],
      ['display', 'flex'],
      ['align-items', 'center'],
      ['justify-content', 'center'],
      ['opacity', '0'],
      ['transition', 'opacity 0.1s'],
    ]);
    button.appendChild(iconEl);
    button.addEventListener('mouseenter', () => {
      iconEl.style.opacity = '1';
    });
    button.addEventListener('mouseleave', () => {
      iconEl.style.opacity = '0';
    });
    button.addEventListener('click', () => ipcRenderer.send('login-bar', action));
    return button;
  };

  const closeLight = light('close', '关闭', '#ff5f57', icons.lightClose);
  const minLight = light('minimize', '最小化', '#febc2e', icons.lightMinimize);
  macMaxLight = light('maximize', '最大化', '#28c840', icons.lightMaximize);
  container.append(closeLight, minLight, macMaxLight);
  return container;
}

function buildBar(): void {
  const bar = document.createElement('div');
  bar.style.cssText = inlineStyle([
    ['position', 'fixed'],
    ['top', '0'],
    ['left', '0'],
    ['right', '0'],
    ['height', `${BAR_HEIGHT}px`],
    ['display', 'flex'],
    ['align-items', 'center'],
    ['background', '#fafafa'],
    ['border-bottom', '1px solid rgba(0,0,0,0.08)'],
    ['z-index', '2147483647'],
    ['-webkit-app-region', 'drag'],
    ['user-select', 'none'],
    ['font-family', 'system-ui, -apple-system, "Segoe UI", sans-serif'],
  ]);

  const title = document.createElement('div');
  title.textContent = 'OpenCode 登录';
  title.style.cssText = inlineStyle([
    ['flex', '1'],
    ['min-width', '0'],
    ['font-size', '12px'],
    ['color', 'rgba(0,0,0,0.45)'],
    ['white-space', 'nowrap'],
    ['overflow', 'hidden'],
    ['text-overflow', 'ellipsis'],
    ['padding-left', '12px'],
    ['text-align', 'left'],
  ]);

  if (isWindows) {
    bar.append(title, buildWindowsGroup());
  } else {
    bar.append(buildMacLights(), makeButton('back', '返回上一步', icons.back, false, '28px'), title);
  }

  const styleEl = document.createElement('style');
  styleEl.textContent = `@keyframes opencodeboard-login-slide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(400%); }
}`;
  document.documentElement.append(styleEl);

  loadingBar = document.createElement('div');
  loadingBar.style.cssText = inlineStyle([
    ['position', 'fixed'],
    ['top', `${BAR_HEIGHT - 2}px`],
    ['left', '0'],
    ['width', '33%'],
    ['height', '2px'],
    ['z-index', '2147483647'],
    ['background', 'linear-gradient(90deg, #4f8cff, #22d3ee, #4f8cff)'],
    ['display', 'none'],
    ['animation', 'opencodeboard-login-slide 1.2s ease-in-out infinite'],
  ]);
  document.documentElement.append(loadingBar);

  document.documentElement.append(bar);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', buildBar, { once: true });
} else {
  buildBar();
}
