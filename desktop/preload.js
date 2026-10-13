/* 달력 웹페이지가 PC 앱에 요청할 수 있는 것들만 아주 좁게 열어줌.
   (페이지에서 컴퓨터 파일 등에 마음대로 접근할 수는 없음) */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dadameunDesktop', {
  openCalendar: () => ipcRenderer.send('desktop:open-calendar'),
  hideWidget: () => ipcRenderer.send('desktop:hide-widget'),
  alarm: (payload) => ipcRenderer.send('desktop:alarm', {
    title: String((payload && payload.title) || ''),
    body: String((payload && payload.body) || '')
  }),
  // 첫 실행 주소 입력 화면(setup.html)에서만 사용
  getUrl: () => ipcRenderer.invoke('setup:get-url'),
  saveUrl: (url) => ipcRenderer.invoke('setup:save-url', String(url || ''))
});
