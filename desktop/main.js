/* 다담은, 달력 - 윈도우 PC 위젯 앱
 *
 * 이 앱은 일정 데이터를 따로 저장하지 않아요.
 * 깃허브 페이지에 올라가 있는 "다담은, 달력" 웹페이지를 작은 위젯 창과 큰 달력 창으로 띄워줄 뿐이고,
 * 저장/동기화(Firebase)/알람은 원래 달력 코드가 그대로 처리해요.
 * → 기존 일정 데이터의 구조나 저장 방식은 전혀 바뀌지 않아요.
 *
 * 하는 일
 *  - 바탕화면 위젯 창 (오늘/내일/모레 일정, 디데이, 메모, 일정 추가, 졸린곰/고민곰 전환)
 *  - 큰 달력 창 열기
 *  - 작업표시줄 오른쪽(트레이)에 구름 아이콘 → 창을 닫아도 앱은 켜져 있어서 알람이 울림
 *  - 윈도우 켤 때 자동 실행
 *  - 데이터 백업 파일 저장
 */
const { app, BrowserWindow, Tray, Menu, Notification, nativeImage, shell, ipcMain, dialog, screen, net } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_ID = 'com.dadameun.calendar';
const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
const TRAY_ICON_PATH = path.join(__dirname, 'assets', 'tray.png');
const PRELOAD_PATH = path.join(__dirname, 'preload.js');

let widgetWin = null;
let calendarWin = null;
let setupWin = null;
let tray = null;
let isQuitting = false;

/* ===== 설정 저장 (위젯 위치/크기, 달력 주소 등 - 일정 데이터는 여기 저장하지 않음) ===== */
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (e) { return {}; }
}
let config = loadConfig();
function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) { console.warn('설정 저장 실패', e); }
}

/* 사용자가 붙여넣은 주소를 정리. "아이디.github.io/저장소" 처럼 https:// 없이 넣어도 됨 */
function normalizeAppUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch (e) { return null; }
  u.search = '';
  u.hash = '';
  if (!/\.html?$/i.test(u.pathname) && !u.pathname.endsWith('/')) u.pathname += '/';
  return u.toString();
}
function widgetUrl() {
  const u = new URL(config.appUrl);
  u.searchParams.set('widget', '1');
  return u.toString();
}
function appOrigin() {
  try { return new URL(config.appUrl).origin; } catch (e) { return null; }
}

/* ===== 창 공통: 다른 사이트 링크는 기본 브라우저로 열기 ===== */
function guardNavigation(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    try {
      if (new URL(url).origin !== appOrigin()) {
        e.preventDefault();
        shell.openExternal(url);
      }
    } catch (err) { e.preventDefault(); }
  });
}

/* ===== 위젯 창 ===== */
function defaultWidgetBounds() {
  const area = screen.getPrimaryDisplay().workArea;
  const width = 340, height = 620;
  return { width, height, x: area.x + area.width - width - 16, y: area.y + 16 };
}
function boundsVisible(b) {
  if (!b || typeof b.x !== 'number') return false;
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x + 60 > a.x && b.x < a.x + a.width - 60 && b.y >= a.y - 10 && b.y < a.y + a.height - 40;
  });
}

let boundsSaveTimer = null;
function rememberWidgetBounds() {
  clearTimeout(boundsSaveTimer);
  boundsSaveTimer = setTimeout(() => {
    if (widgetWin && !widgetWin.isDestroyed()) {
      config.widgetBounds = widgetWin.getBounds();
      saveConfig();
    }
  }, 400);
}

function createWidget() {
  const b = boundsVisible(config.widgetBounds) ? config.widgetBounds : defaultWidgetBounds();
  widgetWin = new BrowserWindow({
    ...b,
    minWidth: 280,
    minHeight: 260,
    maxWidth: 900, // 너무 넓히면 큰 달력용 화면 배치로 바뀌므로 위젯은 이 정도까지만
    frame: false,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: !!config.alwaysOnTop,
    show: false,
    title: '다담은 달력 위젯',
    icon: ICON_PATH,
    backgroundColor: '#eef2f5',
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false // 창을 숨겨놔도 알람 확인이 멈추지 않게
    }
  });
  guardNavigation(widgetWin);
  widgetWin.loadURL(widgetUrl());
  widgetWin.once('ready-to-show', () => widgetWin.show());
  widgetWin.on('move', rememberWidgetBounds);
  widgetWin.on('resize', rememberWidgetBounds);
  // 위젯 창을 닫아도 앱은 꺼지지 않고 숨기기만 함 (알람이 계속 울려야 하니까)
  widgetWin.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      widgetWin.hide();
      refreshTrayMenu();
    }
  });
  widgetWin.on('show', refreshTrayMenu);
  widgetWin.on('hide', refreshTrayMenu);
  // 인터넷이 끊겨서 페이지를 못 불러오면 30초 뒤에 다시 시도
  widgetWin.webContents.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3: 사용자가 새로고침 등으로 취소한 경우
    setTimeout(() => { if (widgetWin && !widgetWin.isDestroyed()) widgetWin.loadURL(widgetUrl()); }, 30000);
  });
}

function showWidget() {
  if (!widgetWin || widgetWin.isDestroyed()) createWidget();
  widgetWin.show();
  widgetWin.focus();
}
function toggleWidget() {
  if (widgetWin && !widgetWin.isDestroyed() && widgetWin.isVisible()) widgetWin.hide();
  else showWidget();
}

/* ===== 큰 달력 창 (원래 달력 화면 그대로) ===== */
function openCalendar() {
  if (calendarWin && !calendarWin.isDestroyed()) {
    if (calendarWin.isMinimized()) calendarWin.restore();
    calendarWin.show();
    calendarWin.focus();
    return;
  }
  const area = screen.getPrimaryDisplay().workArea;
  calendarWin = new BrowserWindow({
    width: Math.min(1600, area.width - 40),
    height: Math.min(960, area.height - 40),
    center: true,
    title: '다담은, 달력',
    icon: ICON_PATH,
    autoHideMenuBar: true,
    backgroundColor: '#eef2f5',
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  guardNavigation(calendarWin);
  calendarWin.loadURL(config.appUrl);
  calendarWin.on('closed', () => { calendarWin = null; });
}

/* ===== 첫 실행: 달력 주소 입력 창 ===== */
function openSetup() {
  if (setupWin && !setupWin.isDestroyed()) { setupWin.focus(); return; }
  setupWin = new BrowserWindow({
    width: 460,
    height: 430,
    resizable: false,
    title: '다담은 달력 - 처음 설정',
    icon: ICON_PATH,
    autoHideMenuBar: true,
    backgroundColor: '#eef2f5',
    webPreferences: { preload: PRELOAD_PATH, contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  setupWin.loadFile(path.join(__dirname, 'setup.html'));
  setupWin.on('closed', () => {
    setupWin = null;
    if (!config.appUrl) app.quit(); // 주소를 안 넣고 닫으면 종료
  });
}

/* 주소가 진짜 "다담은, 달력"이 맞는지, 위젯 기능이 들어간 새 index.html이 올라가 있는지 확인 */
async function checkAppUrl(url) {
  try {
    const res = await net.fetch(url, { cache: 'no-store' });
    if (!res.ok) return { ok: false, error: `페이지를 열 수 없어요 (오류 ${res.status}). 주소를 다시 확인해주세요.` };
    const html = await res.text();
    if (!html.includes('다담은')) return { ok: false, error: '이 주소는 "다담은, 달력" 페이지가 아닌 것 같아요.' };
    if (!html.includes('widget-mode')) {
      return { ok: false, error: '깃허브에 아직 예전 index.html이 올라가 있어요. 새 index.html을 먼저 올리고 1~2분 뒤에 다시 시도해주세요.' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: '인터넷 연결을 확인해주세요.' };
  }
}

ipcMain.handle('setup:get-url', () => config.appUrl || '');
ipcMain.handle('setup:save-url', async (e, raw) => {
  const url = normalizeAppUrl(raw);
  if (!url) return { ok: false, error: '주소 형식이 올바르지 않아요.' };
  const check = await checkAppUrl(url);
  if (!check.ok) return check;
  const firstTime = !config.appUrl;
  const changed = config.appUrl !== url;
  config.appUrl = url;
  if (firstTime) {
    // 처음 설치했을 때는 윈도우 켤 때 자동 실행을 켜둠 (알람이 울리려면 앱이 켜져 있어야 해서)
    config.autoStart = true;
    applyAutoStart();
  }
  saveConfig();
  if (setupWin && !setupWin.isDestroyed()) setupWin.destroy();
  if (!tray) createTray();
  if (!widgetWin || widgetWin.isDestroyed()) createWidget();
  else if (changed) widgetWin.loadURL(widgetUrl());
  if (changed && calendarWin && !calendarWin.isDestroyed()) calendarWin.loadURL(config.appUrl);
  return { ok: true };
});

/* ===== 달력 페이지에서 PC 앱으로 보내는 요청 ===== */
ipcMain.on('desktop:open-calendar', () => openCalendar());
ipcMain.on('desktop:hide-widget', () => { if (widgetWin && !widgetWin.isDestroyed()) widgetWin.hide(); });
ipcMain.on('desktop:alarm', (e, payload) => {
  const title = String((payload && payload.title) || '⏰ 알람').slice(0, 200);
  const body = String((payload && payload.body) || '').slice(0, 500);
  // 숨겨져 있던 위젯을 앞으로 띄워서 알람 창이 바로 보이게 함
  showWidget();
  if (widgetWin) widgetWin.flashFrame(true);
  if (Notification.isSupported()) {
    const n = new Notification({ title, body, icon: ICON_PATH });
    n.on('click', () => showWidget());
    n.show();
  }
});

/* ===== 백업: 이 컴퓨터에 들어있는 달력 데이터 전체를 파일로 저장 ===== */
async function saveBackup() {
  if (!widgetWin || widgetWin.isDestroyed()) {
    dialog.showMessageBox({ type: 'info', message: '위젯이 열려 있을 때 백업할 수 있어요.' });
    return;
  }
  let json;
  try {
    json = await widgetWin.webContents.executeJavaScript(`(function(){
      const o = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf('yearlyCalendar') === 0) o[k] = localStorage.getItem(k);
      }
      return JSON.stringify(o);
    })()`);
  } catch (e) {
    dialog.showMessageBox({ type: 'error', message: '데이터를 읽지 못했어요. 위젯이 다 열린 뒤 다시 시도해주세요.' });
    return;
  }
  const data = JSON.parse(json || '{}');
  if (!Object.keys(data).some((k) => k.indexOf('yearlyCalendarMemos') === 0)) {
    dialog.showMessageBox({ type: 'info', message: '아직 이 컴퓨터에 불러온 일정이 없어요. 위젯에서 로그인한 뒤 다시 시도해주세요.' });
    return;
  }
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: '다담은 달력 백업 저장',
    defaultPath: path.join(app.getPath('documents'), `다담은달력-백업-${stamp}.json`),
    filters: [{ name: '백업 파일', extensions: ['json'] }]
  });
  if (canceled || !filePath) return;
  const out = { app: '다담은, 달력', exportedAt: d.toISOString(), data };
  fs.writeFileSync(filePath, JSON.stringify(out, null, 2), 'utf8');
  dialog.showMessageBox({ type: 'info', message: '백업 파일을 저장했어요.', detail: filePath });
}

/* ===== 윈도우 시작 시 자동 실행 ===== */
function applyAutoStart() {
  if (!app.isPackaged) return; // 개발 중 실행일 때는 건드리지 않음
  app.setLoginItemSettings({ openAtLogin: !!config.autoStart });
}

/* ===== 작업표시줄 오른쪽 구름 아이콘(트레이) ===== */
function refreshTrayMenu() {
  if (!tray) return;
  const widgetVisible = !!(widgetWin && !widgetWin.isDestroyed() && widgetWin.isVisible());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: widgetVisible ? '위젯 숨기기' : '위젯 보이기', click: toggleWidget },
    { label: '큰 달력 열기', click: openCalendar },
    { type: 'separator' },
    {
      label: '위젯을 항상 맨 위에 표시',
      type: 'checkbox',
      checked: !!config.alwaysOnTop,
      click: (item) => {
        config.alwaysOnTop = item.checked;
        saveConfig();
        if (widgetWin && !widgetWin.isDestroyed()) widgetWin.setAlwaysOnTop(item.checked);
      }
    },
    {
      label: '윈도우 시작할 때 자동 실행',
      type: 'checkbox',
      checked: !!config.autoStart,
      click: (item) => {
        config.autoStart = item.checked;
        saveConfig();
        applyAutoStart();
      }
    },
    { label: '위젯 위치 초기화', click: () => { if (widgetWin && !widgetWin.isDestroyed()) { widgetWin.setBounds(defaultWidgetBounds()); showWidget(); } } },
    { label: '새로고침', click: () => { if (widgetWin && !widgetWin.isDestroyed()) widgetWin.reload(); } },
    { type: 'separator' },
    { label: '데이터 백업 파일 저장…', click: saveBackup },
    { label: '달력 주소 변경…', click: openSetup },
    { type: 'separator' },
    { label: '종료 (알람이 울리지 않아요)', click: () => { isQuitting = true; app.quit(); } }
  ]));
}
function createTray() {
  const img = nativeImage.createFromPath(TRAY_ICON_PATH);
  tray = new Tray(img.isEmpty() ? nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 }) : img);
  tray.setToolTip('다담은, 달력');
  tray.on('click', toggleWidget);
  refreshTrayMenu();
}

/* ===== 앱 시작 ===== */
if (!app.requestSingleInstanceLock()) {
  // 이미 켜져 있으면 새로 켜지 않고 기존 위젯만 보여줌
  app.quit();
} else {
  app.on('second-instance', () => {
    if (config.appUrl) showWidget();
    else openSetup();
  });

  app.whenReady().then(() => {
    app.setAppUserModelId(APP_ID); // 윈도우 알림이 제대로 뜨려면 필요
    if (!config.appUrl) {
      openSetup();
      return;
    }
    createTray();
    createWidget();
    applyAutoStart();
  });

  app.on('before-quit', () => { isQuitting = true; });
  // 창이 다 닫혀도 트레이에 남아서 알람을 계속 확인함
  app.on('window-all-closed', () => {});
}
