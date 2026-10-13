/* 다담은, 달력 - 윈도우 PC 앱
 *
 * 이 앱은 일정 데이터를 따로 저장하지 않아요.
 * 깃허브 페이지에 올라가 있는 "다담은, 달력" 웹페이지를 창 하나로 그대로 띄워줄 뿐이고,
 * 저장/동기화(Firebase)/알람은 원래 달력 코드가 그대로 처리해요.
 * → 기존 일정 데이터의 구조나 저장 방식은 전혀 바뀌지 않아요.
 *
 * 하는 일
 *  - 웹이랑 똑같은 전체 달력 창 하나 (바탕화면 아이콘 / 구름 아이콘 / 뭘 눌러도 이 창이 열림)
 *  - 창의 X를 눌러도 꺼지지 않고 작업표시줄 오른쪽 구름 아이콘으로 숨어서 알람이 계속 울림
 *  - 윈도우 켤 때 자동 실행 (켜질 때는 구름 아이콘으로 조용히 시작)
 *  - 데이터 백업 파일 저장
 */
const { app, BrowserWindow, Tray, Menu, Notification, nativeImage, shell, ipcMain, dialog, screen, net } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_ID = 'com.dadameun.calendar';
const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
const TRAY_ICON_PATH = path.join(__dirname, 'assets', 'tray.png');
const PRELOAD_PATH = path.join(__dirname, 'preload.js');
const STARTED_HIDDEN = process.argv.includes('--hidden'); // 윈도우 자동 실행으로 켜졌을 때

let mainWin = null;
let setupWin = null;
let tray = null;
let isQuitting = false;

/* ===== 설정 저장 (창 위치/크기, 달력 주소 등 - 일정 데이터는 여기 저장하지 않음) ===== */
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
function appOrigin() {
  try { return new URL(config.appUrl).origin; } catch (e) { return null; }
}

/* ===== 다른 사이트 링크는 기본 브라우저로 열기 ===== */
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

/* ===== 달력 창 (웹이랑 똑같은 전체 달력) ===== */
function defaultBounds() {
  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.min(1600, area.width - 40);
  const height = Math.min(960, area.height - 40);
  return { width, height, x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2) };
}
function boundsVisible(b) {
  if (!b || typeof b.x !== 'number') return false;
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x + 100 > a.x && b.x < a.x + a.width - 100 && b.y >= a.y - 10 && b.y < a.y + a.height - 60;
  });
}
let boundsSaveTimer = null;
function rememberBounds() {
  clearTimeout(boundsSaveTimer);
  boundsSaveTimer = setTimeout(() => {
    if (!mainWin || mainWin.isDestroyed()) return;
    config.maximized = mainWin.isMaximized();
    if (!config.maximized && !mainWin.isMinimized()) config.bounds = mainWin.getBounds();
    saveConfig();
  }, 400);
}

function createMainWindow(showNow) {
  const b = boundsVisible(config.bounds) ? config.bounds : defaultBounds();
  mainWin = new BrowserWindow({
    ...b,
    minWidth: 360,
    minHeight: 500,
    show: false,
    title: '다담은, 달력',
    icon: ICON_PATH,
    autoHideMenuBar: true,
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
  guardNavigation(mainWin);
  mainWin.loadURL(config.appUrl);
  if (showNow) {
    mainWin.once('ready-to-show', () => {
      if (config.maximized) mainWin.maximize();
      mainWin.show();
    });
  }
  mainWin.on('move', rememberBounds);
  mainWin.on('resize', rememberBounds);
  mainWin.on('maximize', rememberBounds);
  mainWin.on('unmaximize', rememberBounds);
  // X를 눌러도 앱은 꺼지지 않고 구름 아이콘으로 숨기만 함 (알람이 계속 울려야 하니까)
  mainWin.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    mainWin.hide();
    if (!config.hideTipShown && Notification.isSupported()) {
      config.hideTipShown = true;
      saveConfig();
      new Notification({
        title: '다담은 달력은 계속 켜져 있어요',
        body: '알람이 울리도록 작업표시줄 오른쪽 구름 아이콘으로 숨었어요. 완전히 끄려면 구름 아이콘을 우클릭 → 종료.',
        icon: ICON_PATH
      }).show();
    }
  });
  // 인터넷이 끊겨서 페이지를 못 불러오면 30초 뒤에 다시 시도
  mainWin.webContents.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3: 새로고침 등으로 취소된 경우
    setTimeout(() => { if (mainWin && !mainWin.isDestroyed()) mainWin.loadURL(config.appUrl); }, 30000);
  });
}

function showMain() {
  if (!mainWin || mainWin.isDestroyed()) {
    createMainWindow(true);
    return;
  }
  if (mainWin.isMinimized()) mainWin.restore();
  if (!mainWin.isVisible() && config.maximized) mainWin.maximize();
  mainWin.show();
  mainWin.focus();
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

/* 주소가 진짜 "다담은, 달력"이 맞는지, 새 index.html이 올라가 있는지 확인 */
async function checkAppUrl(url) {
  try {
    const res = await net.fetch(url, { cache: 'no-store' });
    if (!res.ok) return { ok: false, error: `페이지를 열 수 없어요 (오류 ${res.status}). 주소를 다시 확인해주세요.` };
    const html = await res.text();
    if (!html.includes('다담은')) return { ok: false, error: '이 주소는 "다담은, 달력" 페이지가 아닌 것 같아요.' };
    if (!html.includes('alarmHost')) {
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
  }
  saveConfig();
  applyAutoStart();
  if (setupWin && !setupWin.isDestroyed()) setupWin.destroy();
  if (!tray) createTray();
  if (!mainWin || mainWin.isDestroyed()) createMainWindow(true);
  else {
    if (changed) mainWin.loadURL(config.appUrl);
    showMain();
  }
  return { ok: true };
});

/* ===== 달력 페이지에서 PC 앱으로 보내는 요청 ===== */
ipcMain.on('desktop:open-calendar', () => showMain());
ipcMain.on('desktop:hide-widget', () => {});
ipcMain.on('desktop:alarm', (e, payload) => {
  const title = String((payload && payload.title) || '⏰ 알람').slice(0, 200);
  const body = String((payload && payload.body) || '').slice(0, 500);
  // 숨겨져 있던 달력 창을 앞으로 띄워서 알람 창이 바로 보이게 함
  showMain();
  if (mainWin) mainWin.flashFrame(true);
  if (Notification.isSupported()) {
    const n = new Notification({ title, body, icon: ICON_PATH });
    n.on('click', () => showMain());
    n.show();
  }
});

/* ===== 백업: 이 컴퓨터에 들어있는 달력 데이터 전체를 파일로 저장 ===== */
async function saveBackup() {
  if (!mainWin || mainWin.isDestroyed()) {
    dialog.showMessageBox({ type: 'info', message: '달력이 열려 있을 때 백업할 수 있어요.' });
    return;
  }
  let json;
  try {
    json = await mainWin.webContents.executeJavaScript(`(function(){
      const o = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf('yearlyCalendar') === 0) o[k] = localStorage.getItem(k);
      }
      return JSON.stringify(o);
    })()`);
  } catch (e) {
    dialog.showMessageBox({ type: 'error', message: '데이터를 읽지 못했어요. 달력이 다 열린 뒤 다시 시도해주세요.' });
    return;
  }
  const data = JSON.parse(json || '{}');
  if (!Object.keys(data).some((k) => k.indexOf('yearlyCalendarMemos') === 0)) {
    dialog.showMessageBox({ type: 'info', message: '아직 이 컴퓨터에 불러온 일정이 없어요. 로그인한 뒤 다시 시도해주세요.' });
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

/* ===== 윈도우 시작 시 자동 실행 (켜질 때는 창 없이 구름 아이콘으로 조용히 시작) ===== */
function applyAutoStart() {
  if (!app.isPackaged) return; // 개발 중 실행일 때는 건드리지 않음
  app.setLoginItemSettings({ openAtLogin: !!config.autoStart, args: ['--hidden'] });
}

/* ===== 작업표시줄 오른쪽 구름 아이콘(트레이) ===== */
function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '달력 열기', click: showMain },
    { type: 'separator' },
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
    { label: '새로고침', click: () => { if (mainWin && !mainWin.isDestroyed()) mainWin.reload(); } },
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
  tray.on('click', showMain);
  tray.on('double-click', showMain);
  refreshTrayMenu();
}

/* ===== 앱 시작 ===== */
if (!app.requestSingleInstanceLock()) {
  // 이미 켜져 있으면 (바탕화면 아이콘을 또 눌러도) 새로 켜지 않고 기존 달력 창을 보여줌
  app.quit();
} else {
  app.on('second-instance', () => {
    if (config.appUrl) showMain();
    else openSetup();
  });

  app.whenReady().then(() => {
    app.setAppUserModelId(APP_ID); // 윈도우 알림이 제대로 뜨려면 필요
    if (!config.appUrl) {
      openSetup();
      return;
    }
    // 예전 버전(위젯 따로 뜨던 버전)에서 쓰던 설정은 그대로 두고, 자동 실행 설정만 새 방식으로 다시 적용
    if (typeof config.autoStart === 'undefined') config.autoStart = true;
    saveConfig();
    createTray();
    createMainWindow(!STARTED_HIDDEN); // 자동 실행일 때는 창 없이 구름 아이콘으로만, 직접 켰을 때는 바로 달력 표시
    applyAutoStart();
  });

  app.on('before-quit', () => { isQuitting = true; });
  // 창이 다 닫혀도 구름 아이콘에 남아서 알람을 계속 확인함
  app.on('window-all-closed', () => {});
}
