// 앱 설치용 도우미 (서비스 워커)
//  · 내용 지문(?v=…)이 붙은 파일(그래프 도구 등): 같은 지문의 저장본이 있으면 인터넷 없이 바로 씀 (내용이 같다는 게 보장됨)
//  · 첫 화면·데이터처럼 지문이 없는 파일: 인터넷에서 최신을 먼저 받고, 3.5초 안에 안 오거나 끊기면 저장본
//  · 파일마다 저장본은 하나만 (버전이 바뀔 때마다 쌓이지 않게) · 끊겼을 때는 같은 파일의 '가장 최근' 저장본
//  · 같은 주소(github.io)의 다른 앱 저장소는 건드리지 않음
const CACHE = "ai-compare-v2";
const PREFIX = "ai-compare-";
const WAIT_MS = 3500;
const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));

/** 주소에서 ?v= 등을 뺀 '파일' 주소 @param {string} url */
const fileOf = (url) => { const u = new URL(url); return u.origin + u.pathname; };

sw.addEventListener("install", () => { sw.skipWaiting(); });
sw.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== CACHE) await caches.delete(k);
    await sw.clients.claim();
  })());
});

/** 저장 — 같은 파일의 예전 판은 지움 @param {Request} req @param {Response} res */
async function save(req, res) {
  const c = await caches.open(CACHE);
  const f = fileOf(req.url);
  for (const k of await c.keys()) if (fileOf(k.url) === f && k.url !== req.url) await c.delete(k);
  await c.put(req, res);
}
/** 저장본 찾기: 정확히 같은 주소 → 없으면 같은 파일의 가장 최근 것 @param {Request} req */
async function cached(req) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req);
  if (hit) return hit;
  const f = fileOf(req.url);
  const same = (await c.keys()).filter((k) => fileOf(k.url) === f);
  return same.length ? c.match(same[same.length - 1]) : undefined;
}

sw.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== sw.location.origin) return;
  /** @type {() => void} */
  let done = () => {};
  e.waitUntil(new Promise((resolve) => { done = () => resolve(undefined); }));   // 저장이 끝날 때까지 도우미를 살려 둠
  e.respondWith((async () => {
    if (url.searchParams.has("v")) {
      const hit = await (await caches.open(CACHE)).match(req);
      if (hit) { done(); return hit; }
    }
    // 받자마자 복사본을 떠서 저장 (화면이 본문을 읽기 전에)
    const net = fetch(req, { cache: "no-cache" }).then((res) => {
      if (res.ok && res.type === "basic") save(req, res.clone()).catch(() => undefined).finally(done);
      else done();
      return res;
    }, (err) => { done(); throw err; });
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    /** @type {Promise<null>} */
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), WAIT_MS); });
    try {
      const first = await Promise.race([net, timeout]);
      clearTimeout(timer);
      if (first && first.ok) return first;
      const old = await cached(req);
      if (old) return old;                         // 느리거나 서버 오류 → 저장본
      return first || (await net);                 // 저장본이 없으면 끝까지 기다림
    } catch (err) {
      clearTimeout(timer);
      return (await cached(req)) || Response.error();   // 인터넷 끊김
    }
  })());
});
