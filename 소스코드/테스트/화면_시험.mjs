// 화면 자동 시험 — 백그라운드 크롬(창 없음)으로 실제 화면을 열고, 버튼을 모두 눌러 보고, 오류가 하나도 없는지 확인한다.
//
//   node 화면_시험.mjs                 → 모든 시험
//   node 화면_시험.mjs --only 휴대폰    → 이름에 '휴대폰'이 들어간 시험만
//   node 화면_시험.mjs --shots         → 주요 화면을 사진으로도 저장 (SHOT_DIR, 기본: 임시 폴더)
//
// 시험용 작은 웹 서버를 직접 띄워 웹/ 폴더를 보여 준다. 주소가 /fx/<이름>/... 이면 data.js 대신 시험용 데이터(일부러 망가뜨린 것 포함)를 준다.
// 크롬 위치: CHROME_PATH 환경 변수 → 윈도우/리눅스 기본 위치 순서로 찾음.
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "..", "웹");
const argv = process.argv.slice(2);
const ONLY = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;
const SHOTS = argv.includes("--shots");
const SHOT_DIR = process.env.SHOT_DIR || path.join(os.tmpdir(), "ai_compare_shots");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CMD_MS = 20000, EVAL_MS = 60000, TEST_MS = 150000;   // 크롬 명령 · 페이지 안 시험 코드 · 시험 하나의 시간 제한 (화면이 멈추면 끝없이 기다리지 않게)

// 크롬 원격 조종에 쓰는 WebSocket 은 Node.js 22 부터 기본으로 들어 있음
if (typeof WebSocket === "undefined") {
  console.log(`✗ Node.js 22 이상이 필요해요 (지금 ${process.version}). https://nodejs.org 에서 LTS 를 설치해 주세요.`);
  process.exit(1);
}

// ───────── 시험용 데이터
//  · 기본은 고정해 둔 실제 데이터 사진(시험_데이터.json, 2026-10-02) → 날마다 데이터가 바뀌어도 시험 결과는 같음
//  · REAL_DATA=live 이면 지금 웹/data.json 으로 시험
const REAL_FILE = process.env.REAL_DATA === "live" ? path.join(WEB, "data.json") : path.join(HERE, "시험_데이터.json");
const REAL = JSON.parse(fs.readFileSync(REAL_FILE, "utf8"));
const clone = (x) => JSON.parse(JSON.stringify(x));
const asJs = (d) => "window.MODEL_DATA=" + JSON.stringify(d) + ";\n";
// 화면의 '오늘'을 시험 데이터 날짜 근처로 고정 (실제 날짜가 지나도 '새로 나온 모델'·'새' 표시·오래된 데이터 안내가 같은 결과)
//  · 시계는 멈추지 않고 흐름 (그래프 움직임 효과가 정상으로 돎) · REAL_DATA=live 이면 실제 날짜 그대로
const GEN_MS = Date.parse(String(REAL.generated).replace(" ", "T") + ":00+09:00");
const clockAt = (hoursAfterGen) => (process.env.REAL_DATA === "live" || !Number.isFinite(GEN_MS) ? null : GEN_MS + hoursAfterGen * 36e5);
const clockScript = (target) => `(() => {
  const R = Date, off = ${target} - R.now();
  function D(...a) { if (!new.target) return new R(R.now() + off).toString(); return a.length ? new R(...a) : new R(R.now() + off); }
  Object.setPrototypeOf(D, R); D.prototype = R.prototype; D.now = () => R.now() + off;
  window.Date = D;
})();`;
const FIXTURES = {
  real: () => asJs(REAL),
  // 모델이 하나도 없음
  empty: () => asJs(Object.assign(clone(REAL), { models: [] })),
  // 모델 하나, 점 하나
  one: () => {
    const d = clone(REAL);
    const m = d.models.find((x) => x.variants.some((v) => v.cost != null)) || d.models[0];
    m.variants = [m.variants.find((v) => v.cost != null) || m.variants[0]];
    d.models = [m];
    return asJs(d);
  },
  // 비용 기록이 전혀 없음 (그래프에 그릴 점이 없음)
  nocost: () => {
    const d = clone(REAL);
    for (const m of d.models) for (const v of m.variants) { delete v.cost; delete v.cost_kind; delete v.cost_src; }
    return asJs(d);
  },
  // 필드가 빠지거나 형식이 틀린 데이터 + 이름에 HTML(해킹 시도) — 화면이 깨지지 않고 나머지를 보여 줘야 함
  broken: () => {
    const d = clone(REAL);
    delete d.sources; delete d.effort_order; delete d.health; delete d.effort_ladder;
    d.generated = "날짜 아님";
    const ms = d.models.filter((m) => m.variants.some((v) => v.cost != null)).slice(0, 40);
    ms[0].name = '<img src=x onerror="window.__xss=1">';
    ms[1].company = null;
    ms[2].date = null;
    ms[3].variants = [];
    ms[4].variants[0].src = {};
    ms[5].variants[0].src = { aa: { m: 150, var: 0 } };
    ms[6].variants[0].cost = -1;
    ms[7].variants[0].cost = 0;
    ms[8].variants[0].cost = "abc";
    ms[9].name = "아주 긴 이름 ".repeat(25);
    ms[10].key = ms[11].key;
    ms[12].variants[0].effort = "hyper";
    ms[13].price = { in: null, out: "x" };
    ms[14].efforts_supported = "high";
    ms[15].variants[0].src = { epoch: { m: null, var: 2 }, aa: { m: "160", var: "4" } };
    ms[16].variants.push(null);
    ms[17].variants = "없음";
    ms[18].date = "2026-13-45";
    ms[19].company = '<b onmouseover="window.__xss=1">악성</b>';
    delete ms[20].key;
    delete ms[21].name;
    ms[22].variants[0].src.aa = { m: 1e9, var: 1 };
    d.models = [...ms, null, 5, "문자열", { key: "only-key" }];
    return asJs(d);
  },
  // 10배 큰 데이터 (모델 약 5천 개)
  big: () => {
    const d = clone(REAL);
    const extra = [];
    for (let k = 1; k < 10; k++) for (const m of REAL.models) { const c = clone(m); c.key += "-x" + k; c.name += " x" + k; extra.push(c); }
    d.models.push(...extra);
    return asJs(d);
  },
  missing: () => "/* data.js 가 비어 있는 경우 */\n",
  garbage: () => 'window.MODEL_DATA = "망가진 값";\n',
  syntax: () => 'window.MODEL_DATA = {"generated": "2026-10-02 18:00", "models": [\n',
  // 로컬 도우미(server.py)가 켜져 있는 것처럼 /api 응답
  helper: () => asJs(REAL),
  // 한 기관을 못 받아 '마지막 정상 데이터'를 보여 주는 중 (13시간 지남 → 안내가 떠야 함)
  prevdata: () => asJs(Object.assign(clone(REAL), { health: { using_previous: true, failed: ["Artificial Analysis"] } })),
  // 한 기관을 오래 못 받아 받을 수 있는 기관만으로 계산함 (OpenRouter 는 가격표라 안내에서 뺌)
  partial: () => asJs(Object.assign(clone(REAL), { health: { failed: ["Epoch AI", "OpenRouter"] } })),
  // 화면을 다 준비한 뒤(처리기를 붙인 뒤) 오류가 나는 경우 → 오류 화면 뒤에도 키를 눌러 오류가 쌓이면 안 됨
  latefail: () => asJs(REAL),
};

// ───────── 시험용 웹 서버
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml" };
function startServer() {
  const fxCache = {};
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    let p = decodeURIComponent(u.pathname);
    let fx = null;
    const m = p.match(/^\/fx\/([a-z]+)(\/.*)$/);
    if (m) { fx = m[1]; p = m[2]; }
    const send = (code, type, body) => { res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" }); res.end(body); };
    const json = (obj) => send(200, TYPES[".json"], JSON.stringify(obj));
    if (p === "/api/ping") {
      // 도우미 흉내: helper 시험에서만 '이 프로그램의 도우미', 나머지는 '다른 서버' (404 콘솔 오류 없이)
      json(fx === "helper" ? { ok: true, app: "ai-compare", generated: REAL.generated, busy: false } : { ok: true, app: "other" });
    } else if (fx === "helper" && p === "/api/refresh") {
      setTimeout(() => json({ ok: true, changed: false, generated: REAL.generated, log: [] }), 400);
    } else if (fx && p === "/data.js" && FIXTURES[fx]) {
      fxCache[fx] = fxCache[fx] || FIXTURES[fx]();
      send(200, TYPES[".js"], fxCache[fx]);
    } else if (fx === "noecharts" && p.startsWith("/lib/")) {
      send(404, "text/plain", "없음");
    } else if (fx === "latefail" && p === "/app.js") {
      // 시작 끝무렵(처리기를 다 붙인 뒤)에 일부러 오류를 냄
      const src = fs.readFileSync(path.join(WEB, "app.js"), "utf8");
      const hook = "    renderFooter();\n";
      const patched = src.replace(/\r\n/g, "\n").replace(hook, hook + '    throw new Error("시험용 늦은 오류");\n');
      send(patched.includes("시험용 늦은 오류") ? 200 : 500, TYPES[".js"], patched);
    } else {
      if (p === "/" || p.endsWith("/")) p += "index.html";
      const f = path.resolve(WEB, "." + p);
      if (!f.startsWith(WEB)) { send(403, "text/plain", "금지"); return; }
      fs.readFile(f, (err, buf) => {
        if (err) send(404, "text/plain", "없음");
        else send(200, TYPES[path.extname(f)] || "application/octet-stream", buf);
      });
    }
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

// ───────── 크롬
function findChrome() {
  const c = [process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    path.join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean);
  return c.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
}
async function startChrome() {
  const exe = findChrome();
  if (!exe) throw new Error("크롬을 찾지 못했어요. 크롬을 설치하거나 CHROME_PATH 환경 변수에 chrome.exe 위치를 넣어 주세요.");
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ai_compare_chrome_"));
  const flags = ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
    "--hide-scrollbars", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "about:blank"];
  if (process.platform === "linux") flags.unshift("--no-sandbox", "--disable-dev-shm-usage");
  const proc = spawn(exe, flags, { stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) break; } catch { /* 아직 안 뜸 */ }
    await sleep(150);
  }
  return {
    port,
    async close() {
      proc.kill();
      await sleep(300);
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 크롬이 아직 파일을 잡고 있으면 남겨 둠 */ }
    },
  };
}

// ───────── 탭 하나 (크롬 원격 조종)
class Tab {
  static async open(port) {
    const r = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
    const t = await r.json();
    const tab = new Tab(port, t.id, new WebSocket(t.webSocketDebuggerUrl));
    await new Promise((ok, no) => { tab.ws.onopen = ok; tab.ws.onerror = no; });
    tab.ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      const p = d.id ? tab.pending.get(d.id) : null;
      if (p) { clearTimeout(p.timer); tab.pending.delete(d.id); p.resolve(d); } else if (d.method) tab.onEvent(d);
    };
    // 연결이 끊기면 기다리던 명령을 모두 실패로 (끝없이 기다리지 않게)
    tab.ws.onclose = () => {
      tab.closed = true;
      for (const p of tab.pending.values()) { clearTimeout(p.timer); p.reject(new Error(`크롬 연결이 끊겼어요 (${p.method})`)); }
      tab.pending.clear();
    };
    await tab.send("Page.enable"); await tab.send("Runtime.enable"); await tab.send("Log.enable");
    return tab;
  }
  constructor(port, id, ws) { this.port = port; this.id = id; this.ws = ws; this.n = 0; this.pending = new Map(); this.errors = []; this.loaded = null; this.closed = false; }
  onEvent(d) {
    if (d.method === "Page.loadEventFired" && this.loaded) { this.loaded(); this.loaded = null; }
    if (d.method === "Runtime.exceptionThrown") {
      const x = d.params.exceptionDetails;
      this.errors.push(`${(x.exception && x.exception.description) || x.text} @ ${x.url || ""}:${x.lineNumber}`);
    }
    if (d.method === "Runtime.consoleAPICalled" && (d.params.type === "error" || d.params.type === "assert"))
      this.errors.push("console.error: " + d.params.args.map((a) => a.value ?? a.description).join(" "));
    if (d.method === "Log.entryAdded" && d.params.entry.level === "error") this.errors.push(`${d.params.entry.text} ${d.params.entry.url || ""}`);
  }
  send(method, params = {}, ms = CMD_MS) {
    return new Promise((resolve, reject) => {
      if (this.closed) { reject(new Error(`크롬 연결이 끊겼어요 (${method})`)); return; }
      const i = ++this.n;
      const timer = setTimeout(() => {
        this.pending.delete(i);
        reject(new Error(`크롬 명령이 ${ms / 1000}초 안에 끝나지 않았어요: ${method} — 화면이 멈췄을 수 있어요`));
      }, ms);
      this.pending.set(i, { resolve, reject, timer, method });
      this.ws.send(JSON.stringify({ id: i, method, params }));
    });
  }
  async setup(vp, clock) {
    if (clock) await this.send("Page.addScriptToEvaluateOnNewDocument", { source: clockScript(clock) });
    await this.send("Emulation.setDeviceMetricsOverride", { width: vp.w, height: vp.h, deviceScaleFactor: vp.dpr || 1, mobile: !!vp.mobile });
    await this.send("Emulation.setTouchEmulationEnabled", { enabled: !!vp.mobile, maxTouchPoints: vp.mobile ? 5 : 1 });
    if (vp.mobile) await this.send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36" });
    await this.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: vp.reduced ? "reduce" : "no-preference" }] });
  }
  async goto(url, readyMs = 8000) {
    const loaded = new Promise((r) => { this.loaded = r; });
    await this.send("Page.navigate", { url });
    await Promise.race([loaded, sleep(15000)]);
    // 화면 준비 완료 표시(data-ready) 또는 오류 화면(data-fatal)을 기다림
    const t0 = Date.now();
    while (Date.now() - t0 < readyMs) {
      const s = await this.eval(() => document.documentElement.dataset.ready || document.documentElement.dataset.fatal || "");
      if (s) return { state: s, ms: Date.now() - t0 };
      await sleep(100);
    }
    return { state: "", ms: Date.now() - t0 };
  }
  // 함수를 페이지 안에서 실행 (함수는 바깥 변수를 쓰지 않는 독립 함수여야 함)
  async eval(fn, ...args) {
    const expression = `(${fn.toString()})(...${JSON.stringify(args)})`;
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, EVAL_MS);
    if (r.result && r.result.exceptionDetails) {
      const x = r.result.exceptionDetails;
      throw new Error("페이지 안 시험 코드 오류: " + ((x.exception && x.exception.description) || x.text));
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  }
  async mouse(type, x, y, extra = {}) {
    await this.send("Input.dispatchMouseEvent", Object.assign({ type, x, y, button: "left", clickCount: 1 }, extra));
  }
  async click(x, y) { await this.mouse("mouseMoved", x, y, { button: "none" }); await this.mouse("mousePressed", x, y); await this.mouse("mouseReleased", x, y); }
  // 손가락으로 한 번 누르기 (휴대폰 흉내에서 실제 터치 → 초점·클릭이 브라우저가 하는 그대로 생김)
  async tap(x, y) {
    await this.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await this.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  async wheel(x, y, dy) { await this.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: dy }); }
  async key(key) {
    const codes = { Tab: 9, Enter: 13, Escape: 27, " ": 32, "/": 191, ArrowDown: 40, ArrowUp: 38 };
    const base = { key, code: key === " " ? "Space" : key === "/" ? "Slash" : key, windowsVirtualKeyCode: codes[key] || 0 };
    const text = key === "Enter" ? String.fromCharCode(13) : key.length === 1 ? key : undefined;   // 글자가 있어야 단추가 눌림 (Enter = 줄바꿈 글자)
    await this.send("Input.dispatchKeyEvent", Object.assign({ type: "keyDown", text }, base));
    await this.send("Input.dispatchKeyEvent", Object.assign({ type: "keyUp" }, base));
  }
  async shot(name) {
    if (!SHOTS) return;
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const r = await this.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(SHOT_DIR, name + ".png"), Buffer.from(r.result.data, "base64"));
  }
  async close() {
    try { this.ws.close(); } catch { /* 이미 닫힘 */ }
    await Promise.race([fetch(`http://127.0.0.1:${this.port}/json/close/${this.id}`).catch(() => {}), sleep(5000)]);
  }
}

// ───────── 페이지 안에서 쓰는 공통 점검들 (독립 함수)
const IN_PAGE = {
  // 가로로 넘치는 요소가 없는지 (화면 밖으로 삐져나와 옆으로 밀리는 문제)
  overflow: () => {
    const W = document.documentElement.clientWidth;
    const over = [];
    // 옆으로 넘겨 보는 칸(가로 스크롤 영역) 안의 요소는 넘쳐도 정상
    const inScroller = (el) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") return true;
      }
      return false;
    };
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (cs.position === "fixed" || el.closest(".detail:not(.open)") || el.closest("[hidden]") || inScroller(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.right > W + 1 && cs.visibility !== "hidden") over.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} right=${Math.round(r.right)}`);
    }
    return { scroll: document.documentElement.scrollWidth - W, over: over.slice(0, 5) };
  },
  basics: () => {
    const q = (s) => document.querySelector(s), qa = (s) => [...document.querySelectorAll(s)];
    const ch = window.echarts && echarts.getInstanceByDom(q("#chart"));
    const opt = ch ? ch.getOption() : null;
    const pins = opt && opt.graphic && opt.graphic[0] ? opt.graphic[0].elements.filter((e) => String(e.id || "").startsWith("pin") && !e.invisible).length : 0;
    const lines = qa("#headline .hl-s");
    const lineKey = (i) => { const n = lines[i] && lines[i].querySelector("[data-key]"); return n ? n.dataset.key + "|" + n.dataset.eff : null; };
    const firstRow = (kind) => { const r = q(`.pick[data-kind="${kind}"] .vt-row.first`); return r ? r.dataset.key + "|" + r.dataset.eff : null; };
    return {
      ready: document.documentElement.dataset.ready, lines: lines.length, notes: qa("#notes li").length, pins,
      headTop: lineKey(0), headValue: lineKey(1), cardTop: firstRow("top"), cardValue: firstRow("value"),
      series: opt ? opt.series.length : 0, rows: qa("#table tbody tr[data-key]").length, legend: qa("#legend .chip").length,
      empty: !q("#chartEmpty").hidden, cards: qa(".pick").length, xss: window.__xss || 0,
    };
  },
};

// ───────── 시험 목록
// 각 시험: { name, fx, vp, run(tab, ok) }  — ok(조건, 이름, 자세히) 로 결과를 기록
const DESK = { w: 1440, h: 900 };
const PHONE = { w: 390, h: 844, mobile: true, dpr: 2 };
const TESTS = [
  {
    name: "PC 기본 화면 · 오늘의 답 · 각주 핀 · 카드가 같은 답",
    fx: "real", vp: DESK,
    async run(t, ok) {
      const b = await t.eval(IN_PAGE.basics);
      ok(b.lines >= 2, "큰 문장 줄 2개 이상", b.lines);
      ok(b.notes === b.lines || b.notes >= 2, "각주 줄 수", b.notes);
      ok(b.pins >= 2, "지도 위 각주 핀", b.pins);
      ok(b.headTop && b.headTop === b.cardTop, "문장 1 = 최고 성능 카드 1위", `${b.headTop} / ${b.cardTop}`);
      ok(b.headValue && b.headValue === b.cardValue, "문장 2 = 가성비 카드 1위", `${b.headValue} / ${b.cardValue}`);
      ok(b.series > 5 && b.rows > 10 && b.legend === 6, "그래프·표·회사 버튼", JSON.stringify(b));
      ok(!b.empty, "빈 그래프 안내는 숨김");
      const o = await t.eval(IN_PAGE.overflow);
      ok(o.scroll <= 0 && !o.over.length, "가로 넘침 없음", JSON.stringify(o));
      // 화면 시계를 시험 데이터 날짜에 고정했으니 '새로 나온 모델'이 늘 보여야 함
      const tk = await t.eval(() => ({ hidden: document.querySelector("#ticker").hidden, n: document.querySelectorAll("#ticker .tk-item").length }));
      ok(!tk.hidden && tk.n >= 1, "새로 나온 모델 목록", JSON.stringify(tk));
      // 넓은 PC 화면: 지도는 옆에 붙어 있음
      const st = await t.eval(() => getComputedStyle(document.querySelector(".col-map")).position);
      ok(st === "sticky", "넓은 화면에서 지도가 옆에 붙음", st);
      await t.shot("pc_light");
    },
  },
  {
    name: "PC 모든 버튼 누르기",
    fx: "real", vp: DESK,
    async run(t, ok) {
      const r = await t.eval(async () => {
        const w = (ms = 120) => new Promise((res) => setTimeout(res, ms));
        const q = (s) => document.querySelector(s), qa = (s) => [...document.querySelectorAll(s)];
        const log = {};
        for (const b of qa("#xAxisSeg button")) { b.click(); await w(); }
        for (const b of qa("#periodSeg button")) { b.click(); await w(); }
        for (const b of qa("#perCoMenu .menu-item")) { b.click(); await w(60); }
        qa("#perCoMenu .menu-item")[2].click(); await w();
        log.perCo = q("#perCoText").textContent;
        for (const id of ["optFrontier", "optLabels", "optSelectable", "optEstimated", "optBestOnly", "optPinnedOnly"]) { q("#" + id).click(); await w(); q("#" + id).click(); await w(); }
        // 켜져 있는 회사를 모두 끄면 빈 안내 → 다시 원래대로
        const wasOn = qa("#legend .chip").map((c) => !c.classList.contains("off"));
        for (let i = 0; i < wasOn.length; i++) if (wasOn[i]) { qa("#legend .chip")[i].click(); await w(60); }
        log.allHidden = q("#chartEmpty").hidden === false;
        for (let i = 0; i < wasOn.length; i++) if (wasOn[i]) { qa("#legend .chip")[i].click(); await w(60); }
        for (const id of ["zoomIn", "zoomIn", "zoomOut", "resetZoom"]) { q("#" + id).click(); await w(200); }
        for (const th of qa("#table th[data-k]")) { th.click(); await w(40); th.click(); await w(40); }
        q("#table th[data-k=score]").click(); await w();
        if (!q("#moreRows").hidden) { q("#moreRows").click(); await w(); }
        for (const tx of ["제미나이, gpt", "클로드 오퍼스", "zzzz없는모델", "<script>", "솔", ""]) {
          const inp = q("#search"); inp.value = tx; inp.dispatchEvent(new Event("input")); await w(300);
          log["검색:" + tx] = (q("#searchNote").hidden ? "-" : q("#searchNote").innerText.split("\n")[0]) + " / 빈=" + !q("#chartEmpty").hidden;
        }
        for (const r2 of qa(".pick .vt-row").slice(0, 4)) { r2.click(); await w(150); }
        log.pinned = qa("#pinBar .pin").length;
        log.detail = q("#detail").classList.contains("open");
        // 표 줄 누르기 → 고정 / 다시 누르기 → 해제
        const tr0 = () => q("#table tbody tr[data-key]");
        const k0 = tr0().dataset.key, before = qa("#pinBar .pin").length;
        tr0().click(); await w(200);
        const mid = qa("#pinBar .pin").length;
        q(`#table tbody tr[data-key="${CSS.escape(k0)}"]`).click(); await w(200);
        log.rowToggle = [before, mid, qa("#pinBar .pin").length].join(">");
        for (const tr of qa(".dt tr.eff-row")) { tr.click(); await w(60); }
        if (q("#closeDetail")) { q("#closeDetail").click(); await w(); }
        log.detailClosed = !q("#detail").classList.contains("open");
        const clr = q("#pinBar .pin-clear"); if (clr) { clr.click(); await w(); }
        log.pinnedAfter = qa("#pinBar .pin").length;
        const tk = q("#ticker .nl-more"); if (tk) { tk.click(); await w(); }
        q("#themeBtn").click(); await w(800); log.dark = document.documentElement.dataset.theme;
        q("#themeBtn").click(); await w(800); log.light = document.documentElement.dataset.theme;
        q("#fullBtn").click(); await w(300); log.full = q("#chartBox").classList.contains("full");
        q("#fullBtn").click(); await w(400); log.fullClosed = !q("#chartBox").classList.contains("full") && !document.body.classList.contains("no-scroll");
        return log;
      });
      ok(r.perCo === "3개", "회사마다 3개로 되돌림", r.perCo);
      ok(r.allHidden, "회사를 모두 끄면 빈 그래프 안내");
      ok(r.pinned >= 1 && r.detail, "카드 줄 누르면 고정 + 상세", JSON.stringify(r));
      ok(r.detailClosed && r.pinnedAfter === 0, "상세 닫기 · 모두 해제");
      const [rt0, rt1, rt2] = String(r.rowToggle).split(">").map(Number);
      ok(Math.abs(rt1 - rt0) === 1 && rt2 === rt0, "표 줄 누르기 = 고정/해제 (두 번 누르면 원래대로)", r.rowToggle);
      ok(r.dark === "dark" && r.light === "light", "밝게/어둡게 전환");
      ok(r.full && r.fullClosed, "크게 보기 열고 닫기", JSON.stringify(r));
      ok(/찾은 모델/.test(r["검색:제미나이, gpt"]), "쉼표 검색", r["검색:제미나이, gpt"]);
      ok(/true$/.test(r["검색:zzzz없는모델"]), "없는 모델 검색 → 빈 안내", r["검색:zzzz없는모델"]);
    },
  },
  {
    name: "PC 키보드만으로 사용",
    fx: "real", vp: DESK,
    async run(t, ok) {
      // Tab 으로 초점이 이동하고, 초점 표시가 보이는지
      await t.eval(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); });
      const seen = new Set();
      let visibleRing = 0;
      for (let i = 0; i < 45; i++) {
        await t.key("Tab");
        const f = await t.eval(() => {
          const a = document.activeElement;
          if (!a || a === document.body) return null;
          const cs = getComputedStyle(a);
          const ring = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
          return { id: a.id || a.className || a.tagName, ring };
        });
        if (f) { seen.add(f.id); if (f.ring) visibleRing++; }
      }
      ok(seen.size >= 15, "Tab 으로 여러 곳에 초점", seen.size);
      ok(visibleRing >= 10, "초점 표시(테두리)가 보임", visibleRing);
      // '/' → 검색칸
      await t.eval(() => document.activeElement && document.activeElement.blur());
      await t.key("/");
      ok(await t.eval(() => document.activeElement === document.querySelector("#search")), "/ 키 → 검색칸");
      // 순위표 줄에서 Enter → 고정, 방향키로 다음 줄, 다시 그려도 초점이 그 줄에 남음
      await t.eval(() => { document.querySelector("#search").blur(); document.querySelector("#table tbody tr").focus(); });
      await t.key("Enter");
      await sleep(300);
      const pinned = await t.eval(() => ({ n: document.querySelectorAll("#pinBar .pin").length, focus: document.activeElement && document.activeElement.matches("#table tbody tr") }));
      ok(pinned.n === 1, "순위표 줄 Enter → 고정", JSON.stringify(pinned));
      ok(pinned.focus, "다시 그려도 초점이 표 줄에 남음", JSON.stringify(pinned));
      await t.key("ArrowDown");
      ok(await t.eval(() => document.activeElement === document.querySelectorAll("#table tbody tr")[1]), "↓ 키 → 다음 줄");
      // 고정 칩 이름 Enter → 상세 열림, Esc → 닫힘
      await t.eval(() => document.querySelector("#pinBar .pin-name").focus());
      await t.key("Enter");
      await sleep(300);
      ok(await t.eval(() => document.querySelector("#detail").classList.contains("open")), "고정 칩 Enter → 상세 열림");
      // 고정 칩도 키보드로 초점을 받아야 함
      const chipFocus = await t.eval(() => { const c = document.querySelector("#pinBar .pin-name"); c.focus(); return document.activeElement === c; });
      ok(chipFocus, "고정 칩에 키보드 초점");
      await t.key("Escape");
      await sleep(300);
      ok(await t.eval(() => !document.querySelector("#detail").classList.contains("open")), "Esc → 상세 닫힘");
      // 큰 문장의 모델 이름에서 Enter
      await t.eval(() => document.querySelector("#headline .nm").focus());
      await t.key("Enter");
      await sleep(300);
      ok(await t.eval(() => document.querySelector("#detail").classList.contains("open")), "큰 문장 이름 Enter → 상세 열림");
      await t.key("Escape");
    },
  },
  {
    name: "PC 그래프 확대 · 이동 · Esc",
    fx: "real", vp: DESK,
    async run(t, ok) {
      const g = await t.eval(() => {
        const ch = echarts.getInstanceByDom(document.querySelector("#chart"));
        const r = ch.getModel().getComponent("grid").coordinateSystem.getRect();
        const c = document.querySelector("#chart").getBoundingClientRect();
        window.scrollTo(0, 0);
        return { x: c.left + r.x + r.width * 0.5, y: c.top + r.y + 6, w: r.width, h: r.height, top: c.top + r.y, left: c.left + r.x };
      });
      // 휠만 굴리면(클릭 전) 확대되지 않음
      await t.wheel(g.x, g.top + g.h * 0.5, -300); await sleep(500);
      ok(await t.eval(() => !document.querySelector("#chart").classList.contains("zoomed")), "클릭 전 휠 = 확대 안 함");
      // 빈 곳(맨 위 가운데) 클릭 → 확대 모드
      await t.click(g.left + g.w * 0.02, g.top + 4); await sleep(300);
      ok(await t.eval(() => document.querySelector("#chartBox").classList.contains("zoom-on")), "빈 곳 클릭 → 확대 모드");
      await t.wheel(g.x, g.top + g.h * 0.5, -400); await sleep(700);
      ok(await t.eval(() => document.querySelector("#chart").classList.contains("zoomed")), "확대 모드에서 휠 → 확대");
      // 끌어서 이동
      await t.mouse("mouseMoved", g.x, g.top + g.h * 0.5, { button: "none" });
      await t.mouse("mousePressed", g.x, g.top + g.h * 0.5);
      for (let i = 1; i <= 5; i++) await t.mouse("mouseMoved", g.x - i * 20, g.top + g.h * 0.5 + i * 5);
      await t.mouse("mouseReleased", g.x - 100, g.top + g.h * 0.5 + 25); await sleep(500);
      await t.key("Escape"); await sleep(300);
      ok(await t.eval(() => !document.querySelector("#chartBox").classList.contains("zoom-on")), "Esc → 확대 모드 끝");
      await t.eval(() => document.querySelector("#resetZoom").click()); await sleep(600);
      ok(await t.eval(() => !document.querySelector("#chart").classList.contains("zoomed")), "처음 화면으로");
      // 크게 보기 → 브라우저 뒤로 가기로 닫힘
      await t.eval(() => document.querySelector("#fullBtn").click()); await sleep(300);
      await t.eval(() => history.back()); await sleep(600);
      ok(await t.eval(() => !document.querySelector("#chartBox").classList.contains("full") && !document.body.classList.contains("no-scroll")), "크게 보기 → 뒤로 가기로 닫힘");
      // 크게 보기 열고 닫기 반복해도 기록이 쌓이지 않음
      const h0 = await t.eval(() => history.length);
      for (let i = 0; i < 4; i++) { await t.eval(() => document.querySelector("#fullBtn").click()); await sleep(150); await t.eval(() => document.querySelector("#fullBtn").click()); await sleep(250); }
      const h1 = await t.eval(() => history.length);
      ok(h1 - h0 <= 1, "크게 보기 반복해도 뒤로 가기 기록이 쌓이지 않음", `${h0}→${h1}`);
    },
  },
  {
    name: "PC 어둡게 화면",
    fx: "real", vp: DESK,
    async run(t, ok) {
      await t.eval(() => document.querySelector("#themeBtn").click()); await sleep(900);
      const c = await t.eval(() => ({ theme: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor, meta: document.querySelector('meta[name="theme-color"]').content }));
      ok(c.theme === "dark" && c.bg === "rgb(10, 10, 10)" && c.meta === "#0b0b0b", "어두운 색 적용", JSON.stringify(c));
      const b = await t.eval(IN_PAGE.basics);
      ok(b.pins >= 2 && b.series > 5, "어둡게에서도 그래프·핀", JSON.stringify(b));
      // 화면 읽기 프로그램용 이름은 그대로, 켜졌는지는 눌림 상태로
      const a = await t.eval(() => ({ label: document.querySelector("#themeBtn").getAttribute("aria-label"), pressed: document.querySelector("#themeBtn").getAttribute("aria-pressed") }));
      ok(a.label === "어둡게 보기" && a.pressed === "true", "밝게/어둡게 버튼: 이름 고정 + 눌림 상태", JSON.stringify(a));
      await t.shot("pc_dark");
    },
  },
  {
    name: "PC 키보드 초점 · 상세를 닫으면 연 자리로",
    fx: "real", vp: DESK,
    async run(t, ok) {
      const where = () => t.eval(() => {
        const a = document.activeElement;
        const host = a && a.closest ? a.closest("#cards, #notes, #pinBar, #table, #headline, #ticker") : null;
        const card = a && a.closest ? a.closest(".pick") : null;
        return { host: host ? host.id : null, tag: a ? a.tagName : null, key: (a && a.dataset && a.dataset.key) || null, eff: (a && a.dataset && a.dataset.eff) || null, card: card ? card.dataset.kind : null };
      });
      // 가성비 카드 첫 줄 Enter → 상세 → Esc → 초점이 가성비 카드의 그 줄로 (최고 성능 카드에 같은 줄이 있어도)
      await t.eval(() => { window.scrollTo(0, 0); document.querySelector('.pick[data-kind="value"] .vt-row').focus(); });
      const before = await where();
      await t.key("Enter"); await sleep(400);
      ok(await t.eval(() => document.querySelector("#detail").classList.contains("open")), "카드 줄 Enter → 상세");
      await t.key("Escape"); await sleep(400);
      const after = await where();
      ok(after.host === "cards" && after.card === "value" && after.key === before.key && after.eff === before.eff, "Esc 뒤 초점 = 연 카드 줄", JSON.stringify([before, after]));
      // 각주 버튼에서 연 상세 → 닫으면 각주로
      await t.eval(() => document.querySelector("#notes .note-btn").focus());
      const nb = await where();
      await t.key("Enter"); await sleep(400);
      await t.key("Escape"); await sleep(400);
      const na = await where();
      ok(na.host === "notes" && na.key === nb.key, "각주에서 연 상세를 닫으면 각주로", JSON.stringify([nb, na]));
      // 순위표 줄: Enter 두 번(고정 → 해제) 뒤에도 초점이 그 줄 (고정 표시 클래스가 빠져도 찾음)
      await t.eval(() => { const c = document.querySelector("#pinBar .pin-clear"); if (c) c.click(); });
      await sleep(200);
      await t.eval(() => document.querySelector("#table tbody tr[data-key]").focus());
      const tb = await where();
      await t.key("Enter"); await sleep(300);
      await t.key("Enter"); await sleep(300);
      const ta = await where();
      ok(ta.host === "table" && ta.tag === "TR" && ta.key === tb.key, "표 줄 고정 → 해제 뒤에도 초점이 그 줄", JSON.stringify([tb, ta]));
    },
  },
  {
    name: "PC 경계선 끄기 · 회사마다 1개",
    fx: "real", vp: DESK,
    async run(t, ok) {
      const r = await t.eval(async () => {
        const w = (ms = 250) => new Promise((res) => setTimeout(res, ms));
        const q = (s) => document.querySelector(s);
        const keys = () => new Set([...document.querySelectorAll("#table tbody tr[data-key]")].map((tr) => tr.dataset.key)).size;
        q('#perCoMenu .menu-item[data-v="1"]').click(); await w();
        const on = keys();
        q("#optFrontier").click(); await w();
        const off = keys();
        const inp = q("#search"); inp.value = "claude"; inp.dispatchEvent(new Event("input")); await w(450);
        const note = q("#searchNote").innerText;
        inp.value = ""; inp.dispatchEvent(new Event("input")); await w(350);
        q("#optFrontier").click(); await w();
        return { on, off, note };
      });
      ok(r.off < r.on, "경계선을 끄면 경계선 때문에 더한 모델이 빠짐", JSON.stringify(r));
      ok(!/경계선/.test(r.note), "경계선을 끄면 검색 안내에 '경계선' 문구 없음", r.note);
    },
  },
  {
    name: "PC 그래프 · 가로축 바꾸면 확대 풀림 · 마우스 뒤 방향키 · Esc 순서",
    fx: "real", vp: DESK,
    async run(t, ok) {
      const z = await t.eval(async () => {
        const w = (ms = 300) => new Promise((res) => setTimeout(res, ms));
        const q = (s) => document.querySelector(s);
        const other = () => [...document.querySelectorAll("#xAxisSeg button")].find((b) => !b.classList.contains("on"));
        window.scrollTo(0, 0);
        q("#zoomIn").click(); await w(); q("#zoomIn").click(); await w(500);
        const zoomed = q("#chart").classList.contains("zoomed");
        other().click(); await w(600);
        const after = q("#chart").classList.contains("zoomed");
        other().click(); await w(400);      // 원래 가로축으로
        return { zoomed, after };
      });
      ok(z.zoomed && !z.after, "가로축을 바꾸면 확대가 풀림", JSON.stringify(z));
      // 그래프의 점을 마우스로 누름(고정) → ↓ 키는 페이지 스크롤 (그래프가 방향키를 가로채지 않음)
      const pt = await t.eval(() => {
        const ch = echarts.getInstanceByDom(document.querySelector("#chart"));
        const c = document.querySelector("#chart").getBoundingClientRect();
        for (const s of ch.getModel().getSeries()) {
          const d = s.getData();
          for (let i = 0; i < d.count(); i++) {
            const raw = d.getRawDataItem(i);
            const l = raw && raw.v && raw.value ? ch.convertToPixel({ seriesIndex: s.componentIndex }, raw.value) : null;
            if (Array.isArray(l) && l[0] > 40 && l[1] > 40 && l[0] < c.width - 40 && l[1] < c.height - 60) return { x: c.left + l[0], y: c.top + l[1] };
          }
        }
        return null;
      });
      ok(pt, "누를 점 찾기", JSON.stringify(pt));
      if (pt) {
        await t.click(pt.x, pt.y); await sleep(400);
        const y0 = await t.eval(() => ({ y: window.scrollY, focus: document.activeElement && document.activeElement.id }));
        await t.key("ArrowDown"); await t.key("ArrowDown"); await t.key("ArrowDown"); await sleep(400);
        const y1 = await t.eval(() => window.scrollY);
        ok(y1 > y0.y, "마우스로 누른 뒤 ↓ 키 = 페이지가 내려감", JSON.stringify([y0, y1]));
        await t.key("Escape"); await sleep(300);
      }
      // 크게 보기 위에 연 상세 → Esc 는 상세부터
      const e = await t.eval(async () => {
        const w = (ms = 350) => new Promise((res) => setTimeout(res, ms));
        const q = (s) => document.querySelector(s);
        window.scrollTo(0, 0);
        if (q("#detail").classList.contains("open")) { q("#closeDetail").click(); await w(); }
        q("#fullBtn").click(); await w();
        q(".pick .vt-row").click(); await w();
        return { full: q("#chartBox").classList.contains("full"), detail: q("#detail").classList.contains("open") };
      });
      ok(e.full && e.detail, "크게 보기 + 상세", JSON.stringify(e));
      await t.key("Escape"); await sleep(400);
      const e1 = await t.eval(() => ({ full: document.querySelector("#chartBox").classList.contains("full"), detail: document.querySelector("#detail").classList.contains("open") }));
      ok(e1.full && !e1.detail, "Esc 한 번 = 맨 위의 상세만 닫힘", JSON.stringify(e1));
      await t.key("Escape"); await sleep(400);
      ok(await t.eval(() => !document.querySelector("#chartBox").classList.contains("full")), "Esc 두 번 = 크게 보기도 닫힘");
    },
  },
  {
    name: "PC 건너뛰기 링크",
    fx: "real", vp: DESK,
    async run(t, ok) {
      await t.eval(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); });
      await t.key("Tab");
      ok(await t.eval(() => document.activeElement && document.activeElement.classList.contains("skip")), "첫 Tab = 본문으로 건너뛰기");
      await t.key("Enter"); await sleep(500);
      const r = await t.eval(() => ({ label: Math.round(document.querySelector(".hl-label").getBoundingClientRect().top), bar: Math.round(document.querySelector(".topbar").getBoundingClientRect().bottom) }));
      ok(r.label >= r.bar - 1, "건너뛴 뒤 '오늘의 답'이 머리칸에 가리지 않음", JSON.stringify(r));
    },
  },
  {
    name: "낮은 PC 화면 (노트북 창 1366×657)",
    fx: "real", vp: { w: 1366, h: 657 },
    async run(t, ok) {
      const r = await t.eval(() => ({
        spread: getComputedStyle(document.querySelector(".spread")).display,
        map: getComputedStyle(document.querySelector(".col-map")).position,
        chartH: Math.round(document.querySelector("#chart").getBoundingClientRect().height),
      }));
      ok(r.spread === "flex" && r.map === "static", "위아래 배치 (왼쪽이 비지 않음)", JSON.stringify(r));
      ok(r.chartH >= 400, "그래프가 찌그러지지 않음 (400px 이상)", JSON.stringify(r));
      const o = await t.eval(IN_PAGE.overflow);
      ok(o.scroll <= 0 && !o.over.length, "가로 넘침 없음", JSON.stringify(o));
      await t.shot("pc_low");
    },
  },
  {
    name: "마지막 정상 데이터 안내 · 알림이 조절 막대를 가리지 않음",
    fx: "prevdata", vp: DESK, clockHours: 13,
    async run(t, ok) {
      const n = await t.eval(() => document.querySelector("#notice").innerText);
      ok(/Artificial Analysis/.test(n) && /정상 데이터/.test(n), "어떤 기관을 못 받았는지 안내", n);
      const r = await t.eval(async () => {
        window.scrollTo(0, 1200);
        await new Promise((res) => setTimeout(res, 400));
        const b = document.querySelector("#dock .dock-in").getBoundingClientRect();
        const hit = document.elementFromPoint(b.left + 30, b.top + Math.min(20, b.height / 2));
        return { underNotice: !!(hit && hit.closest("#notice")), hit: hit ? hit.tagName + "." + hit.className : null };
      });
      ok(!r.underNotice, "스크롤해도 알림이 지도 조절 막대를 덮지 않음", JSON.stringify(r));
    },
  },
  {
    name: "일부 기관만으로 계산 안내 (휴대폰)",
    fx: "partial", vp: PHONE,
    async run(t, ok) {
      const n = await t.eval(() => document.querySelector("#notice").innerText);
      ok(/Epoch AI/.test(n) && !/OpenRouter/.test(n), "점수 기관만 안내 (가격표 OpenRouter 는 뺌)", n);
      const o = await t.eval(IN_PAGE.overflow);
      ok(o.scroll <= 0 && !o.over.length, "가로 넘침 없음", JSON.stringify(o));
    },
  },
  {
    name: "시작 뒤 오류 → 오류 화면 · 키를 눌러도 오류가 더 쌓이지 않음",
    fx: "latefail", vp: DESK, allow: [/시험용 늦은 오류/],
    async run(t, ok, info) {
      ok(info.state === "fatal", "오류 화면 표시", info.state);
      await t.key("Escape"); await t.key("/"); await t.key("ArrowDown");
      await t.send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false });
      await sleep(800);
      ok(await t.eval(() => /새로고침/.test(document.body.innerText)), "새로고침 안내");
    },
  },
  {
    name: "태블릿 세로",
    fx: "real", vp: { w: 820, h: 1180, mobile: true },
    async run(t, ok) {
      const o = await t.eval(IN_PAGE.overflow);
      ok(o.scroll <= 0 && !o.over.length, "가로 넘침 없음", JSON.stringify(o));
      const b = await t.eval(IN_PAGE.basics);
      ok(b.lines >= 2 && b.series > 5, "문장·그래프", JSON.stringify(b));
      await t.shot("tablet");
    },
  },
  {
    // 작은 휴대폰(320px) — 글꼴이 넓게 그려지는 컴퓨터(리눅스 등)에서도 아래 막대가 화면 밖으로 밀리면 안 됨
    name: "아주 좁은 휴대폰",
    fx: "real", vp: { w: 320, h: 640, mobile: true, dpr: 2 },
    async run(t, ok) {
      const o = await t.eval(IN_PAGE.overflow);
      ok(o.scroll <= 0 && !o.over.length, "가로 넘침 없음", JSON.stringify(o));
      const d = await t.eval(() => {
        const W = document.documentElement.clientWidth;
        const r = (s) => document.querySelector(s).getBoundingClientRect();
        return { W, dock: Math.round(r(".dock").right), toggle: Math.round(r(".dock-toggle").right), search: Math.round(r("#search").width) };
      });
      ok(d.dock <= d.W && d.toggle <= d.W && d.search >= 60, "아래 막대가 화면 안 · 찾기 칸 남음", JSON.stringify(d));
      await t.eval(async () => {
        document.querySelector(".notes").scrollIntoView({ block: "center", behavior: "instant" });
        await new Promise((res) => setTimeout(res, 300));
      });
      await t.shot("phone_narrow");
    },
  },
  {
    name: "휴대폰 세로 · 조절 판 · 상세 판",
    fx: "real", vp: PHONE,
    async run(t, ok) {
      const o = await t.eval(IN_PAGE.overflow);
      ok(o.scroll <= 0 && !o.over.length, "가로 넘침 없음", JSON.stringify(o));
      const r = await t.eval(async () => {
        const w = (ms = 350) => new Promise((res) => setTimeout(res, ms));
        const q = (s) => document.querySelector(s), qa = (s) => [...document.querySelectorAll(s)];
        const log = {};
        const d = q("#dock").getBoundingClientRect(); log.dockBottom = Math.round(innerHeight - d.bottom);
        q("#dockToggle").click(); await w(); log.open = q("#dock").classList.contains("open") && !q("#dockScrim").hidden && document.body.classList.contains("sheet-open");
        q('#xAxisSeg button[data-v="cost"]').click(); await w(); log.cost = q("#table").classList.contains("x-cost");
        q("#dockScrim").click(); await w(); log.closed = !q("#dock").classList.contains("open") && !document.body.classList.contains("sheet-open");
        q("#table tbody tr").click(); await w(300);
        log.rowPinned = qa("#pinBar .pin").length === 1 && !q("#detail").classList.contains("open");   // 표 줄 = 고정만
        // 상세 판은 아래에서 올라오는 움직임이 있음 → 고정 시간 대신 '화면 안에 들어올 때까지' 최대 3초 기다림 (느린 컴퓨터에서도 같은 결과)
        const until = async (fn, ms = 3000) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { if (fn()) return true; await w(50); } return fn(); };
        q(".pick .vt-row").click();        // (실제 터치로 누르는 시험은 '휴대폰 카드 줄 터치' 장면에서)
        const det = q("#detail");
        log.detailInView = await until(() => { const dr = det.getBoundingClientRect(); return det.classList.contains("open") && dr.top < innerHeight - 40 && dr.bottom > 0; });
        log.detail = det.classList.contains("open");
        // 작은 터치 대상 (44px 미만인 주요 버튼 — 열린 상세의 닫기·고정 칩 × 포함)
        const sizes = (sel) => qa(sel).filter((b) => b.offsetParent).map((b) => { const r2 = b.getBoundingClientRect(); return { id: b.id || b.className || b.tagName, w: Math.round(r2.width), h: Math.round(r2.height) }; });
        log.small = sizes(".circ, .cbtn, .dock-toggle, #closeDetail, .pin .x, .pin-name").filter((x) => x.w < 44 || x.h < 44);
        q("#closeDetail").click(); await w();
        log.smallMore = sizes(".pick-why summary, .notes .note-btn").filter((x) => x.h < 44);
        return log;
      });
      ok(r.dockBottom >= 0 && r.dockBottom < 60, "아래쪽 조절 막대", r.dockBottom);
      ok(r.open && r.cost && r.closed, "조절 판 열고 닫기", JSON.stringify(r));
      ok(r.rowPinned, "표 줄 → 고정만 (상세가 표를 덮지 않음)", JSON.stringify(r));
      ok(r.detail && r.detailInView, "카드 줄 → 상세 판", JSON.stringify(r));
      ok(!r.small.length && !r.smallMore.length, "누르는 곳 터치 크기 44px 이상", JSON.stringify([r.small, r.smallMore]));
      await t.shot("phone");
    },
  },
  {
    name: "휴대폰 카드 줄 터치 → 상세 · 말풍선이 같이 뜨지 않음",
    fx: "real", vp: PHONE,
    async run(t, ok) {
      const p = await t.eval(async () => {
        const r = document.querySelector('.pick[data-kind="value"] .vt-row');
        r.scrollIntoView({ block: "center", behavior: "instant" });
        await new Promise((res) => setTimeout(res, 300));
        const b = r.getBoundingClientRect();
        return { x: Math.round(b.left + Math.min(60, b.width / 2)), y: Math.round(b.top + b.height / 2) };
      });
      await t.tap(p.x, p.y);
      // 말풍선은 터치 직후·다시 그린 뒤 어느 때든 뜨면 안 됨 → 1초 동안 계속 살핌
      const r = await t.eval(async () => {
        const q = (s) => document.querySelector(s);
        const shown = () => { const tip = q("#chart .chart-tip"); if (!tip || !tip.innerText.trim()) return false; const cs = getComputedStyle(tip); return cs.display !== "none" && cs.visibility !== "hidden" && +cs.opacity > 0; };
        let ever = false;
        for (let i = 0; i < 20; i++) { if (shown()) ever = true; await new Promise((res) => setTimeout(res, 50)); }
        const a = document.activeElement;
        return { detail: q("#detail").classList.contains("open"), ever, focus: a ? a.className : null };
      });
      ok(r.detail, "터치 → 상세 열림", JSON.stringify(r));
      ok(!r.ever, "터치로 연 상세에는 그래프 말풍선이 뜨지 않음", JSON.stringify(r));
    },
  },
  {
    name: "휴대폰 가로 · 크게 보기",
    fx: "real", vp: { w: 844, h: 390, mobile: true, dpr: 2 },
    async run(t, ok) {
      await t.eval(() => document.querySelector("#fullBtn").click()); await sleep(700);
      const r = await t.eval(() => { const c = document.querySelector("#chartBox").getBoundingClientRect(), ch = document.querySelector("#chart").getBoundingClientRect(); return { full: document.querySelector("#chartBox").classList.contains("full"), h: Math.round(c.height), chartH: Math.round(ch.height), vh: innerHeight }; });
      ok(r.full && r.h <= r.vh + 1 && r.chartH > 200, "가로 화면 가득", JSON.stringify(r));
      await t.shot("landscape_full");
      // 머리칸이 붙지 않는 낮은 화면: 표 머리줄도 맨 위에 붙어야 함 (위에 표 줄이 비쳐 보이지 않게)
      await t.eval(() => document.querySelector("#fullBtn").click()); await sleep(500);
      const th = await t.eval(() => getComputedStyle(document.querySelector("#table th")).top);
      ok(th === "0px", "표 머리줄이 맨 위에 붙음", th);
    },
  },
  {
    name: "로컬 도우미 켜짐 · 최신 받기 버튼",
    fx: "helper", vp: DESK,
    async run(t, ok) {
      const before = await t.eval(() => document.querySelector("#refreshBtn").innerHTML);
      await t.eval(() => document.querySelector("#refreshBtn").click()); await sleep(150);
      const busy = await t.eval(() => ({ busy: document.querySelector("#refreshBtn").classList.contains("busy"), aria: document.querySelector("#refreshBtn").getAttribute("aria-busy") }));
      ok(busy.busy && busy.aria === "true", "받는 중 표시", JSON.stringify(busy));
      await sleep(900);
      const after = await t.eval(() => ({ html: document.querySelector("#refreshBtn").innerHTML, notice: !!document.querySelector("#notice .notice"), w: document.querySelector("#refreshBtn span").scrollWidth, cw: document.querySelector("#refreshBtn").clientWidth }));
      ok(after.html === before, "끝나면 버튼 글자가 원래대로", after.html);
      ok(after.notice, "결과 안내가 보임");
      ok(after.w <= after.cw, "버튼 글자가 원 안에", JSON.stringify(after));
    },
  },
  {
    name: "도우미 없음 · 최신 받기 버튼 안내",
    fx: "real", vp: DESK,
    async run(t, ok) {
      await t.eval(() => document.querySelector("#refreshBtn").click()); await sleep(700);
      const r = await t.eval(() => ({ notice: !!document.querySelector("#notice .notice"), err: !!document.querySelector("#notice .notice.err"), text: document.querySelector("#notice").innerText }));
      ok(r.notice && r.err && /성능비교판_열기/.test(r.text), "어떻게 하면 되는지 안내", r.text);
    },
  },
  {
    name: "빈 데이터 (모델 0개)",
    fx: "empty", vp: DESK,
    async run(t, ok) {
      const b = await t.eval(IN_PAGE.basics);
      ok(b.ready === "1", "화면 준비 완료", b.ready);
      ok(b.empty && b.rows === 0, "빈 그래프 안내 · 표 0줄", JSON.stringify(b));
      ok(await t.eval(() => /없어요/.test(document.querySelector("#cards").innerText)), "카드 자리에 안내 문구");
    },
  },
  {
    name: "모델 하나뿐",
    fx: "one", vp: DESK,
    async run(t, ok) {
      const b = await t.eval(IN_PAGE.basics);
      ok(b.ready === "1" && b.lines >= 1 && b.rows === 1, "점 하나로도 정상", JSON.stringify(b));
      await t.eval(async () => { document.querySelector("#zoomIn").click(); await new Promise((r) => setTimeout(r, 300)); document.querySelector("#resetZoom").click(); });
    },
  },
  {
    name: "비용 기록 없음",
    fx: "nocost", vp: DESK,
    async run(t, ok) {
      const b = await t.eval(IN_PAGE.basics);
      ok(b.ready === "1" && b.empty && b.rows > 10, "그래프는 빈 안내, 표는 점수로", JSON.stringify(b));
    },
  },
  {
    name: "망가진 데이터 · 해킹 문자열",
    fx: "broken", vp: DESK,
    async run(t, ok) {
      const b = await t.eval(IN_PAGE.basics);
      ok(b.ready === "1", "크래시 없이 화면 준비", b.ready);
      ok(b.rows > 5 && b.series > 3, "멀쩡한 모델은 보임", JSON.stringify(b));
      await t.eval(async () => {
        const w = (ms = 120) => new Promise((res) => setTimeout(res, ms));
        const q = (s) => document.querySelector(s), qa = (s) => [...document.querySelectorAll(s)];
        q("#perCoMenu .menu-item:last-child").click(); await w();
        q("#optEstimated").click(); await w();
        for (const tr of qa("#table tbody tr").slice(0, 25)) { tr.click(); await w(40); }
        for (const th of qa("#table th[data-k]")) { th.click(); await w(30); }
        const inp = q("#search"); inp.value = "img"; inp.dispatchEvent(new Event("input")); await w(300);
        inp.value = ""; inp.dispatchEvent(new Event("input")); await w(300);
      });
      const x = await t.eval(() => ({ xss: window.__xss || 0, imgs: document.querySelectorAll("img").length, b: document.querySelectorAll("#legend b, #table b[onmouseover]").length }));
      ok(x.xss === 0 && x.imgs === 0 && x.b === 0, "이름 속 HTML 이 실행되지 않음", JSON.stringify(x));
    },
  },
  {
    name: "10배 큰 데이터 속도",
    fx: "big", vp: DESK,
    readyMs: 20000,
    async run(t, ok, info) {
      // 주소를 연 순간부터 화면 준비까지 (data.js 2MB 읽기 + 계산 + 그리기 모두 포함)
      const total = await t.eval(() => Math.round(performance.now()));
      ok(info.state === "1" && total < 15000, "열고 다 그리기까지 15초 안", `${total}ms`);
      // 검색 Enter = 기다림 없이 바로 다시 그림 → 한 번 다시 그리는 시간
      const ms = await t.eval(() => {
        const inp = document.querySelector("#search");
        inp.value = "gpt";
        const t0 = performance.now();
        inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        return Math.round(performance.now() - t0);
      });
      ok(ms < 3000, "검색 한 번 다시 그리기 3초 안", ms + "ms");
      const ms2 = await t.eval(() => {
        const t0 = performance.now();
        document.querySelector('#periodSeg button[data-v="6"]').click();
        return Math.round(performance.now() - t0);
      });
      ok(ms2 < 3000, "출시 기간 바꾸기 3초 안", ms2 + "ms");
      const found = await t.eval(() => document.querySelector("#searchNote").innerText);
      ok(/찾은 모델/.test(found), "큰 데이터에서도 검색 안내", found.slice(0, 80));
    },
  },
  {
    name: "데이터 파일 없음 → 친절한 안내",
    fx: "missing", vp: DESK,
    async run(t, ok, info) {
      ok(info.state === "fatal", "오류 화면 표시", info.state);
      ok(await t.eval(() => /성능비교판_열기|새로고침/.test(document.body.innerText)), "해결 방법 안내", await t.eval(() => document.body.innerText.slice(0, 120)));
    },
  },
  {
    name: "데이터 형식이 틀림 → 친절한 안내",
    fx: "garbage", vp: DESK,
    async run(t, ok, info) { ok(info.state === "fatal", "오류 화면 표시", info.state); },
  },
  {
    name: "데이터 문법 오류 → 친절한 안내",
    fx: "syntax", vp: DESK, allow: [/data\.js/, /SyntaxError|Unexpected end/],
    async run(t, ok, info) { ok(info.state === "fatal", "오류 화면 표시", info.state); },
  },
  {
    name: "그래프 도구 불러오기 실패 → 친절한 안내",
    fx: "noecharts", vp: DESK, allow: [/lib\/echarts|404|Failed to load resource/],
    async run(t, ok, info) {
      ok(info.state === "fatal", "오류 화면 표시", info.state);
      ok(await t.eval(() => /새로고침/.test(document.body.innerText)), "새로고침 안내");
    },
  },
  {
    name: "움직임 줄이기 설정",
    fx: "real", vp: Object.assign({ reduced: true }, DESK),
    async run(t, ok) {
      const b = await t.eval(IN_PAGE.basics);
      ok(b.ready === "1" && b.series > 5 && b.lines >= 2, "효과 없이 정상", JSON.stringify(b));
    },
  },
];

// ───────── 실행
const results = [];
const server = await startServer();
const base = `http://127.0.0.1:${server.address().port}`;
let chrome;
try {
  chrome = await startChrome();
  for (const T of TESTS) {
    if (ONLY && !T.name.includes(ONLY)) continue;
    const checks = [];
    const ok = (cond, name, detail) => checks.push({ ok: !!cond, name, detail: detail == null ? "" : String(detail).slice(0, 400) });
    let tab;
    try {
      tab = await Tab.open(chrome.port);
      await tab.setup(T.vp, clockAt(T.clockHours ?? 2));
      const body = async () => {
        const info = await tab.goto(`${base}/fx/${T.fx || "real"}/index.html`, T.readyMs || 8000);
        if (!["noecharts", "missing", "garbage", "syntax", "latefail"].includes(T.fx)) ok(info.state === "1", "화면 준비 완료 표시", info.state || "(없음)");
        await sleep(T.settle || 700);
        await T.run(tab, ok, info);
        await sleep(300);
      };
      let timer;
      await Promise.race([body(), new Promise((_, no) => { timer = setTimeout(() => no(new Error(`시험 하나가 ${TEST_MS / 1000}초 안에 끝나지 않았어요 (화면이 멈췄을 수 있어요)`)), TEST_MS); })])
        .finally(() => clearTimeout(timer));
      const allow = (T.allow || []).concat([/cdn\.jsdelivr\.net|pretendard/i]);   // 바깥 글꼴은 인터넷 상태에 따라 실패할 수 있음 (화면은 기본 글꼴로 동작)
      const errs = tab.errors.filter((e) => !allow.some((re) => re.test(e)));
      ok(!errs.length, "콘솔 오류 0개", errs.join(" | "));
    } catch (e) {
      ok(false, "시험 실행", e.stack || String(e));
    } finally {
      if (tab) await tab.close();
    }
    const pass = checks.every((c) => c.ok);
    results.push({ name: T.name, pass, checks });
    console.log(`${pass ? "✓" : "✗"} ${T.name}`);
    for (const c of checks) if (!c.ok || process.env.VERBOSE) console.log(`    ${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? "  — " + c.detail : ""}`);
  }
} catch (e) {
  console.log("✗ 시험 준비 실패:", e.message);
  results.push({ name: "시험 준비", pass: false, checks: [] });
} finally {
  if (chrome) await chrome.close();
  server.close();
}
const nPass = results.filter((r) => r.pass).length;
const nChecks = results.reduce((n, r) => n + r.checks.length, 0), nOk = results.reduce((n, r) => n + r.checks.filter((c) => c.ok).length, 0);
console.log(`\n화면 시험: ${nPass}/${results.length} 통과 (점검 ${nOk}/${nChecks})${SHOTS ? "  사진: " + SHOT_DIR : ""}`);
process.exit(nPass === results.length && results.length > 0 ? 0 : 1);
