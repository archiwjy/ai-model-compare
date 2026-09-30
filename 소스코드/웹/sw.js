// 앱 설치용 도우미 (서비스 워커)
// 항상 인터넷에서 최신 파일을 먼저 받고, 인터넷이 안 될 때만 저장해 둔 파일로 보여준다.
// → 예전 화면이 남는 문제 없이, 지하철 같은 곳에서도 마지막 화면은 볼 수 있음
const CACHE = "ai-compare-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req, { cache: "no-cache" })   // 서버에 바뀌었는지 물어보고, 안 바뀌었으면 브라우저 저장본을 씀
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || Response.error()))
  );
});
