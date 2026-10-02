// AI 모델 성능비교판 — 화면 동작
// data.js(수집기가 만든 window.MODEL_DATA) → core.js 로 정리·계산 → 그래프(ECharts)·카드·표를 그린다.
//  · 다 그리면 <html data-ready="1">, 그릴 수 없으면(데이터·그래프 도구 없음) 하얀 화면 대신 한국어 안내 <html data-fatal="fatal">
//  · 계산 규칙(추천·검색·경계선·숫자 표시)은 core.js 에 있고 시험(테스트/core.test.mjs)으로 확인한다
(function () {
  "use strict";

  const root = document.documentElement;
  const HOSTED = location.protocol === "https:" && !/^(localhost|127\.)/.test(location.hostname);
  const escText = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ───────── 화면 수명: 오류 화면(fatal)으로 바뀌면 전역 처리기·반복 작업·관찰자를 모두 멈춤 (없는 요소를 건드려 오류가 쌓이지 않게)
  const LIFE = new AbortController();
  const TIMERS = [], OBSERVERS = [];
  let DEAD = false;
  const listen = (target, type, fn, opts) => target.addEventListener(type, fn, Object.assign(typeof opts === "boolean" ? { capture: opts } : opts || {}, { signal: LIFE.signal }));
  const every = (fn, ms) => { const id = setInterval(() => { if (!DEAD) fn(); }, ms); TIMERS.push(id); return id; };
  const watch = (obs) => { OBSERVERS.push(obs); return obs; };

  // ───────── 그릴 수 없을 때: 하얀 화면 대신 무엇을 하면 되는지 안내
  function fatal(title, lines) {
    DEAD = true;
    LIFE.abort();
    TIMERS.forEach((id) => clearInterval(id));
    OBSERVERS.forEach((o) => o.disconnect());
    root.dataset.fatal = "fatal";
    const mark = '<svg class="mark" viewBox="0 0 40 40" aria-hidden="true"><path d="M5 33H13V24H21V15H29V7H36"/><circle cx="29" cy="3.5" r="3.5"/></svg>';
    document.body.innerHTML = `<main class="fatal" role="alert">${mark}<h1>${escText(title)}</h1>${lines.map((l) => `<p>${l}</p>`).join("")}` +
      `<button type="button" id="fatalReload">새로고침</button></main>`;
    const b = document.getElementById("fatalReload");
    if (b) b.addEventListener("click", () => location.reload());
  }
  const C = window.AICore;
  if (!C) {
    fatal("화면 계산 파일을 불러오지 못했어요", ["인터넷 연결을 확인하고 <b>새로고침</b>해 주세요.", '<span class="fine">core.js 를 받지 못했어요.</span>']);
    return;
  }
  if (typeof echarts === "undefined") {
    fatal("그래프 도구를 불러오지 못했어요", ["인터넷 연결을 확인하고 <b>새로고침</b>해 주세요. 한 번 열어 둔 적이 있으면 연결이 끊겨도 마지막 화면이 보여요.",
      '<span class="fine">lib/echarts.min.js 를 받지 못했어요.</span>']);
    return;
  }
  if (!window.MODEL_DATA) {
    fatal("데이터를 불러오지 못했어요", HOSTED || location.protocol.startsWith("http")
      ? ["잠시 뒤 <b>새로고침</b>해 주세요. 사이트를 고치는 중이거나 인터넷 연결이 불안정할 수 있어요."]
      : ["data.js 가 없어요. 먼저 <b>성능비교판_열기</b>를 실행하세요 (데이터를 받아 와서 화면을 엽니다)."]);
    return;
  }
  let NORM;
  try {
    NORM = C.normalizeData(window.MODEL_DATA);
  } catch (e) {
    fatal("데이터 형식이 맞지 않아요", [escText(e && e.message ? e.message : e), "잠시 뒤 <b>새로고침</b>해 주세요. 계속되면 성능비교판_열기로 데이터를 다시 받아 주세요."]);
    return;
  }
  const D = NORM.data;
  C.uniqueNames(D.models);

  // ───────── 상수
  const SRC_ORDER = ["epoch", "aa"];          // 점수 출처: Epoch AI + Artificial Analysis 두 곳
  const EFF_ORDER = D.effort_order;
  const effIdx = (e) => { const i = EFF_ORDER.indexOf(e); return i < 0 ? 99 : i; };
  const VALUE_K = 6;                          // 가성비: 비용 10배 = 6점
  const SAME_COST = 1.1;                      // 비용 차이 10% 안 = 사실상 같은 값
  const PER_CO_OPTIONS = [1, 2, 3, 5, 10, 15, 20, 25, 30, 0];
  const PIN_MAX = 8;
  const DIFF = C.DIFFICULTY.vhard;            // '맞힌 문제당'은 매우 어려운 문제 기준
  const TOP_N = 5, RECENT_MONTHS = 6;
  const SLOTS = [
    { c: "--c1", sym: "circle" }, { c: "--c2", sym: "rect" }, { c: "--c3", sym: "diamond" },
    { c: "--c7", sym: "triangle" }, { c: "--c4", sym: "pin" },
  ];
  const OTHER = { c: "--c0", sym: "circle" };
  const NL = String.fromCharCode(10);
  const EG = window.EFFORT_GUIDE || {};
  const EDEF = window.EFFORT_DEFAULTS || {};
  const EFF_KO = {
    none: "추론 과정 없이 바로 답", minimal: "최소", low: "낮음", medium: "중간", high: "높음",
    xhigh: "매우 높음", max: "최대", promax: "프로 최대", ultra: "울트라 (여러 에이전트)", default: "기본 설정", thinking: "생각 켬 (단계 없음)",
  };
  const MUTE = 0.6;                           // 은은한 회사 색: 회사 색 비율 (1 = 원래 색, 0 = 회색)
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const CAN_HOVER = matchMedia("(hover: hover)").matches;
  const IS_PHONE = matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) <= 600;
  const FONT = "Pretendard Variable, Pretendard, Malgun Gothic, sans-serif";
  const PERIOD_KO = { 3: "3개월", 6: "6개월", 12: "1년" };
  const EMPTY_FR = { front: [], status: new Map(), k: 0, levelAt: () => -Infinity };
  const OPTS = { optFrontier: "frontier", optLabels: "labels", optEstimated: "estimated", optSelectable: "selectableOnly", optBestOnly: "bestOnly", optPinnedOnly: "pinnedOnly" };

  // ───────── 설정 (저장하지 않음 — 열 때마다 기본값, 사용자 요청 2026-09-30)
  //  기본값: 맞힌 문제당 · 전체 기간 · 회사마다 3개 · 경계선·이름 켬 · 고를 수 있는 등급만 · 추정 비용 끔 · 상위 5개 회사만(기타 숨김) · 흰 화면 · 성능 높은 순
  const DEFAULTS = {
    x: "costok", period: 0, perCo: 3, search: "", hidden: ["기타"], frontier: true, labels: true,
    estimated: false, selectableOnly: true, bestOnly: false, sortK: "score", sortDir: -1, selected: null, selEffort: null,
    theme: "light", pinned: [], pinnedOnly: false,
  };
  const S = JSON.parse(JSON.stringify(DEFAULTS));
  try { localStorage.removeItem("aiCompare.settings"); } catch (e) { /* 예전에 저장된 설정 지우기 */ }

  // ───────── 화면 상태 (함수들보다 먼저 선언)
  let COMPANY_STYLE = {}, MAIN_COMPANIES = [], COMPANY_RULE = "";
  let colorCache = {}, mutedCache = {};
  let VIEW = null;                 // 마지막으로 그린 목록·점
  let FR = EMPTY_FR;               // 가성비 경계선 (추천 계산용 — 표시 여부와 상관없이 늘 계산)
  let PICKS = null;                // 오늘의 답 (top/value/alt …)
  let FULL = null, VIEWBOX = null, viewKind = null; // 그래프 전체 범위 / 확대한 범위 / 확대할 때의 가로축
  let quietRender = false, chartDrawn = false, chartVisible = true;
  let hoverCo = null, hoverSeries = null, lastTapKey = null;
  let SIDX = new Map();
  let tableLimit = 40, tableActive = null, tickerAll = false;
  let zoomOn = false, toastTimer = null, centerAfterUp = false;
  let wheelHintN = 0, wheelHintT = 0;
  let drag = null, suppressClick = false, touch = null;
  let rafPending = false, labelTimer = null, resizeTimer = null, lastSize = "";
  let searchTimer = null, fsSeq = 0, pendingBack = 0, ownExit = 0;   // ownExit: 우리가 부른 전체 화면 해제 수
  let lastKeyboard = false, detailOpener = null;
  let helperOk = false, refreshTick = null, installEvt = null;
  const layers = [];               // 뒤로 가기로 닫을 판 (크게 보기·휴대폰 상세·조절 판)
  const ALL_CACHE = {};            // 계산한 모델 목록 (고를 수 있는 등급만 켬/끔 두 가지)
  const HAY = new Map();           // 모델별 검색용 글

  // ───────── 도우미
  /** @type {(sel: string) => any} */
  const $ = (sel) => document.querySelector(sel);
  /** @type {(sel: string) => any[]} */
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  /** 이벤트가 일어난 요소 @type {(e: Event) => any} */
  const tgt = (e) => e.target;
  const esc = C.esc;
  const cssVar = (name) => getComputedStyle(root).getPropertyValue(name).trim();
  const today = () => new Date();
  const styleOf = (co) => COMPANY_STYLE[co] || OTHER;
  const groupOf = (co) => (COMPANY_STYLE[co] ? co : "기타");
  const colorOf = (co) => colorCache[co] || (colorCache[co] = cssVar(styleOf(co).c) || "#8a8a8a");
  const muteColor = (c) => C.mixHex(c, cssVar("--dot") || "#8a8a8a", MUTE);
  const mutedOf = (co) => mutedCache[co] || (mutedCache[co] = muteColor(colorOf(co)));
  const srcName = (s) => (D.sources[s] && D.sources[s].name) || s;
  const blended = (m) => (m.price ? (3 * m.price.in + m.price.out) / 4 : null);
  const vkey = (v) => v.m.key + "|" + v.effort;
  const costFor = (v) => (S.x === "costok" ? v.costOk : v.cost);
  const costUnit = () => (S.x === "costok" ? "맞힌 문제당" : "문제당");
  const effLabel = (m, e) => C.effLabel(EG[m.company], e);
  const canSelect = (m, e) => C.canSelect(m, e, EG[m.company]);
  const howToSet = (m, e) => C.howToSet(m, e, EG[m.company]);
  const defaultEffort = (m) => C.defaultEffort(m, EDEF);
  const announce = (msg) => { const el = $("#srLive"); if (el) { el.textContent = ""; setTimeout(() => { el.textContent = msg; }, 30); } };
  const onMQ = (mq, fn) => (mq.addEventListener ? listen(mq, "change", fn) : mq.addListener((e) => { if (!DEAD) fn(e); }));   // 옛 사파리도
  const tx = (v) => Math.log10(v);
  const itx = (t) => 10 ** t;

  // ───────── 회사별 색·모양 (데이터로 자동: 최근 6개월 모델의 최고 점수가 높은 회사 상위 5곳, 나머지는 회색 '기타')
  function pickCompanies(all) {
    let prev = {};
    try { prev = JSON.parse(localStorage.getItem("aiCompare.coSlots") || "{}") || {}; } catch (e) { prev = {}; }
    const r = C.pickCompanies(all, C.monthsAgo(RECENT_MONTHS, today()), prev, TOP_N, SLOTS.length);
    try { localStorage.setItem("aiCompare.coSlots", JSON.stringify(r.slot)); } catch (e) { /* 저장 안 돼도 동작 */ }
    COMPANY_STYLE = {};
    for (const co of r.top) COMPANY_STYLE[co] = SLOTS[r.slot[co]] || OTHER;
    MAIN_COMPANIES = r.top;
    COMPANY_RULE = `최근 ${RECENT_MONTHS}개월 모델의 최고 점수가 높은 회사 ${TOP_N}곳 (데이터가 바뀌면 자동으로 다시 고름)`;
  }

  // ───────── 점수 계산 (모델 × 등급) — 고를 수 있는 등급만 켬/끔 두 가지를 미리 계산해 둠
  function getAll(selectableOnly) {
    const k = selectableOnly ? "sel" : "all";
    if (ALL_CACHE[k]) return ALL_CACHE[k];
    const models = [];
    for (const m of D.models) {
      const vs = [];
      for (const v of m.variants) {
        if (selectableOnly && !canSelect(m, v.effort)) continue;
        const r = C.scoreVariant(v, SRC_ORDER);
        if (!r) continue;
        const eff = effLabel(m, v.effort);
        const acc = C.accuracy(r.score, DIFF);
        vs.push({
          m, effort: v.effort, eff, effKo: /[가-힣]/.test(eff) ? "" : (EFF_KO[v.effort] || ""),
          isDefault: defaultEffort(m) === v.effort, score: r.score, se: r.se, disagree: r.disagree, nReal: r.nReal, parts: r.parts,
          cost: v.cost, costKind: v.cost_kind, costSrc: v.cost_src, acc, costOk: v.cost != null ? v.cost / acc : null,
        });
      }
      if (!vs.length) continue;
      C.sortEfforts(vs, effIdx);
      const best = vs.reduce((a, b) => (b.score > a.score ? b : a));
      if (!HAY.has(m.key)) HAY.set(m.key, C.makeHay(`${m.name} ${m.key} ${m.company}`));
      models.push({ m, key: m.key, name: m.name, company: m.company, date: m.date, vs, best, hay: HAY.get(m.key) });
    }
    ALL_CACHE[k] = models;
    return models;
  }

  // ───────── 필터: 검색도 다른 설정(출시 기간 · 꺼 둔 회사 · 회사별 개수)을 똑같이 따른다
  const outOfPeriod = (M, cutoff) => !!cutoff && (!M.date || M.date < cutoff);
  function applyFilters(all, allAny) {
    const cutoff = S.period ? C.monthsAgo(S.period, today()) : null;
    const terms = C.searchTerms(S.search);
    const found = terms.length ? all.filter((M) => C.matchSearch(M.hay, terms)) : null;
    // '고를 수 있는 등급만' 때문에 통째로 빠진 모델도 검색에는 알려 줌
    const selHidden = terms.length && allAny !== all ? allAny.filter((M) => C.matchSearch(M.hay, terms) && !all.some((x) => x.key === M.key)).length : 0;
    let list = (found || all).filter((M) => !S.hidden.includes(groupOf(M.company)) && !outOfPeriod(M, cutoff));
    list.sort((a, b) => b.best.score - a.best.score);
    const pool = list.slice();   // 가성비 경계선·추천은 개수 제한 없이 이 전체로 계산
    if (S.perCo) {
      const cnt = {};
      list = list.filter((M) => (cnt[M.company] = (cnt[M.company] || 0) + 1) <= S.perCo);
    }
    const base = new Set(list);
    for (const key of S.pinned) {   // 고정한 모델은 항상 보여줌 (비교용)
      if (!list.some((M) => M.key === key)) {
        const M = all.find((x) => x.key === key);
        if (M) list.push(M);
      }
    }
    return { list, pool, found, cutoff, base, selHidden, extra: null };   // extra: render 가 제한 밖에서 더한 모델 (경계선·오늘의 답)
  }
  // 검색 결과 중 몇 개가 그래프에 보이고, 나머지는 무엇 때문에 가려졌는지
  function searchReport(F, points) {
    if (!F.found) return null;
    const inList = new Set(F.list);
    const drawn = new Set(points.filter((p) => p.x != null).map((p) => p.M));
    const r = { found: F.found.length, shown: 0, pin: 0, front: 0, pick: 0, period: 0, cap: 0, co: 0, coGroups: [], est: 0, nocost: 0, sel: F.selHidden };
    for (const M of F.found) {
      const g = groupOf(M.company);
      if (drawn.has(M)) {
        r.shown++;
        if (!F.base.has(M)) {
          if (S.pinned.includes(M.key)) r.pin++;
          else if (F.extra && F.extra.front.has(M)) r.front++;
          else r.pick++;
        }
      } else if (inList.has(M)) {
        if (!S.estimated && M.vs.some((v) => v.costKind === "가격 추정" && costFor(v) != null)) r.est++; else r.nocost++;
      } else if (outOfPeriod(M, F.cutoff)) r.period++;
      else if (S.hidden.includes(g)) { r.co++; if (!r.coGroups.includes(g)) r.coGroups.push(g); }
      else r.cap++;
    }
    return r;
  }
  // 그래프 가로 위치 (비용 축만 씀). 가격표로 짐작한 비용은 '추정 비용'을 켰을 때만
  function xOf(v) {
    const c = costFor(v);
    if (!(typeof c === "number" && Number.isFinite(c) && c > 0)) return null;
    if (!S.estimated && v.costKind === "가격 추정") return null;
    return c;
  }

  // ───────── 그래프 준비
  const chartEl = $("#chart");
  const chartBox = $("#chartBox");
  const chart = echarts.init(chartEl, null, { renderer: "canvas" });
  const measureCtx = document.createElement("canvas").getContext("2d");
  const isNarrow = () => chartEl.clientWidth < 560;
  const setThemeColor = (c) => { const m = /** @type {HTMLMetaElement|null} */ (document.querySelector('meta[name="theme-color"]')); if (m) m.content = c; };

  // ═════════ 다시 그리기 ═════════
  function render() {
    const keep = rememberFocus();
    const all = getAll(S.selectableOnly);
    const allAny = S.selectableOnly ? getAll(false) : all;
    const F = applyFilters(all, allAny);
    // 가성비 경계선·오늘의 답 후보: 필터를 통과한 모델의 점 중 비용이 있는 것 (가격표로 짐작한 비용은 빼고)
    const cand = [];
    for (const M of F.pool) {
      for (const v of M.vs) {
        const x = xOf(v);
        if (x != null && v.costKind !== "가격 추정") cand.push({ key: vkey(v), x, score: v.score, se: v.se, model: M, M, v });
      }
    }
    FR = C.frontier(cand);
    const r = C.picks(cand, FR.front, SAME_COST);
    PICKS = r ? {
      top: r.top.v, rival: r.rival ? r.rival.v : null, band: (v, w) => Math.sqrt((w || r.top.v).se ** 2 + v.se ** 2), near: r.near.map((p) => p.v),
      value: r.value.v, valueRows: r.valueRows.map((p) => p.v), topRows: r.topRows.map((p) => p.v), alt: r.alt ? r.alt.v : null, next: r.next ? r.next.v : null,
    } : null;
    // 경계선 위 모델(경계선을 켰을 때만) · 오늘의 답 모델은 '회사마다 N개' 제한에 걸려도 그래프에 그림
    // 왜 더해졌는지 따로 기억 → 검색 안내 줄이 '경계선 위'와 '오늘의 답'을 나눠 셈
    F.extra = { front: new Set(), pick: new Set() };
    const add = (M, why) => { if (M && !F.list.includes(M)) { F.list.push(M); F.extra[why].add(M); } };
    if (S.frontier) for (const p of FR.front) add(p.M, "front");
    if (r) for (const p of [r.top, r.value, ...r.valueRows, ...r.topRows]) add(p.M, "pick");
    const points = [];
    for (const M of F.list) for (const v of M.vs) points.push({ M, v, x: xOf(v) });
    VIEW = { all, list: F.list, points };
    const SR = searchReport(F, points);
    const empty = $("#chartEmpty");
    const none = !points.some((p) => p.x != null);
    empty.hidden = !none;
    if (none) empty.textContent = emptyText(SR, " · ");
    lastTapKey = null;
    renderSearchNote(SR);
    renderLegend(all, F.found);
    renderPinBar();
    renderCards(SR);
    renderChart();
    renderHeadline();
    renderTable(F.list);
    renderDetail();
    renderTicker(all);
    renderFacts(all, false);
    syncControls();
    restoreFocus(keep);
  }
  // 그래프·카드에 보일 모델이 하나도 없을 때의 안내
  function emptyText(SR, sep) {
    if (!SR) {
      if (S.period || S.hidden.length > 1) return "지금 설정으로는 보이는 모델이 없어요" + sep + "출시 기간을 '전체'로 바꾸거나 그래프 위 회사 버튼을 다시 켜 보세요";
      return "보이는 모델이 없어요" + sep + "그래프 위 회사 버튼을 다시 켜 보세요";
    }
    if (!SR.found) return SR.sel ? `찾은 모델 ${SR.sel}개는 실제로 고를 수 없는 등급만 있어 숨겨져 있어요` + sep + "보기 → '고를 수 있는 등급만'을 끄면 보여요"
      : "검색한 모델이 없어요" + sep + "이름 일부만 쳐도 되고, 쉼표로 여러 개를 찾을 수 있어요";
    if (SR.co + SR.period + SR.cap) return `찾은 모델 ${SR.found}개가 지금 설정에 가려져 있어요` + sep + "그래프 위 안내 줄의 버튼으로 바로 보이게 할 수 있어요";
    if (SR.est) return "찾은 모델은 가격표로 짐작한 비용만 있어요" + sep + "그래프 위 안내 줄의 '추정 비용 켜기'를 누르면 보여요";
    return "찾은 모델은 비용 기록이 없어 그래프에 그릴 수 없어요" + sep + "아래 순위표에서 점수를 볼 수 있어요";
  }
  // 검색 안내 줄: 찾은 모델 중 몇 개가 보이고, 나머지는 어떤 설정 때문에 가려졌는지 + 바로 켜는 버튼
  function renderSearchNote(SR) {
    const el = $("#searchNote");
    if (!SR) { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;
    const hid = SR.found - SR.shown;
    const plus = [];
    if (SR.front) plus.push(`가성비 경계선 위 ${SR.front}개`);
    if (SR.pick) plus.push(`오늘의 답 ${SR.pick}개`);
    if (SR.pin) plus.push(`고정한 ${SR.pin}개`);
    let h = `<span class="sn-main"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span>`
      + (!SR.found ? "찾은 모델 <b>0</b>개" : hid ? `찾은 모델 <b>${SR.found}</b>개 중 <b>${SR.shown}</b>개 보임` : `찾은 모델 <b>${SR.found}</b>개 모두 보임`)
      + (plus.length && S.perCo ? ` <small class="sn-plus">(${plus.join(" · ")}는 회사별 개수와 상관없이 표시)</small>` : "") + `</span></span>`;
    const rs = [];
    const reason = (txt, n, k, btn) => `<span class="sn-r"><span>${txt} <b>${n}</b>개</span>${k ? `<button type="button" data-sn="${k}">${btn}</button>` : ""}</span>`;
    if (SR.co) rs.push(reason(`꺼 둔 회사(${SR.coGroups.map(esc).join(", ")})`, SR.co, "co", "켜기"));
    if (SR.period) rs.push(reason(`출시 ${PERIOD_KO[S.period] || S.period + "개월"} 밖`, SR.period, "period", "전체 기간"));
    if (SR.cap) rs.push(reason(`회사마다 ${S.perCo}개까지라`, SR.cap, "cap", "전부 보기"));
    if (SR.est) rs.push(reason("가격표로 짐작한 비용뿐이라", SR.est, "est", "추정 비용 켜기"));
    if (SR.sel) rs.push(reason("고를 수 없는 등급만 있어", SR.sel, "sel", "모든 등급 보기"));
    if (SR.nocost) rs.push(reason("비용 기록이 없어 (순위표에만)", SR.nocost));
    if (rs.length) h += `<span class="sn-why">가려짐</span>` + rs.join("");
    el.innerHTML = h;
    el.querySelectorAll("button[data-sn]").forEach((b) => {
      b.addEventListener("click", () => {
        const k = b.dataset.sn;
        if (k === "co") S.hidden = S.hidden.filter((g) => !SR.coGroups.includes(g));
        if (k === "period") S.period = 0;
        if (k === "cap") S.perCo = 0;
        if (k === "est") S.estimated = true;
        if (k === "sel") S.selectableOnly = false;
        render();
      });
    });
  }

  // ═════════ 오늘의 답: 큰 문장 + 각주 + 지도 핀 ═════════
  function pinTargets() {
    const P = PICKS, out = [];
    if (!P) return out;
    [[1, P.top], [2, P.value], [3, P.alt]].forEach(([n, v]) => {
      if (!v || xOf(v) == null) return;
      const same = out.find((t) => t.v === v);
      if (same) same.n.push(n); else out.push({ n: [n], v });
    });
    return out;
  }
  function renderHeadline() {
    const el = $("#headline"), notes = $("#notes");
    const P = PICKS;
    if (!P) { el.textContent = "돈을 쓴 만큼 똑똑한 AI는 무엇일까"; notes.innerHTML = ""; return; }
    const sup = (n) => `<sup>${n})</sup>`;
    const att = (v) => ` data-key="${esc(v.m.key)}" data-eff="${esc(v.effort)}" tabindex="0" role="button" title="누르면 지도에 고정하고 자세히 보기"`;
    const nm = (v) => `<span class="nm"${att(v)}>${esc(v.m.name)}</span><span class="ef">${esc(v.eff)}</span>`;
    const ef = (v) => `<span class="nm"${att(v)}>${esc(v.eff)}</span>`;
    const pct = (v) => C.savePct(costFor(v), costFor(P.top));
    const line = (n, q, ans) => `<span class="hl-s"><span class="hl-q"><i>${n}</i>${q}</span><span class="hl-a">${ans}</span></span>`;
    let h = line(1, "지금 가장 똑똑한 AI는", `${nm(P.top)}${sup(1)}`);
    if (P.value && P.value !== P.top) {
      const s1 = pct(P.value);
      const q = s1 == null ? "가성비로 고르면" : s1 > 0 ? `사실상 같은 실력을 <em>${s1}% 싸게</em> 쓰려면` : "사실상 같은 실력을 비슷한 값에 쓰려면";
      h += line(2, q, `${P.value.m === P.top.m ? `<span class="hl-pre">같은 모델의</span>` + ef(P.value) : nm(P.value)}${sup(2)}`);
    } else if (P.value) {
      h += line(2, "가성비로 봐도", `이 모델이 가장 좋아요${sup(2)}`);
    }
    if (P.alt && P.alt !== P.value) {
      const base = P.value || P.top, s3 = pct(P.alt);
      h += line(3, `더 아끼려면${s3 != null && s3 > 0 ? ` <span class="hl-sv">(${s3}% 싸게)</span>` : ""}`,
        `${P.alt.m === base.m ? `<span class="hl-pre">같은 모델의</span>` + ef(P.alt) : nm(P.alt)}${sup(3)}`);
    }
    el.innerHTML = h;
    const row = (n, v) => `<li><button type="button" class="note-btn" data-key="${esc(v.m.key)}" data-eff="${esc(v.effort)}"><b>${n})</b><span>${esc(v.m.name)} · ${esc(v.eff)}</span> — 종합 ${v.score.toFixed(1)}점 · ${esc(costUnit())} ${C.fmtCost(costFor(v))}</button></li>`;
    const rows = [row(1, P.top)];
    if (P.value === P.top) rows.push(`<li><b>2)</b> 1)과 같은 모델 — 가성비로 봐도 가장 좋아요</li>`);
    else if (P.value) rows.push(row(2, P.value));
    if (P.alt && P.alt !== P.value) rows.push(row(3, P.alt));
    notes.innerHTML = rows.join("");
  }
  // 큰 문장·각주·카드의 모델 이름 ↔ 지도의 점 (마우스·키보드 초점이 오면 강조, 누르면 고정 + 상세)
  function bindPointLinks(host, sel) {
    const pick = (e) => (tgt(e) && tgt(e).closest ? tgt(e).closest(sel) : null);
    let hov = null;
    const enter = (e) => {
      const t = pick(e);
      if (!t || t === hov) return;
      hov = t;
      chart.dispatchAction({ type: "downplay" });
      focusPoint(t.dataset.key, t.dataset.eff);
    };
    const leave = () => { hov = null; chart.dispatchAction({ type: "downplay" }); chart.dispatchAction({ type: "hideTip" }); };
    if (CAN_HOVER) { host.addEventListener("mouseover", enter); host.addEventListener("mouseleave", leave); }
    host.addEventListener("focusin", (e) => { if (lastKeyboard) enter(e); });   // 키보드로 왔을 때만 (휴대폰 터치로 생긴 초점에 말풍선이 머리칸 위로 뜨지 않게)
    host.addEventListener("focusout", (e) => { if (!host.contains(e.relatedTarget)) leave(); });
    host.addEventListener("click", (e) => { const t = pick(e); if (t) pinAndShow(t.dataset.key, t.dataset.eff, t); });
  }
  // 확대·이동할 때 핀을 점에 맞춰 옮김
  function updatePins() {
    const V = VIEWBOX || FULL;
    if (!V) return;
    const els = pinTargets().map((t, i) => {
      const x = xOf(t.v), inV = x != null && x >= V.x0 && x <= V.x1 && t.v.score >= V.y0 && t.v.score <= V.y1;
      const q = inV ? chart.convertToPixel({ gridIndex: 0 }, [x, t.v.score]) : null;
      return { id: "pin" + i, x: q ? q[0] : -999, y: q ? q[1] : -999, invisible: !q };
    });
    if (els.length) chart.setOption({ graphic: els }, { silent: true });
  }

  // ───────── 최근 30일 새 모델 (누르면 그 모델 고정 + 상세)
  function renderTicker(all) {
    const el = $("#ticker");
    const now = today();
    const fresh = all.filter((M) => M.date && C.daysSince(M.date, now) <= 30).sort((a, b) => b.date.localeCompare(a.date) || b.best.score - a.best.score);
    if (!fresh.length) { el.hidden = true; el.innerHTML = ""; return; }
    const shown = tickerAll ? fresh : fresh.slice(0, 6);
    const row = (M) => `<button type="button" class="tk-item" data-key="${esc(M.key)}" title="누르면 지도에 고정하고 자세히 보기">` +
      `<span class="sym" aria-hidden="true">${symbolSvg(styleOf(M.company).sym, mutedOf(M.company))}</span><b>${esc(M.name)}</b>` +
      `<span class="tk-meta">${esc(M.date.slice(5).replace("-", "."))} 출시</span><span class="tk-score">${M.best.score.toFixed(1)}</span></button>`;
    el.innerHTML = `<h3 class="sub-h">새로 나온 모델 <b>${fresh.length}</b><small>최근 30일 · 최고 등급 점수</small></h3>` +
      `<div class="nl-rows">${shown.map(row).join("")}</div>` +
      (fresh.length > shown.length ? `<button type="button" class="nl-more">${fresh.length - shown.length}개 더 보기</button>` : "");
    el.hidden = false;
  }

  // ═════════ 그래프 그리기 ═════════
  // 이름표 자리 정하기: 중요한 것부터(고정 > 회사 강조 > 경계선 위 > 점수 높은 순) 다른 이름표·점과 겹치지 않는 자리를 찾음
  function placeLabels(series, V, narrow, st) {
    const W = chartEl.clientWidth, H = chartEl.clientHeight;
    const g = { l: st.G.left, r: st.G.right, t: st.G.top, b: st.G.bottom };
    const gw = W - g.l - g.r, gh = H - g.t - g.b;
    if (gw <= 0 || gh <= 0) return;
    const ax = tx(V.x0), bx = tx(V.x1);
    const px = (x) => g.l + ((tx(x) - ax) / (bx - ax)) * gw;
    const py = (y) => g.t + ((V.y1 - y) / (V.y1 - V.y0)) * gh;
    const cands = [], dots = [];
    for (const s of series) {
      for (const d of s.data || []) {
        if (!d || !d.value) continue;
        if (!(d.itemStyle && d.itemStyle.opacity < 0.5)) {
          const X = px(d.value[0]), Y = py(d.value[1]), r = (d.symbolSize || 10) / 2;
          dots.push({ x: X - r, y: Y - r, w: 2 * r, h: 2 * r });
        }
        if (!d.__lab) continue;
        const X = px(d.value[0]), Y = py(d.value[1]);
        if (X < g.l - 2 || X > g.l + gw + 2 || Y < g.t - 2 || Y > g.t + gh + 2) continue;
        cands.push({ d, X, Y, r: (d.symbolSize || 10) / 2 });
      }
    }
    if (st.soft) dots.push(...st.soft);
    cands.sort((a, b) => b.d.__lab.prio - a.d.__lab.prio);
    const placed = (st.block || []).slice();
    const overlap = (R, q) => R.x < q.x + q.w && R.x + R.w > q.x && R.y < q.y + q.h && R.y + R.h > q.y;
    const hit = (R) => placed.some((q) => overlap(R, q));
    const dotArea = (R) => dots.reduce((a, q) => a + (overlap(R, q) ? (Math.min(R.x + R.w, q.x + q.w) - Math.max(R.x, q.x)) * (Math.min(R.y + R.h, q.y + q.h) - Math.max(R.y, q.y)) : 0), 0);
    const inside = (R) => R.x >= 2 && R.x + R.w <= W - 2 && R.y >= 0 && R.y + R.h <= g.t + gh + 2;
    for (const c of cands) {
      const L = c.d.__lab;
      const fs = L.small ? 11 : L.strong ? 12.5 : narrow ? 11 : 11.5, fw = L.strong ? 700 : 500;
      measureCtx.font = `${fw} ${fs}px ${st.font}`;
      const h = fs + 5, dist = narrow ? 4 : 6;
      for (const label of L.alt ? [L.text, L.alt] : [L.text]) {   // 긴 이름표가 안 들어가면 짧은 것으로 다시 시도
        const w = measureCtx.measureText(label).width + 6;
        const nearR = (c.X - g.l) / gw > (narrow ? 0.62 : 0.8);
        const order = nearR ? ["left", "top", "bottom", "right"] : narrow ? ["top", "right", "left", "bottom"] : ["right", "left", "top", "bottom"];
        const rectOf = (p) => (p === "right" ? { x: c.X + c.r + dist, y: c.Y - h / 2, w, h }
          : p === "left" ? { x: c.X - c.r - dist - w, y: c.Y - h / 2, w, h }
            : p === "top" ? { x: c.X - w / 2, y: c.Y - c.r - dist - h, w, h }
              : { x: c.X - w / 2, y: c.Y + c.r + dist, w, h });
        let pos = order.find((p) => { const R = rectOf(p); return inside(R) && !hit(R) && !dots.some((q) => overlap(R, q)); });
        if (!pos) {
          let bv = Infinity;
          for (const p of order) { const R = rectOf(p); if (!inside(R) || hit(R)) continue; const v = dotArea(R); if (v < bv) { bv = v; pos = p; } }
          if (pos && bv > 30 && L.prio < 500) pos = null;   // 점을 많이 가리면 중요한 이름표만
        }
        if (!pos && L.force) pos = order.find((p) => inside(rectOf(p))) || order[0];
        if (!pos) continue;
        placed.push(rectOf(pos));
        c.d.label = { show: true, position: pos, distance: dist, formatter: label, color: L.strong ? st.txt : st.txt2,
          fontSize: fs, fontWeight: fw, fontFamily: st.font, textBorderColor: st.halo, textBorderWidth: 3 };
        break;
      }
    }
  }

  function renderChart() {
    if (!VIEW) return;
    const { list, points } = VIEW;
    const narrow = isNarrow();
    const txt = cssVar("--text"), txt2 = cssVar("--text-2"), muted = cssVar("--muted"), grid = cssVar("--grid"), axis = cssVar("--axis");
    const ink = cssVar("--acc"), inkText = cssVar("--acc-text"), surf = cssVar("--surface");
    const full = chartBox.classList.contains("full");
    const G = narrow ? { left: 34, right: 12, top: full && S.pinned.length ? 70 : 22, bottom: 30 } : { left: 46, right: 18, top: 24, bottom: 34 };
    const firstDraw = !chartDrawn;
    chartDrawn = true;
    const FRS = S.frontier ? FR : EMPTY_FR;            // 표시용 경계선 (경계선을 끄면 숨김 — 추천 계산은 그대로)
    const front = FRS.front;

    // 전체 범위: 점이 있는 곳에 딱 맞추고 조금만 여유
    const xs = points.map((p) => p.x).filter((x) => x != null);
    const ys = points.filter((p) => p.x != null).map((p) => p.v.score);
    const y0 = ys.length ? Math.floor(Math.min(...ys) - 2) : 100;
    const y1 = ys.length ? Math.ceil(Math.max(...ys) + 2) : 170;
    const lo = xs.length ? Math.min(...xs) : 0.01, hi = xs.length ? Math.max(...xs) : 1;
    const a = Math.log10(lo), b = Math.log10(hi);
    const pad = Math.max(0.06, (b - a) * 0.03);
    FULL = { x0: 10 ** (a - pad), x1: 10 ** (b + pad), y0, y1 };
    if (viewKind !== S.x) { VIEWBOX = null; viewKind = S.x; }   // 가로축(문제당 ↔ 맞힌 문제당)이 바뀌면 값의 크기가 달라 확대 범위가 의미 없음
    VIEWBOX = C.clampView(VIEWBOX, FULL);
    const V = VIEWBOX || FULL;

    const nearRight = (x) => x != null && (tx(x) - tx(V.x0)) / (tx(V.x1) - tx(V.x0)) > (narrow ? 0.62 : 0.8);
    const sidePos = (x) => (nearRight(x) ? "left" : narrow ? "top" : "right");
    const labelled = new Set(list.slice(0, S.labels ? 40 : 0).map((M) => M.key));
    const zoomedIn = !!VIEWBOX && S.labels;
    const pinSet = new Set(S.pinned);
    const anyPin = list.some((M) => pinSet.has(M.key));
    const frModels = new Set(front.map((p) => p.M.key));
    const topKeys = new Set(list.slice().sort((p, q) => q.best.score - p.best.score).slice(0, 3).map((M) => M.key));
    const series = [];
    for (const M of list) {
      const coCol = colorOf(M.company);
      const sym = styleOf(M.company).sym;
      const pinned = pinSet.has(M.key);
      const hl = hoverCo != null && groupOf(M.company) === hoverCo;
      const dim = (anyPin && !pinned) || (hoverCo != null && !hl);
      const focus = pinned || hl;
      const soft = mutedOf(M.company);
      const col = focus ? coCol : soft;
      const shown = M.vs.filter((z) => xOf(z) != null);
      const topV = shown.reduce((p, q) => (q.score > p.score ? q : p), { score: -1 });
      const data = shown.map((v) => {
        const x = xOf(v);
        const hollow = v.costKind === "가격 추정";
        const isTop = v === topV;
        const st = (FRS.status.get(vkey(v)) || {}).st;
        const fr = st === "front", nr = st === "near";
        const base = sym === "pin" ? 16 : sym === "triangle" ? 12 : 10;
        return {
          value: [x, +v.score.toFixed(2)],
          v,
          symbol: sym,
          symbolSize: base + (pinned ? 3 : 0) + (fr ? 3 : nr ? 2 : 0),
          itemStyle: Object.assign(
            hollow ? { color: surf, borderColor: col, borderWidth: 2 }
              : fr ? { color: col, borderColor: ink, borderWidth: 1.6 }
                : nr ? { color: col, borderColor: ink, borderWidth: 1.4, borderType: [2, 2] }
                  : { color: col, borderColor: surf, borderWidth: 1.5 },
            { opacity: dim ? 0.14 : 1 }),
          label: { show: false },
          __lab: pinned ? { text: isTop ? `${M.name} · ${v.eff}` : v.eff, strong: isTop, small: !isTop, force: true, prio: 1000 + (isTop ? 50 : 0) + v.score }
            : isTop && (labelled.has(M.key) || hl) && !dim ? { text: zoomedIn ? `${M.name} · ${v.eff}` : M.name, prio: (hl ? 800 : frModels.has(M.key) ? 500 : topKeys.has(M.key) ? 450 : 300) + v.score }
              : zoomedIn && !dim ? { text: `${M.name} · ${v.eff}`, alt: v.eff, small: true, prio: 100 + v.score } : null,
          emphasis: {
            itemStyle: Object.assign({ opacity: 1, color: hollow ? surf : coCol }, hollow ? { borderColor: coCol } : {}),
            label: {
              show: true, position: sidePos(x), distance: 7, fontFamily: FONT, opacity: 1, textBorderColor: surf, textBorderWidth: 3,
              formatter: isTop ? `${M.name} · ${v.eff}` : v.eff, color: isTop ? txt : txt2, fontSize: isTop ? 12.5 : 10.5, fontWeight: isTop ? 700 : 500,
            },
          },
        };
      });
      if (!data.length) continue;
      series.push({
        name: M.name, id: M.key, type: "line", data, showSymbol: true, triggerLineEvent: CAN_HOVER,
        lineStyle: { width: focus ? 2 : 1.2, color: focus ? coCol : soft, opacity: focus ? 0.7 : dim ? 0.08 : 0.42, cap: "round", join: "round" },
        itemStyle: { color: col },
        emphasis: { focus: "series", lineStyle: { width: 2, opacity: 0.85, color: coCol } },
        blur: { lineStyle: { opacity: 0.06 }, itemStyle: { opacity: 0.14 }, label: { opacity: 0.2 } },
        labelLayout: { hideOverlap: false },
        z: pinned ? 6 : hl ? 5 : dim ? 1 : 3,
        animationDuration: firstDraw ? 1500 : 550, animationEasing: "cubicOut",
      });
    }
    // 지도 영역 이름 · 경계선 이름 · 각주 핀 (글자는 흰 바탕 대비 4.5:1 이상인 진한 보라)
    const regions = [], regionRects = [];
    const W = chartEl.clientWidth, H = chartEl.clientHeight, gw = W - G.left - G.right, gh = H - G.top - G.bottom;
    const gx = (x) => G.left + ((tx(x) - tx(V.x0)) / (tx(V.x1) - tx(V.x0))) * gw;
    const gy = (y) => G.top + ((V.y1 - y) / (V.y1 - V.y0)) * gh;
    const lineRects = [];
    for (let i = 0; i < front.length && front.length >= 2; i++) {
      const p = front[i], q = front[i + 1];
      const xa = gx(p.x), ya = gy(p.v.score), xb = q ? gx(q.x) : G.left + gw, yb = q ? gy(q.v.score) : ya;
      lineRects.push({ x: Math.min(xa, xb), y: ya - 2.5, w: Math.abs(xb - xa), h: 5 });
      if (q) lineRects.push({ x: xb - 2.5, y: Math.min(ya, yb), w: 5, h: Math.abs(yb - ya) });
    }
    if (front.length >= 2 && !VIEWBOX) {
      const big = narrow ? 11.5 : 13, small = narrow ? 10.5 : 11.5, padR = narrow ? 8 : 14;
      const mk = (t1, t2, side) => {
        measureCtx.font = `700 ${big}px ${FONT}`; const w1 = measureCtx.measureText(t1).width;
        measureCtx.font = `500 ${small}px ${FONT}`; const w2 = measureCtx.measureText(t2).width;
        const w = Math.max(w1, w2) + 4, h = big + small + 10;
        const x = side === "tl" ? G.left + padR : W - G.right - padR - w;
        const y = side === "tl" ? G.top + padR : H - G.bottom - padR - h;
        regionRects.push({ x, y, w, h });
        regions.push({
          type: "text", left: x, top: y, silent: true, z: 0,
          style: {
            text: `{a|${t1}}\n{b|${t2}}`, align: side === "tl" ? "left" : "right",
            rich: { a: { fontFamily: FONT, fontSize: big, fontWeight: 700, fill: txt2, lineHeight: big + 6 }, b: { fontFamily: FONT, fontSize: small, fontWeight: 500, fill: muted, lineHeight: small + 4 } },
          },
        });
      };
      mk("↖ 아직 아무도 없는 곳", "경계선보다 싸면서 더 똑똑한 모델은 아직 없어요", "tl");
      mk("돈 낭비 구역 ↘", "같은 돈이면 경계선 위에 더 똑똑한 모델이 있어요", "br");
    }
    if (front.length >= 2) {
      const f0 = front.find((p) => p.x >= V.x0 && p.x <= V.x1 && p.v.score >= V.y0 && p.v.score <= V.y1);
      if (f0) {
        const fs = narrow ? 11 : 12, label = "가성비 경계선";
        measureCtx.font = `700 ${fs}px ${FONT}`;
        const w = measureCtx.measureText(label).width + 4, h = fs + 4;
        const X = gx(f0.x) + 12;
        let Y = gy(f0.v.score) + 9;
        if (Y + h > G.top + gh - 4) Y = gy(f0.v.score) - 9 - h;
        if (X + w < G.left + gw) {
          regionRects.push({ x: X, y: Y, w, h });
          regions.push({ type: "text", left: X, top: Y, silent: true, z: 5, style: { text: label, fill: inkText, font: `700 ${fs}px ${FONT}`, stroke: surf, lineWidth: 3 } });
        }
      }
    }
    pinTargets().forEach((t, i) => {
      const x = xOf(t.v), inV = x != null && x >= V.x0 && x <= V.x1 && t.v.score >= V.y0 && t.v.score <= V.y1;
      const X = inV ? gx(x) : -999, Y = inV ? gy(t.v.score) : -999, label = t.n.map((n) => n + ")").join(" ");
      if (inV) regionRects.push({ x: X - 8, y: Y - 40, w: 14 + label.length * 7, h: 34 });
      regions.push({ id: "pin" + i, type: "group", x: X, y: Y, silent: true, z: 30, invisible: !inV, children: [
        { type: "line", shape: { x1: 0, y1: -7, x2: 0, y2: -27 }, style: { stroke: ink, lineWidth: 1.5 } },
        { type: "circle", shape: { cx: 0, cy: -32, r: 6 }, style: { fill: ink } },
        { type: "text", x: 10, y: -40, style: { text: label, fill: inkText, font: `700 11px ${FONT}` } },
      ] });
    });
    placeLabels(series, V, narrow, { txt, txt2, halo: surf, font: FONT, block: regionRects, soft: lineRects, G });
    // 가성비 경계선: 보라 계단 + 아래 '오차 범위' 띠 — 이 화면의 주인공
    if (front.length >= 2) {
      const pts = front.map((p) => [p.x, +p.v.score.toFixed(2)]);
      pts.push([FULL.x1 * 1.5, pts[pts.length - 1][1]]);   // 가장 비싼 경계 점 오른쪽으로 수평 연장 (확대·이동해도 끝이 끊기지 않게 전체 범위 기준)
      const k = FRS.k;
      const bandFill = cssVar("--acc-fill");
      series.push({
        id: "__fband", type: "custom", silent: true, z: 1, clip: true, data: [0], tooltip: { show: false }, animation: false,
        renderItem: (params, ec) => {
          const up = [];
          for (let i = 0; i < pts.length; i++) {
            if (i > 0) up.push([pts[i][0], pts[i - 1][1]]);
            up.push(pts[i]);
          }
          const top = up.map((q) => ec.coord(q));
          const bot = up.slice().reverse().map(([x, y]) => ec.coord([x, y - k]));
          return { type: "polygon", shape: { points: top.concat(bot) }, style: { fill: bandFill, opacity: 0.9 } };
        },
      });
      series.push({
        id: "__frontier", name: "가성비 경계선", type: "line", step: "end", silent: true, z: 2,
        data: pts, showSymbol: false,
        lineStyle: { width: 2.5, color: ink, opacity: 1, cap: "butt", join: "miter" },
        tooltip: { show: false }, emphasis: { disabled: true },
        animationDuration: firstDraw ? 1900 : 1100, animationDelay: firstDraw ? 250 : 0, animationEasing: "cubicInOut",
      });
      if (!REDUCED && chartVisible) {   // 경계선을 따라 흐르는 빛 — 별도 층(zlevel 1)이라 다른 점들은 다시 그리지 않음, 그래프가 화면 밖이면 멈춤
        const cs = [[front[0].x, front[0].v.score]];
        for (let i = 1; i < front.length; i++) { cs.push([front[i].x, front[i - 1].v.score]); cs.push([front[i].x, front[i].v.score]); }
        cs.push([FULL.x1, front[front.length - 1].v.score]);
        series.push({
          id: "__fpulse", type: "lines", coordinateSystem: "cartesian2d", polyline: true, silent: true, zlevel: 1, z: 4, clip: true,
          data: [{ coords: cs }], lineStyle: { opacity: 0, width: 0 },
          effect: { show: true, period: 9, trailLength: 0, symbol: "circle", symbolSize: narrow ? 4 : 5, color: ink, loop: true },
          tooltip: { show: false }, animation: false,
        });
      }
    }
    SIDX = new Map();
    series.forEach((s2, i) => { if (s2.type === "line" && !String(s2.id).startsWith("__")) SIDX.set(s2.id, { i, effs: s2.data.map((d) => d.v.effort) }); });

    const axLabel = { fontFamily: FONT, fontSize: 11.5 };
    const ticks = C.logTicks(V.x0, V.x1);
    const fmtTick = (v) => "$" + (v >= 1 ? +v.toFixed(2) : +v.toPrecision(3));
    const xAxis = {
      type: "log", logBase: 10, min: V.x0, max: V.x1, splitLine: { show: true, lineStyle: { color: grid } }, axisLine: { lineStyle: { color: txt, width: 1 } }, minorSplitLine: { show: false },
      axisLabel: Object.assign({ color: muted, customValues: ticks, formatter: fmtTick, hideOverlap: true }, axLabel), axisTick: { customValues: ticks, show: false },
    };
    let yPointer = { show: false };
    if (CAN_HOVER && !narrow) {   // 마우스를 따라오는 십자선과 눈금 읽기
      const ap = (fmt) => ({ show: true, type: "line", snap: false, triggerTooltip: false, lineStyle: { color: axis, width: 1, type: [3, 4] },
        label: { show: true, backgroundColor: txt, color: cssVar("--bg"), fontFamily: FONT, fontSize: 11, padding: [3, 6], borderRadius: 3, formatter: fmt } });
      xAxis.axisPointer = ap((p) => C.fmtCost(p.value));
      yPointer = ap((p) => (+p.value).toFixed(1));
    }
    const xName = S.x === "costok" ? `가로 → 맞힌 문제 1개당 비용 (난이도 '${DIFF.label}' 기준 · 틀리는 만큼 비싸짐)` : "가로 → 문제 1개 푸는 비용 (오른쪽일수록 비쌈)";
    const noX = list.reduce((n, M) => n + M.vs.filter((v) => xOf(v) == null).length, 0);
    $("#axisX").textContent = xName + (noX ? ` · 비용 정보가 없어 빠진 점 ${noX}개 (표에는 있음)` : "");

    chart.setOption({
      backgroundColor: "transparent",
      animation: !quietRender && !REDUCED,
      textStyle: { fontFamily: FONT },
      grid: G,
      graphic: regions,
      xAxis,
      yAxis: {
        type: "value", min: V.y0, max: V.y1,
        axisLabel: Object.assign({ color: muted, showMinLabel: false, showMaxLabel: false, formatter: (v) => (Number.isInteger(v) ? v : v.toFixed(1)) }, axLabel),
        splitLine: { lineStyle: { color: grid } }, axisLine: { show: false }, minInterval: 0.5, axisPointer: yPointer,
      },
      tooltip: {
        trigger: "item", confine: true, enterable: false, backgroundColor: "transparent", borderWidth: 0, padding: 0,
        extraCssText: "box-shadow:none;", transitionDuration: 0.15, className: "chart-tip",
        formatter: (p) => {
          if (p.data && p.data.v) return tipHtml(p.data.v);
          if (p.seriesType === "line" && seriesKey(p)) {
            const pinned = S.pinned.includes(seriesKey(p));
            return `<div class="tip"><div class="tip-h">${esc(p.seriesName)}</div><div class="tip-hint">${pinned ? "누르면 고정 해제" : "누르면 고정 · 점에 올리면 자세히"}</div></div>`;
          }
          return "";
        },
      },
      series,
    }, { notMerge: true });
    lastSize = chartEl.clientWidth + "x" + chartEl.clientHeight;
    updateZoomUi();
  }

  // ───────── 말풍선
  function tipHtml(v) {
    const M = v.m, c = C.confOf(v.se), col = colorOf(M.company);
    let h = `<div class="tip"><div class="tip-h"><span class="sw" style="background:${esc(col)}"></span>${esc(M.name)}</div>`;
    h += `<div class="tip-sub">${esc(v.eff)}${v.effKo ? " · " + esc(v.effKo) : ""}${v.isDefault ? " · 기본값" : ""}</div>`;
    h += `<div class="tip-score"><b>${v.score.toFixed(1)}</b><span>±${v.se.toFixed(1)} · 신뢰도 ${c.t}</span></div>`;
    h += `<div class="tip-row"><span>문제당 비용</span><b>${C.fmtCost(v.cost)}${v.costKind && v.costKind !== "측정" ? ` <span class="muted">(${esc(v.costKind)})</span>` : ""}</b></div>`;
    if (v.costOk != null) h += `<div class="tip-row"><span>맞힌 문제당 <span class="muted">(${esc(DIFF.label)} ${C.fmtAcc(v.acc)})</span></span><b>${C.fmtCost(v.costOk)}</b></div>`;
    if (M.price) h += `<div class="tip-row"><span>가격표 (입력/출력)</span><span>${C.fmtPriceExact(M.price.in)} / ${C.fmtPriceExact(M.price.out)}</span></div>`;
    const fs = (S.frontier ? FR : EMPTY_FR).status.get(vkey(v));
    if (fs) {
      const t = fs.st === "front" ? "<b>경계선 위</b> — 이 가격대에서 최선"
        : fs.st === "near" ? `<b>사실상 동급</b> — 경계선보다 ${fs.gap.toFixed(1)}점 낮지만 오차(±${FR.k}) 안`
          : `경계선보다 ${fs.gap.toFixed(1)}점 낮음 — 같은 돈이면 더 좋은 모델이 있음`;
      h += `<div class="tip-front ${fs.st}">${t}</div>`;
    }
    const how = howToSet(M, v.effort)[0];
    if (how) h += `<div class="tip-sep"></div><div class="tip-row"><span>설정</span><span class="${how.code ? "tip-code" : ""}">${esc(how.v)}</span></div>`;
    h += `<div class="tip-sep"></div>`;
    for (const p of v.parts) h += `<div class="tip-row"><span>${esc(srcName(p.s))}${p.est ? " (추정)" : ""}</span><b>${p.m.toFixed(1)}</b></div>`;
    const pinHint = S.pinned.includes(M.key) ? (S.selected === M.key && S.selEffort === v.effort ? "누르면 고정 해제" : "누르면 이 등급 설명 보기")
      : CAN_HOVER ? "누르면 고정" : "한 번 더 누르면 고정";
    h += `<div class="tip-hint">${esc(M.company)} · ${esc(M.date || "?")} 출시 · ${pinHint}</div></div>`;
    return h;
  }

  // ═════════ 확대·이동 ═════════
  //  · 그래프를 한 번 클릭해야 '확대 모드'가 켜짐 (그전엔 휠 = 페이지 스크롤)
  //  · 확대 모드: 휠로 확대/축소, 끌어서 이동, 빈 곳 더블클릭 = 처음 화면 · 키보드: +/− 확대, 방향키 이동, 0 처음 화면
  //  · 끄는 방법: Esc, 또는 그래프 칸 밖을 한 번 클릭
  function drawView() {
    rafPending = false;
    const V = VIEWBOX || FULL;
    if (!V) return;
    const ticks = C.logTicks(V.x0, V.x1);
    chart.setOption({ yAxis: { min: V.y0, max: V.y1 }, xAxis: { min: V.x0, max: V.x1, axisLabel: { customValues: ticks }, axisTick: { customValues: ticks } } }, { silent: true });
    updatePins();
    updateZoomUi();
    clearTimeout(labelTimer);   // 멈추면 이름표 방향 다시 계산
    labelTimer = setTimeout(quietChart, 350);
  }
  function quietChart() {
    if (!VIEW) return;
    quietRender = true;
    try { renderChart(); } finally { quietRender = false; }
  }
  function applyView() {
    if (document.visibilityState === "hidden") { drawView(); return; }
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(drawView);
  }
  const setView = (v) => { VIEWBOX = C.clampView(v, FULL); applyView(); };
  const resetView = () => { VIEWBOX = null; applyView(); };
  function gridRect() {
    const g = chart.getModel() && chart.getModel().getComponent("grid");
    return g && g.coordinateSystem ? g.coordinateSystem.getRect() : null;
  }
  function inGrid(px, py) {
    const r = gridRect();
    return !!r && px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height;
  }
  function zoomAt(px, py, f, axes, base) {
    const V = base || VIEWBOX || FULL, r = gridRect();
    if (!V || !r) return;
    const t = tx(V.x0) + ((px - r.x) / r.width) * (tx(V.x1) - tx(V.x0));
    const yc = V.y1 - ((py - r.y) / r.height) * (V.y1 - V.y0);
    let a = tx(V.x0), b = tx(V.x1), y0 = V.y0, y1 = V.y1;
    if (axes !== "y") { a = t - (t - a) * f; b = t + (b - t) * f; }
    if (axes !== "x") { y0 = yc - (yc - y0) * f; y1 = yc + (y1 - yc) * f; }
    setView({ x0: itx(a), x1: itx(b), y0, y1 });
  }
  const zoomCenter = (f) => { const r = gridRect(); if (r) zoomAt(r.x + r.width / 2, r.y + r.height / 2, f, "xy"); };
  function panBy(fx, fy, base) {
    const v = base || VIEWBOX;
    if (!v) return;
    const a = tx(v.x0), b = tx(v.x1);
    setView({ x0: itx(a + fx * (b - a)), x1: itx(b + fx * (b - a)), y0: v.y0 + fy * (v.y1 - v.y0), y1: v.y1 + fy * (v.y1 - v.y0) });
  }

  // 확대 모드일 때만 페이지 휠을 막음 (평소엔 브라우저가 바로 스크롤 — 막는 처리기를 붙여 두지 않음)
  function blockWheel(e) {
    if (tgt(e) && tgt(e).closest && tgt(e).closest("#detail, .dock-sheet")) return;   // 상세·조절 판은 그대로 스크롤
    e.preventDefault();
    if (!chartBox.contains(tgt(e))) showToast("확대 모드라 페이지가 고정돼 있어요 · Esc 또는 그래프 밖 클릭으로 끝내기");
  }
  function setZoomOn(on) {
    if (zoomOn === on) return;
    zoomOn = on;
    chartBox.classList.toggle("zoom-on", on);
    $("#zoomBadge").setAttribute("aria-hidden", String(!on));
    if (on) { hideToast(); listen(window, "wheel", blockWheel, { passive: false }); }
    else window.removeEventListener("wheel", blockWheel);
  }
  function showToast(msg) {
    const t = $("#zoomToast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 1800);
  }
  function hideToast() { $("#zoomToast").classList.remove("show"); }
  // 확대 모드를 켜면 그래프가 화면 가운데 오도록 (PC 넓은 화면은 지도가 이미 고정돼 있어 옮기지 않음)
  function centerChart() {
    if (getComputedStyle($("#map")).position === "sticky") return;
    const r = chartBox.getBoundingClientRect();
    const top0 = $(".topbar").offsetHeight;
    if (r.top >= top0 && r.bottom <= window.innerHeight) return;   // 이미 다 보임
    const avail = window.innerHeight - top0 - 80;
    const delta = r.height <= avail ? r.top - (top0 + (avail - r.height) / 2) : r.top - top0 - 8;
    if (Math.abs(delta) > 4) window.scrollBy({ top: delta, behavior: REDUCED ? "auto" : "smooth" });
  }
  function updateZoomUi() {
    chartEl.classList.toggle("zoomed", !!VIEWBOX);
    $("#resetZoom").disabled = !VIEWBOX;
    $("#zoomOut").disabled = !VIEWBOX;
  }

  // ───────── 마우스 올리기·누르기
  function seriesKey(p) {
    const id = p.seriesId || ((chart.getOption().series || [])[p.seriesIndex] || {}).id;
    return id && !String(id).startsWith("__") ? String(id) : null;
  }
  function focusPoint(key, eff) {
    const s2 = SIDX.get(key);
    if (!s2) return;
    const di = s2.effs.indexOf(eff);
    chart.dispatchAction({ type: "highlight", seriesIndex: s2.i });
    if (di >= 0) chart.dispatchAction({ type: "showTip", seriesIndex: s2.i, dataIndex: di });
  }

  // ───────── 고정 (비교)
  function addPin(key) {
    if (S.pinned.includes(key)) return;
    if (S.pinned.length >= PIN_MAX) {
      const gone = S.pinned[0];
      const M = VIEW && VIEW.all.find((x) => x.key === gone);
      showToast(`고정은 ${PIN_MAX}개까지예요 — ${M ? M.name : "가장 먼저 고정한 모델"} 고정을 풀었어요`);
      announce(`고정은 ${PIN_MAX}개까지라 가장 먼저 고정한 모델을 풀었어요`);
    }
    S.pinned = [...S.pinned, key].slice(-PIN_MAX);
  }
  function togglePin(key, effort, opts = {}) {
    const name = (VIEW && (VIEW.all.find((x) => x.key === key) || {}).name) || "모델";
    // 이미 고정한 모델의 다른 등급을 누르면: 고정은 그대로 두고 그 등급을 보여 줌
    if (opts.select !== false && S.pinned.includes(key) && effort && (S.selected !== key || S.selEffort !== effort)) {
      S.selected = key; S.selEffort = effort;
      render();
      return;
    }
    if (S.pinned.includes(key)) {
      S.pinned = S.pinned.filter((k) => k !== key);
      if (S.selected === key) { S.selected = null; S.selEffort = null; }
      announce(`${name} 고정 해제`);
    } else {
      addPin(key);
      if (opts.select !== false) { S.selected = key; S.selEffort = effort || null; }
      announce(`${name} 지도에 고정`);
    }
    render();
  }
  function pinAndShow(key, effort, opener) {
    addPin(key);
    S.selected = key; S.selEffort = effort || null;
    detailOpener = describeFocus(opener || document.activeElement);
    render();
  }
  function renderPinBar() {
    const el = $("#pinBar"), hint = $("#pinHint");
    hint.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v6l-2 3h10l-2-3V4M12 13v7"/></svg>${CAN_HOVER ? "점을 누르면 고정 · 여러 개 골라 비교" : "점을 누르면 설명, 한 번 더 누르면 고정"}`;
    el.innerHTML = "";
    el.hidden = !S.pinned.length;
    if (!S.pinned.length) return;
    for (const key of S.pinned) {
      const M = VIEW.all.find((x) => x.key === key) || getAll(false).find((x) => x.key === key);
      if (!M) continue;
      const chip = document.createElement("span");
      chip.className = "pin" + (S.selected === key ? " cur" : "");
      const nameBtn = document.createElement("button");
      nameBtn.type = "button"; nameBtn.className = "pin-name"; nameBtn.dataset.key = key; nameBtn.title = "눌러서 자세히 보기";
      nameBtn.setAttribute("aria-pressed", String(S.selected === key));
      nameBtn.innerHTML = `<span class="sw" style="background:${esc(colorOf(M.company))}"></span>`;
      nameBtn.append(document.createTextNode(M.name));
      nameBtn.addEventListener("click", () => { S.selected = key; S.selEffort = null; detailOpener = describeFocus(nameBtn); render(); });
      const x = document.createElement("button");
      x.type = "button"; x.className = "x"; x.textContent = "×"; x.dataset.key = key; x.setAttribute("aria-label", M.name + " 고정 해제");
      x.addEventListener("click", (e) => { e.stopPropagation(); togglePin(key); });
      chip.append(nameBtn, x);
      el.append(chip);
    }
    const clr = document.createElement("button");
    clr.type = "button"; clr.className = "pin-clear"; clr.textContent = "모두 해제";
    clr.addEventListener("click", () => { S.pinned = []; S.selected = null; announce("고정을 모두 풀었어요"); render(); });
    el.append(clr);
  }

  // ───────── 회사 버튼 (누르면 숨기기/보이기)
  function symbolSvg(sym, col) {
    const s = {
      circle: `<circle cx="6" cy="6" r="5"/>`, rect: `<rect x="1" y="1" width="10" height="10" rx="1.5"/>`,
      diamond: `<path d="M6 0 L12 6 L6 12 L0 6Z"/>`, triangle: `<path d="M6 1 L11.5 11 L0.5 11Z"/>`, pin: `<path d="M6 12 C3 8 1 6.5 1 4.5 A5 5 0 0 1 11 4.5 C11 6.5 9 8 6 12Z"/>`,
    }[sym] || `<circle cx="6" cy="6" r="5"/>`;
    return `<svg viewBox="0 0 12 12" aria-hidden="true"${col ? ` style="fill:${esc(col)}"` : ""}>${s}</svg>`;
  }
  function renderLegend(all, found) {
    const cnt = {};
    const cutoff = S.period ? C.monthsAgo(S.period, today()) : null;
    for (const M of found || all) if (!outOfPeriod(M, cutoff)) cnt[groupOf(M.company)] = (cnt[groupOf(M.company)] || 0) + 1;
    const el = $("#legend");
    el.innerHTML = "";
    for (const g of [...MAIN_COMPANIES, "기타"]) {
      const st = g === "기타" ? OTHER : COMPANY_STYLE[g];
      const off = S.hidden.includes(g);
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip" + (off ? " off" : "");
      chip.dataset.g = g;
      chip.title = (g === "기타" ? "상위 " + TOP_N + "곳 밖의 모든 회사" + NL : "") + COMPANY_RULE + NL + (found ? "숫자 = 검색에 맞는 모델 수" + NL : "") + (off ? "눌러서 보이기" : "눌러서 숨기기");
      if (found && off && cnt[g]) chip.classList.add("has-hit");
      chip.innerHTML = symbolSvg(st.sym);
      chip.style.setProperty("--co", cssVar(st.c));
      chip.style.setProperty("--cm", muteColor(cssVar(st.c)));
      const t = document.createElement("span"); t.textContent = g;
      const n = document.createElement("span"); n.className = "cnt"; n.textContent = cnt[g] || 0;
      chip.append(t, n);
      chip.setAttribute("aria-pressed", String(!off));
      chip.setAttribute("aria-label", `${g} ${cnt[g] || 0}개 ${off ? "(숨김)" : ""}`.trim());
      chip.addEventListener("click", () => { hoverCo = null; S.hidden = off ? S.hidden.filter((x) => x !== g) : [...S.hidden, g]; render(); });
      chip.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse" && !S.hidden.includes(g)) setHoverCo(g); });
      chip.addEventListener("pointerleave", () => setHoverCo(null));
      chip.addEventListener("focus", () => { if (lastKeyboard && !S.hidden.includes(g)) setHoverCo(g); });
      chip.addEventListener("blur", () => setHoverCo(null));
      el.append(chip);
    }
    updateLegendFade();
  }
  function updateLegendFade() {
    const el = $("#legend");
    el.classList.toggle("more-r", el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
  }
  function setHoverCo(g) {
    if (hoverCo === g || !VIEW) return;
    hoverCo = g;
    quietChart();
  }

  // ═════════ 최고 성능 · 가성비 추천 카드 ═════════
  function renderCards(SR) {
    const el = $("#cards");
    const P = PICKS;
    if (!P) { el.innerHTML = `<div class="pick pick-empty">${esc(emptyText(SR, ". "))}.</div>`; return; }
    if (el.querySelector(".pick-empty")) el.innerHTML = "";
    const top = P.top;
    const topCost = costFor(top);
    const rowsAll = P.topRows.concat(P.valueRows);
    const lo = Math.min(...rowsAll.map((v) => v.score)) - 3;
    const barW = (v) => Math.max(6, Math.min(100, ((v.score - lo) / (top.score - lo || 1)) * 100));
    const cmp = (v) => {
      if (v === top) return "이 모델이 비교 기준";
      const gap = top.score - v.score;
      let t = gap < 0.05 ? "성능 같음" : `<span class="nw">성능 −${gap.toFixed(1)}점</span>`;
      const c = costFor(v);
      if (topCost && c) {
        const pct = (1 - c / topCost) * 100, ratio = c / topCost;
        t += pct >= 0.5 ? ` · <span class="up nw">비용 ${Math.min(99, Math.round(pct))}% 절약</span>`
          : ratio >= 2 ? ` · <span class="down nw">비용 ${ratio.toFixed(1)}배</span>`
            : pct <= -0.5 ? ` · <span class="down nw">비용 ${Math.round(-pct)}% 더 듦</span>` : " · 비용 같음";
      }
      return t;
    };
    const rowsHtml = (rows) => rows.map((v, i) =>
      `<div class="vt-row${i === 0 ? " first" : ""}" data-key="${esc(v.m.key)}" data-eff="${esc(v.effort)}" tabindex="0" role="button">` +
      `<span class="rk"><span class="sr-only">${i + 1}위 </span><span aria-hidden="true">${i + 1}</span></span>` +
      `<span class="vn"><span class="dot" style="background:${esc(colorOf(v.m.company))}"></span><b>${esc(v.m.name)}</b> <span class="eff-chip sm">${esc(v.eff)}</span></span>` +
      `<span class="vs"><small>성능</small><b>${v.score.toFixed(1)}</b><i class="vbar"><i style="width:${barW(v).toFixed(0)}%"></i></i></span>` +
      `<span class="vc"><small>${esc(costUnit())}</small>${C.fmtCost(costFor(v))}</span>` +
      `<span class="vd"><span class="vd-k">최고 성능과 비교: </span>${cmp(v)}</span></div>`).join("");
    const confHtml = (level, checks) =>
      `<div class="pick-conf ${level.k}"><span class="lv">${esc(level.t)}${level.x ? `<span class="lv-x"> · ${esc(level.x)}</span>` : ""}</span>` +
      checks.map((c) => `<span class="ck ${c.ok ? "ok" : "no"}">${c.ok ? "✓" : "!"} ${esc(c.t)}</span>`).join("") + `</div>`;
    const why = (summary, body) => `<details class="pick-why"><summary>${esc(summary)}</summary><p>${body}</p></details>`;

    const cards = [];
    {
      const rival = P.rival;
      const gapOk = !rival || top.score - rival.score > P.band(rival);
      const checks = [
        top.nReal >= 2 ? { ok: true, t: "두 기관 모두 측정" } : { ok: false, t: "한 기관만 측정" },
        !rival ? { ok: true, t: "비교할 다른 모델 없음" } : gapOk ? { ok: true, t: `다음 모델(${rival.m.name})보다 확실히 높음` }
          : { ok: false, t: `${(top.score - rival.score).toFixed(1)}점 차 < 오차 ±${P.band(rival).toFixed(1)}` },
      ];
      const level = !gapOk ? { k: "mid", t: "사실상 공동 1위", x: rival.m.name } : checks[0].ok ? { k: "hi", t: "1위 확실" } : { k: "mid", t: "1위 대체로 확실" };
      cards.push({ kind: "top", label: "최고 성능", sub: "성능 높은 순", v: top,
        html: why("어떻게 고르나요?", "그래프의 모든 점(모델 × 추론 등급) 중 종합 성능 점수가 높은 순서예요. 그래프에서 위에 있는 순서와 같아요. "
          + "'1위 확실'은 다른 모델 중 1등과의 점수 차이가 오차 범위보다 클 때예요.") + rowsHtml(P.topRows) + confHtml(level, checks) });
    }
    {
      const cheap = P.value;
      const next = P.next;
      const nextRatio = next ? costFor(next) / costFor(cheap) : null;
      const checks = [
        cheap.nReal >= 2 ? { ok: true, t: "두 기관 모두 측정" } : { ok: false, t: "한 기관만 측정" },
        cheap.costKind === "측정" ? { ok: true, t: "비용 실측" } : cheap.costKind === "등급 환산" ? { ok: false, t: "비용 등급 환산" } : { ok: false, t: "비용 가격표 추정" },
        !next ? { ok: true, t: "비슷한 후보 없음" } : nextRatio >= 1.25 ? { ok: true, t: "비슷한 값의 후보 없음" } : { ok: false, t: "비슷한 값의 후보 있음" },
      ];
      const nOk = checks.filter((c) => c.ok).length;
      const level = nOk === 3 ? { k: "hi", t: "1위 확실" } : nOk === 2 ? { k: "mid", t: "1위 대체로 확실" } : { k: "lo", t: "1위 참고용" };
      cards.push({ kind: "value", label: "가성비 추천", sub: "성능 높은 순", v: cheap,
        html: why("어떻게 고르나요?", "1위: 최고 성능과 실력 차이가 오차 범위 안(사실상 동급)인 것 중 가장 싼 것 — 비용 차이가 10% 안이면 같은 값으로 보고 점수가 높은 쪽. "
          + "2·3위: 그래프의 가성비 경계선을 따라 바로 앞보다 10% 이상 싼 모델. 확실: 세 가지 모두 충족 · 대체로 확실: 두 가지 · 참고용: 한 가지 이하.")
          + rowsHtml(P.valueRows) + confHtml(level, checks) });
    }
    cards.forEach((c, i) => {
      let card = el.children[i];
      if (!card) { card = document.createElement("div"); el.append(card); bindPointLinks(card, ".vt-row"); }
      card.className = "pick pick-table spot";
      card.dataset.kind = c.kind;
      card.style.setProperty("--pc", colorOf(c.v.m.company));
      card.innerHTML = `<div class="pick-top"><span class="pick-label">${c.label}</span><span class="pick-sub">${esc(c.sub)}</span></div><div class="vt">${c.html}</div>`;
    });
    while (el.children.length > cards.length) el.lastChild.remove();
  }

  // ═════════ 순위표 ═════════
  function renderTable(list) {
    const rows = [];
    for (const M of list) {
      if (S.pinnedOnly && !S.pinned.includes(M.key)) continue;
      for (const v of S.bestOnly ? [M.best] : M.vs) rows.push(v);
    }
    // 가성비 점수(0~100): 화면에 보이는 줄끼리가 아니라 그 기간의 모든 모델 기준 (필터·고정에 따라 같은 모델 점수가 바뀌지 않게)
    const okCost = (v) => v.cost != null && (S.estimated || v.costKind !== "가격 추정");
    const cutoff = S.period ? C.monthsAgo(S.period, today()) : null;
    const base = VIEW.all.filter((M) => !cutoff || (M.date && M.date >= cutoff)).flatMap((M) => M.vs).filter(okCost);
    const scale = C.valueScaler(base, VALUE_K);
    for (const v of rows) v.value = okCost(v) ? scale(v) : null;
    [...rows].sort((p, q) => q.score - p.score).forEach((v, i) => { v.rank = i + 1; });
    const sMin = Math.min(...rows.map((v) => v.score)), sMax = Math.max(...rows.map((v) => v.score));
    const keyFn = {
      rank: (v) => v.rank, effort: (v) => effIdx(v.effort), score: (v) => v.score,
      cost: (v) => v.cost, costok: (v) => v.costOk, value: (v) => v.value, price: (v) => blended(v.m), date: (v) => v.m.date,
    }[S.sortK] || ((v) => v.score);
    if (S.sortK === "name") rows.sort((p, q) => (p.m.name.localeCompare(q.m.name, "ko", { numeric: true }) || effIdx(p.effort) - effIdx(q.effort)) * S.sortDir);
    else {
      // 값이 없는 줄('—')은 정렬 방향과 상관없이 늘 맨 아래
      rows.sort((p, q) => {
        const x = keyFn(p), y = keyFn(q);
        if (x == null && y == null) return q.score - p.score;
        if (x == null) return 1;
        if (y == null) return -1;
        return (x < y ? -1 : x > y ? 1 : 0) * S.sortDir || q.score - p.score;
      });
    }
    const tb = $("#table tbody");
    tb.innerHTML = "";
    const FRS = S.frontier ? FR : EMPTY_FR;
    const now = today();
    const shown = rows.slice(0, tableLimit);
    if (!shown.length) {
      const tr = document.createElement("tr");
      const msg = S.pinnedOnly && !S.pinned.length ? "아직 고정한 모델이 없어요 — 지도의 점이나 아래 줄을 눌러 고정하세요"
        : S.search ? "찾은 모델이 없어요 — 검색어를 지우거나 다른 이름으로 찾아 보세요" : "지금 설정으로 보이는 모델이 없어요";
      tr.innerHTML = `<td class="t-empty" colspan="9">${esc(msg)}${S.search ? ' <button type="button" id="clearSearch">검색 지우기</button>' : ""}</td>`;
      tb.append(tr);
      const cs = tr.querySelector("#clearSearch");
      if (cs) cs.addEventListener("click", () => { $("#search").value = ""; S.search = ""; render(); $("#search").focus(); });
    }
    if (tableActive && !shown.some((v) => vkey(v) === tableActive)) tableActive = null;
    for (const v of shown) {
      const tr = document.createElement("tr");
      const pinned = S.pinned.includes(v.m.key);
      if (pinned) tr.className = "sel";
      tr.dataset.key = v.m.key;
      tr.dataset.eff = v.effort;
      tr.setAttribute("aria-selected", String(pinned));
      tr.tabIndex = (tableActive ? vkey(v) === tableActive : v === shown[0]) ? 0 : -1;
      const c = C.confOf(v.se);
      const pct = sMax > sMin ? ((v.score - sMin) / (sMax - sMin)) * 100 : 100;
      const f = FRS.status.get(vkey(v));
      tr.innerHTML =
        `<td class="c-rank">${v.rank}</td>` +
        `<td class="c-name"><span class="mname"><span class="sym" aria-hidden="true">${symbolSvg(styleOf(v.m.company).sym, mutedOf(v.m.company))}</span>${esc(v.m.name)}</span> ${C.daysSince(v.m.date, now) <= 30 ? '<span class="badge new">새</span>' : ""}<span class="m-eff"><b>${esc(v.eff)}</b>${v.isDefault ? " · 기본값" : ""}</span></td>` +
        `<td class="effc c-eff"><b>${esc(v.eff)}</b>${v.effKo && v.effort !== "none" ? `<span class="ko">${esc(v.effKo)}</span>` : ""}${v.isDefault ? ' <span class="badge def">기본값</span>' : ""}${!canSelect(v.m, v.effort) ? ' <span class="badge est">선택 불가</span>' : ""}</td>` +
        `<td class="num c-score"><span class="scorec"><span class="bar" aria-hidden="true"><i style="width:${Math.max(4, pct).toFixed(0)}%"></i></span><b>${v.score.toFixed(1)}</b></span><span class="sub2">±${v.se.toFixed(1)}<span class="conf-x"> · 신뢰도 <span class="badge ${c.k}">${c.t}</span></span></span></td>` +
        `<td class="num c-cost">${C.fmtCost(v.cost)}${v.costKind && v.costKind !== "측정" ? `<span class="sub2">${esc(v.costKind === "가격 추정" ? "가격표로 추정" : "등급 환산")}</span>` : ""}</td>` +
        `<td class="num c-costok">${C.fmtCost(v.costOk)}${v.costOk != null ? `<span class="sub2">정답률 ${C.fmtAcc(v.acc)}</span>` : ""}</td>` +
        `<td class="num">${f && f.st === "front" ? '<span class="badge fr">경계선</span> ' : f && f.st === "near" ? '<span class="badge nr">동급</span> ' : ""}${v.value ?? "—"}</td>` +
        `<td class="num c-price">${v.m.price ? `${C.fmtPrice(v.m.price.in)} / ${C.fmtPrice(v.m.price.out)}` : "—"}</td>` +
        `<td class="c-date">${esc(v.m.date || "—")}</td>`;
      tb.append(tr);
    }
    $("#table").classList.toggle("x-cost", S.x === "cost");
    $("#moreRows").hidden = rows.length <= tableLimit;
    $("#moreRows").textContent = `더 보기 (${rows.length - tableLimit}개 더)`;
    $("#tableSub").textContent = `${rows.length}개 · 줄을 누르면 지도에 고정 (다시 누르면 해제) · 제목을 누르면 정렬`;
    $$("#table th").forEach((th) => {
      const on = th.dataset.k === S.sortK;
      th.classList.toggle("sorted", on); th.classList.toggle("asc", on && S.sortDir === 1);
      th.tabIndex = 0;
      th.setAttribute("aria-sort", on ? (S.sortDir === 1 ? "ascending" : "descending") : "none");
    });
  }

  // ═════════ 모델 상세 (고정 칩·카드·큰 문장을 누르면 열림) ═════════
  function renderDetail() {
    const el = $("#detail");
    const M = VIEW && (VIEW.all.find((x) => x.key === S.selected) || getAll(false).find((x) => x.key === S.selected));
    const wasOpen = el.classList.contains("open");
    el.classList.toggle("open", !!M);
    if (!M) {
      if (!el.firstChild) el.innerHTML = `<div class="detail-in"></div>`;
      if (wasOpen) { popLayer("detail"); returnFocus(); }
      return;
    }
    const m = M.m, col = colorOf(M.company);
    const now = today();
    let h = `<div class="detail-in"><div class="detail-body">`;
    h += `<div class="d-head"><div><div class="d-title"><span class="sw" style="background:${esc(col)}"></span><h3 id="detailTitle" tabindex="-1">${esc(M.name)}</h3>${C.daysSince(M.date, now) <= 30 ? '<span class="badge new">새</span>' : ""}</div>`;
    h += `<div class="d-meta"><span>${esc(M.company)}</span><span>${esc(M.date || "?")} 출시</span>${m.price ? `<span>가격표 입력 ${C.fmtPriceExact(m.price.in)} · 출력 ${C.fmtPriceExact(m.price.out)} <span class="muted">/100만 토큰</span></span>` : ""}</div></div>`;
    h += `<button class="btn btn-ghost d-close" type="button" id="closeDetail">닫기</button></div>`;
    h += `<div class="dcols"><div class="dcol"><div class="sect">추론 등급별 <span class="muted" style="letter-spacing:0;font-weight:500">줄을 누르면 설명이 바뀌어요</span></div>`;
    h += `<table class="dt"><thead><tr><th scope="col">등급</th><th class="num" scope="col">점수</th><th class="num" scope="col">문제당 비용</th><th scope="col">한 단계 올리면</th></tr></thead><tbody>`;
    M.vs.forEach((vv, i) => {
      const prev = M.vs[i - 1];
      let step = "";
      if (prev) {
        const ds = vv.score - prev.score, cr = vv.cost && prev.cost ? vv.cost / prev.cost : null;
        step = `<span class="step"><span class="${ds >= 0 ? "up" : "dn"}">${ds >= 0 ? "+" : ""}${ds.toFixed(1)}점</span>${cr ? ` · 비용 ${cr.toFixed(1)}배` : ""}</span>`;
      }
      h += `<tr data-e="${esc(vv.effort)}" class="eff-row${S.selEffort === vv.effort ? " hl" : ""}" tabindex="0" aria-selected="${S.selEffort === vv.effort}"><td><b>${esc(vv.eff)}</b>${vv.effKo ? `<span class="muted small ko-line">${esc(vv.effKo)}</span>` : ""}${vv.isDefault ? ' <span class="badge def">기본값</span>' : ""}${!canSelect(m, vv.effort) ? ' <span class="badge est">선택 불가</span>' : ""}</td>` +
        `<td class="num"><b>${vv.score.toFixed(1)}</b><span class="muted small"> ±${vv.se.toFixed(1)}</span></td>` +
        `<td class="num">${C.fmtCost(vv.cost)}${vv.costKind && vv.costKind !== "측정" ? `<br><span class="badge est">${esc(vv.costKind)}</span>` : ""}</td><td>${step}</td></tr>`;
    });
    h += `</tbody></table></div>`;
    const v = M.vs.find((x) => x.effort === S.selEffort) || M.best;
    const g = EG[M.company];
    h += `<div class="dcol"><div class="sect">이 등급 쓰는 법 <b>${esc(v.eff)}</b></div><div class="howto">`;
    for (const r of howToSet(m, v.effort)) h += `<div class="howto-row"><span class="howto-k">${esc(r.k)}</span><span class="${r.code ? "code" : ""}">${esc(r.v)}</span></div>`;
    h += `</div>`;
    if (g && g.paramFull) h += `<div class="note">${esc(g.paramFull)}</div>`;
    const sup = m.efforts_supported;
    if (sup && sup.length) {
      const de = defaultEffort(m);
      h += `<div class="note">고를 수 있는 등급: ${sup.slice().sort((p, q) => effIdx(p) - effIdx(q)).map((e) => esc(effLabel(m, e))).join(" · ")}${de ? ` (기본값 ${esc(effLabel(m, de))})` : ""}</div>`;
    }
    if (EDEF[m.key] && m.effort_default_or && EDEF[m.key] !== m.effort_default_or) h += `<div class="note">기본 등급: 공식 문서 ${esc(effLabel(m, EDEF[m.key]))} · OpenRouter ${esc(effLabel(m, m.effort_default_or))}</div>`;
    if (g && g.note) h += `<div class="note">${esc(g.note)}</div>`;
    if (window.EFFORT_GUIDE_DATE) h += `<div class="note muted">고를 수 있는 등급·API 값·기본 등급은 6시간마다 자동 갱신 · 앱 메뉴 이름(참고)은 ${esc(window.EFFORT_GUIDE_DATE)} 기준</div>`;
    h += `</div>`;
    h += `<div class="dcol"><div class="sect">기관별 점수 <b>${esc(v.eff)}</b></div>`;
    for (const p of v.parts) {
      const pct = Math.max(2, Math.min(100, ((p.m - 130) / 45) * 100));
      const detail = p.est ? `다른 등급(${esc(effLabel(m, p.est))}) 값에서 추정` : p.s === "epoch" ? `벤치마크 ${p.n != null ? p.n : "?"}개로 계산` : `지능 지수 ${p.raw != null ? (+p.raw).toFixed(1) : "?"}`;
      h += `<div class="srcbar"><span>${esc(srcName(p.s))}</span><div class="track"><div class="fill${p.est ? " est" : ""}" style="width:${pct}%"></div></div><span class="val">${p.m.toFixed(1)}</span></div><div class="srcnote">${detail}</div>`;
    }
    if (v.disagree != null) h += `<div class="note">두 기관 차이 <b>${v.disagree.toFixed(1)}점</b> — ${v.disagree > 6 ? "평가가 꽤 달라요" : v.disagree > 3 ? "약간 달라요" : "대체로 일치해요"}</div>`;
    h += `<div class="note">맞힌 문제당 ${C.fmtCost(v.costOk)} (난이도 ${esc(DIFF.label)} · 정답률 ${C.fmtAcc(v.acc)})</div>`;
    if (v.costSrc && v.costSrc.length) h += `<div class="note">비용 측정 출처: ${v.costSrc.map(esc).join(", ")}</div>`;
    if (m.price && m.price.id) h += `<div class="note">모델 ID: ${esc(m.price.id)}</div>`;
    h += `</div></div></div></div>`;
    el.innerHTML = h;
    $("#closeDetail").addEventListener("click", () => closeDetail());
    el.querySelectorAll("tr.eff-row").forEach((tr) => { tr.addEventListener("click", () => { S.selEffort = tr.dataset.e; render(); }); });
    if (!wasOpen) {
      if (matchMedia("(max-width: 700px)").matches) pushLayer("detail");
      announce(`${M.name} 자세히 보기를 열었어요`);
      if (lastKeyboard) requestAnimationFrame(() => { const t = $("#detailTitle"); if (t) t.focus({ preventScroll: false }); });
    }
  }
  function closeDetail(fromPop) {
    if (!S.selected) return;
    S.selected = null;
    if (!fromPop) popLayer("detail");
    render();
  }
  // 상세를 닫으면 연 자리(같은 칸의 같은 줄)로 초점을 돌려줌 — 다시 그려졌어도 같은 칸 안에서 찾음
  function returnFocus() {
    const o = detailOpener;
    detailOpener = null;
    if (!lastKeyboard || !o) return;
    let t = findFocus(o);
    const host = !t && o.host ? document.getElementById(o.host) : null;
    if (host) t = host.querySelector("button, a[href], [tabindex='0']") || (host.tabIndex >= 0 ? host : null);
    if (!t && !o.host && o.d.key) t = document.querySelector(`[data-key="${CSS.escape(o.d.key)}"]${o.d.eff ? `[data-eff="${CSS.escape(o.d.eff)}"]` : ""}`);
    if (t) focusEl(t);
  }

  // ───────── 다시 그려도 키보드 초점이 그 자리에 남도록
  // 상태에 따라 붙었다 떨어지는 클래스(고정됨 sel · 켜짐 on · 지금 보는 cur 등)는 빼고 기억 → 다시 그린 뒤에도 같은 요소를 찾음
  const STATE_CLS = new Set(["sel", "on", "off", "cur", "hl", "open", "first", "in", "show", "est", "old", "up", "dn"]);
  const FOCUS_HOSTS = "#table, #cards, #headline, #notes, #pinBar, #legend, #searchNote, #detail, #ticker, #perCoMenu";
  function focusSel(k) {
    let sel = k.tag.toLowerCase() + (k.cls ? "." + CSS.escape(k.cls) : "");
    for (const n of ["key", "eff", "g", "k", "sn", "v", "e"]) if (k.d[n] != null) sel += `[data-${n}="${CSS.escape(k.d[n])}"]`;
    return sel;
  }
  function describeFocus(a) {
    if (!a || a === document.body || a === root || !a.closest) return null;
    const host = a.closest(FOCUS_HOSTS);
    const k = { el: a, host: host ? host.id : null, tag: a.tagName, cls: [...a.classList].find((c) => !STATE_CLS.has(c)) || "", d: Object.assign({}, a.dataset), idx: 0 };
    // 같은 줄이 두 카드에 있을 수 있음 → 그 칸 안에서 몇 번째였는지도 기억
    if (host) k.idx = Math.max(0, [...host.querySelectorAll(focusSel(k))].indexOf(a));
    return k;
  }
  function findFocus(k) {
    if (!k) return null;
    if (k.el.isConnected) return k.el;
    const host = k.host ? document.getElementById(k.host) : null;
    if (!host) return null;
    const same = host.querySelectorAll(focusSel(k));
    return same[k.idx] || same[0] || (k.host === "pinBar" ? host.querySelector(".pin-name, .pin-clear") : null);
  }
  function focusEl(t) {
    if (t.matches("#table tbody tr")) { tableActive = t.dataset.key + "|" + t.dataset.eff; $$("#table tbody tr").forEach((row) => { row.tabIndex = row === t ? 0 : -1; }); }
    t.focus({ preventScroll: true });
  }
  function rememberFocus() {
    return describeFocus(document.activeElement);
  }
  function restoreFocus(k) {
    if (!k || k.el.isConnected) return;
    const t = findFocus(k);
    if (t) focusEl(t);
  }

  // ───────── 뒤로 가기로 판 닫기 (크게 보기 · 휴대폰 상세 · 조절 판)
  function pushLayer(name) {
    if (layers.includes(name)) return;
    layers.push(name);
    history.pushState({ layer: name }, "");
  }
  function popLayer(name) {
    const i = layers.lastIndexOf(name);
    if (i < 0) return;
    layers.splice(i, 1);
    if (history.state && history.state.layer === name) { pendingBack++; history.back(); }
  }
  // 지금 기록이 '열려 있지 않은 판'의 기록이면 건너뜀 → 뒤로 가기를 눌렀는데 아무 일도 없는 경우가 없게
  // (새로고침 뒤 남은 기록, 판을 닫는 순서가 열린 순서와 다를 때 남은 기록)
  function skipDeadLayer() {
    const st = history.state;
    if (st && st.layer && !layers.includes(st.layer)) { pendingBack++; history.back(); }
  }
  listen(window, "popstate", () => {
    if (pendingBack) { pendingBack--; skipDeadLayer(); return; }   // 우리가 부른 뒤로 가기
    const top = layers.pop();
    if (top === "full") setFull(false, true);
    else if (top === "detail") closeDetail(true);
    else if (top === "sheet") setSheet(false, true);
    skipDeadLayer();
  });

  // ═════════ 조절 막대 ═════════
  function syncControls() {
    const on = (id, v) => $$(`#${id} button`).forEach((b) => { const yes = b.dataset.v === String(v); b.classList.toggle("on", yes); b.setAttribute("aria-pressed", String(yes)); });
    on("xAxisSeg", S.x); on("periodSeg", S.period);
    $("#perCoText").textContent = S.perCo ? `${S.perCo}개` : "전부";
    $$("#perCoMenu .menu-item").forEach((b) => { const yes = +b.dataset.v === S.perCo; b.classList.toggle("on", yes); b.setAttribute("aria-pressed", String(yes)); });
    for (const [id, prop] of Object.entries(OPTS)) $("#" + id).checked = !!S[prop];
    const dark = root.dataset.theme === "dark";
    $("#themeBtn").setAttribute("aria-pressed", String(dark));   // 이름은 '어둡게 보기' 그대로, 켜졌는지는 눌림 상태로 (이름까지 바꾸면 '밝게 보기, 눌림'으로 잘못 읽힘)
  }
  function closeMenus() {
    $$(".menu.open").forEach((m) => { m.classList.remove("open"); m.querySelector(".menu-btn").setAttribute("aria-expanded", "false"); });
  }

  // ───────── 크게 보기 (휴대폰은 전체 화면 + 가로 회전 시도)
  function exitFs() {
    if (!document.fullscreenElement) return Promise.resolve();
    ownExit++;
    return document.exitFullscreen().catch(() => { ownExit = Math.max(0, ownExit - 1); });
  }
  async function phoneLandscape(on) {
    if (!IS_PHONE) return;
    const my = ++fsSeq;   // 빠르게 열고 닫아도 늦게 끝난 '열기'가 화면을 잠가 두지 않게
    const ori = screen.orientation;
    const stale = () => my !== fsSeq || !chartBox.classList.contains("full");
    try {
      if (on) {
        const limit = (p) => Promise.race([p, new Promise((resolve, reject) => { setTimeout(() => reject(new Error("시간 초과")), 1500); })]);
        if (!document.fullscreenElement && root.requestFullscreen) {
          const req = root.requestFullscreen({ navigationUI: "hide" });
          // 시간 초과로 포기한 뒤에 늦게 성공해도, 그 사이 크게 보기를 닫았으면 바로 풀어 줌 (화면이 전체 화면에 갇히지 않게)
          req.then(() => { if (!chartBox.classList.contains("full")) exitFs(); }, () => {});
          await limit(req);
        }
        if (stale()) throw new Error("이미 닫힘");
        if (!ori || !ori.lock) throw new Error("회전 고정 안 됨");
        await limit(ori.lock("landscape"));
        if (stale()) throw new Error("이미 닫힘");
      } else {
        if (ori && ori.unlock) ori.unlock();
        if (document.fullscreenElement) await exitFs();
      }
    } catch (e) {
      if (stale() || !on) {
        try { if (ori && ori.unlock) ori.unlock(); } catch (e2) { /* 지원 안 함 */ }
        if (document.fullscreenElement && !chartBox.classList.contains("full")) exitFs();
      } else if (matchMedia("(orientation: portrait)").matches) showToast("휴대폰을 가로로 돌리면 더 넓게 보여요");
    }
  }
  function setFull(on, fromPop) {
    if (chartBox.classList.contains("full") === on) return;
    chartBox.classList.toggle("full", on);
    phoneLandscape(on);
    document.body.classList.toggle("no-scroll", on);
    const b = $("#fullBtn");
    b.setAttribute("aria-label", on ? "크게 보기 닫기" : "크게 보기");   // 눈에 보이는 글('닫기')과 맞게 이름만 바꿈 (눌림 상태는 쓰지 않음)
    b.title = on ? "크게 보기 닫기 (Esc)" : "그래프만 화면 가득 (휴대폰은 가로로 돌리면 더 넓게)";
    setZoomOn(on);
    if (on) pushLayer("full"); else if (!fromPop) popLayer("full");
    setTimeout(() => { chart.resize(); quietChart(); }, 60);
  }
  function setSheet(on, fromPop) {
    const dock = $("#dock");
    if (dock.classList.contains("open") === on) return;
    dock.classList.toggle("open", on);
    $("#dockScrim").hidden = !on;
    document.body.classList.toggle("sheet-open", on);
    $("#dockToggle").setAttribute("aria-expanded", String(on));
    if (on) { pushLayer("sheet"); requestAnimationFrame(() => { const f = $("#dockSheet .seg button.on"); if (f && lastKeyboard) f.focus(); }); }
    else if (!fromPop) popLayer("sheet");
  }

  // ═════════ 머리글·바닥글·알림 ═════════
  const genTs = C.parseKST(D.generated);
  function renderStatus() {
    const ageH = (Date.now() - genTs) / 3600000;
    $("#status").innerHTML = `<span class="live${!(ageH <= 12) ? " old" : ""}"></span><span><b>${C.ago(genTs, Date.now())}</b><span class="st-x"> 갱신${HOSTED ? " · 6시간마다 자동" : ""}</span></span>`;
    $("#status").title = "마지막 갱신 " + (D.generated || "알 수 없음") + " (한국 시간)";
  }
  // 알림: 여러 개가 쌓이고 각각 닫을 수 있음
  function notice(id, html, opts = {}) {
    const box = $("#notice");
    let el = box.querySelector(`[data-n="${id}"]`);
    if (!html) { if (el) el.remove(); return; }
    const fresh = !el;
    if (!el) { el = document.createElement("div"); el.dataset.n = id; box.append(el); }
    el.className = "notice" + (opts.kind === "err" ? " err" : "");
    el.setAttribute("role", opts.kind === "err" ? "alert" : "status");
    el.innerHTML = `<span>${html}</span><span class="nt-acts"></span>`;
    const acts = el.querySelector(".nt-acts");
    for (const a of opts.actions || []) {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = a.label;
      b.addEventListener("click", a.fn);
      acts.append(b);
    }
    if (opts.close !== false) {
      const x = document.createElement("button");
      x.type = "button"; x.className = "nt-x"; x.textContent = "×"; x.setAttribute("aria-label", "알림 닫기");
      x.addEventListener("click", () => { el.remove(); if (opts.onClose) opts.onClose(); });
      acts.append(x);
    }
    // 사용자가 누른 일(최신 받기)의 첫 안내는, 알림 줄이 화면 위로 지나가 있으면 보이는 곳으로 (알림 줄은 붙어 다니지 않음)
    if (fresh && opts.reveal && box.getBoundingClientRect().top < $(".topbar").offsetHeight) box.scrollIntoView({ block: "start", behavior: REDUCED ? "auto" : "smooth" });
  }
  function healthNotice() {
    const H = D.health || {};
    const failed = (Array.isArray(H.failed) ? H.failed : []).filter((x) => typeof x === "string" && x !== "OpenRouter");
    if (!H.using_previous && failed.length) {
      notice("health", `${esc(failed.join(", "))} 데이터를 오래 받지 못해, 받을 수 있는 기관만으로 계산했어요. 일부 모델·등급이 빠질 수 있어요. 다시 받아지면 자동으로 돌아와요.`);
      return;
    }
    if (!H.using_previous) return;
    if (!((Date.now() - genTs) / 36e5 > 12)) return;
    notice("health", `${esc(failed.join(", ") || "일부 기관")} 데이터를 새로 받지 못해 <b>${esc(D.generated)}</b> 기준 정상 데이터를 보여 주고 있어요. 6시간마다 자동으로 다시 시도해요.`);
  }
  // 첫 화면 핵심 숫자: 모델 · 점 · 평가기관 · 두 기관 점수 차이 (보정 없이 원래 값 그대로)
  function renderFacts(all, animate) {
    const dis = all.flatMap((M) => M.vs).map((v) => v.disagree).filter((x) => x != null).sort((p, q) => p - q);
    const med = dis.length ? dis[Math.floor(dis.length / 2)] : null;
    const aa = D.sources.aa;
    const r = aa && aa.fit && typeof aa.fit.r === "number" ? aa.fit.r : null;
    const srcs = SRC_ORDER.filter((s) => D.sources[s] && D.sources[s].ok).map(srcName);
    const nPts = all.reduce((n, M) => n + M.vs.length, 0);
    const f = [
      { k: "모델", v: all.length.toLocaleString("ko-KR"), u: "개", t: S.selectableOnly ? "실제로 고를 수 있는 등급이 하나라도 있는 모델" : "점수가 있는 모든 모델" },
      { k: "모델 × 추론 등급", v: nPts.toLocaleString("ko-KR"), u: "점", t: "그래프의 점 하나 = 모델 하나의 추론 등급 하나" },
      { k: "평가기관", v: String(srcs.length), u: "곳", t: srcs.join(" · ") + " 의 점수를 합쳐 하나의 종합 점수로" },
      med != null ? { k: "두 기관 점수 차이", v: med.toFixed(1), u: "점 (보통)",
        t: `두 기관이 모두 잰 등급 ${dis.length}개에서, 두 점수 차이의 중앙값이 ${med.toFixed(1)}점입니다.` + (r ? ` 점수 상관 ${r.toFixed(2)} (1 에 가까울수록 두 기관이 같은 순서로 평가).` : "") + " 작을수록 믿을 만합니다." } : null,
    ].filter(Boolean);
    $("#facts").innerHTML = f.map((x) => `<div class="fact" title="${esc(x.t)}"><dt>${esc(x.k)}</dt><dd>${esc(x.v)}<small>${esc(x.u)}</small></dd></div>`).join("");
    if (animate && !REDUCED) {
      $$("#facts dd").forEach((dd) => {   // 처음 열 때 숫자가 0에서 차오름
        const node = dd.firstChild, target = node.textContent, n = parseFloat(target.replace(/,/g, ""));
        if (isNaN(n)) return;
        const dec = (target.split(".")[1] || "").length, t0 = performance.now(), dur = 1000;
        const step = (t) => {
          const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
          node.textContent = k < 1 ? (n * e).toLocaleString("ko-KR", { minimumFractionDigits: dec, maximumFractionDigits: dec }) : target;
          if (k < 1 && node.isConnected) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    }
    $("#heroDate").textContent = D.generated ? D.generated.replace(/-/g, ".") + " 기준" : "";
  }
  function renderFooter() {
    const src = SRC_ORDER.filter((s) => D.sources[s] && D.sources[s].ok).map((s) => {
      const I = D.sources[s];
      const name = I.url ? `<a href="${esc(I.url)}" target="_blank" rel="noopener noreferrer">${esc(I.name)}</a>` : esc(I.name);
      return `<div class="src"><b>${name}</b> — ${esc(I.desc)} <span class="muted">(${esc(I.updated || "")})</span></div>`;
    }).join("");
    $("#foot").innerHTML = `<div class="srcs">${src}</div><div>가격: <a href="https://openrouter.ai/models" target="_blank" rel="noopener noreferrer">OpenRouter</a> · 비용 기록: LiveBench·DeepSWE·CursorBench·ARC-AGI 등</div>` +
      `<div class="fine">Epoch AI 데이터는 CC-BY 4.0 (Epoch AI, "Capabilities & benchmarking", epoch.ai). 지능 지수 출처: Artificial Analysis (artificialanalysis.ai). ` +
      `이 페이지의 점수는 두 기관의 공개 결과를 자체 방식으로 합친 것이며 기관의 공식 순위가 아닙니다. 마지막 갱신 ${esc(D.generated || "알 수 없음")} (한국 시간)</div>`;
  }

  // ───────── 최신 데이터 받기 (이 컴퓨터의 도우미 server.py 가 켜져 있을 때만)
  async function api(path, timeoutMs) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs || 5000);
    try {
      const r = await fetch(path, { cache: "no-store", signal: ctl.signal });
      if (!r.ok) return { fail: "http" };
      return await r.json();
    } catch (e) {
      return { fail: e && e.name === "AbortError" ? "timeout" : "network" };
    } finally { clearTimeout(t); }
  }
  async function checkHelper() {
    const r = location.protocol.startsWith("http") ? await api("api/ping", 2500) : null;
    helperOk = !!(r && r.app === "ai-compare");
    $("#refreshBtn").title = helperOk ? "여러 기관에서 최신 점수·가격을 지금 받아옵니다 (보통 10~30초)" : "이 기능은 '성능비교판_열기'로 열었을 때만 동작합니다";
    return helperOk;
  }
  async function refreshNow(force) {
    const btn = $("#refreshBtn");
    if (btn.classList.contains("busy")) return;
    if (!(await checkHelper())) {
      notice("refresh", location.protocol === "file:"
        ? "이 창은 파일로 직접 열려 있어서 데이터를 받을 수 없어요. 창을 닫고 <b>성능비교판_열기</b>로 다시 열어 주세요."
        : "도우미가 꺼져 있어 데이터를 받을 수 없어요. <b>성능비교판_열기</b>를 다시 실행하면 켜져요.", { kind: "err", reveal: true });
      return;
    }
    const label = btn.querySelector("span");
    const original = label.innerHTML;
    btn.disabled = true; btn.classList.add("busy"); btn.setAttribute("aria-busy", "true");
    label.innerHTML = "받는<br>중…";
    const t0 = Date.now();
    const tick = () => notice("refresh", `최신 데이터를 받는 중이에요… <b>${Math.round((Date.now() - t0) / 1000)}초</b> (보통 10~30초)`, { close: false, reveal: true });
    tick();
    refreshTick = every(tick, 1000);
    const r = await api("api/refresh" + (force ? "?force=1" : ""), 240000);
    clearInterval(refreshTick);
    btn.disabled = false; btn.classList.remove("busy"); btn.removeAttribute("aria-busy");
    label.innerHTML = original;
    const again = { label: "다시 시도", fn: () => refreshNow(force) };
    if (!r || r.fail) {
      const alive = await checkHelper();
      notice("refresh", !alive ? "도우미가 꺼졌어요. <b>성능비교판_열기</b>를 다시 실행해 주세요."
        : r && r.fail === "timeout" ? "4분 안에 끝나지 않았어요. 인터넷이 느릴 수 있어요." : "데이터를 받지 못했어요. 인터넷 연결을 확인해 주세요.", { kind: "err", actions: alive ? [again] : [] });
    } else if (r.busy) notice("refresh", "이미 받는 중이에요. 잠시 뒤에 다시 눌러 주세요.");
    else if (r.ok === false) {
      const last = (r.log || []).slice(-1)[0] || "";
      notice("refresh", `최신 데이터를 받다가 문제가 생겼어요${last ? `: <span class="muted">${esc(last)}</span>` : ""}. 화면은 예전 데이터 그대로예요.`, { kind: "err", actions: [again] });
    } else if (r.changed) location.reload();
    else if (r.using_previous) notice("refresh", `${esc((r.failed || []).join(", ") || "일부 기관")} 데이터를 새로 받지 못해 예전 정상 데이터를 그대로 보여 주고 있어요.`, { kind: "err", actions: [again] });
    else { notice("refresh", "이미 최신이에요. 각 기관에서 새로 올라온 점수가 없어요."); setTimeout(() => notice("refresh", null), 5000); }
  }

  // ═════════ 이벤트 연결 (그리기와 상관없이 먼저) ═════════
  function bindEvents() {
    // 키보드로 움직이는 중인지 (상세를 열 때 초점을 옮길지 정함)
    listen(document, "keydown", (e) => { if (e.key === "Tab" || e.key === "Enter" || e.key === " " || e.key.startsWith("Arrow")) lastKeyboard = true; }, true);
    listen(document, "pointerdown", () => { lastKeyboard = false; }, true);

    // 조절: 가로축·출시 · 회사마다 · 보기 켜고 끄기
    /** @type {[string, string, (v: string) => any][]} */
    const segs = [["xAxisSeg", "x", (v) => v], ["periodSeg", "period", (v) => +v]];
    for (const [id, prop, parse] of segs) {
      const seg = $("#" + id);
      seg.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { S[prop] = parse(b.dataset.v); render(); }));
    }
    for (const id of ["perCoMenu", "viewMenu"]) {
      const menu = $("#" + id);
      const btn = menu.querySelector(".menu-btn");
      btn.setAttribute("aria-expanded", "false");
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const was = menu.classList.contains("open");
        closeMenus();
        if (!was) { menu.classList.add("open"); btn.setAttribute("aria-expanded", "true"); }
      });
      menu.querySelector(".menu-pop").addEventListener("click", (e) => e.stopPropagation());
    }
    const perCoPop = $("#perCoMenu .menu-pop");
    for (const n of PER_CO_OPTIONS) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "menu-item"; b.dataset.v = String(n);
      b.innerHTML = n ? `<span class="mi-pre">회사마다 </span>${n}개` : "전부";
      b.addEventListener("click", () => { S.perCo = n; closeMenus(); render(); });
      perCoPop.append(b);
    }
    for (const [id, prop] of Object.entries(OPTS)) $("#" + id).addEventListener("change", (e) => { S[prop] = tgt(e).checked; render(); });
    listen(document, "click", closeMenus);
    $("#resetSettings").addEventListener("click", () => location.reload());   // 새로 열면 항상 기본값

    // 검색: 칠 때마다 (잠깐 기다렸다) · Enter = 바로 + 휴대폰 키보드 닫기
    const search = $("#search");
    search.value = S.search;
    search.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { S.search = search.value; render(); announceSearch(); }, 180); });
    search.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      clearTimeout(searchTimer);
      S.search = search.value;
      render();
      announceSearch();
      if (matchMedia("(pointer: coarse)").matches) search.blur();
    });

    // 표: 머리 누르면 정렬 · 줄 누르면 고정만 (상세가 표를 덮지 않게 — 상세는 고정 칩을 눌러서) · 위아래 방향키로 줄 이동
    $$("#table th").forEach((th) => th.addEventListener("click", () => {
      const k = th.dataset.k;
      if (S.sortK === k) S.sortDir *= -1;
      else { S.sortK = k; S.sortDir = ["name", "effort", "rank", "cost", "costok", "price"].includes(k) ? 1 : -1; }
      renderTable(VIEW.list);
    }));
    const tb = $("#table tbody");
    tb.addEventListener("click", (e) => {
      const tr = tgt(e).closest("tr[data-key]");
      if (!tr) return;
      tableActive = tr.dataset.key + "|" + tr.dataset.eff;
      togglePin(tr.dataset.key, tr.dataset.eff, { select: false });
    });
    tb.addEventListener("keydown", (e) => {
      const tr = tgt(e).closest("tr[data-key]");
      if (!tr) return;
      const rows = $$("#table tbody tr[data-key]");
      const i = rows.indexOf(tr);
      const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: rows.length - 1, PageDown: i + 10, PageUp: i - 10 }[e.key];
      if (to == null) return;
      e.preventDefault();
      const t = rows[Math.max(0, Math.min(rows.length - 1, to))];
      rows.forEach((r) => { r.tabIndex = r === t ? 0 : -1; });
      tableActive = t.dataset.key + "|" + t.dataset.eff;
      t.focus();
    });
    $("#moreRows").addEventListener("click", () => { tableLimit += 60; renderTable(VIEW.list); });
    // Enter·스페이스로 누를 수 있는 줄들
    listen(document, "keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const t = tgt(e);
      if (t && t.matches && t.matches(".vt-row, #table tbody tr[data-key], #table th, .dt tr.eff-row, #headline .nm")) { e.preventDefault(); t.click(); }
    });

    // 큰 문장·각주·새 모델 목록 ↔ 지도
    bindPointLinks($("#headline"), "[data-key]");
    bindPointLinks($("#notes"), ".note-btn");
    $("#ticker").addEventListener("click", (e) => {
      if (tgt(e).closest(".nl-more")) { tickerAll = true; renderTicker(VIEW.all); return; }
      const b = tgt(e).closest(".tk-item");
      if (b) pinAndShow(b.dataset.key, null, b);
    });

    // 그래프: 빈 곳 클릭 = 확대 모드, 점·선 클릭 = 고정
    chart.getZr().on("mousedown", (e) => {
      const ne = e.event || {};
      if (ne.pointerType === "touch" || String(ne.type || "").startsWith("touch")) return;
      if (e.target) return;
      const first = !zoomOn;
      if (first && !chartBox.classList.contains("full")) centerAfterUp = true;
      setZoomOn(true);
    });
    listen(window, "pointerup", () => { if (!centerAfterUp) return; centerAfterUp = false; setTimeout(centerChart, 0); });
    listen(document, "pointerdown", (e) => { if (!chartBox.contains(tgt(e)) && !chartBox.classList.contains("full")) setZoomOn(false); });
    chartEl.addEventListener("wheel", (e) => {
      const rect = chartEl.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      if (!zoomOn) {
        if (FULL && inGrid(px, py) && wheelHintN < 3 && Date.now() - wheelHintT > 8000) {
          wheelHintN++; wheelHintT = Date.now();
          showToast("그래프 빈 곳을 한 번 클릭하면 휠로 확대할 수 있어요");
        }
        return;
      }
      e.preventDefault();
      if (!FULL || !inGrid(px, py)) return;
      if (e.deltaY > 0 && !VIEWBOX) return;   // 이미 다 축소됨
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      const f = Math.min(1.6, Math.max(0.6, Math.exp(dy * 0.0022)));
      zoomAt(px, py, f, e.shiftKey ? "x" : e.altKey ? "y" : "xy");
    }, { passive: false });
    // 키보드로 확대·이동 (그래프에 초점이 있을 때)
    //  · 방향키는 키보드(Tab)로 그래프에 왔거나 확대 모드일 때만 — 마우스로 점을 누른 뒤에는 방향키로 평소처럼 페이지가 내려감
    //  · 확대 모드에서는 PageDown·스페이스·End 로 페이지가 움직이지 않게
    const PAGE_KEYS = new Set(["PageUp", "PageDown", "Home", "End", " "]);
    let chartKbd = false;
    chartEl.addEventListener("focus", () => { chartKbd = lastKeyboard; });
    chartEl.addEventListener("pointerdown", () => { chartKbd = false; });
    chartEl.addEventListener("keydown", (e) => {
      const r = gridRect();
      if (!r) return;
      const k = e.key;
      if (k === "+" || k === "=") { chartKbd = true; zoomCenter(0.7); }
      else if (k === "-" || k === "_") { if (VIEWBOX) zoomCenter(1 / 0.7); }
      else if (k === "0") resetView();
      else if (k.startsWith("Arrow")) {
        if (!chartKbd && !zoomOn) return;
        if (!VIEWBOX) { showToast("먼저 + 키로 확대하면 방향키로 옮길 수 있어요"); e.preventDefault(); return; }
        panBy(k === "ArrowLeft" ? -0.1 : k === "ArrowRight" ? 0.1 : 0, k === "ArrowUp" ? 0.1 : k === "ArrowDown" ? -0.1 : 0);
      } else if (!(zoomOn && PAGE_KEYS.has(k))) return;
      e.preventDefault();
    });
    // 끌어서 이동 (확대된 상태에서)
    chartEl.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || !VIEWBOX) return;
      const rect = chartEl.getBoundingClientRect();
      if (!inGrid(e.clientX - rect.left, e.clientY - rect.top)) return;
      drag = { sx: e.clientX, sy: e.clientY, v: VIEWBOX, moved: false };
    }, true);
    listen(window, "mousemove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      if (!drag.moved) { drag.moved = true; chartEl.classList.add("panning"); chart.dispatchAction({ type: "hideTip" }); }
      const r = gridRect();
      if (r) panBy(-dx / r.width, dy / r.height, drag.v);
    });
    listen(window, "mouseup", () => {
      if (!drag) return;
      if (drag.moved) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 50); }
      chartEl.classList.remove("panning");
      drag = null;
    });
    chart.getZr().on("dblclick", (e) => { if (!e.target) resetView(); });
    // 휴대폰: 두 손가락으로 벌리면 확대, 확대한 뒤 한 손가락으로 이동
    const tpos = (t) => { const r = chartEl.getBoundingClientRect(); return { x: t.clientX - r.left, y: t.clientY - r.top }; };
    chartEl.addEventListener("touchstart", (e) => {
      touch = null;
      if (!FULL) return;
      if (e.touches.length === 2) {
        const p = tpos(e.touches[0]), q = tpos(e.touches[1]);
        const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
        if (!inGrid(m.x, m.y)) return;
        touch = { mode: "pinch", d: Math.hypot(p.x - q.x, p.y - q.y), m, v: VIEWBOX || FULL };
        e.preventDefault();
      } else if (e.touches.length === 1 && VIEWBOX) {
        const p = tpos(e.touches[0]);
        if (!inGrid(p.x, p.y)) return;
        touch = { mode: "pan", p, v: VIEWBOX, moved: false };
      }
    }, { passive: false });
    chartEl.addEventListener("touchmove", (e) => {
      if (!touch) return;
      if (touch.mode === "pinch" && e.touches.length === 2) {
        const p = tpos(e.touches[0]), q = tpos(e.touches[1]);
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d > 10) zoomAt(touch.m.x, touch.m.y, touch.d / d, "xy", touch.v);
        e.preventDefault();
      } else if (touch.mode === "pan" && e.touches.length === 1) {
        const p = tpos(e.touches[0]);
        const dx = p.x - touch.p.x, dy = p.y - touch.p.y;
        if (!touch.moved && Math.hypot(dx, dy) < 6) return;
        touch.moved = true;
        const r = gridRect();
        if (r) panBy(-dx / r.width, dy / r.height, touch.v);
        e.preventDefault();
      }
    }, { passive: false });
    chartEl.addEventListener("touchend", (e) => {
      if (touch && touch.moved) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 300); }
      if (e.touches.length === 0) touch = null;
    });
    chartEl.addEventListener("touchcancel", () => { touch = null; });   // 시스템 몸짓으로 끊겨도 상태가 남지 않게
    // 점에 마우스 → 그 모델 선 강조
    chart.getZr().on("click", (e) => {
      if (!e.target) { chart.dispatchAction({ type: "downplay" }); chart.dispatchAction({ type: "hideTip" }); hoverSeries = null; lastTapKey = null; }
    });
    chart.on("mouseover", (p) => {
      if (!CAN_HOVER || p.seriesType !== "line" || !seriesKey(p) || hoverSeries === p.seriesIndex) return;
      if (hoverSeries != null) chart.dispatchAction({ type: "downplay", seriesIndex: hoverSeries });
      hoverSeries = p.seriesIndex;
      chart.dispatchAction({ type: "highlight", seriesIndex: p.seriesIndex });
    });
    chart.on("globalout", () => {
      if (hoverSeries != null) chart.dispatchAction({ type: "downplay", seriesIndex: hoverSeries });
      hoverSeries = null;
    });
    chart.getZr().on("mousemove", (e) => {
      if (!e.target && hoverSeries != null) { chart.dispatchAction({ type: "downplay", seriesIndex: hoverSeries }); hoverSeries = null; }
    });
    chart.on("click", (p) => {
      if (suppressClick) return;
      if (p.data && p.data.v) {
        // 휴대폰(터치): 처음 누르면 설명만, 같은 점을 한 번 더 누르면 고정
        if (!CAN_HOVER) { const k = vkey(p.data.v); if (lastTapKey !== k) { lastTapKey = k; return; } lastTapKey = null; }
        togglePin(p.data.v.m.key, p.data.v.effort);
      } else if (CAN_HOVER && p.seriesType === "line" && seriesKey(p)) togglePin(seriesKey(p));
    });

    // 그래프 도구 버튼
    $("#resetZoom").addEventListener("click", () => resetView());
    $("#zoomIn").addEventListener("click", () => zoomCenter(0.7));
    $("#zoomOut").addEventListener("click", () => { if (VIEWBOX) zoomCenter(1 / 0.7); });
    $("#fullBtn").addEventListener("click", () => setFull(!chartBox.classList.contains("full")));
    listen(document, "fullscreenchange", () => {
      if (document.fullscreenElement) return;
      if (ownExit) { ownExit--; return; }   // 우리가 부른 해제 → 그 사이 다시 연 크게 보기를 닫지 않음
      if (chartBox.classList.contains("full") && IS_PHONE) setFull(false);   // 휴대폰 뒤로 가기 등으로 전체 화면이 풀림
    });

    // Esc: 맨 위의 것 하나만 닫음 (메뉴 → 조절 판 → 크게 보기 위의 상세 → 크게 보기 → 상세 → 확대 모드)
    listen(document, "keydown", (e) => {
      if (e.key !== "Escape") return;
      if ($(".menu.open")) { closeMenus(); return; }
      if (tgt(e) && tgt(e).id === "search" && tgt(e).value) return;   // 검색칸: 글자 지우기는 브라우저가
      if ($("#dock").classList.contains("open")) { setSheet(false); $("#dockToggle").focus(); return; }
      const detailOpen = $("#detail").classList.contains("open");
      if (detailOpen && chartBox.classList.contains("full")) { closeDetail(); return; }   // 크게 보기 위에 뜬 상세가 맨 위
      if (chartBox.classList.contains("full")) { setFull(false); $("#fullBtn").focus(); return; }
      if (detailOpen) { closeDetail(); return; }
      setZoomOn(false);
    });
    // 확대 모드일 때는 방향키·스페이스로 페이지가 움직이지 않게 (그래프 초점이면 그래프가 처리)
    const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);
    listen(document, "keydown", (e) => {
      if (!zoomOn || !SCROLL_KEYS.has(e.key)) return;
      const t = tgt(e);
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(t.tagName) || (t.hasAttribute && t.hasAttribute("tabindex")))) return;
      e.preventDefault();
    });
    // '/' 를 누르면 검색칸으로
    listen(document, "keydown", (e) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = tgt(e);
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      if (matchMedia("(max-width: 700px)").matches && !$("#dock").classList.contains("open")) window.scrollTo({ top: 0 });
      $("#search").focus();
    });

    // 밝게/어둡게 (누른 자리에서 새 색이 원으로 퍼짐)
    $("#themeBtn").addEventListener("click", (ev) => {
      const flip = () => {
        S.theme = root.dataset.theme === "dark" ? "light" : "dark";
        root.dataset.theme = S.theme;
        setThemeColor(S.theme === "light" ? "#ffffff" : "#0b0b0b");
        colorCache = {}; mutedCache = {};
        render();
      };
      if (!document.startViewTransition || REDUCED) { flip(); return; }
      const r = ev.currentTarget.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
      const t = document.startViewTransition(flip);
      t.ready.then(() => root.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] },
        { duration: 650, easing: "cubic-bezier(.2,.8,.2,1)", pseudoElement: "::view-transition-new(root)" })).catch(() => {});
    });

    // 휴대폰: 아래쪽 막대의 '조절' → 판이 위로 (화면 폭 기준은 style.css 와 같은 700px)
    $("#dockToggle").addEventListener("click", (e) => { e.stopPropagation(); setSheet(!$("#dock").classList.contains("open")); });
    $("#dockScrim").addEventListener("click", () => setSheet(false));
    onMQ(matchMedia("(max-width: 700px)"), (m) => { if (!m.matches) setSheet(false); });

    // 최신 받기 · 앱 설치
    if (HOSTED) $("#refreshBtn").hidden = true;
    $("#refreshBtn").addEventListener("click", () => refreshNow(true));
    listen(window, "beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; $("#installBtn").hidden = false; });
    $("#installBtn").addEventListener("click", async () => {
      if (!installEvt) return;
      installEvt.prompt();
      await installEvt.userChoice.catch(() => null);
      installEvt = null; $("#installBtn").hidden = true;
    });
    listen(window, "appinstalled", () => { $("#installBtn").hidden = true; });

    // 크기가 바뀌면 그래프·핀·영역 이름을 새 크기에 맞춰 다시 그림
    const onResize = () => {
      chart.resize();
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        chart.resize();
        if (chartEl.clientWidth + "x" + chartEl.clientHeight !== lastSize) quietChart();
        updateLegendFade();
      }, 150);
    };
    if (window.ResizeObserver) watch(new ResizeObserver(onResize)).observe(chartEl); else listen(window, "resize", onResize);
    $("#legend").addEventListener("scroll", updateLegendFade, { passive: true });
    // 그래프가 화면 밖이면 흐르는 빛을 멈춤 (배터리·버벅임)
    if ("IntersectionObserver" in window && !REDUCED) {
      watch(new IntersectionObserver((ents) => {
        const vis = ents.some((en) => en.isIntersecting);
        if (vis !== chartVisible) { chartVisible = vis; if (VIEW) quietChart(); }
      })).observe(chartBox);
    }
    // 인쇄할 때는 숨은 구역도 모두 보이게
    listen(window, "beforeprint", () => $$(".rv").forEach((el) => el.classList.add("in")));
  }
  function announceSearch() {
    if (!S.search.trim()) return;
    const n = $("#searchNote");
    announce(n && !n.hidden ? n.textContent.replace(/\s+/g, " ").trim() : "검색 결과를 표시했어요");
  }

  // ───────── 맨 위 길잡이: 지금 읽는 구역 표시
  function topNav() {
    const nav = $("#topnav");
    const links = Array.from(nav.querySelectorAll("a")), ind = nav.querySelector(".tn-ind");
    const secs = links.map((a) => document.getElementById(a.getAttribute("href").slice(1)));
    let cur = -1;
    const place = () => {
      const a = links[cur];
      if (!a || !a.offsetWidth) return;
      ind.style.width = a.offsetWidth + "px";
      ind.style.transform = `translateX(${a.offsetLeft - 3}px)`;
      nav.classList.add("ready");
    };
    const update = () => {
      const line = $(".topbar").offsetHeight + innerHeight * 0.3;
      let i = 0;
      secs.forEach((s, k) => { if (s && s.getBoundingClientRect().top <= line) i = k; });
      if (innerHeight + scrollY >= root.scrollHeight - 4) i = secs.length - 1;
      if (i === cur) return;
      cur = i;
      links.forEach((a, k) => { a.classList.toggle("on", k === i); if (k === i) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current"); });
      place();
    };
    let tick = false;
    listen(window, "scroll", () => { if (!tick) { tick = true; requestAnimationFrame(() => { tick = false; update(); }); } }, { passive: true });
    listen(window, "resize", place);
    update();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
  }

  // ═════════ 시작 ═════════
  try {
    root.dataset.theme = S.theme;
    setThemeColor("#ffffff");
    bindEvents();
    topNav();
    skipDeadLayer();      // 새로고침 전에 열려 있던 판의 기록이 남았으면 건너뜀
    if (NORM.problems.length) notice("data", esc(NORM.problems.join(" · ")) + " (나머지는 그대로 보여 드려요)");
    pickCompanies(getAll(S.selectableOnly));
    render();
    renderFacts(getAll(S.selectableOnly), true);
    renderFooter();
    renderStatus();
    every(renderStatus, 60000);
    healthNotice();
    if (HOSTED && "serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
    if (HOSTED && /KAKAOTALK|NAVER|Instagram|FBAN|FBAV|Line\//i.test(navigator.userAgent) && /Android/i.test(navigator.userAgent)) {
      let seen = false;
      try { seen = sessionStorage.getItem("aiCompare.inapp") === "1"; } catch (e) { seen = false; }
      if (!seen) {
        const chromeUrl = "intent://" + location.href.replace(/^https?:\/\//, "") + "#Intent;scheme=https;package=com.android.chrome;end";
        notice("inapp", "앱으로 설치하려면 <b>크롬</b>에서 열어야 해요.", {
          actions: [{ label: "크롬으로 열기", fn: () => { location.href = chromeUrl; } }],
          onClose: () => { try { sessionStorage.setItem("aiCompare.inapp", "1"); } catch (e) { /* 저장 안 돼도 됨 */ } },
        });
      }
    }
    // 이 컴퓨터의 도우미가 켜져 있으면: 1분마다 '창이 열려 있다'고 알리고, 1시간마다 조용히 새 데이터 확인
    (HOSTED ? Promise.resolve(false) : checkHelper()).then((ok) => {
      if (!ok) return;
      every(() => api("api/ping", 3000), 60000);
      listen(document, "visibilitychange", () => { if (document.visibilityState === "visible") checkHelper(); });
      every(async () => {
        const r = await api("api/refresh", 240000);
        if (r && r.changed) notice("newdata", "새 데이터가 들어왔어요.", { actions: [{ label: "반영하기", fn: () => location.reload() }] });
      }, 3600000);
    });
    document.body.classList.add("intro");
    setTimeout(() => document.body.classList.remove("intro"), 2600);
    // 스크롤하면 구역이 떠오름
    window.__rvReady = true;
    if (root.classList.contains("io")) {
      const io = watch(new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } }), { rootMargin: "0px 0px -6% 0px" }));
      $$(".rv").forEach((el) => io.observe(el));
    }
    // 글꼴이 늦게 도착하면 그래프 글자를 한 번 더 그림 (그래프는 그림이라 글꼴이 자동으로 안 바뀜)
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => quietChart());
    root.dataset.ready = "1";
  } catch (e) {
    console.error(e);
    fatal("화면을 그리다 문제가 생겼어요", ["<b>새로고침</b>해 주세요. 계속되면 잠시 뒤 다시 열어 주세요.", `<span class="fine">${escText(e && e.message ? e.message : e)}</span>`]);
  }
})();
