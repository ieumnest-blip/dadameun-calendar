/* 다담은, 달력 - 아주 단순한 서비스워커
   - 앱을 "설치 가능한 앱"으로 인식시키기 위한 최소 기능만 담당
   - 로그인/동기화에 영향 없도록 Firebase 등 대부분의 요청은 그대로 네트워크로 보냄
   - 페이지 자체(index.html)만 "네트워크 우선, 실패하면 캐시" 방식으로 오프라인에서도 열리게 함 */

const CACHE_NAME = 'dadameun-calendar-v2';
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
          // res를 돌려주기 전에 먼저(동기적으로) 복제해둬야 함. caches.open()은
          // 비동기라서, 나중에(await 없이) res.clone()을 부르면 그 사이에 브라우저가
          // 이미 res의 본문을 읽기 시작해 "Response body is already used" 에러가 남.
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', resClone)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
  }
});
