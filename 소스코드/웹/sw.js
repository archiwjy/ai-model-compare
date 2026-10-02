// 앱 설치용 도우미 (서비스 워커)
//  · 내용 지문(?v=…)이 붙은 파일(그래프 도구 등): 같은 지문의 저장본이 있으면 인터넷 없이 바로 씀 (내용이 같다는 게 보장됨)
//    저장본이 없으면 느려도 인터넷에서 끝까지 받음 — 다른 지문의 저장본은 인터넷이 끊겼거나 서버 오류일 때만 (판이 섞이지 않게)
//  · 첫 화면처럼 지문이 없는 파일: 인터넷에서 최신을 먼저 받고, 3.5초 안에 안 오거나 끊기면 저장본
//  · 화면에 실제로 준 응답만 저장 (느려서 옛 첫 화면을 보여 줬으면 늦게 온 새 첫 화면은 저장 안 함 → 다음에 끊겨도 화면과 파일의 판이 맞음)
//  · 파일마다 저장본은 하나만 (버전이 바뀔 때마다 쌓이지 않게) · 끊겼을 때는 같은 파일의 '가장 최근' 저장본
//  · 새 도우미로 바뀔 때 예전 저장소의 파일은 옮겨 담은 뒤 지움 (업데이트 직후 끊겨도 마지막 화면이 열리게)
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
    const c = await caches.open(CACHE);
    const have = new Set((await c.keys()).map((k) => fileOf(k.url)));
    for (const name of await caches.keys()) {
      if (!name.startsWith(PREFIX) || name === CACHE) continue;
      const old = await caches.open(name);
      // 같은 파일이 여러 판이면 가장 최근 것(뒤쪽)만 옮김
      for (const k of [...(await old.keys())].reverse()) {
        const f = fileOf(k.url);
        if (have.has(f)) continue;
        const res = await old.match(k);
        if (res) { await c.put(k, res); have.add(f); }
      }
      await caches.delete(name);
    }
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
  const pinned = url.searchParams.has("v");      // 지문이 붙은 파일 = 내용이 정해져 있음
  /** @type {() => void} */
  let done = () => {};
  e.waitUntil(new Promise((resolve) => { done = () => resolve(undefined); }));   // 저장이 끝날 때까지 도우미를 살려 둠
  e.respondWith((async () => {
    if (pinned) {
      const hit = await (await caches.open(CACHE)).match(req);
      if (hit) { done(); return hit; }
    }
    /** @type {Response | null} */
    let copy = null;
    // 받자마자 복사본을 떠 둠 (화면이 본문을 읽기 전에) — 저장은 이 응답을 실제로 화면에 줄 때만
    const net = fetch(req, { cache: "no-cache" }).then((res) => {
      if (res.ok && res.type === "basic") copy = res.clone();
      return res;
    });
    net.catch(() => undefined);                  // 저장본을 준 뒤에 늦게 실패해도 조용히
    /** 인터넷 응답을 화면에 줌 → 저장 @param {Response} res */
    const use = (res) => {
      if (copy) save(req, copy).catch(() => undefined).finally(done);
      else done();
      return res;
    };
    /** 저장본을 화면에 줌 → 늦게 온 응답은 저장하지 않음 @param {Response} res */
    const fallback = (res) => { done(); return res; };
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    try {
      if (pinned) {
        const res = await net;                   // 느려도 끝까지 기다림
        if (res.ok) return use(res);
        const old = await cached(req);
        return old ? fallback(old) : use(res);   // 서버 오류 → 저장본, 없으면 오류 그대로
      }
      /** @type {Promise<null>} */
      const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), WAIT_MS); });
      const first = await Promise.race([net, timeout]);
      clearTimeout(timer);
      if (first && first.ok) return use(first);
      const old = await cached(req);
      if (old) return fallback(old);             // 느리거나 서버 오류 → 저장본
      return use(first || (await net));          // 저장본이 없으면 끝까지 기다림
    } catch (err) {
      clearTimeout(timer);
      done();
      return (await cached(req)) || Response.error();   // 인터넷 끊김
    }
  })());
});
