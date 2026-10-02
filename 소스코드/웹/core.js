// AI 모델 성능비교판 — 계산 모음 (화면과 상관없는 순수 계산)
//  · 브라우저에서는 window.AICore, 시험(node)에서는 require 로 씀
//  · 같은 입력이면 항상 같은 결과 (화면·저장소·현재 시각을 직접 건드리지 않음 — 시각은 인자로 받음) → 시험하기 쉬움
//  · 데이터가 망가져 있어도 예외 대신 빈 값·'—' 를 돌려줌 (화면 전체가 멈추지 않게)
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  else /** @type {any} */ (root).AICore = api;
})(globalThis, function () {
  "use strict";

  /**
   * @typedef {{m: number, var: number, raw: number|null, n: number|null, name?: string, est?: string}} Src
   * @typedef {{effort: string, src: Record<string, Src>, cost: number|null, cost_kind: string|null, cost_src: string[]}} Variant
   * @typedef {{in: number, out: number, id: string|null}} Price
   * @typedef {{key: string, name: string, company: string, date: string|null, variants: Variant[], price: Price|null,
   *   efforts_supported: string[]|null, effort_default_or: string|null, reasoning_mandatory: boolean|null, eci: number|null}} Model
   * @typedef {{generated: string, sources: Record<string, any>, models: Model[], effort_order: string[], health: Record<string, any>,
   *   cost_sources: Record<string, any>, effort_ladder: Record<string, number>}} Data
   * @typedef {{key: string, x: number, score: number, se: number}} FPoint
   * @typedef {{param?: string, paramFull?: string, value?: Record<string, string>, apps?: any[], none?: string, onOff?: boolean, note?: string}} Guide
   */

  const EFFORT_ORDER = ["none", "minimal", "low", "medium", "default", "thinking", "high", "xhigh", "max", "promax", "ultra"];
  const EXPLICIT_EFF = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
  const COST_KINDS = ["측정", "등급 환산", "가격 추정"];

  /** 데이터가 화면을 그릴 수 없을 만큼 망가졌을 때 */
  class DataError extends Error {
    /** @param {string} msg */
    constructor(msg) { super(msg); this.name = "DataError"; }
  }

  /** 숫자로 바꾸기 — 숫자가 아니거나 무한대·NaN 이면 null
   * @param {unknown} x @returns {number|null} */
  function num(x) {
    if (typeof x === "number") return Number.isFinite(x) ? x : null;
    if (typeof x === "string" && x.trim() !== "") { const n = Number(x); return Number.isFinite(n) ? n : null; }
    return null;
  }
  /** @param {unknown} x @returns {x is Record<string, any>} */
  const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
  /** @param {unknown} x @returns {string} */
  const text = (x) => (typeof x === "string" ? x.trim() : "");

  /** 'YYYY-MM-DD' 로 시작하는 실제 날짜면 그 날짜, 아니면 null (2026-13-45 같은 것은 거름)
   * @param {unknown} s @returns {string|null} */
  function validDate(s) {
    if (typeof s !== "string") return null;
    const d = s.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
    const t = Date.parse(d + "T00:00:00Z");
    return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d ? d : null;
  }

  /**
   * 화면 데이터 정리 — 형식이 틀린 항목은 빼고, 빠진 값은 안전한 기본값으로
   * @param {unknown} raw
   * @returns {{data: Data, problems: string[]}}
   */
  function normalizeData(raw) {
    if (!isObj(raw)) throw new DataError("데이터 형식이 맞지 않아요");
    if (!Array.isArray(raw.models)) throw new DataError("모델 목록이 없어요");
    /** @type {string[]} */
    const problems = [];
    const order = Array.isArray(raw.effort_order) && raw.effort_order.length && raw.effort_order.every((/** @type {unknown} */ e) => typeof e === "string")
      ? raw.effort_order.slice() : EFFORT_ORDER.slice();
    /** @type {Record<string, any>} */
    const sources = {};
    if (isObj(raw.sources)) {
      for (const [s, x] of Object.entries(raw.sources)) {
        if (!isObj(x)) continue;
        sources[s] = { name: text(x.name) || s, url: /^https:\/\//.test(text(x.url)) ? text(x.url) : "", desc: text(x.desc), updated: text(x.updated),
          ok: x.ok === true, count: num(x.count) || 0, fit: isObj(x.fit) ? x.fit : null };
      }
    }
    /** @type {Model[]} */
    const models = [];
    const seen = new Set();
    let dropped = 0;
    for (const m of raw.models) {
      if (!isObj(m) || !text(m.key) || seen.has(text(m.key)) || !Array.isArray(m.variants)) { dropped++; continue; }
      /** @type {Variant[]} */
      const vs = [];
      for (const v of m.variants) {
        if (!isObj(v) || !text(v.effort)) continue;
        /** @type {Record<string, Src>} */
        const src = {};
        if (isObj(v.src)) {
          for (const [s, x] of Object.entries(v.src)) {
            if (!isObj(x)) continue;
            const mm = num(x.m), vv = num(x.var);
            if (mm == null || vv == null || vv <= 0 || mm < 0 || mm > 400) continue;   // 말이 안 되는 점수는 뺌
            src[s] = { m: mm, var: vv, raw: num(x.raw), n: num(x.n) };
            if (text(x.name)) src[s].name = text(x.name);
            if (text(x.est)) src[s].est = text(x.est);
          }
        }
        const c = num(v.cost);
        const cost = c != null && c > 0 ? c : null;
        vs.push({ effort: text(v.effort), src, cost,
          cost_kind: cost == null ? null : (COST_KINDS.includes(v.cost_kind) ? v.cost_kind : "가격 추정"),   // 종류를 모르면 가장 덜 믿는 쪽으로
          cost_src: cost != null && Array.isArray(v.cost_src) ? v.cost_src.filter((/** @type {unknown} */ x) => typeof x === "string") : [] });
      }
      const p = isObj(m.price) ? m.price : null;
      const pin = p ? num(p.in) : null, pout = p ? num(p.out) : null;
      const sup = Array.isArray(m.efforts_supported) ? m.efforts_supported.filter((/** @type {unknown} */ e) => typeof e === "string") : null;
      models.push({
        key: text(m.key), name: text(m.name) || text(m.key), company: text(m.company) || "기타", date: validDate(m.date), variants: vs,
        price: pin != null && pout != null && pin >= 0 && pout >= 0 ? { in: pin, out: pout, id: text(p && p.id) || null } : null,
        efforts_supported: sup && sup.length ? sup : null,
        effort_default_or: text(m.effort_default_or) || null,
        reasoning_mandatory: typeof m.reasoning_mandatory === "boolean" ? m.reasoning_mandatory : null,
        eci: num(m.eci),
      });
      seen.add(text(m.key));
    }
    if (dropped) problems.push(`형식이 맞지 않는 모델 ${dropped}개를 뺐어요`);
    return {
      data: { generated: text(raw.generated), sources, models, effort_order: order, health: isObj(raw.health) ? raw.health : {},
        cost_sources: isObj(raw.cost_sources) ? raw.cost_sources : {}, effort_ladder: isObj(raw.effort_ladder) ? raw.effort_ladder : {} },
      problems,
    };
  }

  /** 표시 이름이 같은 모델 구분: 출시월 → 그래도 같으면 키를 붙임 (데이터를 직접 고침)
   * @param {{name: string, date: string|null, key: string}[]} models */
  function uniqueNames(models) {
    /** @param {(m: {name: string}) => string} f @returns {Record<string, number>} */
    function count(f) {
      /** @type {Record<string, number>} */
      const c = {};
      for (const m of models) c[f(m)] = (c[f(m)] || 0) + 1;
      return c;
    }
    const c1 = count((m) => m.name);
    for (const m of models) if (c1[m.name] > 1) m.name = `${m.name} (${(m.date || "").slice(0, 7) || m.key})`;
    const c2 = count((m) => m.name);
    for (const m of models) if (c2[m.name] > 1) m.name = `${m.name.replace(/ \([^)]*\)$/, "")} (${m.key})`;
    return models;
  }

  /** 점 하나의 종합 점수: 두 기관 점수를 각자의 오차로 가중 평균 (실측이 하나도 없으면 null)
   * @param {Variant} v @param {string[]} srcOrder */
  function scoreVariant(v, srcOrder) {
    let sum = 0, den = 0;
    /** @type {number[]} */
    const real = [];
    /** @type {{s: string, m: number, est?: string, raw: number|null, n: number|null, name?: string}[]} */
    const parts = [];
    for (const s of srcOrder) {
      const x = v.src[s];
      if (!x) continue;
      const w = 1 / x.var;
      sum += x.m * w;
      den += w;
      parts.push({ s, m: x.m, est: x.est, raw: x.raw, n: x.n, name: x.name });
      if (!x.est) real.push(x.m);
    }
    if (!(den > 0) || !real.length) return null;
    const score = sum / den, se = Math.sqrt(1 / den);
    if (!Number.isFinite(score) || !Number.isFinite(se)) return null;
    return { score, se, parts, nReal: real.length, disagree: real.length >= 2 ? Math.max(...real) - Math.min(...real) : null };
  }

  // 정답률 → 맞힌 문제당 비용. 종합 점수는 Epoch 방식 능력치라 '난이도 D, 변별력 k' 시험의 예상 정답률을 바로 계산
  /** @type {Record<string, {D: number, k: number, label: string}>} */
  const DIFFICULTY = {
    easy: { D: 120, k: 0.10, label: "쉬움" },
    normal: { D: 140, k: 0.12, label: "보통" },
    hard: { D: 155, k: 0.12, label: "어려움" },
    vhard: { D: 165, k: 0.15, label: "매우 어려움" },
  };
  /** 예상 정답률 (0.5%~99.5% 로 자름 — 맞힌 문제당 비용이 무한대·0 으로 튀지 않게)
   * @param {number} score @param {{D: number, k: number}} d */
  function accuracy(score, d) {
    return Math.min(0.995, Math.max(0.005, 1 / (1 + Math.exp(-d.k * (score - d.D)))));
  }
  /** @param {number} a */
  function fmtAcc(a) {
    const p = a * 100;
    if (!Number.isFinite(p)) return "—";
    if (p < 1) return "1% 미만";
    if (p > 99) return "99% 초과";
    return Math.round(p) + "%";
  }

  /** 비용 표시: 작을수록 자릿수를 늘림 (반올림 뒤 자릿수가 넘치면 다음 칸으로 → '$0.0100' 같은 들쭉날쭉 없음)
   * @param {unknown} c */
  function fmtCost(c) {
    if (typeof c !== "number" || !Number.isFinite(c) || c <= 0) return "—";
    for (const [lim, dec] of [[0.001, 5], [0.01, 4], [1, 3], [100, 2]]) {
      const r = +c.toFixed(dec);
      if (r < lim) return "$" + r.toFixed(dec);
    }
    return "$" + Math.round(c);
  }
  /** 가격표(100만 토큰당) 표시: 1달러 미만은 유효숫자 2자리 ($0.0051 → $0.0051, 예전엔 $0.01)
   * @param {unknown} p */
  function fmtPrice(p) {
    if (typeof p !== "number" || !Number.isFinite(p) || p < 0) return "—";
    if (p === 0) return "$0";
    if (p < 1) return "$" + +p.toPrecision(2);
    if (p < 10) return "$" + +p.toFixed(2);
    return "$" + Math.round(p);
  }
  /** 가격표 원래 값 그대로 (자세히 보기용 — 반올림하지 않고 끝의 0 만 뺌: 13.5 → $13.5, 0.2574 → $0.2574) @param {unknown} p */
  function fmtPriceExact(p) {
    if (typeof p !== "number" || !Number.isFinite(p) || p < 0) return "—";
    return "$" + String(+p.toPrecision(6));
  }

  /** 'YYYY-MM-DD HH:MM' (한국 시간) → 밀리초, 해석 못 하면 NaN
   * @param {unknown} s */
  function parseKST(s) {
    const m = typeof s === "string" ? s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/) : null;
    if (!m) return NaN;
    const [y, mo, d, h, mi] = m.slice(1).map(Number);
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return NaN;
    return Date.UTC(y, mo - 1, d, h - 9, mi);
  }
  /** 몇 분/시간/일 전 @param {number} ts @param {number} now */
  function ago(ts, now) {
    if (!Number.isFinite(ts)) return "?";
    const min = Math.max(0, (now - ts) / 60000);
    if (min < 2) return "방금";
    if (min < 60) return Math.round(min) + "분 전";
    if (min < 60 * 24) return Math.round(min / 60) + "시간 전";
    return Math.round(min / 1440) + "일 전";
  }

  /** 기기 시간대의 날짜 'YYYY-MM-DD' @param {Date} d */
  function localDate(d) {
    const two = (/** @type {number} */ n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
  }
  /** n개월 전 날짜 (월말이면 그 달 마지막 날로 — 8월 31일의 6개월 전 = 2월 28일)
   * @param {number} n @param {Date} today */
  function monthsAgo(n, today) {
    const y = today.getFullYear(), m = today.getMonth() - n;
    const last = new Date(y, m + 1, 0).getDate();
    return localDate(new Date(y, m, Math.min(today.getDate(), last)));
  }
  /** 그 날짜부터 오늘까지 며칠 (날짜가 없거나 틀리면 무한대) @param {unknown} s @param {Date} today */
  function daysSince(s, today) {
    const d = validDate(s);
    if (!d) return Infinity;
    const [y, m, dd] = d.split("-").map(Number);
    const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    return Math.round((t0 - new Date(y, m - 1, dd).getTime()) / 864e5);
  }

  /** 두 색 섞기 (#rrggbb) — 해석 못 하면 첫 색 그대로 @param {string} a @param {string} b @param {number} t */
  function mixHex(a, b, t) {
    const p = (/** @type {string} */ h) => {
      let x = String(h).trim().replace("#", "");
      if (x.length === 3) x = x.replace(/./g, "$&$&");
      if (!/^[0-9a-f]{6}$/i.test(x)) return null;
      const n = parseInt(x, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const x = p(a), y = p(b);
    if (!x || !y) return a;
    return "#" + x.map((v, i) => Math.round(v * t + y[i] * (1 - t)).toString(16).padStart(2, "0")).join("");
  }
  /** HTML 글자 안전하게 @param {unknown} s */
  function esc(s) {
    /** @type {Record<string, string>} */
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => map[c]);
  }
  /** 점수 오차 → 신뢰도 @param {number} se */
  function confOf(se) {
    if (se <= 2.5) return { k: "hi", t: "높음" };
    if (se <= 4) return { k: "mid", t: "보통" };
    return { k: "lo", t: "낮음" };
  }
  /** a 가 b 보다 몇 % 싼지 (비교할 수 없으면 null, 99% 를 넘지 않음) @param {number|null} a @param {number|null} b */
  function savePct(a, b) {
    if (!(typeof a === "number" && typeof b === "number" && a > 0 && b > 0 && Number.isFinite(a) && Number.isFinite(b))) return null;
    return Math.min(99, Math.round((1 - a / b) * 100));
  }

  // ───────── 검색: 쉼표로 여러 개, 한글 이름도 (제미나이 → gemini). 단어 시작에서만 맞춤 (mini 가 gemini 에 맞지 않게)
  const KO_ALIAS = [
    ["챗지피티", "gpt"], ["지피티", "gpt"], ["제미나이", "gemini"], ["제미니", "gemini"], ["클로드", "claude"], ["그록", "grok"],
    ["딥시크", "deepseek"], ["큐웬", "qwen"], ["퀜", "qwen"], ["라마", "llama"], ["미스트랄", "mistral"], ["미니스트랄", "ministral"], ["키미", "kimi"],
    ["오퍼스", "opus"], ["소넷", "sonnet"], ["하이쿠", "haiku"], ["페이블", "fable"], ["플래시", "flash"], ["라이트", "lite"],
    ["아스트라", "astra"], ["루나", "luna"], ["테라", "terra"], ["솔라", "solar"], ["솔", "sol"], ["미니맥스", "minimax"], ["미니", "mini"], ["나노", "nano"],
    ["프로", "pro"], ["뮤즈", "muse"], ["스파크", "spark"], ["미모", "mimo"], ["샤오미", "xiaomi"], ["메타", "meta"], ["구글", "google"],
    ["오픈에이아이", "openai"], ["앤트로픽", "anthropic"], ["엔트로픽", "anthropic"], ["알리바바", "alibaba"], ["엔비디아", "nvidia"],
    ["지엘엠", "glm"], ["문샷", "moonshot"], ["아마존", "amazon"], ["노바", "nova"], ["코덱스", "codex"], ["젬마", "gemma"], ["네모트론", "nemotron"],
  ].sort((a, b) => b[0].length - a[0].length);   // 긴 별칭부터 (솔라 → solar 가 솔 → sol 보다 먼저)

  /** 검색창 글 → 검색어 목록 (글자·숫자가 하나도 없는 검색어는 버림)
   *  · 한글 별칭에서 바뀐 단어는 앞에 '=' 를 붙여 '단어 전체'로만 맞춤 (솔 → sol 이 Solar 에 맞지 않게)
   *  · 별칭 바로 뒤에 숫자·영문이 붙으면 영어로 붙여 쓴 것과 똑같이 (지피티5 = gpt5, 지피티-5 = gpt-5 → GPT-4.5 는 안 나옴)
   * @param {unknown} q */
  function searchTerms(q) {
    return String(q == null ? "" : q).split(/[,，、;]/).map((t) => {
      let r = t.trim().toLowerCase();
      for (const [ko, en] of KO_ALIAS) r = r.replace(new RegExp(ko + "(?=[-_.]?[0-9a-z])", "g"), " " + en).split(ko).join(" =" + en + " ");
      return r.replace(/\s+/g, " ").trim();
    }).filter((t) => /[a-z0-9가-힣]/.test(t));
  }
  /** 글자 종류: 영문 a · 숫자 d · 한글 k · 그 밖(구분자) "" @param {string} ch */
  const kind = (ch) => (/[a-z]/.test(ch) ? "a" : /[0-9]/.test(ch) ? "d" : /[가-힣]/.test(ch) ? "k" : "");
  /** 검색용으로 미리 만든 글: 구분자를 뺀 글자열 + 글자마다 '단어 시작인지'
   * @param {string} s @returns {{c: string, starts: boolean[]}} */
  function makeHay(s) {
    let c = "", prev = "";
    /** @type {boolean[]} */
    const starts = [];
    for (const ch of String(s).toLowerCase()) {
      const k = kind(ch);
      if (!k) { prev = ""; continue; }
      starts.push(!prev || prev !== k);   // 구분자 뒤 · 글자↔숫자가 바뀌는 곳 = 단어 시작 (gpt5, k2)
      c += ch;
      prev = k;
    }
    return { c, starts };
  }
  /** 검색어 조각이 단어 시작 위치에 있는지 (whole = 단어 전체가 같아야 함)
   * @param {{c: string, starts: boolean[]}} hay @param {string} w @param {boolean} [whole] */
  function atWordStart(hay, w, whole) {
    if (!w) return false;
    for (let i = hay.c.indexOf(w); i >= 0; i = hay.c.indexOf(w, i + 1)) {
      const j = i + w.length;
      if (hay.starts[i] && (!whole || j === hay.c.length || hay.starts[j])) return true;
    }
    return false;
  }
  /** 모델이 검색어 중 하나에라도 맞는지
   * · 한 검색어 안의 띄어쓴 단어는 모두 들어 있어야 함 ("claude opus" → Claude Opus 만)
   * · 붙여 써도 됨 ("gpt5", "클로드오퍼스")
   * @param {{c: string, starts: boolean[]}} hay @param {string[]} terms */
  function matchSearch(hay, terms) {
    const compact = (/** @type {string} */ t) => makeHay(t).c;
    return terms.some((t) => {
      const words = t.split(" ").filter((w) => compact(w));
      if (words.length && words.every((w) => atWordStart(hay, compact(w), w.startsWith("=")))) return true;
      return !t.includes("=") && atWordStart(hay, compact(t));
    });
  }

  /**
   * 가성비 경계선: "나보다 싸면서 나보다 똑똑한 점이 하나도 없으면 경계선 위"
   * · 오차 범위 k = √2 × 점수 오차의 중앙값. 경계선 아래 k 안의 점 = '사실상 동급'
   * @template {FPoint} P
   * @param {P[]} pts
   */
  function frontier(pts) {
    const ok = pts.filter((p) => Number.isFinite(p.x) && p.x > 0 && Number.isFinite(p.score));
    /** @type {P[]} */
    const front = [];
    /** @type {Map<string, {st: string, gap: number}>} */
    const status = new Map();
    if (ok.length < 2) return { front, status, k: 0, levelAt: (/** @type {number} */ x) => (x > Infinity ? 0 : -Infinity) };
    const sorted = ok.slice().sort((a, b) => a.x - b.x || b.score - a.score);
    let best = -Infinity;
    for (const p of sorted) if (p.score > best + 1e-9) { front.push(p); best = p.score; }
    /** 그 비용까지 쓸 때 얻을 수 있는 최고 점수 (계단 모양) @param {number} x */
    const levelAt = (x) => { let lv = -Infinity; for (const f of front) { if (f.x <= x * (1 + 1e-9)) lv = f.score; else break; } return lv; };
    const ses = ok.map((p) => p.se).filter(Number.isFinite).sort((a, b) => a - b);
    const k = ses.length ? Math.round(Math.SQRT2 * ses[Math.floor(ses.length / 2)] * 10) / 10 : 0;
    for (const f of front) status.set(f.key, { st: "front", gap: 0 });
    for (const p of ok) {
      if (status.has(p.key)) continue;
      const gap = levelAt(p.x) - p.score;
      status.set(p.key, { st: gap <= k ? "near" : "below", gap });
    }
    return { front, status, k, levelAt };
  }

  /**
   * 오늘의 답 (최고 성능 · 가성비 추천)
   * · 최고 성능 1~3위: 점수 높은 순
   * · 가성비 1위: 최고 성능과 실력 차이가 오차 범위(√(오차₁²+오차₂²)) 안인 것 중 가장 싼 것.
   *   비용 차이가 10%(sameCost) 안이면 '사실상 같은 값'으로 보고 그중 점수가 높은 것
   * · 가성비 2·3위: 그래프와 같은 경계선(front)을 따라 바로 앞 추천보다 10% 이상 싼 것
   * @template {FPoint & {model: unknown}} P
   * @param {P[]} cand 후보 점 (x = 지금 가로축 비용)
   * @param {P[]} front 같은 후보로 만든 가성비 경계선
   * @param {number} [sameCost]
   */
  function picks(cand, front, sameCost = 1.1) {
    const all = cand.filter((p) => Number.isFinite(p.x) && p.x > 0 && Number.isFinite(p.score) && Number.isFinite(p.se));
    if (!all.length) return null;
    const byScore = all.slice().sort((a, b) => b.score - a.score || a.x - b.x);
    const top = byScore[0];
    const rival = byScore.find((p) => p.model !== top.model) || null;
    /** 두 점수를 비교할 때의 오차 범위 @param {P} p @param {P} [w] */
    const band = (p, w = top) => Math.sqrt(w.se ** 2 + p.se ** 2);
    const near = all.filter((p) => top.score - p.score <= band(p)).sort((a, b) => a.x - b.x || b.score - a.score);
    const cheapest = near[0];
    const value = near.filter((p) => p.x <= cheapest.x * sameCost).sort((a, b) => b.score - a.score || a.x - b.x)[0];
    /** @type {P[]} */
    const below = [];
    let prev = value;
    for (const p of front.filter((f) => f.x < value.x && f.score < value.score).sort((a, b) => b.x - a.x)) {
      if (p.x * sameCost <= prev.x) { below.push(p); prev = p; }
      if (below.length >= 2) break;
    }
    const valueRows = [value, ...below];
    return {
      top, rival, band, near, value, valueRows,
      topRows: byScore.slice(0, 3),
      alt: valueRows.length > 1 ? valueRows[valueRows.length - 1] : null,
      // 확실성 비교 상대: 1위보다 비싼 쪽의 사실상 동급 후보 중 가장 싼 것
      next: near.find((p) => p !== value && p.x >= value.x) || null,
    };
  }

  /** 가성비 점수(0~100): 비용이 10배 늘 때 6점 오르면 같은 가성비 — 기준 목록의 최저~최고로 맞춤
   * @param {{score: number, cost: number}[]} base @param {number} [K] */
  function valueScaler(base, K = 6) {
    const raw = (/** @type {{score: number, cost: number}} */ v) => v.score - K * Math.log10(v.cost);
    const vals = base.filter((v) => v.cost > 0 && Number.isFinite(v.cost) && Number.isFinite(v.score)).map(raw);
    const lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 0;
    return (/** @type {{score: number, cost: number|null}} */ v) => (v.cost != null && v.cost > 0 && hi > lo
      ? Math.max(0, Math.min(100, Math.round(((v.score - K * Math.log10(v.cost)) - lo) / (hi - lo) * 100))) : null);
  }

  /** 확대 범위를 전체 범위 안으로 (로그 축) — 전체와 같으면 null
   * @param {{x0: number, x1: number, y0: number, y1: number}|null} v
   * @param {{x0: number, x1: number, y0: number, y1: number}|null} full
   * @param {{x: number, y: number}} [minSpan] */
  function clampView(v, full, minSpan = { x: 0.12, y: 1.5 }) {
    if (!v || !full) return null;
    const vals = [v.x0, v.x1, v.y0, v.y1, full.x0, full.x1, full.y0, full.y1];
    if (!vals.every(Number.isFinite) || v.x0 <= 0 || v.x1 <= 0 || full.x0 <= 0 || full.x1 <= 0) return null;
    const fit = (/** @type {number} */ lo, /** @type {number} */ hi, /** @type {number} */ flo, /** @type {number} */ fhi, /** @type {number} */ min) => {
      let w = hi - lo;
      if (w >= fhi - flo) return [flo, fhi];
      if (w < min) { const m = (lo + hi) / 2; lo = m - min / 2; hi = m + min / 2; w = min; }
      if (lo < flo) { hi += flo - lo; lo = flo; }
      if (hi > fhi) { lo -= hi - fhi; hi = fhi; }
      return [lo, hi];
    };
    const [a, b] = fit(Math.log10(v.x0), Math.log10(v.x1), Math.log10(full.x0), Math.log10(full.x1), minSpan.x);
    const [c, d] = fit(v.y0, v.y1, full.y0, full.y1, minSpan.y);
    const same = Math.abs(a - Math.log10(full.x0)) < 1e-9 && Math.abs(b - Math.log10(full.x1)) < 1e-9 && Math.abs(c - full.y0) < 1e-9 && Math.abs(d - full.y1) < 1e-9;
    return same ? null : { x0: 10 ** a, x1: 10 ** b, y0: c, y1: d };
  }
  /** 로그 축 눈금: 보이는 범위에 맞춰 읽기 좋은 값만 (최대 40개 — 이상한 범위에서도 끝없이 돌지 않게)
   * @param {number} x0 @param {number} x1 */
  function logTicks(x0, x1) {
    /** @type {number[]} */
    const vals = [];
    if (!(x0 > 0 && x1 > x0 && Number.isFinite(x0) && Number.isFinite(x1))) return vals;
    const a = Math.log10(x0), b = Math.log10(x1), span = b - a;
    if (span > 0.6) {
      const mult = span > 4.5 ? [1] : span > 1.5 ? [1, 3] : [1, 2, 5];
      for (let k = Math.floor(a) - 1; k <= Math.ceil(b) + 1 && vals.length < 40; k++) {
        for (const m of mult) {
          const v = m * 10 ** k;
          if (v >= x0 * 0.999 && v <= x1 * 1.001) vals.push(+v.toPrecision(3));
        }
      }
    } else {
      const raw = (x1 - x0) / 5;
      const p = 10 ** Math.floor(Math.log10(raw));
      const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) || 10 * p;
      for (let v = Math.ceil(x0 / step) * step; v <= x1 * 1.0001 && vals.length < 40; v += step) vals.push(+v.toPrecision(4));
    }
    return vals;
  }

  /** 등급 순서대로 정렬. 처음 보는 등급(회사가 새로 만든 것)은 비용으로 자리를 찾음 (생각을 많이 할수록 비쌈)
   * @template {{effort: string, cost: number|null}} V
   * @param {V[]} vs @param {(e: string) => number} effIdx */
  function sortEfforts(vs, effIdx) {
    const known = vs.filter((v) => effIdx(v.effort) < 99).sort((a, b) => effIdx(a.effort) - effIdx(b.effort));
    for (const u of vs.filter((v) => effIdx(v.effort) >= 99)) {
      let at = known.length;
      if (u.cost != null) { const i = known.findIndex((k) => k.cost != null && /** @type {number} */ (k.cost) > /** @type {number} */ (u.cost)); if (i >= 0) at = i; }
      known.splice(at, 0, u);
    }
    vs.splice(0, vs.length, ...known);
    return vs;
  }

  /** 화면에 보이는 등급 이름 = 그 회사에서 실제로 고르는 값 (예: max, xhigh, high)
   * @param {Guide|undefined} g @param {string} e */
  function effLabel(g, e) {
    if (e === "none") return g && g.value && g.value.none ? g.value.none : "생각 끔";
    if (g && g.value && g.value[e]) return g.value[e];
    if (e === "default") return "기본";
    if (e === "thinking") return "생각 켬";
    return e;   // 공식 단계가 없는 회사: 평가기관이 붙인 이름 그대로
  }

  /** 이 등급을 실제 AI 에서 사용자가 고를 수 있는지 (근거: OpenRouter 의 모델별 공식 정보 + 회사 공식 등급표)
   *  · 생각 끔(none): '생각 필수' 모델이면 못 고름 (공식 등급 목록에 none 이 있으면 고를 수 있음)
   *  · low~max: 공식 등급 목록에 있어야 함. 단 OpenRouter 가 회사와 다른 이름을 쓰는 경우(예: DeepSeek 을 xhigh 로 적음)는 회사 공식 등급표를 믿음
   *  · 근거 정보가 없는 모델은 판단하지 않고 그대로 둠 (잘못 숨기지 않게)
   * @param {{efforts_supported: string[]|null, reasoning_mandatory: boolean|null}} m @param {string} e @param {Guide|undefined} g */
  function canSelect(m, e, g) {
    const sup = m.efforts_supported;
    if (e === "none") {
      if (sup && sup.includes("none")) return true;
      return m.reasoning_mandatory !== true;
    }
    if (!sup || !sup.length || !EXPLICIT_EFF.includes(e)) return true;
    if (sup.includes(e)) return true;
    const vals = g && g.value ? Object.keys(g.value) : [];
    return vals.includes(e) && sup.some((x) => !vals.includes(x));
  }

  /** 기본 등급: 공식 문서에 적어 둔 값(EFFORT_DEFAULTS)이 먼저, 없으면 OpenRouter 값
   * @param {{key: string, effort_default_or: string|null}} m @param {Record<string, string>} edef */
  function defaultEffort(m, edef) { return (edef && edef[m.key]) || m.effort_default_or || null; }

  /** 선택한 등급을 실제로 설정하는 방법 (여러 줄)
   * @param {{key: string, efforts_supported: string[]|null, reasoning_mandatory: boolean|null}} m @param {string} e @param {Guide|undefined} g */
  function howToSet(m, e, g) {
    /** @type {{k: string, v: string, code?: boolean}[]} */
    const out = [];
    if (!canSelect(m, e, g)) {
      out.push({ k: "주의", v: `이 모델은 '${effLabel(g, e)}' 등급을 직접 고를 수 없어요. 평가기관이 별도 조건으로 측정한 값이라 참고용으로만 보세요.` });
      return out;
    }
    const sup = m.efforts_supported || [];
    if (e === "default") out.push({ k: "API", v: "따로 설정하지 않음 (기본값)" });
    else if (!g) {
      if (sup.includes(e)) out.push({ k: "API", v: `reasoning effort = "${e}" (OpenRouter 공식 목록 기준)`, code: true });
      else if (e === "thinking") out.push({ k: "API", v: "생각(추론) 켜기 — 단계는 따로 정하지 않은 상태로 평가됨" });
      else if (e === "none") out.push({ k: "API", v: "생각(추론) 끄기" });
      else out.push({ k: "설정", v: `이 회사의 공식 등급 이름은 아직 정리돼 있지 않아요. 평가기관이 쓴 이름: ${e}` });
      return out;
    } else if (g.value && g.value[e]) out.push({ k: "API", v: `${g.param} = "${g.value[e]}"`, code: true });
    else if (sup.includes(e) && e !== "none") out.push({ k: "API", v: `${g.param} = "${e}"`, code: true });
    else if (e === "none" && g.none) out.push({ k: "API", v: g.none });
    else if (e === "none") out.push({ k: "API", v: "생각(추론) 끄기" });
    else if (e === "thinking") out.push({ k: "API", v: g.onOff ? "생각 켬 (기본)" : "생각(추론) 켜기 — 단계는 따로 정하지 않은 상태로 평가됨" });
    else if (g.onOff) out.push({ k: "API", v: `이 회사는 단계 설정이 없어요. '${e}'는 평가기관이 붙인 이름이고, 실제로는 생각 켜기만 하면 됩니다.` });
    else out.push({ k: "API", v: `이 모델은 '${e}' 등급을 직접 고를 수 없어요 (평가기관 조건).` });
    for (const a of (g && g.apps) || []) {
      if (a.only && !a.only.includes(m.key)) continue;
      // 앱 메뉴 이름은 자동으로 받아올 공식 자료가 없어 참고용
      if (a.labels && a.labels[e]) out.push({ k: a.name, v: `${a.how} → ${a.labels[e]}` });
      else if (a.note) out.push({ k: a.name, v: a.note });
    }
    return out;
  }

  /**
   * 회사 색 정하기: 최근 n개월 모델의 최고 점수가 높은 회사 상위 topN 곳 (모자라면 전체 기간으로 채움)
   * · 지난번에 받은 색 자리를 기억해 두었다가 그대로 줌 (순위가 바뀌어도 색이 뒤섞이지 않게)
   * @param {{company: string, date: string|null, best: {score: number}}[]} all @param {string} cutoff
   * @param {Record<string, number>} prev @param {number} topN @param {number} slots */
  function pickCompanies(all, cutoff, prev, topN, slots) {
    const bestOf = (/** @type {typeof all} */ list) => {
      /** @type {Record<string, number>} */
      const b = {};
      for (const M of list) if (M.company && M.company !== "기타" && !(b[M.company] >= M.best.score)) b[M.company] = M.best.score;
      return Object.entries(b).sort((x, y) => y[1] - x[1]).map(([co]) => co);
    };
    const top = bestOf(all.filter((M) => M.date && M.date >= cutoff)).slice(0, topN);
    for (const co of bestOf(all)) if (top.length < topN && !top.includes(co)) top.push(co);
    /** @type {Record<string, number>} */
    const slot = {};
    const used = new Set();
    for (const co of top) {
      const s = prev && typeof prev[co] === "number" ? prev[co] : null;
      if (s != null && s >= 0 && s < slots && !used.has(s)) { slot[co] = s; used.add(s); }
    }
    for (const co of top) {
      if (slot[co] != null) continue;
      let i = 0;
      while (used.has(i)) i++;
      slot[co] = i;
      used.add(i);
    }
    return { top, slot };
  }

  return {
    EFFORT_ORDER, DIFFICULTY, DataError, num, validDate, normalizeData, uniqueNames, scoreVariant, accuracy, fmtAcc, fmtCost, fmtPrice, fmtPriceExact,
    parseKST, ago, localDate, monthsAgo, daysSince, mixHex, esc, confOf, savePct, searchTerms, makeHay, matchSearch,
    frontier, picks, valueScaler, clampView, logTicks, sortEfforts, effLabel, canSelect, defaultEffort, howToSet, pickCompanies,
  };
});
