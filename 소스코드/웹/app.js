// AI 모델 성능비교판 — 화면 동작 (v3)
// data.js(수집기가 만든 파일)의 window.MODEL_DATA 를 읽어 그래프·표를 그린다.
(function () {
  "use strict";

  const D = window.MODEL_DATA;
  if (!D) {
    document.body.innerHTML = '<p style="padding:40px;font-size:16px">data.js 가 없습니다. 먼저 <b>성능비교판_열기</b> 를 실행하세요.</p>';
    return;
  }
  (function uniqueNames() {
    const count = (f) => { const c = {}; for (const m of D.models) c[f(m)] = (c[f(m)] || 0) + 1; return c; };
    const c1 = count((m) => m.name);
    for (const m of D.models) if (c1[m.name] > 1) m.name = `${m.name} (${(m.date || "").slice(0, 7) || m.key})`;
    const c2 = count((m) => m.name);
    for (const m of D.models) if (c2[m.name] > 1) m.name = `${m.name.replace(/ \([^)]*\)$/, "")} (${m.key})`;
  })();

  // ───────── 회사별 색·모양
  //  · 색을 받는 회사는 사람이 정하지 않고, 데이터가 갱신될 때마다 자동으로 고름 (pickCompanies)
  //    규칙: 최근 6개월에 나온 모델 중 '가장 높은 종합 점수'가 높은 회사 순으로 상위 5곳
  //  · 나머지 회사는 전부 회색 '기타'
  //  · 한 번 받은 색은 그 회사가 상위 5곳에 남아 있는 동안 그대로 유지 (순위가 바뀌어도 색이 뒤섞이지 않게)
  const TOP_N = 5, RECENT_MONTHS = 6;
  const SLOTS = [
    { c: "--c1", sym: "circle" }, { c: "--c2", sym: "rect" }, { c: "--c3", sym: "diamond" },
    { c: "--c7", sym: "triangle" }, { c: "--c4", sym: "pin" },
  ];
  let COMPANY_STYLE = {};
  const OTHER = { c: "--c0", sym: "circle" };
  let MAIN_COMPANIES = [];
  let COMPANY_RULE = "";
  const NL = String.fromCharCode(10);   // 말풍선 줄바꿈
  function pickCompanies(all) {
    const bestOf = (list) => {
      const b = {};
      for (const M of list) if (M.company && M.company !== "기타" && !(b[M.company] >= M.best.score)) b[M.company] = M.best.score;
      return Object.entries(b).sort((x, y) => y[1] - x[1]).map(([co]) => co);
    };
    const cutoff = monthsAgo(RECENT_MONTHS);
    let top = bestOf(all.filter((M) => M.date && M.date >= cutoff)).slice(0, TOP_N);
    for (const co of bestOf(all)) if (top.length < TOP_N && !top.includes(co)) top.push(co);   // 최근 모델이 적으면 전체 기간으로 채움
    // 색 자리: 지난번에 받은 자리를 기억해 두었다가 그대로 줌
    let prev = {};
    try { prev = JSON.parse(localStorage.getItem("aiCompare.coSlots") || "{}"); } catch (e) { /* 없어도 됨 */ }
    const slot = {}, used = new Set();
    for (const co of top) if (prev[co] != null && prev[co] < SLOTS.length && !used.has(prev[co])) { slot[co] = prev[co]; used.add(prev[co]); }
    for (const co of top) if (slot[co] == null) { const i = SLOTS.findIndex((_, k) => !used.has(k)); slot[co] = i; used.add(i); }
    try { localStorage.setItem("aiCompare.coSlots", JSON.stringify(slot)); } catch (e) { /* 저장 안 돼도 동작 */ }
    COMPANY_STYLE = {};
    for (const co of top) COMPANY_STYLE[co] = SLOTS[slot[co]];
    MAIN_COMPANIES = top;
    COMPANY_RULE = `최근 ${RECENT_MONTHS}개월 모델의 최고 점수가 높은 회사 ${TOP_N}곳 (데이터가 바뀌면 자동으로 다시 고름)`;
  }
  const styleOf = (co) => COMPANY_STYLE[co] || OTHER;
  const groupOf = (co) => (COMPANY_STYLE[co] ? co : "기타");

  // 점수 출처: Epoch AI + Artificial Analysis 두 곳
  const SRC_ORDER = ["epoch", "aa"];
  const EFF_ORDER = D.effort_order;
  const VALUE_K = 6; // 가성비: 비용 10배 = 6점
  const PER_CO_OPTIONS = [1, 2, 3, 5, 10, 15, 20, 25, 30, 0];

  // ───────── 설정 (저장하지 않음 — 열 때마다 기본값)
  //  기본값 (사용자가 정함, 2026-09-30): 맞힌 문제당 · 전체 기간 · 매우 어려움 · 회사마다 3개 ·
  //  가성비 경계선·모델 이름 켬 · 추정 비용 끔 · 상위 5개 회사만 (기타 숨김) · 어두운 화면 · 순위표는 성능 높은 순
  const DEFAULTS = {
    x: "costok", period: 0, perCo: 3, difficulty: "vhard", search: "", hidden: ["기타"], frontier: true, labels: true,
    estimated: false, selectableOnly: true, bestOnly: false, sortK: "score", sortDir: -1, selected: null, selEffort: null,
    theme: "dark", pinned: [], pinnedOnly: false,
  };
  // 들어올 때·새로고침할 때마다 항상 위 기본값으로 시작 (사용자 요청 2026-09-30)
  //  · 화면에서 바꾼 설정은 그 창을 보는 동안만 유지되고 저장하지 않음
  const fresh = () => JSON.parse(JSON.stringify(DEFAULTS));
  let S = fresh();
  try { localStorage.removeItem("aiCompare.settings"); } catch (e) { /* 예전에 저장된 설정 지우기 */ }
  function save() { /* 저장하지 않음 (항상 기본값으로 시작) */ }
  function resetSettings() {
    location.reload();   // 새로 열면 항상 기본값
  }
  if (!PER_CO_OPTIONS.includes(S.perCo)) S.perCo = 3;
  for (const k of ["top", "budget", "weight", "enabled"]) delete S[k];   // 예전 버전 설정은 버림
  document.documentElement.dataset.theme = S.theme || "dark";
  document.querySelector('meta[name="theme-color"]').content = S.theme === "light" ? "#f5f4f0" : "#0b0b0c";

  // ───────── 도우미
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  let colorCache = {};
  const colorOf = (co) => colorCache[co] || (colorCache[co] = css(styleOf(co).c));
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  function fmtCost(c) {
    if (c == null) return "—";
    if (c < 0.001) return "$" + c.toFixed(5);
    if (c < 0.01) return "$" + c.toFixed(4);
    if (c < 1) return "$" + c.toFixed(3);
    if (c < 100) return "$" + c.toFixed(2);
    return "$" + Math.round(c);
  }
  const fmtPrice = (p) => (p == null ? "—" : "$" + (p < 10 ? +p.toFixed(2) : Math.round(p)));
  const effIdx = (e) => { const i = EFF_ORDER.indexOf(e); return i < 0 ? 99 : i; };
  const today = new Date();
  function monthsAgo(n) { const d = new Date(today); d.setMonth(d.getMonth() - n); return d.toISOString().slice(0, 10); }
  function daysSince(s) { return s ? (today - new Date(s)) / 86400000 : 9999; }
  function confOf(se) {
    if (se <= 2.5) return { k: "hi", t: "높음" };
    if (se <= 4) return { k: "mid", t: "보통" };
    return { k: "lo", t: "낮음" };
  }
  function srcName(s) { return (D.sources[s] && D.sources[s].name) || s; }
  function blended(m) { return m.price ? (3 * m.price.in + m.price.out) / 4 : null; }
  function ago(ts) {
    const min = Math.max(0, (Date.now() - ts) / 60000);
    if (min < 2) return "방금";
    if (min < 60) return Math.round(min) + "분 전";
    if (min < 60 * 24) return Math.round(min / 60) + "시간 전";
    return Math.round(min / 1440) + "일 전";
  }

  // ───────── 회사별 추론 등급 공식 이름 (effort_guide.js)
  const EG = window.EFFORT_GUIDE || {};
  const EDEF = window.EFFORT_DEFAULTS || {};
  // 한국어 뜻
  const EFF_KO = {
    none: "추론 과정 없이 바로 답", minimal: "최소", low: "낮음", medium: "중간", high: "높음",
    xhigh: "매우 높음", max: "최대", promax: "프로 최대", ultra: "울트라 (여러 에이전트)", default: "기본 설정", thinking: "생각 켬 (단계 없음)",
  };
  // 화면에 보이는 등급 이름 = 그 회사에서 실제로 고르는 값 (예: max, xhigh, high)
  // 등급 이름은 회사 공식 이름으로 (추론을 끄는 것도: OpenAI 는 API 값 "none", 켜고 끄는 방식인 회사는 "생각 끔")
  function effLabel(m, e) {
    const g = EG[m.company];
    if (e === "none") return g && g.value && g.value.none ? g.value.none : "생각 끔";
    if (g && g.value && g.value[e]) return g.value[e];
    if (e === "default") return "기본";
    if (e === "thinking") return "생각 켬";
    return e;   // 공식 단계가 없는 회사: 평가기관이 붙인 이름 그대로
  }
  // 등급 순서대로 정렬. 처음 보는 등급(회사가 새로 만든 것)은 비용으로 자리를 찾음 (생각을 많이 할수록 비쌈)
  function sortEfforts(vs) {
    const known = vs.filter((v) => effIdx(v.effort) < 99).sort((a, b) => effIdx(a.effort) - effIdx(b.effort));
    for (const u of vs.filter((v) => effIdx(v.effort) >= 99)) {
      let at = known.length;
      if (u.cost != null) { const i = known.findIndex((k) => k.cost != null && k.cost > u.cost); if (i >= 0) at = i; }
      known.splice(at, 0, u);
    }
    vs.splice(0, vs.length, ...known);
    return vs;
  }
  // 기본 등급: 공식 자료(OpenRouter, 6시간마다 자동 갱신)를 먼저, 없을 때만 손으로 적어 둔 값
  function defaultEffort(m) { return m.effort_default_or || EDEF[m.key] || null; }
  const EXPLICIT_EFF = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
  // 이 등급을 실제 AI 에서 사용자가 고를 수 있는지 (근거: OpenRouter 의 모델별 공식 정보)
  //  · 생각 끔(none): '생각 필수' 모델이면 못 고름 (공식 등급 목록에 none 이 있으면 고를 수 있음)
  //  · low~max: 공식 등급 목록에 있어야 함
  //  · 근거 정보가 없는 모델은 판단하지 않고 그대로 둠 (잘못 숨기지 않게)
  function canSelect(m, e) {
    const sup = m.efforts_supported;
    if (e === "none") {
      if (sup && sup.includes("none")) return true;
      if (m.reasoning_mandatory === true) return false;
      return true;
    }
    if (!sup || !sup.length || !EXPLICIT_EFF.includes(e)) return true;
    return sup.includes(e);
  }
  // 선택한 등급을 실제로 설정하는 방법 (여러 줄)
  function howToSet(m, e) {
    const g = EG[m.company];
    const out = [];
    if (!canSelect(m, e)) {
      out.push({ k: "주의", v: `이 모델은 '${effLabel(m, e)}' 등급을 직접 고를 수 없어요. 평가기관이 별도 조건으로 측정한 값이라 참고용으로만 보세요.` });
      return out;
    }
    const sup = m.efforts_supported || [];
    if (!g) {
      if (sup.includes(e)) out.push({ k: "API", v: `reasoning effort = "${e}" (OpenRouter 공식 목록 기준)`, code: true });
      else out.push({ k: "설정", v: `이 회사의 공식 등급 이름은 아직 정리돼 있지 않아요. 평가기관이 쓴 이름: ${e}` });
      return out;
    }
    if (g.value && g.value[e]) out.push({ k: "API", v: `${g.param} = "${g.value[e]}"`, code: true });
    else if (sup.includes(e) && e !== "none") out.push({ k: "API", v: `${g.param} = "${e}"`, code: true });
    else if (e === "none" && g.none) out.push({ k: "API", v: g.none });
    else if (e === "none" && g.value && g.value.none) out.push({ k: "API", v: `${g.param} = "none"`, code: true });
    else if (e === "default") out.push({ k: "API", v: "따로 설정하지 않음 (기본값)" });
    else if (g.onOff && e === "thinking") out.push({ k: "API", v: "생각 켬 (기본)" });
    else if (g.onOff) out.push({ k: "API", v: `이 회사는 단계 설정이 없어요. '${e}'는 평가기관이 붙인 이름이고, 실제로는 생각 켜기만 하면 됩니다.` });
    else out.push({ k: "API", v: `이 모델은 '${e}' 등급을 직접 고를 수 없어요 (평가기관 조건).` });
    for (const a of g.apps || []) {
      if (a.only && !a.only.includes(m.key)) continue;
      // 앱 메뉴 이름은 자동으로 받아올 공식 자료가 없어 참고용 (날짜는 상세 아래에 표시)
      if (a.labels && a.labels[e]) out.push({ k: a.name, v: `${a.how} → ${a.labels[e]}` });
      else if (a.note) out.push({ k: a.name, v: a.note });
    }
    return out;
  }

  // ───────── 정답률 → 맞힌 문제당 비용
  // 종합 점수는 Epoch 방식 능력치라서 '난이도 D, 변별력 k' 인 시험의 예상 정답률을 바로 계산할 수 있다.
  //   정답률 = 1 / (1 + e^(−k × (점수 − D)))
  const DIFFICULTY = {
    easy: { D: 120, k: 0.10, label: "쉬움" },
    normal: { D: 140, k: 0.12, label: "보통" },
    hard: { D: 155, k: 0.12, label: "어려움" },
    vhard: { D: 165, k: 0.15, label: "매우 어려움" },
  };
  const diff = () => DIFFICULTY[S.difficulty] || DIFFICULTY.normal;
  const accuracyOf = (score) => { const d = diff(); return Math.min(0.995, Math.max(0.005, 1 / (1 + Math.exp(-d.k * (score - d.D))))); };
  const isCostAxis = () => S.x === "cost" || S.x === "costok";
  const costFor = (v) => (S.x === "costok" ? v.costOk : v.cost);
  const costUnit = () => (S.x === "costok" ? "맞힌 문제당" : "문제당");

  // ───────── 점수 계산
  function computeAll() {
    const models = [];
    for (const m of D.models) {
      const vs = [];
      for (const v of m.variants) {
        if (S.selectableOnly && !canSelect(m, v.effort)) continue;   // 실제로 고를 수 없는 등급은 뺌
        let num = 0, den = 0;
        const real = [], parts = [];
        for (const s of SRC_ORDER) {
          const x = v.src[s];
          if (!x) continue;
          const w = 1 / x.var;
          num += x.m * w; den += w;
          parts.push({ s, m: x.m, est: x.est, raw: x.raw, n: x.n, name: x.name });
          if (!x.est) real.push(x.m);
        }
        if (!den || !real.length) continue;
        vs.push({
          m, effort: v.effort, eff: effLabel(m, v.effort),
          effKo: /[가-힣]/.test(effLabel(m, v.effort)) ? "" : (EFF_KO[v.effort] || ""),   // 이름이 이미 한글이면 뜻을 또 붙이지 않음
          isDefault: defaultEffort(m) === v.effort,
          score: num / den, se: Math.sqrt(1 / den),
          disagree: real.length >= 2 ? Math.max(...real) - Math.min(...real) : null,
          nReal: real.length, parts, cost: v.cost ?? null, costKind: v.cost_kind || null, costSrc: v.cost_src || [],
        });
      }
      if (!vs.length) continue;
      sortEfforts(vs);
      for (const v of vs) {
        v.acc = accuracyOf(v.score);
        v.costOk = v.cost != null && v.acc ? v.cost / v.acc : null;
      }
      const best = vs.reduce((a, b) => (b.score > a.score ? b : a));
      models.push({ m, key: m.key, name: m.name, company: m.company, date: m.date, vs, best });
    }
    return models;
  }

  // ───────── 검색: 쉼표로 여러 개를 한 번에 (예: "제미나이, gpt, claude opus")
  //  · 쉼표로 나눈 검색어 중 하나라도 맞으면 보여 줌 (부분만 쳐도 됨)
  //  · 한 검색어 안의 띄어쓴 단어는 모두 들어 있어야 함 ("claude opus" → Claude Opus 만)
  //  · 한글 이름도 알아들음 (제미나이 → gemini, 클로드 → claude …)
  const KO_ALIAS = [
    ["챗지피티", "gpt"], ["지피티", "gpt"], ["제미나이", "gemini"], ["제미니", "gemini"], ["클로드", "claude"], ["그록", "grok"],
    ["딥시크", "deepseek"], ["큐웬", "qwen"], ["퀜", "qwen"], ["라마", "llama"], ["미스트랄", "mistral"], ["키미", "kimi"],
    ["오퍼스", "opus"], ["소넷", "sonnet"], ["하이쿠", "haiku"], ["페이블", "fable"], ["플래시", "flash"], ["라이트", "lite"],
    ["아스트라", "astra"], ["루나", "luna"], ["테라", "terra"], ["솔", "sol"], ["미니맥스", "minimax"], ["미니", "mini"], ["나노", "nano"],
    ["프로", "pro"], ["뮤즈", "muse"], ["스파크", "spark"], ["미모", "mimo"], ["샤오미", "xiaomi"], ["메타", "meta"], ["구글", "google"],
    ["오픈에이아이", "openai"], ["앤트로픽", "anthropic"], ["엔트로픽", "anthropic"], ["알리바바", "alibaba"], ["엔비디아", "nvidia"],
    ["지엘엠", "glm"], ["문샷", "moonshot"], ["아마존", "amazon"], ["노바", "nova"],
  ];
  const compact = (t) => t.replace(/[\s\-_.·]/g, "");
  function searchTerms() {
    return S.search.split(/[,，、;]/).map((t) => {
      let r = t.trim().toLowerCase();
      for (const [ko, en] of KO_ALIAS) r = r.split(ko).join(" " + en + " ");
      return r.trim().replace(/\s+/g, " ");
    }).filter(Boolean);
  }
  function matchSearch(M, terms) {
    const hay = (M.name + " " + M.key + " " + M.company).toLowerCase();
    const hayC = compact(hay);
    return terms.some((t) => t.split(" ").every((w) => hay.includes(w)) || hayC.includes(compact(t)));
  }

  // ───────── 필터
  function applyFilters(all) {
    const cutoff = S.period ? monthsAgo(S.period) : null;
    const terms = searchTerms();
    const q = terms.length > 0;
    let list = all.filter((M) => {
      if (q) return matchSearch(M, terms);   // 검색은 숨긴 회사·기간 밖 모델도 찾음
      if (S.hidden.includes(groupOf(M.company))) return false;
      if (cutoff && (!M.date || M.date < cutoff)) return false;
      return true;
    });
    list.sort((a, b) => b.best.score - a.best.score);
    const pool = list.slice();   // 가성비 경계선은 개수 제한 없이 이 전체로 계산
    if (S.perCo && !q) {   // 회사마다 점수 높은 순으로 N개씩
      const cnt = {};
      list = list.filter((M) => (cnt[M.company] = (cnt[M.company] || 0) + 1) <= S.perCo);
    }
    for (const key of S.pinned) {   // 고정한 모델은 항상 보여줌
      if (!list.some((M) => M.key === key)) {
        const M = all.find((x) => x.key === key);
        if (M) list.push(M);
      }
    }
    return { list, pool };
  }
  function xOf(v) {
    if (isCostAxis()) {
      const c = costFor(v);
      if (c == null) return null;
      // '추정 비용도 그리기'를 끄면 가격표로 짐작한 점(속이 빈 점)만 숨김.
      // '등급 환산'(같은 모델의 다른 등급에서 실제로 잰 비용 × 등급별 배율)은 계속 보여 줌 → 등급별 점과 선이 끊기지 않게
      if (!S.estimated && v.costKind === "가격 추정") return null;
      return c;
    }
    if (S.x === "price") return blended(v.m);
    if (S.x === "date") return v.m.date ? v.m.date : null;
    return null;
  }
  // ───────── 가성비 경계선 (효율적 경계선)
  // 규칙: "나보다 싸면서 나보다 똑똑한 모델이 하나도 없으면 경계선 위"
  //  · 화면의 '회사별 개수' 제한과 상관없이 그 기간의 모든 모델로 계산 (숨은 가성비 모델도 찾음)
  //  · 가격표로 추정한 비용(실측 없음)은 믿기 어려워 계산에서 뺌
  //  · 점수 오차(±)가 있으므로, 경계선 아래 '오차 범위' 안의 점은 '사실상 동급'으로 따로 표시
  // 그래프 도구가 데이터를 복사해 쓰므로, 점은 '모델 키 + 등급' 이름표로 찾는다
  const vkey = (v) => v.m.key + "|" + v.effort;
  function frontierInfo(poolPts) {
    const none = { front: [], status: new Map(), k: 0, levelAt: () => -Infinity };
    if (!S.frontier || S.x === "date") return none;
    const ok = poolPts.filter((p) => p.x != null && !(isCostAxis() && p.v.costKind === "가격 추정"));
    if (ok.length < 2) return none;
    const sorted = ok.slice().sort((a, b) => a.x - b.x || b.v.score - a.v.score);
    const front = [];
    let best = -Infinity;
    for (const p of sorted) if (p.v.score > best + 1e-9) { front.push(p); best = p.v.score; }
    // 그 비용까지 쓸 때 얻을 수 있는 최고 점수 (계단 모양)
    const levelAt = (x) => { let lv = -Infinity; for (const f of front) { if (f.x <= x * (1 + 1e-9)) lv = f.v.score; else break; } return lv; };
    // 오차 범위: 두 점수를 비교할 때의 보통 오차 (√2 × 점수 오차 중앙값)
    const ses = ok.map((p) => p.v.se).sort((a, b) => a - b);
    const k = Math.round(Math.SQRT2 * ses[Math.floor(ses.length / 2)] * 10) / 10;
    const status = new Map();
    for (const f of front) status.set(vkey(f.v), { st: "front", gap: 0 });
    for (const p of ok) {
      if (status.has(vkey(p.v))) continue;
      const gap = levelAt(p.x) - p.v.score;
      status.set(vkey(p.v), { st: gap <= k ? "near" : "below", gap });
    }
    return { front, status, k, levelAt };
  }

  // ───────── 그래프 준비
  const chartEl = $("#chart");
  const chartBox = $("#chartBox");
  const chart = echarts.init(chartEl, null, { renderer: "canvas" });
  const isNarrow = () => chartEl.clientWidth < 560;
  let renderedNarrow = null, resizeTimer = null, VIEW = null;
  let FR = { front: [], status: new Map(), k: 0, levelAt: () => -Infinity };
  let hoverCo = null;   // 위 회사 버튼에 마우스를 올린 회사 → 그래프에서 그 회사만 강조
  function onChartResize() {
    chart.resize();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      chart.resize();
      if (VIEW && renderedNarrow !== isNarrow()) renderChart(VIEW.list, VIEW.points);
      syncSegs();
    }, 150);
  }
  window.addEventListener("resize", onChartResize);
  if (window.ResizeObserver) new ResizeObserver(() => onChartResize()).observe(chartEl);

  function render() {
    const all = computeAll();
    const { list, pool } = applyFilters(all);
    const poolPts = [];
    for (const M of pool) for (const v of M.vs) poolPts.push({ M, v, x: xOf(v) });
    FR = frontierInfo(poolPts);
    for (const p of FR.front) if (!list.includes(p.M)) list.push(p.M);   // 경계선 위 모델은 개수 제한에 걸려도 보여줌
    const points = [];
    for (const M of list) for (const v of M.vs) points.push({ M, v, x: xOf(v) });
    VIEW = { all, list, points };
    const empty = $("#chartEmpty");
    if (empty) {
      const none = !points.some((p) => p.x != null);
      empty.hidden = !none;
      if (none) empty.textContent = S.search.trim() ? "검색한 모델이 없어요 · 이름 일부만 쳐도 되고, 쉼표로 여러 개를 찾을 수 있어요"
        : "보이는 모델이 없어요 · 그래프 위 회사 버튼을 눌러 다시 켜 보세요";
    }
    renderLegend(all);
    renderChart(list, points);
    renderPinBar();
    renderCards(points);
    renderTable(list);
    renderDetail();
    syncControls();
  }

  // ───────── 그래프 그리기
  let quietRender = false;
  // ───────── 이름표 자리 정하기
  //  중요한 것부터(고정한 모델 > 회사 강조 > 경계선 위 모델 > 점수 높은 순) 오른쪽·왼쪽·위·아래 중
  //  다른 이름표와 겹치지 않는 자리를 찾아 붙인다. 자리가 없으면 숨김 (고정한 모델은 항상 표시)
  const measureCtx = document.createElement("canvas").getContext("2d");
  function placeLabels(series, V, narrow, st) {
    const W = chartEl.clientWidth, H = chartEl.clientHeight;
    const full = chartBox.classList.contains("full");
    const g = narrow ? { l: 34, r: 12, t: full && S.pinned.length ? 70 : 22, b: 30 } : { l: 46, r: 18, t: 24, b: 34 };
    const gw = W - g.l - g.r, gh = H - g.t - g.b;
    if (gw <= 0 || gh <= 0) return;
    const ax = tx(V.x0), bx = tx(V.x1);
    const px = (x) => g.l + ((tx(x) - ax) / (bx - ax)) * gw;
    const py = (y) => g.t + ((V.y1 - y) / (V.y1 - V.y0)) * gh;
    const cands = [], dots = [];
    for (const s of series) for (const d of s.data || []) {
      if (!d) continue;
      // 흐리지 않은 점은 '가리지 않을 것'으로 기억
      if (!(d.itemStyle && d.itemStyle.opacity < 0.5)) {
        const X = px(d.value[0]), Y = py(d.value[1]), r = (d.symbolSize || 10) / 2;
        dots.push({ x: X - r, y: Y - r, w: 2 * r, h: 2 * r });
      }
      if (!d.__lab) continue;
      const X = px(d.value[0]), Y = py(d.value[1]);
      if (X < g.l - 2 || X > g.l + gw + 2 || Y < g.t - 2 || Y > g.t + gh + 2) continue;   // 확대로 화면 밖
      cands.push({ d, X, Y, r: (d.symbolSize || 10) / 2 });
    }
    cands.sort((a, b) => b.d.__lab.prio - a.d.__lab.prio);
    const placed = [];
    const overlap = (R, q) => R.x < q.x + q.w && R.x + R.w > q.x && R.y < q.y + q.h && R.y + R.h > q.y;
    const hit = (R) => placed.some((q) => overlap(R, q));
    for (const c of cands) {
      const L = c.d.__lab;
      const fs = L.small ? 11 : L.strong ? 12.5 : narrow ? 11 : 11.5, fw = L.strong ? 700 : 500;
      measureCtx.font = `${fw} ${fs}px ${st.font}`;
      const h = fs + 5, dist = narrow ? 4 : 6;
      for (const text of L.alt ? [L.text, L.alt] : [L.text]) {   // 긴 이름표가 안 들어가면 짧은 것으로 다시 시도
      const w = measureCtx.measureText(text).width + 6;
      const nearR = (c.X - g.l) / gw > (narrow ? 0.62 : 0.8);
      const order = nearR ? ["left", "top", "bottom", "right"] : narrow ? ["top", "right", "left", "bottom"] : ["right", "left", "top", "bottom"];
      const rectOf = (p) => p === "right" ? { x: c.X + c.r + dist, y: c.Y - h / 2, w, h }
        : p === "left" ? { x: c.X - c.r - dist - w, y: c.Y - h / 2, w, h }
        : p === "top" ? { x: c.X - w / 2, y: c.Y - c.r - dist - h, w, h }
        : { x: c.X - w / 2, y: c.Y + c.r + dist, w, h };
      const inside = (R) => R.x >= 2 && R.x + R.w <= W - 2 && R.y >= 0 && R.y + R.h <= g.t + gh + 2;
      // 1순위: 다른 이름표·점을 모두 피하는 자리 → 2순위: 이름표만 피하는 자리
      let pos = order.find((p) => { const R = rectOf(p); return inside(R) && !hit(R) && !dots.some((q) => overlap(R, q)); })
        || order.find((p) => { const R = rectOf(p); return inside(R) && !hit(R); });
      if (!pos && L.force) pos = order.find((p) => inside(rectOf(p))) || order[0];
      if (!pos) continue;
      placed.push(rectOf(pos));
      c.d.label = { show: true, position: pos, distance: dist, formatter: text, color: L.strong ? st.txt : st.txt2,
        fontSize: fs, fontWeight: fw, fontFamily: st.font, textBorderColor: st.halo, textBorderWidth: 3 };
      break;
      }
    }
  }

  function renderChart(list, points) {
    renderedNarrow = isNarrow();
    const txt = css("--text"), txt2 = css("--text-2"), muted = css("--muted"), grid = css("--grid"), axis = css("--axis"), surf = css("--surface"), ink = css("--frontier");
    const font = "Pretendard Variable, Pretendard, Malgun Gothic, sans-serif";
    const narrow = isNarrow();
    const halo = css("--surface");   // 글자 테두리: 선이 지나가도 이름이 잘 읽히게

    // 전체 범위: 점이 있는 곳에 딱 맞추고 조금만 여유
    const xs = points.map((p) => p.x).filter((x) => x != null);
    const ys = points.filter((p) => p.x != null).map((p) => p.v.score);
    const y0 = ys.length ? Math.floor(Math.min(...ys) - 2) : 100;
    const y1 = ys.length ? Math.ceil(Math.max(...ys) + 2) : 170;
    let x0, x1;
    if (S.x === "date") {
      const ts = xs.map((d) => Date.parse(d)).filter((t) => !isNaN(t));
      const a = ts.length ? Math.min(...ts) : Date.now() - 365 * 864e5, b = ts.length ? Math.max(...ts) : Date.now();
      const pad = Math.max((b - a) * 0.04, 7 * 864e5);
      x0 = a - pad; x1 = b + pad;
    } else {
      const lo = xs.length ? Math.min(...xs) : 0.01, hi = xs.length ? Math.max(...xs) : 1;
      const a = Math.log10(lo), b = Math.log10(hi);
      const pad = Math.max(0.06, (b - a) * 0.03);
      x0 = 10 ** (a - pad); x1 = 10 ** (b + pad);
    }
    FULL = { x0, x1, y0, y1 };
    if (viewKind !== S.x) { VIEWBOX = null; viewKind = S.x; }
    VIEWBOX = clampView(VIEWBOX);
    const V = VIEWBOX || FULL;

    // 오른쪽 끝 가까운 점은 이름표를 왼쪽에
    const nearRight = (x) => {
      if (x == null) return false;
      const a0 = tx(V.x0), a1 = tx(V.x1);
      const xv = S.x === "date" ? Date.parse(x) : x;
      return (tx(xv) - a0) / (a1 - a0) > (narrow ? 0.62 : 0.8);
    };
    const sidePos = (x) => (nearRight(x) ? "left" : narrow ? "top" : "right");

    const front = FR.front;

    const labelled = new Set(list.slice(0, S.labels ? 40 : 0).map((M) => M.key));
    const zoomedIn = !!VIEWBOX && S.labels;   // 확대 중: 공간이 넓어지니 보이는 점마다 이름·등급 표시
    const pinSet = new Set(S.pinned);
    const anyPin = list.some((M) => pinSet.has(M.key));   // 고정한 모델이 지금 그래프에 있을 때만 나머지를 흐리게
    const frModels = new Set(FR.front.map((p) => p.M.key));   // 가성비 경계선 위에 점이 있는 모델 → 이름표 우선
    const series = [];
    for (const M of list) {
      const col = colorOf(M.company);
      const sym = styleOf(M.company).sym;
      const pinned = pinSet.has(M.key);
      const hl = hoverCo != null && groupOf(M.company) === hoverCo;   // 회사 버튼에 마우스를 올려 강조 중
      const dim = (anyPin && !pinned) || (hoverCo != null && !hl);
      const shown = M.vs.filter((z) => xOf(z) != null);
      const topV = shown.reduce((a, b) => (b.score > a.score ? b : a), { score: -1 });
      const data = shown.map((v) => {
        const x = xOf(v);
        const hollow = isCostAxis() && v.costKind === "가격 추정";
        const isTop = v === topV;
        const st = (FR.status.get(vkey(v)) || {}).st;
        const fr = st === "front", nr = st === "near";
        const base = sym === "pin" ? 16 : sym === "triangle" ? 12 : 10;
        return {
          value: [x, +v.score.toFixed(2)],
          v,
          symbol: sym,
          symbolSize: base + (pinned ? 3 : 0) + (fr ? 3 : nr ? 2 : 0),
          itemStyle: Object.assign(
            hollow ? { color: surf, borderColor: col, borderWidth: 2 }
              : fr ? { color: col, borderColor: ink, borderWidth: 2 }
              : nr ? { color: col, borderColor: ink, borderWidth: 1.4, borderType: [2, 2] }
              : { color: col, borderColor: surf, borderWidth: 1.5 },
            { opacity: dim ? 0.16 : 1 }),
          // 이름표 후보 (실제 자리는 아래 placeLabels 가 겹치지 않게 정함)
          label: { show: false },
          __lab: pinned ? { text: isTop ? `${M.name} · ${v.eff}` : v.eff, strong: isTop, small: !isTop, force: true, prio: 1000 + (isTop ? 50 : 0) + v.score }
            : isTop && (labelled.has(M.key) || hl) && !dim ? { text: zoomedIn ? `${M.name} · ${v.eff}` : M.name, prio: (hl ? 800 : frModels.has(M.key) ? 500 : 300) + v.score }
            : zoomedIn && !dim ? { text: `${M.name} · ${v.eff}`, alt: v.eff, small: true, prio: 100 + v.score } : null,   // 자리가 모자라면 등급만
          emphasis: {
            itemStyle: { opacity: 1 },
            label: {
              show: true, position: sidePos(x), distance: 7, fontFamily: font, opacity: 1, textBorderColor: halo, textBorderWidth: 3,
              formatter: isTop ? `${M.name} · ${v.eff}` : v.eff,
              color: isTop ? txt : txt2, fontSize: isTop ? 12.5 : 10.5, fontWeight: isTop ? 700 : 500,
            },
          },
        };
      });
      if (!data.length) continue;
      series.push({
        name: M.name, id: M.key, type: "line", data, showSymbol: true, triggerLineEvent: true,
        lineStyle: { width: pinned || hl ? 2 : 1.2, color: col, opacity: pinned || hl ? 0.65 : dim ? 0.05 : 0.3, cap: "round", join: "round" },
        itemStyle: { color: col },
        emphasis: { focus: "series", lineStyle: { width: 2, opacity: 0.75 } },
        blur: { lineStyle: { opacity: 0.06 }, itemStyle: { opacity: 0.14 }, label: { opacity: 0.2 } },
        labelLayout: { hideOverlap: false },   // 겹침은 placeLabels 가 직접 처리
        z: pinned ? 6 : hl ? 5 : dim ? 1 : 3,
        animationDuration: 550, animationEasing: "cubicOut",
      });
    }
    placeLabels(series, V, narrow, { txt, txt2, halo, font });
    // 가성비 경계선: 흑백 점선 + 은은한 빛, 아래에 '오차 범위' 띠
    if (front.length >= 2) {
      const pts = front.map((p) => [p.x, +p.v.score.toFixed(2)]);
      pts.push([V.x1 * 1.5, pts[pts.length - 1][1]]);   // 가장 비싼 경계 점 오른쪽으로도 수평 연장
      const k = FR.k;
      series.push({
        id: "__fband_lo", type: "line", step: "end", silent: true, z: 1, stack: "fband", symbol: "none",
        data: pts.map(([x, y]) => [x, y - k]), lineStyle: { opacity: 0 }, tooltip: { show: false }, emphasis: { disabled: true }, animation: false,
      });
      series.push({
        id: "__fband", type: "line", step: "end", silent: true, z: 1, stack: "fband", symbol: "none",
        data: pts.map(([x]) => [x, k]), lineStyle: { opacity: 0 }, areaStyle: { color: ink, opacity: 0.1 },
        tooltip: { show: false }, emphasis: { disabled: true }, animation: false,
      });
      series.push({
        id: "__frontier", name: "가성비 경계선", type: "line", step: "end", silent: true, z: 2,
        data: pts, showSymbol: false,
        lineStyle: { type: [6, 5], width: 2, color: ink, opacity: 0.9, shadowBlur: 10, shadowColor: ink + "55" },
        tooltip: { show: false }, emphasis: { disabled: true },
        animationDuration: 900, animationEasing: "cubicInOut",
      });
    }

    const xAxis = S.x === "date"
      ? Object.assign({ type: "time", splitLine: { show: true, lineStyle: { color: grid } }, axisLine: { lineStyle: { color: axis } }, axisTick: { show: false } }, dateAxisView(V, muted))
      : Object.assign({ type: "log", logBase: 10, splitLine: { show: true, lineStyle: { color: grid } }, axisLine: { lineStyle: { color: axis } }, minorSplitLine: { show: false } }, logAxisView(V, muted));

    // 그래프 아래 설명
    const xName = {
      cost: "가로 → 문제 1개 푸는 비용 (오른쪽일수록 비쌈)",
      costok: `가로 → 맞힌 문제 1개당 비용 (난이도 '${diff().label}' 기준 · 틀리는 만큼 비싸짐)`,
      price: "가로 → 가격표 (100만 토큰당, 입력3:출력1 평균)",
      date: "가로 → 출시일",
    }[S.x];
    const noX = list.reduce((n, M) => n + M.vs.filter((v) => xOf(v) == null).length, 0);
    $("#axisX").textContent = xName + (noX ? ` · 비용 정보가 없어 빠진 점 ${noX}개 (표에는 있음)` : "");

    const full = chartBox.classList.contains("full");
    chart.setOption({
      backgroundColor: "transparent",
      animation: !quietRender && !REDUCED,
      textStyle: { fontFamily: font },
      grid: narrow ? { left: 34, right: 12, top: full && S.pinned.length ? 70 : 22, bottom: 30 } : { left: 46, right: 18, top: 24, bottom: 34 },
      xAxis,
      yAxis: {
        type: "value", min: V.y0, max: V.y1,
        axisLabel: { color: muted, showMinLabel: false, showMaxLabel: false, formatter: (v) => (Number.isInteger(v) ? v : v.toFixed(1)) },
        splitLine: { lineStyle: { color: grid } }, axisLine: { show: false }, minInterval: 0.5,
      },
      tooltip: {
        trigger: "item", confine: true, enterable: false, backgroundColor: "transparent", borderWidth: 0, padding: 0,
        extraCssText: "box-shadow:none;", transitionDuration: 0.15,
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
    updateZoomUi();
  }

  // ───────── 말풍선
  function tipHtml(v) {
    const M = v.m, c = confOf(v.se), col = colorOf(M.company);
    let h = `<div class="tip"><div class="tip-h"><span class="sw" style="background:${col}"></span>${esc(M.name)}</div>`;
    h += `<div class="tip-sub">${esc(v.eff)}${v.effKo ? " · " + esc(v.effKo) : ""}${v.isDefault ? " · 기본값" : ""}</div>`;
    h += `<div class="tip-score"><b>${v.score.toFixed(1)}</b><span>±${v.se.toFixed(1)} · 신뢰도 ${c.t}</span></div>`;
    h += `<div class="tip-row"><span>문제당 비용</span><b>${fmtCost(v.cost)}${v.costKind && v.costKind !== "측정" ? ` <span class="muted">(${esc(v.costKind)})</span>` : ""}</b></div>`;
    if (v.costOk != null) h += `<div class="tip-row"><span>맞힌 문제당 <span class="muted">(${esc(diff().label)} ${Math.round(v.acc * 100)}%)</span></span><b>${fmtCost(v.costOk)}</b></div>`;
    if (M.price) h += `<div class="tip-row"><span>가격표 (입력/출력)</span><span>$${M.price.in} / $${M.price.out}</span></div>`;
    const fs = FR.status.get(vkey(v));
    if (fs) {
      const t = fs.st === "front" ? `<b>경계선 위</b> — 이 가격대에서 최선`
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
  //  · 확대 모드: 휠로 확대/축소, 끌어서 이동, 빈 곳 더블클릭 = 처음 화면
  //  · 끄는 방법은 두 가지뿐: Esc, 또는 그래프 칸 밖을 한 번 클릭 (마우스가 밖으로 나가기만 해서는 안 꺼짐)
  //  · 켜져 있는 동안은 마우스가 어디에 있든 페이지가 스크롤되지 않음
  let FULL = null, VIEWBOX = null, viewKind = null;
  const isLog = () => S.x !== "date";
  const tx = (v) => (isLog() ? Math.log10(v) : v);
  const itx = (t) => (isLog() ? 10 ** t : t);
  const MIN_SPAN = () => ({ x: isLog() ? 0.12 : 5 * 864e5, y: 1.5 });

  function clampView(v) {
    if (!v || !FULL) return null;
    const f = { a: tx(FULL.x0), b: tx(FULL.x1) };
    let a = tx(v.x0), b = tx(v.x1), c = v.y0, d = v.y1;
    const ms = MIN_SPAN();
    const fitRange = (lo, hi, flo, fhi, min) => {
      let w = hi - lo;
      if (w >= fhi - flo) return [flo, fhi];
      if (w < min) { const m = (lo + hi) / 2; lo = m - min / 2; hi = m + min / 2; w = min; }
      if (lo < flo) { hi += flo - lo; lo = flo; }
      if (hi > fhi) { lo -= hi - fhi; hi = fhi; }
      return [lo, hi];
    };
    [a, b] = fitRange(a, b, f.a, f.b, ms.x);
    [c, d] = fitRange(c, d, FULL.y0, FULL.y1, ms.y);
    const isFull = Math.abs(a - f.a) < 1e-9 && Math.abs(b - f.b) < 1e-9 && Math.abs(c - FULL.y0) < 1e-9 && Math.abs(d - FULL.y1) < 1e-9;
    return isFull ? null : { x0: itx(a), x1: itx(b), y0: c, y1: d };
  }
  // 로그 눈금: 보이는 범위에 맞춰 읽기 좋은 값만
  function logAxisView(V, muted) {
    const a = Math.log10(V.x0), b = Math.log10(V.x1), span = b - a;
    const vals = [];
    if (span > 0.6) {
      const mult = span > 4.5 ? [1] : span > 1.5 ? [1, 3] : [1, 2, 5];
      for (let k = Math.floor(a) - 1; k <= Math.ceil(b) + 1; k++) for (const m of mult) {
        const v = m * 10 ** k;
        if (v >= V.x0 * 0.999 && v <= V.x1 * 1.001) vals.push(+v.toPrecision(3));
      }
    } else {
      const raw = (V.x1 - V.x0) / 5;
      const p = 10 ** Math.floor(Math.log10(raw));
      const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) || 10 * p;
      for (let v = Math.ceil(V.x0 / step) * step; v <= V.x1 * 1.0001; v += step) vals.push(+v.toPrecision(4));
    }
    const fmt = (v) => "$" + (v >= 1 ? +v.toFixed(2) : +v.toPrecision(3));
    return { min: V.x0, max: V.x1, axisLabel: { color: muted, customValues: vals, formatter: fmt, hideOverlap: true }, axisTick: { customValues: vals, show: false } };
  }
  function dateAxisView(V, muted) {
    const days = (V.x1 - V.x0) / 864e5;
    const two = (n) => String(n).padStart(2, "0");
    const fmt = (v) => { const d = new Date(v); return days > 100 ? `${d.getFullYear()}.${two(d.getMonth() + 1)}` : `${two(d.getMonth() + 1)}.${two(d.getDate())}`; };
    return { min: V.x0, max: V.x1, axisLabel: { color: muted, hideOverlap: true, showMinLabel: false, showMaxLabel: false, formatter: fmt } };
  }

  let rafPending = false, labelTimer = null;
  function drawView() {
    rafPending = false;
    const V = VIEWBOX || FULL;
    if (!V) return;
    const opt = { yAxis: { min: V.y0, max: V.y1 } };
    opt.xAxis = S.x === "date" ? dateAxisView(V, css("--muted")) : logAxisView(V, css("--muted"));
    chart.setOption(opt, { silent: true });
    updateZoomUi();
    clearTimeout(labelTimer);   // 멈추면 이름표 방향 다시 계산
    labelTimer = setTimeout(() => { if (VIEW) { quietRender = true; renderChart(VIEW.list, VIEW.points); quietRender = false; } }, 350);
  }
  function applyView() {
    if (document.visibilityState === "hidden") return drawView();
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(drawView);
  }
  const setView = (v) => { VIEWBOX = clampView(v); applyView(); };
  const resetView = () => { VIEWBOX = null; applyView(); };
  function gridRect() {
    const g = chart.getModel().getComponent("grid");
    return g && g.coordinateSystem ? g.coordinateSystem.getRect() : null;
  }
  function pxToT(px, py, base) {
    const r = gridRect(), V = base || VIEWBOX || FULL;
    const fx = (px - r.x) / r.width, fy = (py - r.y) / r.height;
    const a = tx(V.x0), b = tx(V.x1);
    return { t: a + fx * (b - a), y: V.y1 - fy * (V.y1 - V.y0) };
  }
  function inGrid(px, py) {
    const r = gridRect();
    return r && px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height;
  }
  function zoomAt(px, py, f, axes, base) {
    const V = base || VIEWBOX || FULL;
    const c = pxToT(px, py, V);
    let a = tx(V.x0), b = tx(V.x1), y0 = V.y0, y1 = V.y1;
    if (axes !== "y") { a = c.t - (c.t - a) * f; b = c.t + (b - c.t) * f; }
    if (axes !== "x") { y0 = c.y - (c.y - y0) * f; y1 = c.y + (y1 - c.y) * f; }
    setView({ x0: itx(a), x1: itx(b), y0, y1 });
  }
  const zoomCenter = (f) => { const r = gridRect(); if (r) zoomAt(r.x + r.width / 2, r.y + r.height / 2, f, "xy"); };

  // 확대 모드 켜고 끄기
  let zoomOn = false, toastTimer = null;
  function setZoomOn(on) {
    if (zoomOn === on) return;
    zoomOn = on;
    chartBox.classList.toggle("zoom-on", on);
    if (on) hideToast();
  }
  function showToast(msg) {
    const t = $("#zoomToast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 1600);
  }
  function hideToast() { $("#zoomToast").classList.remove("show"); }
  // 그래프를 눌러 확대 모드를 켜면, 손을 뗀 뒤 그래프가 화면 가운데 오도록 페이지를 부드럽게 옮긴다
  // (누르는 도중에 움직이면 다른 점이 눌릴 수 있어서 손을 뗀 다음에 옮김)
  let centerAfterUp = false;
  // 그래프의 빈 곳을 누르면 확대 모드. 점·선을 누르면 고정만 하고 확대 모드는 켜지 않음
  //  (점을 눌러 모델을 고정한 뒤 아래 상세로 페이지를 스크롤할 수 있게)
  chart.getZr().on("mousedown", (e) => {
    const ne = e.event || {};
    if (ne.pointerType === "touch" || String(ne.type || "").startsWith("touch")) return;
    const r = fxLayer().getBoundingClientRect();
    if (e.target) { if (zoomOn) ripple(ne.clientX - r.left, ne.clientY - r.top, false); return; }
    const first = !zoomOn;
    if (first && !chartBox.classList.contains("full")) centerAfterUp = true;
    setZoomOn(true);
    ripple(ne.clientX - r.left, ne.clientY - r.top, first);
    if (first) burst();
  });

  // 확대 모드 효과
  //  · 켜질 때: 누른 자리에서 큰 물결 + 번쩍임, 테두리 밖으로 퍼지는 파동, 안내 표시가 튀어오름
  //  · 켜져 있는 동안: 테두리를 따라 무지갯빛이 돌고, 누를 때마다 작은 물결
  let fxEl = null;
  function fxLayer() {
    if (!fxEl) { fxEl = document.createElement("div"); fxEl.className = "zfx"; chartEl.parentElement.appendChild(fxEl); }
    return fxEl;
  }
  function fxAdd(parent, cls, css) {
    const el = document.createElement("i");
    el.className = cls;
    Object.assign(el.style, css || {});
    el.addEventListener("animationend", () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 2500);   // 탭이 가려져 효과가 멈춰도 남지 않게
    parent.appendChild(el);
    return el;
  }
  function ripple(x, y, big) {
    if (REDUCED) return;
    const layer = fxLayer();
    const n = big ? 3 : 2;
    for (let i = 0; i < n; i++) fxAdd(layer, "zripple" + (big ? " big" : ""), { left: x + "px", top: y + "px", animationDelay: i * (big ? 120 : 90) + "ms" });
    if (big) fxAdd(layer, "zflash", { left: x + "px", top: y + "px" });
    else fxAdd(layer, "zdot", { left: x + "px", top: y + "px" });
  }
  function burst() {
    if (REDUCED) return;
    fxAdd(chartBox, "zwave");
    chartBox.classList.remove("zoom-burst");
    void chartBox.offsetWidth;   // 효과를 처음부터 다시 재생
    chartBox.classList.add("zoom-burst");
    clearTimeout(burst.t);
    burst.t = setTimeout(() => chartBox.classList.remove("zoom-burst"), 1200);
  }
  window.addEventListener("pointerup", () => {
    if (!centerAfterUp) return;
    centerAfterUp = false;
    setTimeout(centerChart, 0);
  });
  // PC: 그래프 칸 전체가 (위에 붙은 막대들 아래) 한 화면에 딱 들어가도록 그래프 높이를 맞춤
  function fitChartHeight() {
    if (window.innerWidth <= 700 || chartBox.classList.contains("full")) { chartEl.style.height = ""; return; }
    const extra = chartBox.offsetHeight - chartEl.offsetHeight;
    const top0 = $(".topbar").offsetHeight + dock.offsetHeight;
    const h = Math.max(440, Math.min(900, window.innerHeight - top0 - extra - 16));
    if (Math.abs(chartEl.offsetHeight - h) > 2) chartEl.style.height = h + "px";
  }
  window.addEventListener("resize", () => { clearTimeout(fitChartHeight.t); fitChartHeight.t = setTimeout(fitChartHeight, 120); });
  function centerChart() {
    const r = chartBox.getBoundingClientRect();
    const top0 = $(".topbar").offsetHeight + dock.offsetHeight;   // 위에 붙어 있는 막대들 아래부터가 보이는 공간
    const avail = window.innerHeight - top0;
    const delta = r.height <= avail ? r.top - (top0 + (avail - r.height) / 2) : r.top - top0 - 8;
    if (Math.abs(delta) > 4) window.scrollBy({ top: delta, behavior: REDUCED ? "auto" : "smooth" });
  }
  document.addEventListener("pointerdown", (e) => { if (!chartBox.contains(e.target) && !chartBox.classList.contains("full")) setZoomOn(false); });
  // 확대 모드일 때는 마우스가 어디에 있든(그래프 밖이어도) 페이지가 절대 스크롤되지 않게 막는다
  //  · 그래프 밖에서 휠을 굴리면 끝내는 방법을 알려줌
  window.addEventListener("wheel", (e) => {
    if (!zoomOn) return;
    e.preventDefault();
    if (!chartBox.contains(e.target)) showToast("확대 모드라 페이지가 고정돼 있어요 · Esc 또는 그래프 밖 클릭으로 끝내기");
  }, { passive: false });
  // 키보드로 페이지가 움직이는 것도 막음 (방향키·스페이스·PageUp/Down·Home/End)
  const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);
  document.addEventListener("keydown", (e) => {
    if (!zoomOn || !SCROLL_KEYS.has(e.key)) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(t.tagName) || t.hasAttribute("tabindex"))) return;
    e.preventDefault();
  });
  chartEl.addEventListener("wheel", (e) => {
    const rect = chartEl.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    if (!zoomOn) {
      if (FULL && inGrid(px, py) && wheelHintN < 3 && Date.now() - wheelHintT > 8000) {   // 페이지는 그대로 스크롤
        wheelHintN++; wheelHintT = Date.now();
        showToast("그래프 빈 곳을 한 번 클릭하면 휠로 확대할 수 있어요");
      }
      return;
    }
    e.preventDefault();
    if (!FULL || !inGrid(px, py)) return;
    const zoomOut = e.deltaY > 0;
    if (zoomOut && !VIEWBOX) return;   // 이미 다 축소됨 → 아무 일도 안 함 (페이지도 안 움직임)
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    const f = Math.min(1.6, Math.max(0.6, Math.exp(dy * 0.0022)));
    zoomAt(px, py, f, e.shiftKey ? "x" : e.altKey ? "y" : "xy");
  }, { passive: false });

  // 끌어서 이동 (확대된 상태에서)
  let drag = null, suppressClick = false;
  chartEl.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || !VIEWBOX) return;
    const rect = chartEl.getBoundingClientRect();
    if (!inGrid(e.clientX - rect.left, e.clientY - rect.top)) return;
    drag = { sx: e.clientX, sy: e.clientY, v: VIEWBOX, moved: false };
  }, true);
  window.addEventListener("mousemove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) { drag.moved = true; chartEl.classList.add("panning"); chart.dispatchAction({ type: "hideTip" }); }
    const r = gridRect(), v = drag.v, a = tx(v.x0), b = tx(v.x1);
    setView({ x0: itx(a + (-dx / r.width) * (b - a)), x1: itx(b + (-dx / r.width) * (b - a)), y0: v.y0 + (dy / r.height) * (v.y1 - v.y0), y1: v.y1 + (dy / r.height) * (v.y1 - v.y0) });
  });
  window.addEventListener("mouseup", () => {
    if (!drag) return;
    if (drag.moved) { suppressClick = true; setTimeout(() => (suppressClick = false), 50); }
    chartEl.classList.remove("panning");
    drag = null;
  });
  chart.getZr().on("dblclick", (e) => { if (!e.target) resetView(); });

  // 휴대폰: 두 손가락으로 벌리면 확대, 확대한 뒤 한 손가락으로 이동
  let touch = null;
  const tpos = (t) => { const r = chartEl.getBoundingClientRect(); return { x: t.clientX - r.left, y: t.clientY - r.top }; };
  chartEl.addEventListener("touchstart", (e) => {
    if (!FULL) return;
    if (e.touches.length === 2) {
      const a = tpos(e.touches[0]), b = tpos(e.touches[1]);
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (!inGrid(m.x, m.y)) return;
      touch = { mode: "pinch", d: Math.hypot(a.x - b.x, a.y - b.y), m, v: VIEWBOX || FULL };
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
      const a = tpos(e.touches[0]), b = tpos(e.touches[1]);
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 10) zoomAt(touch.m.x, touch.m.y, touch.d / d, "xy", touch.v);
      e.preventDefault();
    } else if (touch.mode === "pan" && e.touches.length === 1) {
      const p = tpos(e.touches[0]);
      const dx = p.x - touch.p.x, dy = p.y - touch.p.y;
      if (!touch.moved && Math.hypot(dx, dy) < 6) return;
      touch.moved = true;
      const r = gridRect(), v = touch.v, a = tx(v.x0), b = tx(v.x1);
      setView({ x0: itx(a + (-dx / r.width) * (b - a)), x1: itx(b + (-dx / r.width) * (b - a)), y0: v.y0 + (dy / r.height) * (v.y1 - v.y0), y1: v.y1 + (dy / r.height) * (v.y1 - v.y0) });
      e.preventDefault();
    }
  }, { passive: false });
  chartEl.addEventListener("touchend", (e) => {
    if (touch && touch.moved) { suppressClick = true; setTimeout(() => (suppressClick = false), 300); }
    if (e.touches.length === 0) touch = null;
  });
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
  let hoverSeries = null;
  const CAN_HOVER = matchMedia("(hover: hover)").matches;
  chart.getZr().on("click", (e) => {
    if (!e.target) { chart.dispatchAction({ type: "downplay" }); chart.dispatchAction({ type: "hideTip" }); hoverSeries = null; }
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
  let lastTapKey = null;
  let wheelHintN = 0, wheelHintT = 0;
  chart.on("click", (p) => {
    if (suppressClick) return;
    if (p.data && p.data.v) {
      // 휴대폰(터치): 처음 누르면 설명만 보여 주고, 같은 점을 한 번 더 누르면 고정
      if (!CAN_HOVER) { const k = vkey(p.data.v); if (lastTapKey !== k) { lastTapKey = k; return; } lastTapKey = null; }
      togglePin(p.data.v.m.key, p.data.v.effort);
    } else if (p.seriesType === "line" && seriesKey(p)) togglePin(seriesKey(p));
  });

  // ───────── 고정 (비교)
  function togglePin(key, effort) {
    // 이미 고정한 모델의 다른 등급을 누르면: 고정은 그대로 두고 그 등급을 보여 줌
    if (S.pinned.includes(key) && effort && (S.selected !== key || S.selEffort !== effort)) {
      S.selected = key; S.selEffort = effort;
      save(); render();
      return;
    }
    if (S.pinned.includes(key)) {
      S.pinned = S.pinned.filter((k) => k !== key);
      if (S.selected === key) { S.selected = S.pinned[S.pinned.length - 1] || null; S.selEffort = null; }
    } else {
      S.pinned = [...S.pinned, key].slice(-8);
      S.selected = key; S.selEffort = effort || null;
    }
    save(); render();
  }
  function pinAndShow(key, effort) {
    if (!S.pinned.includes(key)) S.pinned = [...S.pinned, key].slice(-8);
    S.selected = key; S.selEffort = effort || null;
    save(); render();
    setTimeout(() => $("#detail").scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" }), 480);
  }
  function renderPinBar() {
    const el = $("#pinBar");
    el.innerHTML = "";
    if (!S.pinned.length) {
      el.innerHTML = `<span class="hint"><svg viewBox="0 0 24 24" style="width:14px;height:14px"><path d="M9 4v6l-2 3h10l-2-3V4M12 13v7"/></svg>점을 누르면 그 모델이 고정돼요 — 여러 개 골라 비교할 수 있어요</span>`;
      return;
    }
    for (const key of S.pinned) {
      const M = VIEW.all.find((x) => x.key === key);
      if (!M) continue;
      const chip = document.createElement("span");
      chip.className = "pin" + (S.selected === key ? " cur" : "");
      chip.title = "눌러서 자세히 보기";
      chip.innerHTML = `<span class="sw" style="background:${colorOf(M.company)}"></span>`;
      const t = document.createElement("span"); t.textContent = M.name;
      const x = document.createElement("button");
      x.type = "button"; x.className = "x"; x.textContent = "×"; x.setAttribute("aria-label", M.name + " 고정 해제");
      x.onclick = (e) => { e.stopPropagation(); togglePin(key); };
      chip.onclick = () => { S.selected = key; S.selEffort = null; save(); renderDetail(); renderPinBar(); };
      chip.append(t, x);
      el.append(chip);
    }
    const clr = document.createElement("button");
    clr.type = "button"; clr.className = "pin-clear"; clr.textContent = "모두 해제";
    clr.onclick = () => { S.pinned = []; S.selected = null; save(); render(); };
    el.append(clr);
  }

  // ───────── 회사 칩 (누르면 숨기기/보이기)
  function symbolSvg(sym, col) {
    const s = {
      circle: `<circle cx="6" cy="6" r="5"/>`, rect: `<rect x="1" y="1" width="10" height="10" rx="1.5"/>`, roundRect: `<rect x="1" y="1" width="10" height="10" rx="3.5"/>`,
      diamond: `<path d="M6 0 L12 6 L6 12 L0 6Z"/>`, triangle: `<path d="M6 1 L11.5 11 L0.5 11Z"/>`, pin: `<path d="M6 12 C3 8 1 6.5 1 4.5 A5 5 0 0 1 11 4.5 C11 6.5 9 8 6 12Z"/>`,
    }[sym];
    return `<svg viewBox="0 0 12 12" style="fill:${col}">${s}</svg>`;
  }
  function renderLegend(all) {
    const cnt = {};
    const cutoff = S.period ? monthsAgo(S.period) : null;
    for (const M of all) if (!cutoff || (M.date && M.date >= cutoff)) cnt[groupOf(M.company)] = (cnt[groupOf(M.company)] || 0) + 1;
    const el = $("#legend");
    el.innerHTML = "";
    for (const g of [...MAIN_COMPANIES, "기타"]) {
      const st = g === "기타" ? OTHER : COMPANY_STYLE[g];
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip" + (S.hidden.includes(g) ? " off" : "");
      chip.title = (g === "기타" ? "상위 " + TOP_N + "곳 밖의 모든 회사" + NL : "") + COMPANY_RULE + NL + (S.hidden.includes(g) ? "눌러서 보이기" : "눌러서 숨기기");
      chip.innerHTML = symbolSvg(st.sym, css(st.c));
      const t = document.createElement("span"); t.textContent = g;
      const n = document.createElement("span"); n.className = "cnt"; n.textContent = cnt[g] || 0;
      chip.append(t, n);
      chip.setAttribute("aria-pressed", String(!S.hidden.includes(g)));
      chip.onclick = () => { hoverCo = null; S.hidden = S.hidden.includes(g) ? S.hidden.filter((x) => x !== g) : [...S.hidden, g]; save(); render(); };
      // 마우스로 올렸을 때만 강조 (휴대폰 터치는 강조하지 않음), 숨긴 회사는 강조하지 않음 (그래프 전체가 흐려지지 않게)
      chip.onpointerenter = (e) => { if (e.pointerType === "mouse" && !S.hidden.includes(g)) setHoverCo(g); };
      chip.onpointerleave = () => setHoverCo(null);
      el.append(chip);
    }
    el.onpointerleave = () => setHoverCo(null);
  }
  // 강조할 회사가 바뀌면 그래프만 움직임 없이 바로 다시 그림
  function setHoverCo(g) {
    if (hoverCo === g || !VIEW) return;
    hoverCo = g;
    quietRender = true;
    renderChart(VIEW.list, VIEW.points);
    quietRender = false;
  }

  // ───────── 첫 화면 추천 카드 (최고 성능 / 가성비 추천)
  const ICON_TOP = `<svg viewBox="0 0 24 24"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>`;
  const ICON_VALUE = `<svg viewBox="0 0 24 24"><path d="M12 2v20M17 6.5C17 4.6 14.8 3.5 12 3.5S7 4.6 7 6.5 9 9.2 12 10s5 2 5 4-2.2 3.5-5 3.5-5-1.1-5-3"/></svg>`;
  function renderCards(points) {
    const el = $("#cards");
    // 그래프에 실제로 그려진 점만 (비용이 없어 그래프에 없는 점은 카드에도 넣지 않음 → 그래프 순서와 똑같이)
    const all = points.filter((p) => p.x != null).map((p) => p.v);
    // 그래프와 같은 기준: 가격표로 짐작한 비용은 빼고 (추정 비용 그리기를 켜면 포함), 등급 환산은 포함하되 확실성 표시에서 알려 줌
    const withCost = points.filter((p) => costFor(p.v) != null && (S.estimated || p.v.costKind !== "가격 추정")).map((p) => p.v);
    if (!all.length) {
      el.innerHTML = `<div class="pick pick-empty">${S.search.trim() ? "검색한 모델이 없어요. 이름 일부만 쳐도 되고, 쉼표로 여러 개를 찾을 수 있어요." : "보이는 모델이 없어요. 그래프 위 회사 버튼을 눌러 다시 켜 보세요."}</div>`;
      return;
    }
    if (el.querySelector(".pick-empty")) el.innerHTML = "";

    // ── 최고 성능 1·2·3위: 그래프의 점(모델 × 등급) 전체를 종합 성능 점수 높은 순으로 (그래프 높이 순서와 똑같이)
    const topRows = all.slice().sort((a, b) => b.score - a.score).slice(0, 3);
    const top = topRows[0];
    // 1위와 겨루는 상대 = 다른 모델 중 가장 높은 점 (같은 모델의 다른 등급끼리 '공동 1위'라 하지 않게)
    const rival = all.slice().sort((a, b) => b.score - a.score).find((v) => v.m !== top.m) || null;
    const band = (v, w = top) => Math.sqrt(w.se ** 2 + v.se ** 2);   // 두 점수를 비교할 때의 오차 범위

    // ── 가성비 추천 1위: "최고 성능과 실력 차이가 오차 범위 안인 것" 중 가장 싼 것
    //  · 고정된 몇 점이 아니라 두 점수의 오차를 합친 범위(√(오차₁²+오차₂²))로 비교 (그래프의 오차 띠와 같은 원리)
    //  · 비용은 실제로 잰 값만 (추정 비용 그리기를 켜면 추정도 포함)
    const near = withCost.filter((v) => top.score - v.score <= band(v)).sort((a, b) => costFor(a) - costFor(b));
    const cheap = near[0] || null;
    // 가성비 2위·3위: 가성비 경계선을 따라 1위보다 싼 쪽으로 내려가며 (점수는 조금 낮지만 더 싼 모델)
    //  · 경계선 = 싼 순서로 보면서 앞의 것보다 점수가 높은 것만 → 각자 그 가격대에서 가장 좋은 모델
    const frontierPts = [];
    for (const v of withCost.slice().sort((a, b) => costFor(a) - costFor(b) || b.score - a.score))
      if (!frontierPts.length || v.score > frontierPts[frontierPts.length - 1].score + 1e-9) frontierPts.push(v);
    const below = cheap ? frontierPts.filter((v) => costFor(v) < costFor(cheap) && v.score < cheap.score).reverse() : [];
    const valueRows = cheap ? [cheap, ...below.slice(0, 2)] : [];

    // ── 두 카드 공통 표: 성능(막대) · 비용 · "최고 성능과 비교: 성능 −○점 · 비용 ○% 절약/더 듦"
    //  · 비교 기준은 항상 최고 성능 1위, 막대 눈금도 두 카드가 같음 (길이를 서로 비교할 수 있게)
    const topCost = costFor(top);
    const lo = Math.min(...topRows.concat(valueRows).map((v) => v.score)) - 3;
    const barW = (v) => Math.max(6, Math.min(100, ((v.score - lo) / (top.score - lo)) * 100));
    const cmp = (v) => {
      if (v === top) return "이 모델이 비교 기준";
      const gap = top.score - v.score;
      let t = gap < 0.05 ? "성능 같음" : `<span class="nw">성능 −${gap.toFixed(1)}점</span>`;
      const c = costFor(v);
      if (topCost && c) {
        // 절약은 99%를 넘지 않게 (반올림으로 '100% 절약'이 되지 않게), 2배 이상 비싸면 '○배'가 읽기 쉬움
        const save = (1 - c / topCost) * 100, ratio = c / topCost;
        t += save >= 0.5 ? ` · <span class="up nw">비용 ${Math.min(99, Math.round(save))}% 절약</span>`
          : ratio >= 2 ? ` · <span class="down nw">비용 ${ratio.toFixed(1)}배</span>`
          : save <= -0.5 ? ` · <span class="down nw">비용 ${Math.round(-save)}% 더 듦</span>` : " · 비용 같음";
      }
      return t;
    };
    const rowsHtml = (rows) => rows.map((v, i) =>
      `<div class="vt-row${i === 0 ? " first" : ""}" data-key="${esc(v.m.key)}" data-eff="${esc(v.effort)}" tabindex="0" role="button" aria-label="${esc(v.m.name)} ${esc(v.eff)} 자세히 보기">` +
      `<span class="rk">${i + 1}</span>` +
      `<span class="vn"><span class="dot" style="background:${colorOf(v.m.company)}"></span><b>${esc(v.m.name)}</b> <span class="eff-chip sm">${esc(v.eff)}</span></span>` +
      `<span class="vs"><small>성능</small><b>${v.score.toFixed(1)}</b><i class="vbar"><i style="width:${barW(v).toFixed(0)}%"></i></i></span>` +
      `<span class="vc"><small>${esc(costUnit())}</small>${fmtCost(costFor(v))}</span>` +
      `<span class="vd"><span class="vd-k">최고 성능과 비교: </span>${cmp(v)}</span></div>`).join("");
    const confHtml = (level, checks, title) =>
      `<div class="pick-conf ${level.k}" title="${esc(title)}"><span class="lv">${esc(level.t)}${level.x ? `<span class="lv-x"> · ${esc(level.x)}</span>` : ""}</span>` +
      checks.map((c) => `<span class="ck ${c.ok ? "ok" : "no"}">${c.ok ? "✓" : "!"} ${esc(c.t)}</span>`).join("") + `</div>`;

    const cards = [];
    // 최고 성능: 1위 모델이 다른 모델들보다 확실히 앞서는지 (다른 모델 중 1등과의 차이가 오차 범위보다 큰지)
    {
      const gapOk = !rival || top.score - rival.score > band(rival);
      const checks = [
        top.nReal >= 2 ? { ok: true, t: "두 기관 모두 측정" } : { ok: false, t: "한 기관만 측정" },
        !rival ? { ok: true, t: "비교할 다른 모델 없음" } : gapOk ? { ok: true, t: `다음 모델(${rival.m.name})보다 확실히 높음` }
          : { ok: false, t: `${(top.score - rival.score).toFixed(1)}점 차 < 오차 ±${band(rival).toFixed(1)}` },
      ];
      const level = !gapOk ? { k: "mid", t: "사실상 공동 1위", x: rival.m.name } : checks[0].ok ? { k: "hi", t: "1위 확실" } : { k: "mid", t: "1위 대체로 확실" };
      cards.push({ kind: "top", label: "최고 성능", icon: ICON_TOP, sub: "성능 높은 순", tip: "그래프의 모든 점(모델 × 추론 등급) 중 종합 성능 점수가 높은 순서 — 그래프에서 위에 있는 순서와 같아요", v: top,
        html: rowsHtml(topRows) + confHtml(level, checks, "1위 모델이 다른 모델들보다 확실히 앞서는지. 다른 모델 중 1등과의 점수 차이가 오차 범위보다 크면 확실") });
    }
    // 가성비 추천: 1위 추천이 얼마나 확실한지 (두 기관 측정? 비용 실측? 다음 후보와 가격 차이가 충분한가?)
    if (cheap) {
      const next = near[1] || null;
      const nextRatio = next ? costFor(next) / costFor(cheap) : null;
      const checks = [
        cheap.nReal >= 2 ? { ok: true, t: "두 기관 모두 측정" } : { ok: false, t: "한 기관만 측정" },
        cheap.costKind === "측정" ? { ok: true, t: "비용 실측" } : cheap.costKind === "등급 환산" ? { ok: false, t: "비용 등급 환산" } : { ok: false, t: "비용 가격표 추정" },
        !next ? { ok: true, t: "비슷한 후보 없음" } : nextRatio >= 1.25 ? { ok: true, t: "비슷한 값의 후보 없음" } : { ok: false, t: "비슷한 값의 후보 있음" },
      ];
      const nOk = checks.filter((c) => c.ok).length;
      const level = nOk === 3 ? { k: "hi", t: "1위 확실" } : nOk === 2 ? { k: "mid", t: "1위 대체로 확실" } : { k: "lo", t: "1위 참고용" };
      cards.push({ kind: "value", label: "가성비 추천", icon: ICON_VALUE, sub: "성능 높은 순", tip: "1위: 최고 성능과 실력 차이가 오차 범위 안(사실상 동급)인 것 중 가장 싼 것 · 2·3위: 가성비 경계선을 따라 1위보다 싼 모델", v: cheap,
        html: rowsHtml(valueRows) + confHtml(level, checks, "1위 추천이 얼마나 확실한지. 확실: 세 가지 모두 충족 · 대체로 확실: 두 가지 · 참고용: 한 가지 이하") });
    }

    cards.forEach((c, i) => {
      let card = el.children[i];
      if (!card) { card = document.createElement("div"); el.append(card); }
      card.className = "pick pick-table";
      card.dataset.kind = c.kind;
      card.style.setProperty("--pc", colorOf(c.v.m.company));
      card.innerHTML =
        `<div class="pick-top"><span class="pick-label"><span class="ic">${c.icon}</span>${c.label}</span><span class="pick-sub" title="${esc(c.tip || "")}">${esc(c.sub)} ⓘ</span></div>` +
        `<div class="vt">${c.html}</div>`;
      // 줄을 누르면 그 모델을 그래프에 고정하고 상세를 보여 줌
      card.onclick = (e) => { const r = e.target.closest(".vt-row"); if (r) pinAndShow(r.dataset.key, r.dataset.eff); };
    });
    while (el.children.length > cards.length) el.lastChild.remove();
  }

  // ───────── 순위표
  let tableLimit = 40;
  function renderTable(list) {
    const rows = [];
    for (const M of list) {
      if (S.pinnedOnly && S.pinned.length && !S.pinned.includes(M.key)) continue;
      for (const v of S.bestOnly ? [M.best] : M.vs) rows.push(v);
    }
    // 가성비 점수(0~100): 화면에 보이는 줄끼리가 아니라 그 기간의 모든 모델을 기준으로 매김
    //  → 필터·고정에 따라 같은 모델 점수가 바뀌지 않음. 가격표로 짐작한 비용은 기준에서 뺌
    const okCost = (v) => v.cost != null && (S.estimated || v.costKind !== "가격 추정");
    const raw = (v) => v.score - VALUE_K * Math.log10(v.cost);
    const cutoff = S.period ? monthsAgo(S.period) : null;
    const base = VIEW.all.filter((M) => !cutoff || (M.date && M.date >= cutoff));   // 검색·회사 숨김과 무관하게 그 기간 전체
    const vals = base.flatMap((M) => M.vs).filter(okCost).map(raw);
    const vMin = Math.min(...vals), vMax = Math.max(...vals);
    for (const v of rows) v.value = okCost(v) && vMax > vMin ? Math.max(0, Math.min(100, Math.round((raw(v) - vMin) / (vMax - vMin) * 100))) : null;
    [...rows].sort((a, b) => b.score - a.score).forEach((v, i) => (v.rank = i + 1));
    const sMin = Math.min(...rows.map((v) => v.score)), sMax = Math.max(...rows.map((v) => v.score));
    const key = {
      rank: (v) => v.rank, name: (v) => v.m.name + effIdx(v.effort), effort: (v) => effIdx(v.effort), score: (v) => v.score,
      cost: (v) => v.cost ?? Infinity, costok: (v) => v.costOk ?? Infinity, value: (v) => v.value ?? -1, price: (v) => blended(v.m) ?? Infinity, date: (v) => v.m.date || "",
    }[S.sortK] || ((v) => v.score);
    if (S.sortK === "name")   // 이름순: 이름을 글자 순서로 비교한 뒤 같은 모델은 등급 순서대로
      rows.sort((a, b) => (a.m.name.localeCompare(b.m.name, "ko", { numeric: true }) || effIdx(a.effort) - effIdx(b.effort)) * S.sortDir);
    else rows.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * S.sortDir; });
    const tb = $("#table tbody");
    tb.innerHTML = "";
    for (const v of rows.slice(0, tableLimit)) {
      const tr = document.createElement("tr");
      if (S.pinned.includes(v.m.key)) tr.className = "sel";
      const c = confOf(v.se);
      const pct = sMax > sMin ? ((v.score - sMin) / (sMax - sMin)) * 100 : 100;
      tr.innerHTML =
        `<td class="c-rank">${v.rank}</td>` +
        `<td class="c-name"><span class="mname"><span class="sw" style="background:${colorOf(v.m.company)}"></span>${esc(v.m.name)}</span> ${daysSince(v.m.date) <= 30 ? '<span class="badge new">NEW</span>' : ""}<span class="m-eff"><b>${esc(v.eff)}</b>${v.isDefault ? " · 기본값" : ""}</span></td>` +
        `<td class="effc c-eff"><b>${esc(v.eff)}</b>${v.effKo && v.effort !== "none" ? `<span class="ko">${esc(v.effKo)}</span>` : ""}${v.isDefault ? ' <span class="badge def">기본값</span>' : ""}${!canSelect(v.m, v.effort) ? ' <span class="badge est">선택 불가</span>' : ""}</td>` +
        `<td class="num c-score"><span class="scorec"><span class="bar"><i style="width:${Math.max(4, pct).toFixed(0)}%"></i></span><b>${v.score.toFixed(1)}</b></span><span class="sub2">±${v.se.toFixed(1)}<span class="conf-x"> · 신뢰도 <span class="badge ${c.k}">${c.t}</span></span></span></td>` +
        `<td class="num c-cost">${fmtCost(v.cost)}${v.costKind && v.costKind !== "측정" ? `<span class="sub2">${esc(v.costKind === "가격 추정" ? "가격표로 추정" : "등급 환산")}</span>` : ""}</td>` +
        `<td class="num c-costok">${fmtCost(v.costOk)}${v.acc ? `<span class="sub2">정답률 ${Math.round(v.acc * 100)}%</span>` : ""}</td>` +
        `<td class="num">${(() => { const f = FR.status.get(vkey(v)); return f && f.st === "front" ? '<span class="badge fr">경계선</span> ' : f && f.st === "near" ? '<span class="badge nr">동급</span> ' : ""; })()}${v.value ?? "—"}</td>` +
        `<td class="num c-price">${v.m.price ? `${fmtPrice(v.m.price.in)} / ${fmtPrice(v.m.price.out)}` : "—"}</td>` +
        `<td class="c-date">${esc(v.m.date || "—")}</td>`;
      tr.onclick = () => togglePin(v.m.key, v.effort);
      tr.tabIndex = 0;
      tb.append(tr);
    }
    $("#table").classList.toggle("x-cost", S.x === "cost");   // 휴대폰: 지금 가로축과 같은 비용 칸만 보임
    $("#moreRows").hidden = rows.length <= tableLimit;
    $("#moreRows").textContent = `더 보기 (${rows.length - tableLimit}개 더)`;
    $("#tableSub").innerHTML = `${rows.length}개 · 줄을 누르면 그래프에 고정돼요 · 제목을 누르면 정렬` +
      `<span class="m-only"><br><span class="nw">가성비 = 돈 대비 성능 (0~100, 높을수록 좋음)</span> · <span class="nw"><span class="badge fr"></span>경계선 위</span> <span class="nw"><span class="badge nr"></span>사실상 동급</span></span>`;
    $$("#table th").forEach((th) => {
      const on = th.dataset.k === S.sortK;
      th.classList.toggle("sorted", on); th.classList.toggle("asc", on && S.sortDir === 1);
      th.tabIndex = 0;
      th.setAttribute("aria-sort", on ? (S.sortDir === 1 ? "ascending" : "descending") : "none");
    });
  }
  $$("#table th").forEach((th) => {
    th.onclick = () => {
      const k = th.dataset.k;
      if (S.sortK === k) S.sortDir *= -1;
      else { S.sortK = k; S.sortDir = ["name", "effort", "rank", "cost", "costok", "price"].includes(k) ? 1 : -1; }
      save(); renderTable(VIEW.list);
    };
  });
  $("#moreRows").onclick = () => { tableLimit += 60; renderTable(VIEW.list); };

  // ───────── 모델 상세 (그래프 아래, 모델을 누르면 열림)
  function renderDetail() {
    const el = $("#detail");
    const M = VIEW && VIEW.all.find((x) => x.key === S.selected);
    el.classList.toggle("open", !!M);
    if (!M) { if (!el.firstChild) el.innerHTML = `<div class="detail-in"></div>`; return; }
    const m = M.m, col = colorOf(M.company);
    let h = `<div class="detail-in"><div class="detail-body">`;
    h += `<div class="d-head"><div><div class="d-title"><span class="sw" style="background:${col}"></span><h3>${esc(M.name)}</h3>${daysSince(M.date) <= 30 ? '<span class="badge new">NEW</span>' : ""}</div>`;
    h += `<div class="d-meta"><span>${esc(M.company)}</span><span>${esc(M.date || "?")} 출시</span>${m.price ? `<span>가격표 입력 $${m.price.in} · 출력 $${m.price.out} <span class="muted">/100만 토큰</span></span>` : ""}</div></div>`;
    h += `<button class="btn btn-ghost d-close" type="button" id="closeDetail">닫기</button></div>`;

    h += `<div class="dcols"><div class="dcol"><div class="sect">추론 등급별 <span class="muted" style="letter-spacing:0;font-weight:500">줄을 누르면 설명이 바뀌어요</span></div>`;
    h += `<table class="dt"><thead><tr><th>등급</th><th class="num">점수</th><th class="num">문제당 비용</th><th>한 단계 올리면</th></tr></thead><tbody>`;
    M.vs.forEach((v, i) => {
      const prev = M.vs[i - 1];
      let step = "";
      if (prev) {
        const ds = v.score - prev.score, cr = v.cost && prev.cost ? v.cost / prev.cost : null;
        step = `<span class="step"><span class="${ds >= 0 ? "up" : "dn"}">${ds >= 0 ? "+" : ""}${ds.toFixed(1)}점</span>${cr ? ` · 비용 ${cr.toFixed(1)}배` : ""}</span>`;
      }
      h += `<tr data-e="${esc(v.effort)}" class="eff-row${S.selEffort === v.effort ? " hl" : ""}" tabindex="0"><td><b>${esc(v.eff)}</b>${v.effKo ? `<span class="muted small ko-line">${esc(v.effKo)}</span>` : ""}${v.isDefault ? ' <span class="badge def">기본값</span>' : ""}${!canSelect(m, v.effort) ? ' <span class="badge est">선택 불가</span>' : ""}</td>` +
        `<td class="num"><b>${v.score.toFixed(1)}</b><span class="muted small"> ±${v.se.toFixed(1)}</span></td>` +
        `<td class="num">${fmtCost(v.cost)}${v.costKind && v.costKind !== "측정" ? `<br><span class="badge est">${esc(v.costKind)}</span>` : ""}</td><td>${step}</td></tr>`;
    });
    h += `</tbody></table></div>`;

    const v = M.vs.find((x) => x.effort === S.selEffort) || M.best;
    const g = EG[M.company];
    h += `<div class="dcol"><div class="sect">이 등급 쓰는 법 <b>${esc(v.eff)}</b></div><div class="howto">`;
    for (const r of howToSet(m, v.effort)) h += `<div class="howto-row"><span class="howto-k">${esc(r.k)}</span><span class="${r.code ? "code" : ""}">${esc(r.v)}</span></div>`;
    h += `</div>`;
    if (g && g.paramFull) h += `<div class="note">${esc(g.paramFull)}</div>`;
    const sup = m.efforts_supported;
    if (sup && sup.length) h += `<div class="note">고를 수 있는 등급: ${sup.slice().sort((a, b) => effIdx(a) - effIdx(b)).map((e) => esc(effLabel(m, e))).join(" · ")}${defaultEffort(m) ? ` (기본값 ${esc(effLabel(m, defaultEffort(m)))})` : ""}</div>`;
    if (g && g.note) h += `<div class="note">${esc(g.note)}</div>`;
    if (window.EFFORT_GUIDE_DATE) h += `<div class="note muted">고를 수 있는 등급·API 값·기본 등급은 6시간마다 자동 갱신 · 앱 메뉴 이름(참고)은 ${esc(window.EFFORT_GUIDE_DATE)} 기준</div>`;
    h += `</div>`;

    h += `<div class="dcol"><div class="sect">기관별 점수 <b>${esc(v.eff)}</b></div>`;
    for (const p of v.parts) {
      const pct = Math.max(2, Math.min(100, ((p.m - 130) / 45) * 100));
      const detail = p.est ? `다른 등급(${esc(effLabel(m, p.est))}) 값에서 추정` : p.s === "epoch" ? `벤치마크 ${p.n}개로 계산` : `지능 지수 ${(+p.raw).toFixed(1)}`;
      h += `<div class="srcbar"><span>${esc(srcName(p.s))}</span><div class="track"><div class="fill${p.est ? " est" : ""}" style="width:${pct}%"></div></div><span class="val">${p.m.toFixed(1)}</span></div><div class="srcnote">${detail}</div>`;
    }
    if (v.disagree != null) h += `<div class="note">두 기관 차이 <b>${v.disagree.toFixed(1)}점</b> — ${v.disagree > 6 ? "평가가 꽤 달라요" : v.disagree > 3 ? "약간 달라요" : "대체로 일치해요"}</div>`;
    h += `<div class="note">맞힌 문제당 ${fmtCost(v.costOk)} (난이도 ${esc(diff().label)} · 정답률 ${Math.round(v.acc * 100)}%)</div>`;
    if (v.costSrc && v.costSrc.length) h += `<div class="note">비용 측정 출처: ${v.costSrc.map(esc).join(", ")}</div>`;
    if (m.price && m.price.id) h += `<div class="note">모델 ID: ${esc(m.price.id)}</div>`;
    h += `</div></div></div></div>`;
    el.innerHTML = h;
    $("#closeDetail").onclick = () => { S.selected = null; save(); renderDetail(); renderPinBar(); };
    el.querySelectorAll("tr.eff-row").forEach((tr) => { tr.onclick = () => { S.selEffort = tr.dataset.e; save(); renderDetail(); }; });
  }

  // ═════════ 조절 막대 ═════════
  // 알약 버튼: 선택 표시(thumb)가 미끄러지듯 이동
  function initSeg(id, prop, parse) {
    const seg = $("#" + id);
    const thumb = document.createElement("span");
    thumb.className = "thumb";
    seg.prepend(thumb);
    seg.querySelectorAll("button").forEach((b) => { b.onclick = () => { S[prop] = parse(b.dataset.v); save(); render(); }; });
  }
  function moveThumb(seg) {
    const on = seg.querySelector("button.on"), th = seg.querySelector(".thumb");
    if (!th) return;
    if (!on) { th.style.width = "0"; return; }
    th.style.width = on.offsetWidth + "px";
    th.style.transform = `translateX(${on.offsetLeft}px)`;
  }
  const syncSegs = () => $$(".seg").forEach(moveThumb);
  initSeg("xAxisSeg", "x", (v) => v);
  initSeg("periodSeg", "period", (v) => +v);

  // 드롭다운 메뉴
  function bindMenu(id) {
    const menu = $("#" + id);
    const btn = menu.querySelector(".menu-btn");
    btn.setAttribute("aria-expanded", "false");
    btn.onclick = (e) => {
      e.stopPropagation();
      const was = menu.classList.contains("open");
      closeMenus();
      if (!was) { menu.classList.add("open"); btn.setAttribute("aria-expanded", "true"); }
    };
    menu.querySelector(".menu-pop").addEventListener("click", (e) => e.stopPropagation());
  }
  function closeMenus() {
    $$(".menu.open").forEach((m) => { m.classList.remove("open"); m.querySelector(".menu-btn").setAttribute("aria-expanded", "false"); });
  }
  document.addEventListener("click", closeMenus);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const t = e.target;
    if (t && t.matches && t.matches(".vt-row, #table tbody tr, #table th, .pin, .dt tr.eff-row")) { e.preventDefault(); t.click(); }
  });
  bindMenu("perCoMenu");
  bindMenu("viewMenu");
  const perCoPop = $("#perCoMenu .menu-pop");
  for (const n of PER_CO_OPTIONS) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "menu-item"; b.dataset.v = n;
    b.textContent = n ? `회사마다 ${n}개` : "전부";
    b.onclick = () => { S.perCo = n; save(); $("#perCoMenu").classList.remove("open"); render(); };
    perCoPop.append(b);
  }
  const opts = { optFrontier: "frontier", optLabels: "labels", optEstimated: "estimated", optSelectable: "selectableOnly", optBestOnly: "bestOnly", optPinnedOnly: "pinnedOnly" };
  for (const [id, prop] of Object.entries(opts)) $("#" + id).onchange = (e) => { S[prop] = e.target.checked; save(); render(); };
  let searchTimer;
  $("#search").value = S.search;
  $("#search").oninput = (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { S.search = e.target.value; save(); render(); }, 180); };

  function syncControls() {
    const on = (id, v) => $$(`#${id} button`).forEach((b) => { b.classList.toggle("on", b.dataset.v === String(v)); b.setAttribute("aria-pressed", String(b.dataset.v === String(v))); });
    on("xAxisSeg", S.x); on("periodSeg", S.period);
    $("#perCoText").textContent = S.perCo ? `${S.perCo}개` : "전부";
    $$("#perCoMenu .menu-item").forEach((b) => b.classList.toggle("on", +b.dataset.v === S.perCo));
    for (const [id, prop] of Object.entries(opts)) $("#" + id).checked = !!S[prop];
    requestAnimationFrame(syncSegs);
    setTimeout(syncSegs, 60);   // 화면 그리기 신호가 늦는 환경에서도 선택 표시가 따라가게
  }

  // 조절 막대가 위에 붙으면 아래 선 표시
  const dock = $("#dock");
  const onScroll = () => dock.classList.toggle("stuck", dock.getBoundingClientRect().top <= 61 && window.scrollY > 40);
  window.addEventListener("scroll", onScroll, { passive: true });

  // ───────── 그래프 도구 버튼
  $("#resetZoom").onclick = () => resetView();
  $("#zoomIn").onclick = () => zoomCenter(0.7);
  $("#zoomOut").onclick = () => { if (VIEWBOX) zoomCenter(1 / 0.7); };
  // 휴대폰: 크게 보기를 누르면 전체 화면 + 자동으로 가로 회전 (안드로이드 크롬·설치한 앱)
  //  · 아이폰 사파리는 브라우저가 회전 고정을 막아서, 세로일 때 "가로로 돌려 주세요" 안내만 띄움
  const IS_PHONE = matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) <= 600;
  async function phoneLandscape(on) {
    if (!IS_PHONE) return;
    const ori = screen.orientation;
    try {
      if (on) {
        const root = document.documentElement;
        // 브라우저가 대답이 없을 때 무한정 기다리지 않도록 1.5초 제한
        const limit = (p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error("시간 초과")), 1500))]);
        if (!document.fullscreenElement && root.requestFullscreen) await limit(root.requestFullscreen({ navigationUI: "hide" }));
        if (!ori || !ori.lock) throw new Error("회전 고정 안 됨");
        await limit(ori.lock("landscape"));
      } else {
        if (ori && ori.unlock) ori.unlock();
        if (document.fullscreenElement) await document.exitFullscreen();
      }
    } catch (e) {
      if (on && chartBox.classList.contains("full") && matchMedia("(orientation: portrait)").matches)
        showToast("휴대폰을 가로로 돌리면 더 넓게 보여요");
    }
  }
  // 안드로이드 뒤로 가기 등으로 전체 화면이 풀리면 크게 보기도 같이 닫음
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && chartBox.classList.contains("full")) setFull(false);
  });
  function setFull(on, fromPop) {
    chartBox.classList.toggle("full", on);
    phoneLandscape(on);
    document.body.classList.toggle("no-scroll", on);
    fitChartHeight();   // 크게 보기에선 높이 지정을 풀고, 닫으면 다시 화면에 맞춤
    $("#fullText").textContent = on ? "닫기" : "크게 보기";
    setZoomOn(on);
    if (on && !fromPop) history.pushState({ full: 1 }, "");
    if (!on && !fromPop && history.state && history.state.full) history.back();
    setTimeout(() => { chart.resize(); if (VIEW) renderChart(VIEW.list, VIEW.points); }, 60);
  }
  $("#fullBtn").onclick = () => setFull(!chartBox.classList.contains("full"));
  window.addEventListener("popstate", () => { if (chartBox.classList.contains("full")) setFull(false, true); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closeMenus();
    if (chartBox.classList.contains("full")) setFull(false);
    else setZoomOn(false);
  });
  $("#themeBtn").onclick = () => {
    const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    S.theme = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = S.theme;
    document.querySelector('meta[name="theme-color"]').content = S.theme === "light" ? "#f5f4f0" : "#0b0b0c";
    colorCache = {}; save(); render();
  };
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { if (!S.theme) render(); });

  // ───────── 머리글·바닥글
  const HOSTED = location.protocol === "https:" && !/^(localhost|127\.)/.test(location.hostname);
  const genTs = new Date(String(D.generated || "").replace(" ", "T")).getTime() || Date.now();
  function renderStatus() {
    const ageH = (Date.now() - genTs) / 3600000;
    $("#status").innerHTML = `<span class="live${ageH > 12 ? " old" : ""}"></span><span><b>${ago(genTs)}</b><span class="st-x"> 갱신${HOSTED ? " · 6시간마다 자동" : ""}</span></span>`;
    $("#status").title = "마지막 갱신 " + D.generated;
  }
  renderStatus();
  setInterval(renderStatus, 60000);
  try {
  (function healthNotice() {
    const H = D.health || {};
    const failed = (H.failed || []).filter((x) => x !== "OpenRouter");
    if (!H.using_previous && failed.length) {   // 7일 넘게 못 받아 받을 수 있는 기관만으로 계산한 경우
      notice(`${esc(failed.join(", "))} 데이터를 오래 받지 못해, 받을 수 있는 기관만으로 계산했어요. 일부 모델·등급이 빠질 수 있어요. 다시 받아지면 자동으로 돌아와요.`);
      return;
    }
    if (!H.using_previous) return;
    const age = (Date.now() - new Date(String(D.generated).replace(" ", "T") + ":00+09:00").getTime()) / 36e5;
    if (!(age > 12)) return;
    notice(`${esc((H.failed || ["일부 기관"]).join(", "))} 데이터를 새로 받지 못해 <b>${esc(D.generated)}</b> 기준 정상 데이터를 보여 주고 있어요. 6시간마다 자동으로 다시 시도해요.`);
  })();
  } catch (e) { /* 이 부분이 실패해도 나머지 화면은 그대로 */ }
  // 믿을 만한 정도: 두 기관이 같은 등급을 쟀을 때 점수가 얼마나 비슷한지 (보정 없이 원래 값 그대로)
  try {
  (function eyebrow() {
    const dis = computeAll().flatMap((M) => M.vs).map((v) => v.disagree).filter((x) => x != null).sort((a, b) => a - b);
    const med = dis.length ? dis[Math.floor(dis.length / 2)] : null;
    const r = D.sources.aa && D.sources.aa.fit && D.sources.aa.fit.r;
    const el = $("#eyebrow");
    el.textContent = `Epoch AI · Artificial Analysis 점수 합산` + (med != null ? ` · 두 기관 차이 보통 ${med.toFixed(1)}점` : "") + ` · 모델 ${D.models.length}개`;
    if (med != null) el.title = `두 기관이 모두 잰 등급 ${dis.length}개에서, 두 점수 차이의 중앙값이 ${med.toFixed(1)}점입니다.` + (r ? ` 점수 상관 ${r.toFixed(2)} (1 에 가까울수록 두 기관이 같은 순서로 평가).` : "") + ` 작을수록 믿을 만합니다.`;
  })();
  } catch (e) { /* 이 부분이 실패해도 나머지 화면은 그대로 */ }
  try {
  (function footer() {
    const src = SRC_ORDER.filter((s) => D.sources[s] && D.sources[s].ok).map((s) => {
      const I = D.sources[s];
      return `<div class="src"><b><a href="${esc(I.url)}" target="_blank" rel="noopener">${esc(I.name)}</a></b> — ${esc(I.desc)} <span class="muted">(${esc(I.updated || "")})</span></div>`;
    }).join("");
    $("#foot").innerHTML = `<div class="srcs">${src}</div><div>가격: <a href="https://openrouter.ai/models" target="_blank" rel="noopener">OpenRouter</a> · 비용 기록: LiveBench·DeepSWE·CursorBench·ARC-AGI 등</div>` +
      `<div class="fine">Epoch AI 데이터는 CC-BY 4.0 (Epoch AI, "Capabilities & benchmarking", epoch.ai). 지능 지수 출처: Artificial Analysis (artificialanalysis.ai). ` +
      `이 페이지의 점수는 두 기관의 공개 결과를 자체 방식으로 합친 것이며 기관의 공식 순위가 아닙니다. 마지막 갱신 ${esc(D.generated)}</div>`;
  })();
  } catch (e) { /* 이 부분이 실패해도 나머지 화면은 그대로 */ }

  // ───────── 알림
  function notice(html, kind, action) {
    const el = $("#notice");
    if (!html) { el.hidden = true; return; }
    el.className = "notice" + (kind === "err" ? " err" : "");
    el.innerHTML = `<span>${html}</span>`;
    if (action) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "btn"; b.textContent = action.label; b.onclick = action.fn;
      el.append(b);
    }
    el.hidden = false;
  }

  // ───────── 최신 데이터 받기 (이 컴퓨터의 도우미 server.py 가 켜져 있을 때만)
  const refreshBtn = $("#refreshBtn");
  if (HOSTED) refreshBtn.hidden = true;
  let helperOk = false;
  async function api(path, timeoutMs) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs || 5000);
    try {
      const r = await fetch(path, { cache: "no-store", signal: ctl.signal });
      return r.ok ? await r.json() : null;
    } catch (e) { return null; } finally { clearTimeout(t); }
  }
  async function checkHelper() {
    const r = location.protocol.startsWith("http") ? await api("api/ping", 2500) : null;
    helperOk = !!(r && r.app === "ai-compare");
    refreshBtn.title = helperOk ? "여러 기관에서 최신 점수·가격을 지금 받아옵니다 (10~30초)" : "이 기능은 '성능비교판_열기'로 열었을 때만 동작합니다";
    return helperOk;
  }
  const refreshLabel = refreshBtn.querySelector("span");
  async function refreshNow(force) {
    if (!helperOk && !(await checkHelper())) {
      notice("이 창은 파일로 직접 열려 있어서 데이터를 받을 수 없어요. 창을 닫고 <b>성능비교판_열기</b>로 다시 열어주세요.", "err", { label: "닫기", fn: () => notice(null) });
      return;
    }
    refreshBtn.disabled = true; refreshBtn.classList.add("busy"); refreshLabel.textContent = "받는 중…";
    notice(null);
    const r = await api("api/refresh" + (force ? "?force=1" : ""), 240000);
    refreshBtn.disabled = false; refreshBtn.classList.remove("busy"); refreshLabel.textContent = "최신 데이터 받기";
    if (!r) notice("데이터를 받지 못했어요. 인터넷 연결을 확인하고 다시 눌러주세요.", "err", { label: "닫기", fn: () => notice(null) });
    else if (r.busy) notice("이미 받는 중이에요. 잠시 뒤에 다시 눌러주세요.", "", { label: "닫기", fn: () => notice(null) });
    else if (r.changed) location.reload();
    else { notice("이미 최신이에요. 각 기관에서 새로 올라온 점수가 없어요.", "", { label: "닫기", fn: () => notice(null) }); setTimeout(() => notice(null), 5000); }
  }
  refreshBtn.onclick = () => refreshNow(true);

  // ───────── 앱으로 설치 (안드로이드 크롬 등)
  if (HOSTED && "serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  let installEvt = null;
  const installBtn = $("#installBtn");
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; installBtn.hidden = false; });
  installBtn.onclick = async () => {
    if (!installEvt) return;
    installEvt.prompt();
    await installEvt.userChoice.catch(() => null);
    installEvt = null; installBtn.hidden = true;
  };
  window.addEventListener("appinstalled", () => { installBtn.hidden = true; });
  if (HOSTED && /KAKAOTALK|NAVER|Instagram|FBAN|FBAV|Line\//i.test(navigator.userAgent) && /Android/i.test(navigator.userAgent)) {
    const chromeUrl = "intent://" + location.href.replace(/^https?:\/\//, "") + "#Intent;scheme=https;package=com.android.chrome;end";
    notice("앱으로 설치하려면 <b>크롬</b>에서 열어야 해요.", "", { label: "크롬으로 열기", fn: () => { location.href = chromeUrl; } });
  }
  (HOSTED ? Promise.resolve(false) : checkHelper()).then((ok) => {
    if (!ok) return;
    setInterval(() => api("api/ping", 3000), 60000);   // 창이 열려 있다고 도우미에게 알림
    setInterval(async () => {                          // 1시간마다 조용히 확인 → 알림만
      const r = await api("api/refresh", 240000);
      if (r && r.changed) notice("새 데이터가 들어왔어요.", "", { label: "반영하기", fn: () => location.reload() });
    }, 3600000);
  });

  $("#resetSettings").onclick = () => resetSettings();
  pickCompanies(computeAll());
  render();
  fitChartHeight();
  // 글꼴이 늦게 들어오면 알약 버튼 폭이 바뀌므로 한 번 더 맞춤
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { syncSegs(); fitChartHeight(); });
})();
