// 앱 설치용 도우미(웹/sw.js) 시험 — 가짜 브라우저 환경에서 sw.js 를 실행해 저장 방식을 확인
//   node --test 테스트/
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CODE = fs.readFileSync(path.join(HERE, "..", "웹", "sw.js"), "utf8");
const ORIGIN = "https://archiwjy.github.io";
const SCOPE = ORIGIN + "/ai-model-compare/ai-x/";

function makeWorld({ online = true, status = 200, oldCaches = [], waitMs = null } = {}) {
  const stores = new Map(oldCaches.map((n) => [n, new Map()]));
  const handlers = {};
  const net = { online, status, calls: [], delay: 0, ver: "" };   // delay: 응답 지연(ms) · ver: 서버에 올라간 판
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name);
      const k = (key) => (typeof key === "string" ? key : key.url);
      return {
        async put(key, res) { m.delete(k(key)); m.set(k(key), res); },   // 넣은 순서 = 최근 순서
        async match(key) { const r = m.get(k(key)); return r ? r.clone() : undefined; },
        async keys() { return [...m.keys()].map((url) => ({ url })); },
        async delete(key) { return m.delete(k(key)); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async match(key) {
      const k = typeof key === "string" ? key : key.url;
      for (const m of stores.values()) if (m.has(k)) return m.get(k).clone();
      return undefined;
    },
  };
  const self = {
    location: new URL(SCOPE + "sw.js"),
    registration: { scope: SCOPE },
    addEventListener: (t, fn) => { handlers[t] = fn; },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  };
  const fetchFn = async (req) => {
    net.calls.push(typeof req === "string" ? req : req.url);
    const ver = net.ver;
    if (net.delay) await new Promise((res) => { setTimeout(res, net.delay); });
    if (!net.online) throw new TypeError("Failed to fetch");
    const r = new Response("본문:" + (req.url || req) + ver, { status: net.status });
    Object.defineProperty(r, "type", { value: "basic" });
    return r;
  };
  const ctx = vm.createContext({ self, caches, fetch: fetchFn, Response, URL, Request, Promise, console, setTimeout, clearTimeout });
  // 시험에서는 '느림' 기준을 짧게 (3.5초를 실제로 기다리지 않게)
  vm.runInContext(waitMs == null ? CODE : CODE.replace("const WAIT_MS = 3500;", `const WAIT_MS = ${waitMs};`), ctx, { filename: "sw.js" });
  async function fire(url, { method = "GET", mode = "no-cors" } = {}) {
    const waits = [];
    let responded = null;
    const ev = {
      request: { url, method, mode },
      respondWith(p) { responded = p; },
      waitUntil(p) { waits.push(p); },
    };
    handlers.fetch(ev);
    const res = responded ? await responded : null;
    await Promise.all(waits);
    return res;
  }
  async function activate() {
    const waits = [];
    handlers.activate({ waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
  }
  return { stores, net, fire, activate, handlers };
}

const entries = (w) => [...w.stores.values()].reduce((n, m) => n + m.size, 0);

test("버전 번호가 바뀌어도 파일마다 하나만 저장 (저장 공간이 계속 커지지 않음)", async () => {
  const w = makeWorld();
  for (let v = 1; v <= 30; v++) {
    await w.fire(`${SCOPE}app.js?v=2026100${v}`);
    await w.fire(`${SCOPE}data.js?v=2026100${v}`);
  }
  assert.equal(entries(w), 2);
});

test("인터넷이 끊기면 저장해 둔 '가장 최근' 파일로 (예전엔 가장 오래된 것이 나와 옛 파일과 새 파일이 섞였음)", async () => {
  const w = makeWorld();
  await w.fire(`${SCOPE}data.js`);
  await w.fire(`${SCOPE}app.js?v=1`);
  await w.fire(`${SCOPE}app.js?v=2`);
  w.net.online = false;
  const r = await w.fire(`${SCOPE}app.js?v=3`);
  assert.ok(r);
  assert.equal(await r.text(), `본문:${SCOPE}app.js?v=2`);
  assert.equal(await (await w.fire(`${SCOPE}data.js`)).text(), `본문:${SCOPE}data.js`);
});

test("지문이 같은 파일은 인터넷 없이 바로 (1MB 그래프 도구를 매번 다시 받지 않음)", async () => {
  const w = makeWorld();
  await w.fire(`${SCOPE}lib/echarts.min.js?v=abc`);
  const n = w.net.calls.length;
  const r = await w.fire(`${SCOPE}lib/echarts.min.js?v=abc`);
  assert.equal(await r.text(), `본문:${SCOPE}lib/echarts.min.js?v=abc`);
  assert.equal(w.net.calls.length, n);
});

test("서버 오류(503)면 저장본, 저장본이 없으면 오류 그대로", async () => {
  const w = makeWorld();
  await w.fire(`${SCOPE}data.js`);
  w.net.status = 503;
  assert.equal((await w.fire(`${SCOPE}data.js`)).status, 200);
  assert.equal((await w.fire(`${SCOPE}없음.js`)).status, 503);
});

test("끊겼는데 저장본도 없으면 오류 응답 (멈추지 않음)", async () => {
  const w = makeWorld({ online: false });
  const r = await w.fire(`${SCOPE}style.css?v=1`);
  assert.equal(r.type, "error");
});

test("끊긴 상태에서 첫 화면을 열면 저장해 둔 첫 화면", async () => {
  const w = makeWorld();
  await w.fire(SCOPE, { mode: "navigate" });
  w.net.online = false;
  const r = await w.fire(SCOPE + "?utm=kakao", { mode: "navigate" });
  assert.ok(r && r.type !== "error");
});

test("실패 응답(404 등)은 저장하지 않음", async () => {
  const w = makeWorld({ status: 404 });
  const r = await w.fire(`${SCOPE}없는파일.js`);
  assert.equal(r.status, 404);
  assert.equal(entries(w), 0);
});

test("다른 사이트 · POST 요청은 건드리지 않음", async () => {
  const w = makeWorld();
  assert.equal(await w.fire("https://cdn.jsdelivr.net/x.css"), null);
  assert.equal(await w.fire(`${SCOPE}api`, { method: "POST" }), null);
  assert.equal(entries(w), 0);
});

test("새 버전이 켜지면 예전 저장소는 지움 (같은 주소의 다른 앱 저장소는 그대로)", async () => {
  const w = makeWorld({ oldCaches: ["ai-compare-v1", "다른앱"] });
  await w.activate();
  assert.deepEqual([...w.stores.keys()].filter((k) => k.startsWith("ai-compare")), ["ai-compare-v2"]);   // 지금 저장소 하나만
  assert.ok(w.stores.has("다른앱"));
});

const sleep = (ms) => new Promise((res) => { setTimeout(res, ms); });

test("느리지만 인터넷이 되면 지문 파일은 새 판을 끝까지 기다림 (옛 판으로 바꾸면 화면 파일끼리 판이 섞임)", async () => {
  const w = makeWorld({ waitMs: 30 });
  await w.fire(`${SCOPE}core.js?v=OLD`);
  w.net.delay = 120;
  const r = await w.fire(`${SCOPE}core.js?v=NEW`);
  assert.equal(await r.text(), `본문:${SCOPE}core.js?v=NEW`);
});

test("첫 화면이 느려 옛 화면을 보여 줬으면, 늦게 온 새 첫 화면은 저장하지 않음 (다음에 끊겨도 화면과 파일의 판이 맞음)", async () => {
  const w = makeWorld({ waitMs: 30 });
  w.net.ver = "#1";
  await w.fire(SCOPE, { mode: "navigate" });
  w.net.ver = "#2";
  w.net.delay = 120;
  const shown = await w.fire(SCOPE, { mode: "navigate" });
  assert.equal(await shown.text(), `본문:${SCOPE}#1`);          // 느려서 저장본(옛 화면)
  await sleep(200);                                             // 늦게 온 새 화면이 도착할 때까지
  w.net.online = false;
  w.net.delay = 0;
  const off = await w.fire(SCOPE, { mode: "navigate" });
  assert.equal(await off.text(), `본문:${SCOPE}#1`);            // 저장된 것은 여전히 보여 줬던 옛 화면
});

test("빠르게 온 새 첫 화면은 저장 (다음에 끊겨도 새 화면)", async () => {
  const w = makeWorld({ waitMs: 200 });
  w.net.ver = "#1";
  await w.fire(SCOPE, { mode: "navigate" });
  w.net.ver = "#2";
  await w.fire(SCOPE, { mode: "navigate" });
  w.net.online = false;
  assert.equal(await (await w.fire(SCOPE, { mode: "navigate" })).text(), `본문:${SCOPE}#2`);
});

test("새 도우미로 바뀐 직후 인터넷이 끊겨도 첫 화면이 열림 (예전 저장소의 파일을 옮겨 담음)", async () => {
  const w = makeWorld({ oldCaches: ["ai-compare-v1"] });
  const v1 = w.stores.get("ai-compare-v1");
  v1.set(SCOPE, new Response("예전 첫 화면 (오래됨)"));
  v1.set(`${SCOPE}app.js?v=A`, new Response("app A"));
  v1.delete(SCOPE);
  v1.set(SCOPE, new Response("예전 첫 화면"));                    // 같은 파일은 가장 최근 것만
  await w.activate();
  assert.ok(!w.stores.has("ai-compare-v1"));
  w.net.online = false;
  const r = await w.fire(SCOPE, { mode: "navigate" });
  assert.equal(await r.text(), "예전 첫 화면");
  assert.equal(await (await w.fire(`${SCOPE}app.js?v=A`)).text(), "app A");
});
