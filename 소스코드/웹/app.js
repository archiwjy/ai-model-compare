// AI 모델 성능비교판 — 화면 동작
// data.js(수집기가 만든 파일)의 window.MODEL_DATA 를 읽어 그래프·표를 그린다.
(function () {
  "use strict";

  const D = window.MODEL_DATA;
  if (!D) {
    document.body.innerHTML = '<p style="padding:40px;font-size:16px">data.js 가 없습니다. 먼저 <b>업데이트.bat</b> 을 실행하세요.</p>';
    return;
  }

  // ───────── 회사별 색·모양 (색은 회사를 따라감. 순위·필터로 바뀌지 않음)
  const COMPANY_STYLE = {
    Google: { c: "--c1", sym: "circle" },
    Anthropic: { c: "--c2", sym: "rect" },
    OpenAI: { c: "--c3", sym: "diamond" },
    xAI: { c: "--c4", sym: "triangle" },
    DeepSeek: { c: "--c7", sym: "pin" },
    Alibaba: { c: "--c6", sym: "roundRect" },
    Zhipu: { c: "--c5", sym: "circle" },
    Moonshot: { c: "--c8", sym: "rect" },
  };
  const OTHER = { c: "--c0", sym: "circle" };
  const MAIN_COMPANIES = Object.keys(COMPANY_STYLE);
  const styleOf = (co) => COMPANY_STYLE[co] || OTHER;
  const groupOf = (co) => (COMPANY_STYLE[co] ? co : "기타");

  const SRC_ORDER = ["epoch", "aa", "livebench", "arena"];
  const DEFAULT_WEIGHT = { epoch: 1, aa: 1, livebench: 1, arena: 0.5 };
  const EFF_ORDER = D.effort_order;
  const EFF_KO = D.effort_ko;
  const VALUE_K = 6; // 가성비: 비용 10배 = 6점

  // ───────── 설정 (바꾸면 바로 저장)
  const DEFAULTS = {
    x: "cost", period: 6, perCo: 3, difficulty: "normal", search: "", hidden: [], frontier: true, labels: true,
    estimated: true, budget: Math.log10(0.2), weight: DEFAULT_WEIGHT,
    enabled: { epoch: true, aa: true, livebench: true, arena: true }, bestOnly: false,
    sortK: "score", sortDir: -1, selected: null, theme: null, pinned: [], pinnedOnly: false,
  };
  let S = load();
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem("aiCompare.settings") || "{}");
      return Object.assign({}, DEFAULTS, s, {
        weight: Object.assign({}, DEFAULT_WEIGHT, s.weight || {}),
        enabled: Object.assign({}, DEFAULTS.enabled, s.enabled || {}),
      });
    } catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function save() {
    try { localStorage.setItem("aiCompare.settings", JSON.stringify(S)); } catch (e) { /* 저장 안 돼도 동작 */ }
  }
  if (![1, 2, 3, 5, 10, 15, 20, 25, 30, 0].includes(S.perCo)) S.perCo = 3;
  delete S.top;   // 예전 방식(전체 순위 몇 개) 설정은 버림
  if (S.theme) document.documentElement.dataset.theme = S.theme;

  // ───────── 도우미
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const colorOf = (co) => css(styleOf(co).c);
  function fmtCost(c) {
    if (c == null) return "—";
    if (c < 0.001) return "$" + c.toFixed(5);
    if (c < 0.01) return "$" + c.toFixed(4);
    if (c < 1) return "$" + c.toFixed(3);
    if (c < 100) return "$" + c.toFixed(2);
    return "$" + Math.round(c);
  }
  const fmtPrice = (p) => (p == null ? "—" : "$" + (p < 1 ? p.toFixed(2) : p < 10 ? p.toFixed(2).replace(/0$/, "") : Math.round(p)));
  const effIdx = (e) => { const i = EFF_ORDER.indexOf(e); return i < 0 ? 99 : i; };
  const today = new Date();
  function monthsAgo(n) { const d = new Date(today); d.setMonth(d.getMonth() - n); return d.toISOString().slice(0, 10); }
  function daysSince(s) { return s ? (today - new Date(s)) / 86400000 : 9999; }
  function confOf(se) {
    if (se <= 3) return { k: "hi", t: "높음" };
    if (se <= 4.5) return { k: "mid", t: "보통" };
    return { k: "lo", t: "낮음" };
  }
  function srcName(s) { return (D.sources[s] && D.sources[s].name) || s; }
  function blended(m) { return m.price ? (3 * m.price.in + m.price.out) / 4 : null; }

  // ───────── 회사별 추론 등급 공식 이름 (effort_guide.js)
  const EG = window.EFFORT_GUIDE || {};
  const EDEF = window.EFFORT_DEFAULTS || {};
  // 화면에 보이는 등급 이름 = 그 회사에서 실제로 고르는 값 (예: max, xhigh, high)
  function effLabel(m, e) {
    const g = EG[m.company];
    if (g && g.value && g.value[e]) return g.value[e];
    if (e === "default") return "기본값";
    if (e === "thinking") return "생각 켬";
    if (e === "none") return m.company === "OpenAI" ? "none" : "생각 끔";
    return e;   // 공식 단계가 없는 회사: 평가기관이 붙인 이름 그대로
  }
  // 이 모델의 기본 등급 (공식 문서 → 없으면 가격 사이트 정보)
  function defaultEffort(m) {
    return EDEF[m.key] || m.effort_default_or || null;
  }
  // 이 모델이 그 등급을 직접 고를 수 있는지 (가격 사이트의 지원 목록 기준, 모르면 true)
  const EXPLICIT_EFF = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
  function canSelect(m, e) {
    const sup = m.efforts_supported;
    if (!sup || !sup.length || !EXPLICIT_EFF.includes(e)) return true;
    if (e === "none") return sup.includes("none");
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
    if (!g) {
      out.push({ k: "설정", v: `이 회사의 공식 등급 이름은 아직 정리돼 있지 않아요. 평가기관이 쓴 이름: ${e}` });
      return out;
    }
    if (g.value && g.value[e]) out.push({ k: "API", v: `${g.param} = "${g.value[e]}"`, code: true });
    else if (e === "none" && g.none) out.push({ k: "API", v: g.none });
    else if (e === "default") out.push({ k: "API", v: "따로 설정하지 않음 (기본값)" });
    else if (g.onOff && (e === "thinking" || e === "default")) out.push({ k: "API", v: "생각 켬 (기본)" });
    else if (g.onOff) out.push({ k: "API", v: `이 회사는 단계 설정이 없어요. '${e}'는 평가기관이 붙인 이름이고, 실제로는 생각 켜기만 하면 됩니다.` });
    else out.push({ k: "API", v: `이 모델은 '${e}' 등급을 직접 고를 수 없어요 (평가기관 조건).` });
    for (const a of g.apps || []) {
      if (a.only && !a.only.includes(m.key)) continue;
      if (a.labels && a.labels[e]) out.push({ k: a.name, v: `${a.how} → ${a.labels[e]}` });
      else if (a.note) out.push({ k: a.name, v: a.note });
    }
    return out;
  }

  // ───────── 정답률 → 맞힌 문제당 비용
  // 종합 점수는 Epoch 방식 능력치라서, '난이도 D, 변별력 k' 인 시험의 예상 정답률을 바로 계산할 수 있다.
  //   정답률 = 1 / (1 + e^(−k × (점수 − D)))       ← Epoch 가 벤치마크 점수를 설명할 때 쓰는 식과 같음
  // 난이도 값은 실제 벤치마크 난이도(Epoch 공개값)를 참고해 정함.
  const DIFFICULTY = {
    easy:  { D: 120, k: 0.10, label: "쉬움", ex: "간단한 질문·번역·요약 (MMLU·GSM8K 수준)" },
    normal:{ D: 140, k: 0.12, label: "보통", ex: "일반 업무·대학원 수준 문제 (GPQA·SWE-bench 수준)" },
    hard:  { D: 155, k: 0.12, label: "어려움", ex: "어려운 코딩·전문 분석 (ARC-AGI-2·GDPval 수준)" },
    vhard: { D: 165, k: 0.15, label: "매우 어려움", ex: "최고난도 연구·복잡한 에이전트 작업 (HLE·OSWorld 2 수준)" },
  };
  const diff = () => DIFFICULTY[S.difficulty] || DIFFICULTY.normal;
  function accuracyOf(score) {
    const d = diff();
    return Math.min(0.995, Math.max(0.005, 1 / (1 + Math.exp(-d.k * (score - d.D)))));
  }
  const isCostAxis = () => S.x === "cost" || S.x === "costok";
  // 지금 보고 있는 비용 기준 (문제당 / 맞힌 문제당)
  const costFor = (v) => (S.x === "costok" ? v.costOk : v.cost);
  const costUnit = () => (S.x === "costok" ? "맞힌 문제당" : "문제당");

  // ───────── 점수 계산 (출처 켜기/끄기, 비중에 따라 다시 계산)
  function computeAll() {
    const models = [];
    for (const m of D.models) {
      const vs = [];
      for (const v of m.variants) {
        let num = 0, den = 0;
        const real = [];
        const parts = [];
        for (const s of SRC_ORDER) {
          const x = v.src[s];
          if (!x || !S.enabled[s]) continue;
          const w = (S.weight[s] ?? 1) / x.var;
          if (w <= 0) continue;
          num += x.m * w; den += w;
          parts.push({ s, m: x.m, est: x.est, raw: x.raw, n: x.n, name: x.name, w });
          if (!x.est) real.push(x.m);
        }
        if (!den || !real.length) continue;
        const score = num / den;
        const se = Math.sqrt(1 / den);
        const disagree = real.length >= 2 ? Math.max(...real) - Math.min(...real) : null;
        vs.push({
          m, effort: v.effort, effortKo: v.effort_ko, eff: effLabel(m, v.effort), isDefault: defaultEffort(m) === v.effort,
          score, se, disagree,
          nReal: real.length, parts, cost: v.cost ?? null, costKind: v.cost_kind || null,
          costSrc: v.cost_src || [],
        });
      }
      if (!vs.length) continue;
      vs.sort((a, b) => effIdx(a.effort) - effIdx(b.effort));
      for (const v of vs) {
        v.acc = accuracyOf(v.score);
        v.costOk = v.cost != null && v.acc ? v.cost / v.acc : null;
      }
      const best = vs.reduce((a, b) => (b.score > a.score ? b : a));
      models.push({ m, key: m.key, name: m.name, company: m.company, date: m.date, vs, best });
    }
    return models;
  }

  // ───────── 필터 적용
  function applyFilters(all) {
    const cutoff = S.period ? monthsAgo(S.period) : null;
    const q = S.search.trim().toLowerCase();
    let list = all.filter((M) => {
      if (S.hidden.includes(groupOf(M.company))) return false;
      if (q) return (M.name + " " + M.key + " " + M.company).toLowerCase().includes(q);
      if (cutoff && (!M.date || M.date < cutoff)) return false;
      return true;
    });
    list.sort((a, b) => b.best.score - a.best.score);
    // 회사마다 점수 높은 순으로 N개씩 (0 = 전부)
    if (S.perCo && !q) {
      const cnt = {};
      list = list.filter((M) => (cnt[M.company] = (cnt[M.company] || 0) + 1) <= S.perCo);
    }
    // 고정한 모델은 기간·상위 몇 개·회사 필터와 상관없이 항상 보여준다
    for (const key of S.pinned) {
      if (!list.some((M) => M.key === key)) {
        const M = all.find((x) => x.key === key);
        if (M) list.push(M);
      }
    }
    return list;
  }

  function xOf(v) {
    if (isCostAxis()) {
      const c = costFor(v);
      if (c == null) return null;
      if (!S.estimated && v.costKind !== "측정") return null;
      return c;
    }
    if (S.x === "price") return blended(v.m);
    if (S.x === "date") return v.m.date ? v.m.date : null;
    return null;
  }

  // 가성비 경계선: 비용이 낮은 순으로 보면서 지금까지 최고 점수를 넘는 점만
  function frontierOf(points) {
    const pts = points.filter((p) => p.x != null && S.x !== "date").sort((a, b) => a.x - b.x || b.v.score - a.v.score);
    const out = [];
    let best = -Infinity;
    for (const p of pts) {
      if (p.v.score > best + 1e-9) { out.push(p); best = p.v.score; }
    }
    return out;
  }

  // ───────── 그리기
  const chart = echarts.init($("#chart"), null, { renderer: "canvas" });
  window.addEventListener("resize", () => chart.resize());
  let VIEW = null;

  function render() {
    const all = computeAll();
    const list = applyFilters(all);
    const points = [];
    for (const M of list) for (const v of M.vs) points.push({ M, v, x: xOf(v) });
    VIEW = { all, list, points };
    renderLegend(all);
    renderChart(list, points);
    renderPinBar();
    renderCards(points);
    renderTable(list);
    renderDetail();
    renderSources();
    syncControls();
  }

  function renderChart(list, points) {
    const txt = css("--text"), txt2 = css("--text-2"), muted = css("--muted"), grid = css("--grid"), axis = css("--axis"), surf = css("--surface");
    const series = [];
    const labelled = new Set(list.slice(0, S.labels ? 40 : 0).map((M) => M.key));
    const pinSet = new Set(S.pinned);
    const anyPin = pinSet.size > 0;
    for (const M of list) {
      const col = colorOf(M.company);
      const sym = styleOf(M.company).sym;
      const pinned = pinSet.has(M.key);
      const dim = anyPin && !pinned;
      const font = "Pretendard Variable, Malgun Gothic, sans-serif";
      const data = M.vs
        .map((v) => ({ v, x: xOf(v) }))
        .filter((p) => p.x != null)
        .map((p) => {
          const hollow = isCostAxis() && p.v.costKind === "가격 추정";
          const isTop = p.v === M.vs.filter((z) => xOf(z) != null).reduce((a, b) => (b.score > a.score ? b : a), { score: -1 });
          return {
            value: [p.x, +p.v.score.toFixed(2)],
            v: p.v,
            symbol: sym,
            symbolSize: (sym === "pin" ? 16 : sym === "triangle" ? 12 : 10) + (pinned ? 3 : 0),
            itemStyle: Object.assign(hollow ? { color: surf, borderColor: col, borderWidth: 2 } : { color: col, borderColor: surf, borderWidth: 1.5 }, { opacity: dim ? 0.18 : 1 }),
            label: pinned ? {
              // 고정한 모델: 모든 점에 등급, 가장 높은 점에는 이름까지
              show: true, position: "right", distance: 6,
              formatter: isTop ? `${M.name} · ${p.v.eff}` : p.v.eff,
              color: isTop ? txt : txt2, fontSize: isTop ? 12 : 10, fontWeight: isTop ? 700 : 400, fontFamily: font,
            } : isTop && labelled.has(M.key) && !dim ? {
              show: true, position: "right", distance: 6, formatter: M.name + (daysSince(M.date) <= 30 ? " ·NEW" : ""),
              color: txt2, fontSize: 11, fontFamily: font,
            } : { show: false },
            // 마우스를 올리면: 가장 높은 점에 모델 이름, 나머지 점에 등급 (흐려진 선도 진하게)
            emphasis: {
              itemStyle: { opacity: 1 },
              label: {
                show: true, position: "right", distance: 6, fontFamily: font,
                formatter: isTop ? `${M.name} · ${p.v.eff}` : p.v.eff,
                color: isTop ? txt : txt2, fontSize: isTop ? 12 : 10, fontWeight: isTop ? 700 : 400, opacity: 1,
              },
            },
          };
        });
      if (!data.length) continue;
      series.push({
        name: M.name, id: M.key, type: "line", data, showSymbol: true,
        triggerLineEvent: true,   // 점 사이 선 위에 올려도 반응
        // 선은 '같은 모델끼리 이어짐'만 알려주는 보조 역할 → 가늘고 옅게. 점이 주인공.
        lineStyle: { width: pinned ? 2 : 1.2, color: col, opacity: pinned ? 0.6 : dim ? 0.06 : 0.3, cap: "round", join: "round" },
        itemStyle: { color: col },
        emphasis: { focus: "series", lineStyle: { width: 2, opacity: 0.7 } },
        blur: { lineStyle: { opacity: 0.08 }, itemStyle: { opacity: 0.15 }, label: { opacity: 0.2 } },
        labelLayout: pinned ? { hideOverlap: false } : { hideOverlap: true },
        z: pinned ? 6 : dim ? 1 : 2,
        animationDuration: 300,
      });
    }
    // 가성비 경계선
    if (S.frontier && S.x !== "date") {
      const fr = frontierOf(points);
      if (fr.length >= 2) {
        series.push({
          id: "__frontier", name: "가성비 경계선", type: "line", step: "end", silent: true,
          data: fr.map((p) => [p.x, +p.v.score.toFixed(2)]), showSymbol: false,
          lineStyle: { type: [4, 4], width: 1.5, color: muted }, z: 1, tooltip: { show: false },
          emphasis: { disabled: true },
        });
      }
    }
    // 예산선
    if (isCostAxis()) {
      series.push({
        id: "__budget", type: "line", data: [], silent: true,
        markLine: {
          silent: true, symbol: "none", animation: false,
          lineStyle: { color: css("--accent"), type: "solid", width: 1, opacity: 0.6 },
          label: { formatter: "내 예산 " + fmtCost(10 ** S.budget), color: css("--accent"), fontSize: 11, position: "insideEndTop" },
          data: [{ xAxis: 10 ** S.budget }],
        },
      });
    }

    // 전체 범위 (확대 안 했을 때 보이는 범위)
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
      const lo = xs.length ? Math.min(...xs) : 0.01, hi = xs.length ? Math.max(...xs, isCostAxis() ? 10 ** S.budget : 0) : 1;
      x0 = 10 ** Math.floor(Math.log10(lo) - 0.05); x1 = 10 ** Math.ceil(Math.log10(hi) + 0.05);
    }
    FULL = { x0, x1, y0, y1 };
    if (viewKind !== S.x) { VIEWBOX = null; viewKind = S.x; }
    VIEWBOX = clampView(VIEWBOX);
    const V = VIEWBOX || FULL;
    let xAxis;
    if (S.x === "date") {
      xAxis = Object.assign({
        type: "time",
        splitLine: { show: true, lineStyle: { color: grid } }, axisLine: { lineStyle: { color: axis } },
      }, dateAxisView(V, muted));
    } else {
      xAxis = Object.assign({
        type: "log", logBase: 10,
        splitLine: { show: true, lineStyle: { color: grid } }, axisLine: { lineStyle: { color: axis } },
        minorSplitLine: { show: false },
      }, logAxisView(V, muted));
    }
    const xName = { cost: "문제 1개 푸는 비용 (오른쪽일수록 비쌈, 눈금은 10배씩)", costok: "맞힌 문제 1개당 비용 = 문제당 비용 ÷ 정답률 (작업 난이도에 따라 달라짐)", price: "가격표: 100만 토큰당 평균 가격 (입력3:출력1)", date: "출시일" }[S.x];
    $("#chartTitle").textContent = "세로: 종합 성능 점수 (위일수록 좋음)  ·  가로: " + xName;
    const noX = list.reduce((n, M) => n + M.vs.filter((v) => xOf(v) == null).length, 0);
    $("#chartFoot").textContent = (noX ? `비용 정보가 없어 그래프에서 빠진 점 ${noX}개 (표에는 있음) · ` : "") +
      "같은 모델의 추론 등급은 선으로 이어집니다 · 속이 빈 점 = 가격표로 추정한 비용";

    chart.setOption({
      backgroundColor: "transparent",
      textStyle: { fontFamily: "Pretendard Variable, Pretendard, Malgun Gothic, sans-serif" },
      grid: { left: 52, right: 150, top: 20, bottom: 48 },
      xAxis: Object.assign(xAxis, { name: "", nameLocation: "middle" }),
      yAxis: {
        type: "value", min: V.y0, max: V.y1,
        axisLabel: { color: muted, showMinLabel: false, showMaxLabel: false, formatter: (v) => (Number.isInteger(v) ? v : v.toFixed(1)) },
        splitLine: { lineStyle: { color: grid } }, axisLine: { show: false }, minInterval: 0.5,
      },
      tooltip: {
        trigger: "item", confine: true, enterable: false,
        backgroundColor: css("--surface-2"), borderColor: css("--line-strong"), borderWidth: 1,
        padding: [10, 12], textStyle: { color: txt, fontSize: 13 },
        extraCssText: "box-shadow:0 6px 24px rgba(0,0,0,.14);border-radius:10px;max-width:340px;white-space:normal;",
        formatter: (p) => {
          if (p.data && p.data.v) return tipHtml(p.data.v);
          // 점 사이 선 위: 모델 이름만
          if (p.seriesType === "line" && seriesKey(p)) {
            const pinned = S.pinned.includes(seriesKey(p));
            return `<div class="tt-h">${esc(p.seriesName)}</div><div class="tt-e" style="font-size:12px">${pinned ? "누르면 고정 해제" : "누르면 고정 · 점에 올리면 자세히"}</div>`;
          }
          return "";
        },
      },
      series,
    }, { notMerge: true });
    if (window.innerWidth < 700) chart.setOption({ grid: { right: 20, left: 40 } });
    updateZoomUi();
  }

  // ───────── 확대·이동 (직접 구현)
  // 가로축이 '10배씩' 눈금이라 차트 기본 확대 기능이 잘 안 맞아서 직접 만든다.
  //  · 마우스 휠: 마우스 위치를 중심으로 확대/축소 (다 축소된 상태에서 더 축소하면 페이지가 스크롤됨)
  //  · 끌기: 확대된 상태에서 이동      · 빈 곳 더블클릭 / '원래대로': 처음 화면
  //  · Shift+휠: 가로만, Alt+휠: 세로만
  let FULL = null;      // 전체 범위 {x0,x1,y0,y1}
  let VIEWBOX = null;   // 지금 보이는 범위 (null = 전체)
  let viewKind = null;  // 가로축 종류가 바뀌면 확대를 푼다
  const isLog = () => S.x !== "date";
  const tx = (v) => (isLog() ? Math.log10(v) : v);
  const itx = (t) => (isLog() ? 10 ** t : t);
  const MIN_SPAN = () => ({ x: isLog() ? 0.12 : 5 * 864e5, y: 1.5 }); // 최대 확대 한도

  function clampView(v) {
    if (!v || !FULL) return null;
    const f = { a: tx(FULL.x0), b: tx(FULL.x1) };
    let a = tx(v.x0), b = tx(v.x1), c = v.y0, d = v.y1;
    const ms = MIN_SPAN();
    // 크기 제한
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
    const full = Math.abs(a - f.a) < 1e-9 && Math.abs(b - f.b) < 1e-9 && Math.abs(c - FULL.y0) < 1e-9 && Math.abs(d - FULL.y1) < 1e-9;
    return full ? null : { x0: itx(a), x1: itx(b), y0: c, y1: d };
  }

  // 로그 눈금: 보이는 범위에 맞춰 $0.01 / $0.02 / $0.05 … 처럼 읽기 좋은 값만
  function logAxisView(V, muted) {
    const a = Math.log10(V.x0), b = Math.log10(V.x1), span = b - a;
    let vals = [];
    if (span > 0.6) {
      const mult = span > 2.5 ? [1] : span > 1.2 ? [1, 3] : [1, 2, 5];
      for (let k = Math.floor(a) - 1; k <= Math.ceil(b) + 1; k++) {
        for (const m of mult) {
          const v = m * 10 ** k;
          if (v >= V.x0 * 0.999 && v <= V.x1 * 1.001) vals.push(+v.toPrecision(3));
        }
      }
    } else {
      // 많이 확대했을 때: 일정한 간격의 깔끔한 값 (예: $0.12, $0.14, $0.16 …)
      const raw = (V.x1 - V.x0) / 5;
      const p = 10 ** Math.floor(Math.log10(raw));
      const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) || 10 * p;
      for (let v = Math.ceil(V.x0 / step) * step; v <= V.x1 * 1.0001; v += step) vals.push(+v.toPrecision(4));
    }
    const fmt = (v) => "$" + (v >= 1 ? +v.toFixed(2) : +v.toPrecision(3));
    return {
      min: V.x0, max: V.x1,
      axisLabel: { color: muted, customValues: vals, formatter: fmt, hideOverlap: true },
      axisTick: { customValues: vals },
    };
  }

  // 휠을 빠르게 돌려도 화면 갱신은 한 프레임에 한 번만
  // 날짜 눈금: 넓게 보면 '2026.07', 좁게 보면 '07.15'
  function dateAxisView(V, muted) {
    const days = (V.x1 - V.x0) / 864e5;
    const two = (n) => String(n).padStart(2, "0");
    const fmt = (v) => {
      const d = new Date(v);
      return days > 100 ? `${d.getFullYear()}.${two(d.getMonth() + 1)}` : `${two(d.getMonth() + 1)}.${two(d.getDate())}`;
    };
    return { min: V.x0, max: V.x1, axisLabel: { color: muted, hideOverlap: true, showMinLabel: false, showMaxLabel: false, formatter: fmt } };
  }

  let rafPending = false;
  function drawView() {
    rafPending = false;
    const V = VIEWBOX || FULL;
    if (!V) return;
    const opt = { yAxis: { min: V.y0, max: V.y1 } };
    opt.xAxis = S.x === "date" ? dateAxisView(V, css("--muted")) : logAxisView(V, css("--muted"));
    chart.setOption(opt, { silent: true });
    updateZoomUi();
  }
  function applyView() {
    if (document.visibilityState === "hidden") return drawView();
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(drawView);
  }
  function setView(v) { VIEWBOX = clampView(v); applyView(); }
  function resetView() { VIEWBOX = null; applyView(); }

  function gridRect() {
    const g = chart.getModel().getComponent("grid");
    return g && g.coordinateSystem ? g.coordinateSystem.getRect() : null;
  }
  // 화면 좌표(px) → 확대 계산용 좌표
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
  // f < 1 확대, f > 1 축소.  axes: "xy" | "x" | "y"
  function zoomAt(px, py, f, axes, base) {
    const V = base || VIEWBOX || FULL;
    const c = pxToT(px, py, V);
    let a = tx(V.x0), b = tx(V.x1), y0 = V.y0, y1 = V.y1;
    if (axes !== "y") { a = c.t - (c.t - a) * f; b = c.t + (b - c.t) * f; }
    if (axes !== "x") { y0 = c.y - (c.y - y0) * f; y1 = c.y + (y1 - c.y) * f; }
    setView({ x0: itx(a), x1: itx(b), y0, y1 });
  }

  const chartEl = $("#chart");
  chartEl.addEventListener("wheel", (e) => {
    const rect = chartEl.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    if (!FULL || !inGrid(px, py)) return;
    const zoomOut = e.deltaY > 0;
    if (zoomOut && !VIEWBOX) return;             // 이미 전체 → 페이지 스크롤 허용
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;   // 줄 단위 휠 보정
    const f = Math.min(1.6, Math.max(0.6, Math.exp(dy * 0.0022)));
    zoomAt(px, py, f, e.shiftKey ? "x" : e.altKey ? "y" : "xy");
  }, { passive: false });

  // 끌어서 이동
  let drag = null, suppressClick = false;
  chartEl.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || !VIEWBOX) return;
    const rect = chartEl.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    if (!inGrid(px, py)) return;
    drag = { sx: e.clientX, sy: e.clientY, v: VIEWBOX, moved: false };
  }, true);
  window.addEventListener("mousemove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) { drag.moved = true; chartEl.classList.add("panning"); chart.dispatchAction({ type: "hideTip" }); }
    const r = gridRect(), v = drag.v;
    const a = tx(v.x0), b = tx(v.x1);
    const dt = (-dx / r.width) * (b - a), dyv = (dy / r.height) * (v.y1 - v.y0);
    setView({ x0: itx(a + dt), x1: itx(b + dt), y0: v.y0 + dyv, y1: v.y1 + dyv });
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
      const dt = (-dx / r.width) * (b - a), dyv = (dy / r.height) * (v.y1 - v.y0);
      setView({ x0: itx(a + dt), x1: itx(b + dt), y0: v.y0 + dyv, y1: v.y1 + dyv });
      e.preventDefault();
    }
  }, { passive: false });
  chartEl.addEventListener("touchend", (e) => {
    if (touch && touch.moved) { suppressClick = true; setTimeout(() => (suppressClick = false), 300); }
    if (e.touches.length === 0) touch = null;
  });

  function updateZoomUi() {
    const zoomed = !!VIEWBOX;
    chartEl.classList.toggle("zoomed", zoomed);
    const hint = $("#zoomHint");
    if (hint) hint.textContent = zoomed ? "확대 중 · 끌어서 이동 · 빈 곳 더블클릭하면 원래대로" : "마우스 휠로 확대 (Shift+휠: 가로만)";
    const rb = $("#resetZoom");
    if (rb) rb.disabled = !zoomed;
  }
  function zoomCenter(f) {
    const r = gridRect();
    if (r) zoomAt(r.x + r.width / 2, r.y + r.height / 2, f, "xy");
  }

  function tipHtml(v) {
    const M = v.m;
    const c = confOf(v.se);
    const col = colorOf(M.company);
    let h = `<div class="tt-h">${esc(M.name)} <span class="tt-e">· ${esc(v.eff)}${v.eff !== v.effortKo ? ` (${esc(v.effortKo)})` : ""}${v.isDefault ? " · 기본값" : ""}</span></div>`;
    h += `<div class="tt-big">${v.score.toFixed(1)} <span class="tt-e" style="font-size:13px">±${v.se.toFixed(1)} · 신뢰도 ${c.t}</span></div>`;
    h += `<div class="tt-row"><span>문제당 비용</span><b>${fmtCost(v.cost)}${v.costKind ? ` <span class="tt-e">(${esc(v.costKind)})</span>` : ""}</b></div>`;
    if (v.costOk != null) h += `<div class="tt-row"><span>맞힌 문제당 <span class="tt-e">(${esc(diff().label)} 작업 정답률 ${Math.round(v.acc * 100)}%)</span></span><b>${fmtCost(v.costOk)}</b></div>`;
    if (M.price) h += `<div class="tt-row"><span>가격표 (입력/출력)</span><span>$${M.price.in} / $${M.price.out}</span></div>`;
    const how = howToSet(M, v.effort)[0];
    if (how) h += `<div class="tt-row"><span>설정</span><span class="tt-code">${esc(how.v)}</span></div>`;
    h += `<div class="tt-row"><span>회사 · 출시</span><span>${esc(M.company)} · ${esc(M.date || "?")}</span></div>`;
    h += `<div class="tt-src">`;
    for (const p of v.parts) {
      h += `<div class="tt-row"><span><i class="tt-key" style="background:${col}"></i>${esc(srcName(p.s))}${p.est ? " (추정)" : ""}</span><b>${p.m.toFixed(1)}</b></div>`;
    }
    if (v.disagree != null) h += `<div class="tt-row"><span>기관 간 의견 차이</span><span>${v.disagree.toFixed(1)}점</span></div>`;
    h += `</div>`;
    return h;
  }

  // 선 위 이벤트는 seriesId 가 비어 올 수 있어서 순서 번호로 모델 키를 찾는다
  function seriesKey(p) {
    const id = p.seriesId || ((chart.getOption().series || [])[p.seriesIndex] || {}).id;
    return id && !String(id).startsWith("__") ? String(id) : null;
  }

  // 점이든 선이든 마우스를 올리면 그 모델 전체(모든 등급 점 + 이름)를 강조
  let hoverSeries = null;
  chart.on("mouseover", (p) => {
    if (p.seriesType !== "line" || !seriesKey(p)) return;
    if (hoverSeries === p.seriesIndex) return;
    if (hoverSeries != null) chart.dispatchAction({ type: "downplay", seriesIndex: hoverSeries });
    hoverSeries = p.seriesIndex;
    chart.dispatchAction({ type: "highlight", seriesIndex: p.seriesIndex });
  });
  chart.on("globalout", () => {
    if (hoverSeries != null) chart.dispatchAction({ type: "downplay", seriesIndex: hoverSeries });
    hoverSeries = null;
  });
  chart.getZr().on("mousemove", (e) => {
    // 빈 곳으로 나가면 강조 해제
    if (!e.target && hoverSeries != null) {
      chart.dispatchAction({ type: "downplay", seriesIndex: hoverSeries });
      hoverSeries = null;
    }
  });

  chart.on("click", (p) => {
    if (suppressClick) return;   // 끌어서 이동한 직후의 클릭은 무시
    if (p.data && p.data.v) togglePin(p.data.v.m.key, p.data.v.effort);
    else if (p.seriesType === "line" && seriesKey(p)) togglePin(seriesKey(p));
  });

  // 점·표 줄을 누르면 비교 목록에 고정 / 이미 고정돼 있으면 해제
  function togglePin(key, effort) {
    if (S.pinned.includes(key)) {
      S.pinned = S.pinned.filter((k) => k !== key);
      if (S.selected === key) { S.selected = S.pinned[S.pinned.length - 1] || null; S.selEffort = null; }
    } else {
      S.pinned = [...S.pinned, key].slice(-8);
      S.selected = key; S.selEffort = effort || null;
    }
    save(); render();
    if (S.selected === key && window.innerWidth < 1000) $("#detail").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  // 카드에서 누르면 고정(해제는 안 함)하고 상세 보기
  function pinAndShow(key, effort) {
    if (!S.pinned.includes(key)) S.pinned = [...S.pinned, key].slice(-8);
    S.selected = key; S.selEffort = effort || null;
    save(); render();
  }

  // 그래프 위: 고정한 모델 목록
  function renderPinBar() {
    const el = $("#pinBar");
    el.innerHTML = "";
    if (!S.pinned.length) {
      el.innerHTML = '<span class="muted">점을 누르면 그 모델이 고정돼 강조됩니다 (여러 개 가능, 다시 누르면 해제)</span>';
      return;
    }
    const lab = document.createElement("span");
    lab.className = "muted"; lab.textContent = "비교 중";
    el.append(lab);
    for (const key of S.pinned) {
      const M = VIEW.all.find((x) => x.key === key);
      if (!M) continue;
      const chip = document.createElement("span");
      chip.className = "pin" + (S.selected === key ? " cur" : "");
      chip.title = "눌러서 자세히 보기";
      chip.innerHTML = `<span class="sw" style="background:${colorOf(M.company)}"></span>`;
      const t = document.createElement("span"); t.textContent = M.name;
      const x = document.createElement("button");
      x.type = "button"; x.className = "x"; x.textContent = "×"; x.title = "고정 해제"; x.setAttribute("aria-label", M.name + " 고정 해제");
      x.onclick = (e) => { e.stopPropagation(); togglePin(key); };
      chip.onclick = () => { S.selected = key; S.selEffort = null; save(); renderDetail(); renderPinBar(); };
      chip.append(t, x);
      el.append(chip);
    }
    const clr = document.createElement("button");
    clr.type = "button"; clr.className = "ghost small"; clr.textContent = "모두 해제";
    clr.onclick = () => { S.pinned = []; S.selected = null; save(); render(); };
    el.append(clr);
  }

  // ───────── 범례 (누르면 그 회사 숨기기/보이기)
  function renderLegend(all) {
    const cnt = {};
    const cutoff = S.period ? monthsAgo(S.period) : null;
    for (const M of all) if (!cutoff || (M.date && M.date >= cutoff)) cnt[groupOf(M.company)] = (cnt[groupOf(M.company)] || 0) + 1;
    const groups = [...MAIN_COMPANIES, "기타"];
    const el = $("#legend");
    el.innerHTML = "";
    for (const g of groups) {
      const st = g === "기타" ? OTHER : COMPANY_STYLE[g];
      const chip = document.createElement("span");
      chip.className = "chip" + (S.hidden.includes(g) ? " off" : "");
      chip.title = "눌러서 숨기기/보이기";
      chip.innerHTML = symbolSvg(st.sym, css(st.c));
      const t = document.createElement("span"); t.textContent = g;
      const n = document.createElement("span"); n.className = "cnt"; n.textContent = cnt[g] || 0;
      chip.append(t, n);
      chip.onclick = () => {
        S.hidden = S.hidden.includes(g) ? S.hidden.filter((x) => x !== g) : [...S.hidden, g];
        save(); render();
      };
      el.append(chip);
    }
  }
  function symbolSvg(sym, col) {
    const s = { circle: `<circle cx="6" cy="6" r="5"/>`, rect: `<rect x="1" y="1" width="10" height="10"/>`, roundRect: `<rect x="1" y="1" width="10" height="10" rx="3"/>`,
      diamond: `<path d="M6 0 L12 6 L6 12 L0 6Z"/>`, triangle: `<path d="M6 1 L11.5 11 L0.5 11Z"/>`, pin: `<path d="M6 12 C3 8 1 6.5 1 4.5 A5 5 0 0 1 11 4.5 C11 6.5 9 8 6 12Z"/>` }[sym];
    return `<svg width="12" height="12" viewBox="0 0 12 12" fill="${col}">${s}</svg>`;
  }

  // ───────── 추천 카드
  function renderCards(points) {
    const withScore = points.map((p) => p.v);
    const withCost = points.filter((p) => costFor(p.v) != null && (S.estimated || p.v.costKind === "측정")).map((p) => p.v);
    const cards = [];
    if (withScore.length) {
      const top = withScore.reduce((a, b) => (b.score > a.score ? b : a));
      cards.push({ k: "최고 성능", v: top, d: `종합 ${top.score.toFixed(1)}점 · ${costUnit()} ${fmtCost(costFor(top))}` });
      // 최고 점수의 오차 범위(최소 3점) 안에 드는 것 중 가장 싼 것
      const tol = Math.max(3, top.se);
      const near = withCost.filter((v) => v.score >= top.score - tol);
      if (near.length) {
        const cheap = near.reduce((a, b) => (costFor(b) < costFor(a) ? b : a));
        const ratio = costFor(top) && costFor(cheap) ? costFor(top) / costFor(cheap) : null;
        cards.push({ k: "가성비 추천", sub: `최고와 ${tol.toFixed(1)}점 이내 중 최저가`, v: cheap,
          d: `종합 ${cheap.score.toFixed(1)}점 · ${costUnit()} <b>${fmtCost(costFor(cheap))}</b>` + (ratio && ratio > 1.2 ? ` · 최고보다 ${ratio.toFixed(1)}배 쌈` : "") });
      }
      const budget = 10 ** S.budget;
      const inB = withCost.filter((v) => costFor(v) <= budget);
      if (inB.length) {
        const b = inB.reduce((a, c) => (c.score > a.score || (c.score === a.score && costFor(c) < costFor(a)) ? c : a));
        cards.push({ k: "내 예산 안 최고", sub: fmtCost(budget) + " 이하", v: b, d: `종합 ${b.score.toFixed(1)}점 · ${costUnit()} <b>${fmtCost(costFor(b))}</b>` });
      } else {
        cards.push({ k: "내 예산 안 최고", sub: fmtCost(budget) + " 이하", v: null, d: "이 예산으로 쓸 수 있는 모델이 없습니다" });
      }
      const lowCost = withCost.filter((v) => v.score >= top.score - 8);
      if (lowCost.length) {
        const c = lowCost.reduce((a, b) => (costFor(b) < costFor(a) ? b : a));
        cards.push({ k: "초저가 쓸만한 모델", sub: "최고와 8점 이내 중 최저가", v: c, d: `종합 ${c.score.toFixed(1)}점 · ${costUnit()} <b>${fmtCost(costFor(c))}</b>` });
      }
    }
    const el = $("#cards");
    el.innerHTML = "";
    for (const c of cards) {
      const div = document.createElement("div");
      div.className = "card";
      const name = c.v ? `<span class="swatch" style="background:${colorOf(c.v.m.company)}"></span>${esc(c.v.m.name)}<span class="eff">${esc(c.v.eff)}</span>` : "—";
      div.innerHTML = `<div class="k"><span>${esc(c.k)}</span><span class="muted">${esc(c.sub || "")}</span></div><div class="v">${name}</div><div class="d">${c.d}</div>`;
      if (c.v) div.onclick = () => pinAndShow(c.v.m.key, c.v.effort);
      el.append(div);
    }
  }

  // ───────── 순위표
  let tableLimit = 40;
  function renderTable(list) {
    let rows = [];
    for (const M of list) {
      if (S.pinnedOnly && S.pinned.length && !S.pinned.includes(M.key)) continue;
      const vs = S.bestOnly ? [M.best] : M.vs;
      for (const v of vs) rows.push(v);
    }
    // 가성비 (상대값): 점수 - K·log10(비용)
    const vals = rows.filter((v) => v.cost != null).map((v) => v.score - VALUE_K * Math.log10(v.cost));
    const vMin = Math.min(...vals), vMax = Math.max(...vals);
    for (const v of rows) v.value = v.cost != null && vMax > vMin ? Math.round(((v.score - VALUE_K * Math.log10(v.cost)) - vMin) / (vMax - vMin) * 100) : null;
    const rankOrder = [...rows].sort((a, b) => b.score - a.score);
    rankOrder.forEach((v, i) => (v.rank = i + 1));
    const key = {
      rank: (v) => v.rank, name: (v) => v.m.name + effIdx(v.effort), effort: (v) => effIdx(v.effort), score: (v) => v.score,
      conf: (v) => -v.se, cost: (v) => v.cost ?? Infinity, costok: (v) => v.costOk ?? Infinity, value: (v) => v.value ?? -1, price: (v) => blended(v.m) ?? Infinity, date: (v) => v.m.date || "",
    }[S.sortK] || ((v) => v.score);
    rows.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * S.sortDir; });
    const tb = $("#table tbody");
    tb.innerHTML = "";
    for (const v of rows.slice(0, tableLimit)) {
      const tr = document.createElement("tr");
      if (S.pinned.includes(v.m.key)) tr.className = "sel";
      const c = confOf(v.se);
      const isNew = daysSince(v.m.date) <= 30;
      tr.innerHTML =
        `<td>${v.rank}</td>` +
        `<td><span class="sw" style="background:${colorOf(v.m.company)}"></span>${esc(v.m.name)} ${isNew ? '<span class="badge new">NEW</span>' : ""}</td>` +
        `<td><b>${esc(v.eff)}</b>${v.eff !== v.effortKo ? ` <span class="muted small">${esc(v.effortKo)}</span>` : ""}${v.isDefault ? ' <span class="badge def">기본값</span>' : ""}${!canSelect(v.m, v.effort) ? ' <span class="badge est">선택 불가</span>' : ""}</td>` +
        `<td class="num"><b>${v.score.toFixed(1)}</b><span class="pm">±${v.se.toFixed(1)}</span></td>` +
        `<td><span class="badge ${c.k}">${c.t}</span> <span class="muted small">${v.nReal}곳</span></td>` +
        `<td class="num">${fmtCost(v.cost)} ${v.costKind && v.costKind !== "측정" ? `<span class="badge est">${esc(v.costKind === "가격 추정" ? "추정" : "환산")}</span>` : ""}</td>` +
        `<td class="num">${fmtCost(v.costOk)}${v.acc ? `<br><span class="muted small">정답률 ${Math.round(v.acc * 100)}%</span>` : ""}</td>` +
        `<td class="num">${v.value ?? "—"}</td>` +
        `<td class="num">${v.m.price ? `${fmtPrice(v.m.price.in)} / ${fmtPrice(v.m.price.out)}` : "—"}</td>` +
        `<td>${esc(v.m.date || "—")}</td>`;
      tr.onclick = () => togglePin(v.m.key, v.effort);
      tb.append(tr);
    }
    $("#moreRows").hidden = rows.length <= tableLimit;
    $("#moreRows").textContent = `더 보기 (${rows.length - tableLimit}개 더)`;
    document.querySelectorAll("#table th").forEach((th) => th.classList.toggle("sorted", th.dataset.k === S.sortK));
  }
  document.querySelectorAll("#table th").forEach((th) => {
    th.onclick = () => {
      const k = th.dataset.k;
      if (S.sortK === k) S.sortDir *= -1;
      else { S.sortK = k; S.sortDir = ["name", "effort", "rank", "cost", "costok", "price"].includes(k) ? 1 : -1; }
      save(); renderTable(VIEW.list);
    };
  });
  $("#moreRows").onclick = () => { tableLimit += 60; renderTable(VIEW.list); };

  // ───────── 상세
  function renderDetail() {
    const el = $("#detail");
    const M = VIEW && VIEW.all.find((x) => x.key === S.selected);
    if (!M) {
      el.innerHTML = `<div class="detail-empty"><p><b>점을 눌러보세요.</b></p><p>모델의 등급별 점수와 비용, 기관별 점수를 자세히 볼 수 있습니다.</p><p class="muted">마우스 휠로 확대, 끌어서 이동할 수 있습니다. 점에 마우스를 올리면 같은 모델만 강조됩니다.</p></div>`;
      return;
    }
    const m = M.m;
    let h = `<button class="ghost small x" type="button" id="closeDetail">닫기</button>`;
    h += `<h3><span class="sw" style="background:${colorOf(M.company)}"></span>${esc(M.name)}</h3>`;
    h += `<div class="meta">${esc(M.company)} · 출시 ${esc(M.date || "?")}${daysSince(M.date) <= 30 ? ' <span class="badge new">NEW</span>' : ""}` +
      (m.price ? `<br>가격표: 입력 $${m.price.in} · 출력 $${m.price.out} <span class="muted">(100만 토큰당)</span>` : "") +
      (m.eci ? `<br>Epoch 공식 능력치(최고 등급 기준): ${m.eci}` : "") + `</div>`;

    h += `<div class="sect">추론 등급별</div><table class="dt"><thead><tr><th>등급</th><th class="num">점수</th><th class="num">문제당 비용<br><span class="muted">맞힌 문제당</span></th><th>올리면</th></tr></thead><tbody>`;
    M.vs.forEach((v, i) => {
      const prev = M.vs[i - 1];
      let step = "";
      if (prev) {
        const ds = v.score - prev.score;
        const cr = v.cost && prev.cost ? v.cost / prev.cost : null;
        step = `<span class="step">${ds >= 0 ? "+" : ""}${ds.toFixed(1)}점${cr ? ` · 비용 ${cr.toFixed(1)}배` : ""}</span>`;
      }
      const sel = "";
      h += `<tr${sel} data-e="${esc(v.effort)}" class="eff-row${S.selEffort === v.effort ? " hl" : ""}"><td><b>${esc(v.eff)}</b>${v.eff !== v.effortKo ? `<br><span class="muted small">${esc(v.effortKo)}</span>` : ""}${v.isDefault ? ' <span class="badge def">기본값</span>' : ""}${!canSelect(m, v.effort) ? ' <span class="badge est">선택 불가</span>' : ""}</td><td class="num"><b>${v.score.toFixed(1)}</b><span class="muted small"> ±${v.se.toFixed(1)}</span></td>` +
        `<td class="num">${fmtCost(v.cost)}${v.costOk != null ? `<br><span class="muted small">${fmtCost(v.costOk)}</span>` : ""}${v.costKind && v.costKind !== "측정" ? `<br><span class="badge est">${esc(v.costKind)}</span>` : ""}</td><td>${step}</td></tr>`;
    });
    h += `</tbody></table>`;

    const v = M.vs.find((x) => x.effort === S.selEffort) || M.best;
    // 이 등급을 실제로 설정하는 방법
    const g = EG[M.company];
    h += `<div class="sect">이 등급 쓰는 법 — <b>${esc(v.eff)}</b></div><div class="howto">`;
    for (const r of howToSet(m, v.effort)) h += `<div class="howto-row"><span class="howto-k">${esc(r.k)}</span><span class="${r.code ? "tt-code" : ""}">${esc(r.v)}</span></div>`;
    if (g && g.paramFull) h += `<div class="note">${esc(g.paramFull)}</div>`;
    const sup = m.efforts_supported;
    if (sup && sup.length) h += `<div class="note">이 모델에서 고를 수 있는 등급: ${sup.slice().sort((a, b) => effIdx(a) - effIdx(b)).map((e) => esc(effLabel(m.key ? m : M.m, e))).join(" · ")}${defaultEffort(m) ? ` (기본값: ${esc(effLabel(m, defaultEffort(m)))})` : ""}</div>`;
    if (g && g.note) h += `<div class="note">${esc(g.note)}</div>`;
    h += `</div>`;
    h += `<div class="sect">기관별 점수 — ${esc(v.eff)}</div><div class="srcbars">`;
    const lo = 130, hi = 175;
    for (const p of v.parts) {
      const pct = Math.max(2, Math.min(100, ((p.m - lo) / (hi - lo)) * 100));
      const detail = p.est ? `다른 등급(${esc(effLabel(m, p.est))}) 값에서 추정` :
        p.s === "epoch" ? `벤치마크 ${p.n}개` : p.s === "arena" ? `투표 점수 ${Math.round(p.raw)}` : `원점수 ${(+p.raw).toFixed(1)}`;
      h += `<div class="srcbar" title="${esc(detail)}"><span>${esc(srcName(p.s))}</span><div class="track"><div class="fill${p.est ? " est" : ""}" style="width:${pct}%"></div></div><span class="val">${p.m.toFixed(1)}</span></div>`;
      h += `<div class="note" style="margin:-2px 0 4px 104px">${detail}</div>`;
    }
    h += `</div>`;
    if (v.disagree != null) h += `<div class="note">기관 간 의견 차이: <b>${v.disagree.toFixed(1)}점</b> ${v.disagree > 6 ? "— 기관마다 평가가 꽤 다릅니다" : v.disagree > 3 ? "— 약간 다릅니다" : "— 대체로 일치합니다"}</div>`;
    if (v.costSrc && v.costSrc.length) h += `<div class="note">비용 측정 출처: ${v.costSrc.map(esc).join(", ")}</div>`;
    if (M.m.price && M.m.price.id) h += `<div class="note">모델 ID: ${esc(M.m.price.id)}</div>`;
    el.innerHTML = h;
    $("#closeDetail").onclick = () => { S.selected = null; save(); renderDetail(); renderPinBar(); };
    el.querySelectorAll("tr.eff-row").forEach((tr) => {
      tr.onclick = () => { S.selEffort = tr.dataset.e; save(); renderDetail(); };
    });
  }

  // ───────── 출처 카드
  function renderSources() {
    const el = $("#sourceCards");
    el.innerHTML = "";
    for (const s of SRC_ORDER) {
      const I = D.sources[s];
      if (!I) continue;
      const card = document.createElement("div");
      card.className = "scard" + (!I.ok || !S.enabled[s] ? " off" : "");
      const fit = I.fit || {};
      const agree = fit.r != null ? `다른 기관과 일치도 <b>${Math.round(fit.r * 100)}%</b> · 평균 어긋남 <b>±${fit.rmse}점</b>` : "";
      const autoW = fit.rmse ? (1 / (fit.rmse * fit.rmse)) : null;
      card.innerHTML =
        `<div class="h"><a href="${esc(I.url)}" target="_blank" rel="noopener">${esc(I.name)}</a>` +
        `<label class="switch" title="이 기관 점수 쓰기"><input type="checkbox" ${S.enabled[s] && I.ok ? "checked" : ""} ${I.ok ? "" : "disabled"}><span></span></label></div>` +
        `<div class="desc">${esc(I.desc)}</div>` +
        (I.ok ? `<div class="stat">평가한 모델·등급 <b>${I.count}개</b> · 데이터 날짜 <b>${esc(I.updated || "?")}</b></div><div class="stat">${agree}</div>` : "") +
        (I.ok ? "" : `<div class="err">사용 못 함: ${esc(I.error || "")}</div>`) +
        (I.ok ? `<div class="w"><span>비중</span><input type="range" min="0" max="2" step="0.25" value="${S.weight[s] ?? 1}"><b>${(S.weight[s] ?? 1).toFixed(2).replace(/\.?0+$/, "")}배</b></div>` : "");
      const sw = card.querySelector(".switch input");
      sw.onchange = () => { S.enabled[s] = sw.checked; save(); render(); };
      const rg = card.querySelector(".w input");
      if (rg) {
        rg.oninput = () => { card.querySelector(".w b").textContent = (+rg.value).toFixed(2).replace(/\.?0+$/, "") + "배"; };
        rg.onchange = () => { S.weight[s] = +rg.value; save(); render(); };
      }
      el.append(card);
    }
    const reset = document.createElement("div");
    reset.innerHTML = `<button class="ghost small" type="button">비중 기본값으로</button>`;
    reset.querySelector("button").onclick = () => { S.weight = Object.assign({}, DEFAULT_WEIGHT); S.enabled = Object.assign({}, DEFAULTS.enabled); save(); render(); };
    el.append(reset);
  }

  // ───────── 조절 막대 연결
  function bindSeg(id, prop, parse) {
    document.querySelectorAll(`#${id} button`).forEach((b) => {
      b.onclick = () => { S[prop] = parse(b.dataset.v); save(); render(); };
    });
  }
  bindSeg("xAxisSeg", "x", (v) => v);
  bindSeg("periodSeg", "period", (v) => +v);
  bindSeg("topSeg", "perCo", (v) => +v);
  bindSeg("diffSeg", "difficulty", (v) => v);
  const opts = { optFrontier: "frontier", optLabels: "labels", optEstimated: "estimated", optBestOnly: "bestOnly", optPinnedOnly: "pinnedOnly" };
  for (const [id, prop] of Object.entries(opts)) {
    $("#" + id).onchange = (e) => { S[prop] = e.target.checked; save(); render(); };
  }
  let searchTimer;
  $("#search").value = S.search;
  $("#search").oninput = (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { S.search = e.target.value; save(); render(); }, 200);
  };
  $("#budget").value = S.budget;
  $("#budget").oninput = (e) => { S.budget = +e.target.value; $("#budgetOut").textContent = fmtCost(10 ** S.budget); };
  $("#budget").onchange = (e) => { S.budget = +e.target.value; save(); render(); };
  $("#resetZoom").onclick = () => resetView();
  $("#zoomIn").onclick = () => zoomCenter(0.7);
  $("#zoomOut").onclick = () => { if (VIEWBOX) zoomCenter(1 / 0.7); };
  $("#themeBtn").onclick = () => {
    const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    S.theme = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = S.theme;
    save(); render();
  };
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (!S.theme) render(); });

  function syncControls() {
    const on = (id, v) => document.querySelectorAll(`#${id} button`).forEach((b) => b.classList.toggle("on", b.dataset.v === String(v)));
    on("xAxisSeg", S.x); on("periodSeg", S.period); on("topSeg", S.perCo); on("diffSeg", S.difficulty);
    for (const [id, prop] of Object.entries(opts)) $("#" + id).checked = !!S[prop];
    $("#budgetOut").textContent = fmtCost(10 ** S.budget);
  }

  // ───────── 머리글·바닥글
  (function header() {
    const ageH = (Date.now() - new Date(D.generated.replace(" ", "T"))) / 3600000;
    const okN = SRC_ORDER.filter((s) => D.sources[s] && D.sources[s].ok).length;
    $("#updated").innerHTML = `<span class="dot${ageH > 36 ? " old" : ""}"></span>마지막 갱신 ${esc(D.generated)}<br><span class="muted">점수 출처 ${okN}곳 · 모델 ${D.models.length}개</span>`;
    const lad = D.effort_ladder;
    $("#ladderText").textContent = ["low", "medium", "high", "xhigh", "max"].map((e) => `${EFF_KO[e]} ${lad[e]}배`).join(", ") + " — '높음' 기준";
    const links = SRC_ORDER.filter((s) => D.sources[s] && D.sources[s].ok).map((s) => `<a href="${esc(D.sources[s].url)}" target="_blank" rel="noopener">${esc(D.sources[s].name)}</a>`);
    $("#foot").innerHTML = `데이터 출처: ${links.join(" · ")} · 가격: <a href="https://openrouter.ai/models" target="_blank" rel="noopener">OpenRouter</a>. ` +
      `Epoch AI 데이터는 CC-BY 4.0 (Epoch AI, "Capabilities & benchmarking", epoch.ai). LMArena 데이터는 CC-BY 4.0. ` +
      `점수는 각 기관의 공개 결과를 이 페이지가 자체 방식으로 합친 것이며, 기관의 공식 순위가 아닙니다.`;
  })();

  // ───────── 최신 데이터 받기 (도우미 server.py 가 켜져 있을 때만 동작)
  const refreshBtn = $("#refreshBtn");
  // 인터넷 사이트(GitHub)로 열렸는지: 그때는 도우미가 없고, 서버가 몇 시간마다 자동 갱신한다
  const HOSTED = location.protocol === "https:" && !/^(localhost|127\.)/.test(location.hostname);
  if (HOSTED) {
    refreshBtn.hidden = true;
    const note = document.createElement("span");
    note.className = "muted";
    note.textContent = " · 6시간마다 자동 갱신";
    $("#updated").append(note);
  }
  let helperOk = false;
  function notice(html, kind, action) {
    const el = $("#notice");
    if (!html) { el.hidden = true; return; }
    el.className = "notice" + (kind === "err" ? " err" : "");
    el.innerHTML = html;
    if (action) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "ghost small"; b.textContent = action.label; b.onclick = action.fn;
      el.append(b);
    }
    el.hidden = false;
  }
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
    refreshBtn.title = helperOk ? "여러 기관에서 최신 점수·가격을 지금 받아옵니다 (10~30초)"
      : "이 기능은 '성능비교판_열기'로 열었을 때만 동작합니다";
    return helperOk;
  }
  async function refreshNow(force) {
    if (!helperOk && !(await checkHelper())) {
      notice("이 창은 파일로 직접 열려 있어서 데이터를 받을 수 없어요. 창을 닫고 <b>성능비교판_열기</b>로 다시 열어주세요.", "err",
        { label: "닫기", fn: () => notice(null) });
      return;
    }
    refreshBtn.disabled = true; refreshBtn.classList.add("busy"); refreshBtn.textContent = "받는 중… (10~30초)";
    notice(null);
    const r = await api("api/refresh" + (force ? "?force=1" : ""), 240000);
    refreshBtn.disabled = false; refreshBtn.classList.remove("busy"); refreshBtn.textContent = "최신 데이터 받기";
    if (!r) {
      notice("데이터를 받지 못했어요. 인터넷 연결을 확인하고 다시 눌러주세요.", "err", { label: "닫기", fn: () => notice(null) });
    } else if (r.busy) {
      notice("이미 받는 중이에요. 잠시 뒤에 다시 눌러주세요.", "", { label: "닫기", fn: () => notice(null) });
    } else if (r.changed) {
      location.reload();   // 설정·고정한 모델은 저장돼 있어서 그대로 유지됨
    } else {
      const up = $("#updated");
      if (up.firstChild && up.firstChild.nextSibling) up.firstChild.nextSibling.textContent = "마지막 확인 " + (r.generated || "");
      notice(`이미 최신이에요. 각 기관에서 새로 올라온 점수가 없어요. <span class="muted">(확인 ${esc(r.generated || "")})</span>`, "",
        { label: "닫기", fn: () => notice(null) });
      setTimeout(() => notice(null), 6000);
    }
  }
  refreshBtn.onclick = () => refreshNow(true);
  (HOSTED ? Promise.resolve(false) : checkHelper()).then((ok) => {
    if (!ok) return;
    // 창이 열려 있다고 도우미에게 알림 (창을 닫으면 도우미가 몇 분 뒤 스스로 꺼짐)
    setInterval(() => api("api/ping", 3000), 60000);
    // 1시간마다 새 데이터가 있는지 조용히 확인 → 있으면 알림만 (화면이 갑자기 바뀌지 않게)
    setInterval(async () => {
      const r = await api("api/refresh", 240000);
      if (r && r.changed) notice("새 데이터가 들어왔어요.", "", { label: "반영하기", fn: () => location.reload() });
    }, 3600000);
  });

  render();
})();
