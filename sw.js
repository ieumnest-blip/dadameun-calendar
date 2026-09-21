/* 다담은, 달력 - 아주 단순한 서비스워커
   - 앱을 "설치 가능한 앱"으로 인식시키기 위한 최소 기능만 담당
   - 로그인/동기화에 영향 없도록 Firebase 등 대부분의 요청은 그대로 네트워크로 보냄
   - 페이지 자체(index.html)만 "네트워크 우선, 실패하면 캐시" 방식으로 오프라인에서도 열리게 함 */

const CACHE_NAME = 'dadameun-calendar-v1';
const APP_SHELL = ['./index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // 페이지 이동(HTML) 요청만 네트워크 우선 + 캐시 폴백으로 처리.
  // 그 외(Firebase, 이미지 등)는 손대지 않고 그대로 통과시킴.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', res.clone()));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
  }
});
