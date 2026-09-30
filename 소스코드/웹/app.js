// AI 모델 성능비교판 — 화면 동작 (v3)
// data.js(수집기가 만든 파일)의 window.MODEL_DATA 를 읽어 그래프·표를 그린다.
(function () {
  "use strict";

  const D = window.MODEL_DATA;
  if (!D) {
    document.body.innerHTML = '<p style="padding:40px;font-size:16px">data.js 가 없습니다. 먼저 <b>성능비교판_열기</b> 를 실행하세요.</p>';
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

  // 점수 출처: Epoch AI + Artificial Analysis 두 곳
  const SRC_ORDER = ["epoch", "aa"];
  const EFF_ORDER = D.effort_order;
  const VALUE_K = 6; // 가성비: 비용 10배 = 6점
  const PER_CO_OPTIONS = [1, 2, 3, 5, 10, 15, 20, 25, 30, 0];

  // ───────── 설정 (바꾸면 바로 저장)
  const DEFAULTS = {
    x: "cost", period: 6, perCo: 3, difficulty: "normal", search: "", hidden: [], frontier: true, labels: true,
    estimated: true, bestOnly: false, sortK: "score", sortDir: -1, selected: null, selEffort: null,
    theme: null, pinned: [], pinnedOnly: false,
  };
  let S = load();
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem("aiCompare.settings") || "{}");
      return Object.assign({}, DEFAULTS, s);
    } catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function save() {
    try { localStorage.setItem("aiCompare.settings", JSON.stringify(S)); } catch (e) { /* 저장 안 돼도 동작 */ }
  }
  if (!PER_CO_OPTIONS.includes(S.perCo)) S.perCo = 3;
  for (const k of ["top", "budget", "weight", "enabled"]) delete S[k];   // 예전 버전 설정은 버림
  if (S.theme) document.documentElement.dataset.theme = S.theme;

  // ───────── 도우미
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const colorOf = (co) => css(styleOf(co).c);
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
    xhigh: "매우 높음", max: "최대", promax: "프로 최대", default: "기본 설정", thinking: "생각 켬 (단계 없음)",
  };
  // 화면에 보이는 등급 이름 = 그 회사에서 실제로 고르는 값 (예: max, xhigh, high)
  function effLabel(m, e) {
    if (e === "none") return "생각 없이";
    const g = EG[m.company];
    if (g && g.value && g.value[e]) return g.value[e];
    if (e === "default") return "기본";
    if (e === "thinking") return "생각 켬";
    return e;   // 공식 단계가 없는 회사: 평가기관이 붙인 이름 그대로
  }
  function defaultEffort(m) { return EDEF[m.key] || m.effort_default_or || null; }
  const EXPLICIT_EFF = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
  function canSelect(m, e) {
    const sup = m.efforts_supported;
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
    if (!g) {
      out.push({ k: "설정", v: `이 회사의 공식 등급 이름은 아직 정리돼 있지 않아요. 평가기관이 쓴 이름: ${e}` });
      return out;
    }
    if (g.value && g.value[e]) out.push({ k: "API", v: `${g.param} = "${g.value[e]}"`, code: true });
    else if (e === "none" && g.none) out.push({ k: "API", v: g.none });
    else if (e === "none" && g.value && g.value.none) out.push({ k: "API", v: `${g.param} = "none"`, code: true });
    else if (e === "default") out.push({ k: "API", v: "따로 설정하지 않음 (기본값)" });
    else if (g.onOff && e === "thinking") out.push({ k: "API", v: "생각 켬 (기본)" });
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
          m, effort: v.effort, eff: effLabel(m, v.effort), effKo: EFF_KO[v.effort] || v.effort,
          isDefault: defaultEffort(m) === v.effort,
          score: num / den, se: Math.sqrt(1 / den),
          disagree: real.length >= 2 ? Math.max(...real) - Math.min(...real) : null,
          nReal: real.length, parts, cost: v.cost ?? null, costKind: v.cost_kind || null, costSrc: v.cost_src || [],
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

  // ───────── 필터
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
    for (const p of pts) if (p.v.score > best + 1e-9) { out.push(p); best = p.v.score; }
    return out;
  }

  // ───────── 그래프 준비
  const chartEl = $("#chart");
  const chartBox = $("#chartBox");
  const chart = echarts.init(chartEl, null, { renderer: "canvas" });
  const isNarrow = () => chartEl.clientWidth < 560;
  let renderedNarrow = null, resizeTimer = null, VIEW = null;
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
    syncControls();
  }

  // ───────── 그래프 그리기
  let quietRender = false;
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

    // 가성비 경계선 위의 점 (조금 크게, 테두리 강조)
    const front = S.frontier && S.x !== "date" ? frontierOf(points) : [];
    const onFront = new Set(front.map((p) => p.v));

    const labelled = new Set(list.slice(0, S.labels ? 40 : 0).map((M) => M.key));
    const pinSet = new Set(S.pinned);
    const anyPin = pinSet.size > 0;
    const series = [];
    for (const M of list) {
      const col = colorOf(M.company);
      const sym = styleOf(M.company).sym;
      const pinned = pinSet.has(M.key);
      const dim = anyPin && !pinned;
      const shown = M.vs.filter((z) => xOf(z) != null);
      const topV = shown.reduce((a, b) => (b.score > a.score ? b : a), { score: -1 });
      const data = shown.map((v) => {
        const x = xOf(v);
        const hollow = isCostAxis() && v.costKind === "가격 추정";
        const isTop = v === topV;
        const fr = onFront.has(v);
        const base = sym === "pin" ? 16 : sym === "triangle" ? 12 : 10;
        return {
          value: [x, +v.score.toFixed(2)],
          v,
          symbol: sym,
          symbolSize: base + (pinned ? 3 : 0) + (fr ? 3 : 0),
          itemStyle: Object.assign(
            hollow ? { color: surf, borderColor: col, borderWidth: 2 } : { color: col, borderColor: fr ? ink : surf, borderWidth: fr ? 2 : 1.5 },
            { opacity: dim ? 0.16 : 1 }),
          label: pinned ? {
            show: true, position: sidePos(x), distance: 7,
            formatter: isTop ? `${M.name} · ${v.eff}` : v.eff,
            color: isTop ? txt : txt2, fontSize: isTop ? 12.5 : 10.5, fontWeight: isTop ? 700 : 500, fontFamily: font, textBorderColor: halo, textBorderWidth: 3,
          } : isTop && labelled.has(M.key) && !dim ? {
            show: true, position: sidePos(x), distance: narrow ? 4 : 7,
            formatter: M.name, color: txt2, fontSize: narrow ? 10.5 : 11.5, fontWeight: 500, fontFamily: font, textBorderColor: halo, textBorderWidth: 3,
          } : { show: false },
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
        lineStyle: { width: pinned ? 2 : 1.2, color: col, opacity: pinned ? 0.6 : dim ? 0.05 : 0.3, cap: "round", join: "round" },
        itemStyle: { color: col },
        emphasis: { focus: "series", lineStyle: { width: 2, opacity: 0.75 } },
        blur: { lineStyle: { opacity: 0.06 }, itemStyle: { opacity: 0.14 }, label: { opacity: 0.2 } },
        labelLayout: pinned ? { hideOverlap: false } : { hideOverlap: true },
        z: pinned ? 6 : dim ? 1 : 3,
        animationDuration: 550, animationEasing: "cubicOut",
      });
    }
    // 가성비 경계선: 흑백 점선 + 은은한 빛 + 아래쪽 옅은 음영
    if (front.length >= 2) {
      series.push({
        id: "__frontier", name: "가성비 경계선", type: "line", step: "end", silent: true, z: 2,
        data: front.map((p) => [p.x, +p.v.score.toFixed(2)]), showSymbol: false,
        lineStyle: { type: [6, 5], width: 2, color: ink, opacity: 0.9, shadowBlur: 10, shadowColor: ink + "55" },
        areaStyle: {
          origin: "start",
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: ink + "14" }, { offset: 1, color: ink + "00" }]),
        },
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
    h += `<div class="tip-sub">${esc(v.eff)}${v.eff !== v.effKo ? " · " + esc(v.effKo) : ""}${v.isDefault ? " · 기본값" : ""}</div>`;
    h += `<div class="tip-score"><b>${v.score.toFixed(1)}</b><span>±${v.se.toFixed(1)} · 신뢰도 ${c.t}</span></div>`;
    h += `<div class="tip-row"><span>문제당 비용</span><b>${fmtCost(v.cost)}${v.costKind && v.costKind !== "측정" ? ` <span class="muted">(${esc(v.costKind)})</span>` : ""}</b></div>`;
    if (v.costOk != null) h += `<div class="tip-row"><span>맞힌 문제당 <span class="muted">(${esc(diff().label)} ${Math.round(v.acc * 100)}%)</span></span><b>${fmtCost(v.costOk)}</b></div>`;
    if (M.price) h += `<div class="tip-row"><span>가격표 (입력/출력)</span><span>$${M.price.in} / $${M.price.out}</span></div>`;
    const how = howToSet(M, v.effort)[0];
    if (how) h += `<div class="tip-sep"></div><div class="tip-row"><span>설정</span><span class="${how.code ? "tip-code" : ""}">${esc(how.v)}</span></div>`;
    h += `<div class="tip-sep"></div>`;
    for (const p of v.parts) h += `<div class="tip-row"><span>${esc(srcName(p.s))}${p.est ? " (추정)" : ""}</span><b>${p.m.toFixed(1)}</b></div>`;
    h += `<div class="tip-hint">${esc(M.company)} · ${esc(M.date || "?")} 출시 · 누르면 고정</div></div>`;
    return h;
  }

  // ═════════ 확대·이동 ═════════
  //  · 그래프를 한 번 클릭해야 '확대 모드'가 켜짐 (그전엔 휠 = 페이지 스크롤)
  //  · 확대 모드: 휠로 확대/축소, 끌어서 이동, 빈 곳 더블클릭 = 처음 화면
  //  · 그래프 밖을 누르거나, 마우스가 그래프를 벗어나거나, Esc 를 누르면 꺼짐
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
  chartEl.addEventListener("pointerdown", (e) => { if (e.pointerType !== "touch") setZoomOn(true); }, true);
  document.addEventListener("pointerdown", (e) => { if (!chartBox.contains(e.target) && !chartBox.classList.contains("full")) setZoomOn(false); });
  chartBox.addEventListener("mouseleave", () => { if (!chartBox.classList.contains("full")) setZoomOn(false); });
  chartEl.addEventListener("wheel", (e) => {
    const rect = chartEl.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    if (!FULL || !inGrid(px, py)) return;
    if (!zoomOn) { showToast("그래프를 한 번 클릭하면 휠로 확대할 수 있어요"); return; }   // 페이지는 그대로 스크롤
    const zoomOut = e.deltaY > 0;
    if (zoomOut && !VIEWBOX) return;
    e.preventDefault();
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
  chart.on("click", (p) => {
    if (suppressClick) return;
    if (p.data && p.data.v) togglePin(p.data.v.m.key, p.data.v.effort);
    else if (p.seriesType === "line" && seriesKey(p)) togglePin(seriesKey(p));
  });

  // ───────── 고정 (비교)
  function togglePin(key, effort) {
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
    setTimeout(() => $("#detail").scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "center" }), 120);
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
      chip.title = S.hidden.includes(g) ? "눌러서 보이기" : "눌러서 숨기기";
      chip.innerHTML = symbolSvg(st.sym, css(st.c));
      const t = document.createElement("span"); t.textContent = g;
      const n = document.createElement("span"); n.className = "cnt"; n.textContent = cnt[g] || 0;
      chip.append(t, n);
      chip.onclick = () => { S.hidden = S.hidden.includes(g) ? S.hidden.filter((x) => x !== g) : [...S.hidden, g]; save(); render(); };
      el.append(chip);
    }
  }

  // ───────── 첫 화면 추천 카드 (최고 성능 / 가성비 추천)
  function countUp(el, to, digits) {
    if (REDUCED) { el.textContent = to.toFixed(digits); return; }
    const from = +(el.dataset.last || to * 0.9), t0 = performance.now(), dur = 700;
    el.dataset.last = to;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = (from + (to - from) * e).toFixed(digits);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  const ICON_TOP = `<svg viewBox="0 0 24 24"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>`;
  const ICON_VALUE = `<svg viewBox="0 0 24 24"><path d="M12 2v20M17 6.5C17 4.6 14.8 3.5 12 3.5S7 4.6 7 6.5 9 9.2 12 10s5 2 5 4-2.2 3.5-5 3.5-5-1.1-5-3"/></svg>`;
  function renderCards(points) {
    const el = $("#cards");
    const all = points.map((p) => p.v);
    const withCost = points.filter((p) => costFor(p.v) != null && (S.estimated || p.v.costKind === "측정")).map((p) => p.v);
    if (!all.length) { el.innerHTML = ""; return; }
    const top = all.reduce((a, b) => (b.score > a.score ? b : a));
    const tol = Math.max(3, top.se);
    const near = withCost.filter((v) => v.score >= top.score - tol);
    const cheap = near.length ? near.reduce((a, b) => (costFor(b) < costFor(a) ? b : a)) : null;
    const cards = [{ kind: "top", label: "최고 성능", icon: ICON_TOP, sub: "지금 보이는 모델 중 1등", v: top }];
    if (cheap) {
      const ratio = costFor(top) && costFor(cheap) ? costFor(top) / costFor(cheap) : null;
      const gap = top.score - cheap.score;
      cards.push({
        kind: "value", label: "가성비 추천", icon: ICON_VALUE, sub: `최고와 ${tol.toFixed(1)}점 이내 중 가장 쌈`, v: cheap,
        note: cheap === top ? "최고 성능 모델이 가장 싸기도 해요" : `최고보다 <b>${gap.toFixed(1)}점</b> 낮고 <span class="up">${ratio ? ratio.toFixed(1) + "배 저렴" : ""}</span>`,
      });
    }
    // 같은 자리 카드는 다시 만들지 않고 내용만 바꿔서 숫자가 부드럽게 변하게
    cards.forEach((c, i) => {
      let card = el.children[i];
      if (!card) { card = document.createElement("button"); card.type = "button"; card.className = "pick"; el.append(card); }
      const v = c.v, col = colorOf(v.m.company);
      card.style.setProperty("--pc", col);
      card.innerHTML =
        `<div class="pick-top"><span class="pick-label"><span class="ic">${c.icon}</span>${c.label}</span><span class="pick-sub">${esc(c.sub)}</span></div>` +
        `<div class="pick-name"><span class="dot" style="background:${col}"></span><span class="nm">${esc(v.m.name)}</span><span class="eff-chip">${esc(v.eff)}</span></div>` +
        `<div class="pick-stats"><div class="stat"><div class="v"><span data-n="score">${v.score.toFixed(1)}</span><small>점</small></div><div class="k">종합 성능</div></div>` +
        `<div class="stat"><div class="v">${fmtCost(costFor(v))}</div><div class="k">${costUnit()} 비용</div></div></div>` +
        (c.note ? `<div class="pick-note">${c.note}</div>` : "");
      countUp(card.querySelector('[data-n="score"]'), v.score, 1);
      card.onclick = () => pinAndShow(v.m.key, v.effort);
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
    const vals = rows.filter((v) => v.cost != null).map((v) => v.score - VALUE_K * Math.log10(v.cost));
    const vMin = Math.min(...vals), vMax = Math.max(...vals);
    for (const v of rows) v.value = v.cost != null && vMax > vMin ? Math.round(((v.score - VALUE_K * Math.log10(v.cost)) - vMin) / (vMax - vMin) * 100) : null;
    [...rows].sort((a, b) => b.score - a.score).forEach((v, i) => (v.rank = i + 1));
    const sMin = Math.min(...rows.map((v) => v.score)), sMax = Math.max(...rows.map((v) => v.score));
    const key = {
      rank: (v) => v.rank, name: (v) => v.m.name + effIdx(v.effort), effort: (v) => effIdx(v.effort), score: (v) => v.score,
      cost: (v) => v.cost ?? Infinity, costok: (v) => v.costOk ?? Infinity, value: (v) => v.value ?? -1, price: (v) => blended(v.m) ?? Infinity, date: (v) => v.m.date || "",
    }[S.sortK] || ((v) => v.score);
    rows.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * S.sortDir; });
    const tb = $("#table tbody");
    tb.innerHTML = "";
    for (const v of rows.slice(0, tableLimit)) {
      const tr = document.createElement("tr");
      if (S.pinned.includes(v.m.key)) tr.className = "sel";
      const c = confOf(v.se);
      const pct = sMax > sMin ? ((v.score - sMin) / (sMax - sMin)) * 100 : 100;
      tr.innerHTML =
        `<td class="c-rank">${v.rank}</td>` +
        `<td><span class="mname"><span class="sw" style="background:${colorOf(v.m.company)}"></span>${esc(v.m.name)}</span> ${daysSince(v.m.date) <= 30 ? '<span class="badge new">NEW</span>' : ""}</td>` +
        `<td class="effc"><b>${esc(v.eff)}</b>${v.effort !== "none" ? `<span class="ko">${esc(v.effKo)}</span>` : ""}${v.isDefault ? ' <span class="badge def">기본값</span>' : ""}${!canSelect(v.m, v.effort) ? ' <span class="badge est">선택 불가</span>' : ""}</td>` +
        `<td class="num"><span class="scorec"><span class="bar"><i style="width:${Math.max(4, pct).toFixed(0)}%"></i></span><b>${v.score.toFixed(1)}</b></span><span class="sub2">±${v.se.toFixed(1)} · 신뢰도 <span class="badge ${c.k}">${c.t}</span></span></td>` +
        `<td class="num">${fmtCost(v.cost)}${v.costKind && v.costKind !== "측정" ? `<span class="sub2">${esc(v.costKind === "가격 추정" ? "가격표로 추정" : "등급 환산")}</span>` : ""}</td>` +
        `<td class="num">${fmtCost(v.costOk)}${v.acc ? `<span class="sub2">정답률 ${Math.round(v.acc * 100)}%</span>` : ""}</td>` +
        `<td class="num">${v.value ?? "—"}</td>` +
        `<td class="num">${v.m.price ? `${fmtPrice(v.m.price.in)} / ${fmtPrice(v.m.price.out)}` : "—"}</td>` +
        `<td>${esc(v.m.date || "—")}</td>`;
      tr.onclick = () => togglePin(v.m.key, v.effort);
      tb.append(tr);
    }
    $("#moreRows").hidden = rows.length <= tableLimit;
    $("#moreRows").textContent = `더 보기 (${rows.length - tableLimit}개 더)`;
    $("#tableSub").textContent = `${rows.length}개 · 줄을 누르면 그래프에 고정돼요 · 제목을 누르면 정렬`;
    $$("#table th").forEach((th) => { th.classList.toggle("sorted", th.dataset.k === S.sortK); th.classList.toggle("asc", th.dataset.k === S.sortK && S.sortDir === 1); });
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

    h += `<div class="dcols"><div class="dcol"><div class="sect">추론 등급별 <span class="muted" style="letter-spacing:0;font-weight:500">줄을 누르면 오른쪽 설명이 바뀌어요</span></div>`;
    h += `<table class="dt"><thead><tr><th>등급</th><th class="num">점수</th><th class="num">문제당 비용</th><th>한 단계 올리면</th></tr></thead><tbody>`;
    M.vs.forEach((v, i) => {
      const prev = M.vs[i - 1];
      let step = "";
      if (prev) {
        const ds = v.score - prev.score, cr = v.cost && prev.cost ? v.cost / prev.cost : null;
        step = `<span class="step"><span class="${ds >= 0 ? "up" : "dn"}">${ds >= 0 ? "+" : ""}${ds.toFixed(1)}점</span>${cr ? ` · 비용 ${cr.toFixed(1)}배` : ""}</span>`;
      }
      h += `<tr data-e="${esc(v.effort)}" class="eff-row${S.selEffort === v.effort ? " hl" : ""}"><td><b>${esc(v.eff)}</b>${v.effort !== "none" ? ` <span class="muted small">${esc(v.effKo)}</span>` : `<br><span class="muted small">${esc(v.effKo)}</span>`}${v.isDefault ? ' <span class="badge def">기본값</span>' : ""}${!canSelect(m, v.effort) ? ' <span class="badge est">선택 불가</span>' : ""}</td>` +
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
  initSeg("diffSeg", "difficulty", (v) => v);

  // 드롭다운 메뉴
  function bindMenu(id) {
    const menu = $("#" + id);
    menu.querySelector(".menu-btn").onclick = (e) => {
      e.stopPropagation();
      const was = menu.classList.contains("open");
      $$(".menu.open").forEach((m) => m.classList.remove("open"));
      if (!was) menu.classList.add("open");
    };
    menu.querySelector(".menu-pop").addEventListener("click", (e) => e.stopPropagation());
  }
  document.addEventListener("click", () => $$(".menu.open").forEach((m) => m.classList.remove("open")));
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
  const opts = { optFrontier: "frontier", optLabels: "labels", optEstimated: "estimated", optBestOnly: "bestOnly", optPinnedOnly: "pinnedOnly" };
  for (const [id, prop] of Object.entries(opts)) $("#" + id).onchange = (e) => { S[prop] = e.target.checked; save(); render(); };
  let searchTimer;
  $("#search").value = S.search;
  $("#search").oninput = (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { S.search = e.target.value; save(); render(); }, 180); };

  function syncControls() {
    const on = (id, v) => $$(`#${id} button`).forEach((b) => b.classList.toggle("on", b.dataset.v === String(v)));
    on("xAxisSeg", S.x); on("periodSeg", S.period); on("diffSeg", S.difficulty);
    $("#diffCtl").style.opacity = S.x === "costok" ? "1" : "0.55";
    $("#diffCtl").title = S.x === "costok" ? "" : "난이도는 '맞힌 문제당' 비용과 표의 정답률에 반영돼요";
    $("#perCoText").textContent = S.perCo ? `${S.perCo}개` : "전부";
    $$("#perCoMenu .menu-item").forEach((b) => b.classList.toggle("on", +b.dataset.v === S.perCo));
    for (const [id, prop] of Object.entries(opts)) $("#" + id).checked = !!S[prop];
    requestAnimationFrame(syncSegs);
  }

  // 조절 막대가 위에 붙으면 아래 선 표시
  const dock = $("#dock");
  const onScroll = () => dock.classList.toggle("stuck", dock.getBoundingClientRect().top <= 61 && window.scrollY > 40);
  window.addEventListener("scroll", onScroll, { passive: true });

  // ───────── 그래프 도구 버튼
  $("#resetZoom").onclick = () => resetView();
  $("#zoomIn").onclick = () => zoomCenter(0.7);
  $("#zoomOut").onclick = () => { if (VIEWBOX) zoomCenter(1 / 0.7); };
  function setFull(on, fromPop) {
    chartBox.classList.toggle("full", on);
    document.body.classList.toggle("no-scroll", on);
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
    $$(".menu.open").forEach((m) => m.classList.remove("open"));
    if (chartBox.classList.contains("full")) setFull(false);
    else setZoomOn(false);
  });
  $("#themeBtn").onclick = () => {
    const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    S.theme = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = S.theme;
    document.querySelector('meta[name="theme-color"]').content = S.theme === "light" ? "#f5f4f0" : "#0b0b0c";
    save(); render();
  };
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { if (!S.theme) render(); });

  // ───────── 머리글·바닥글
  const HOSTED = location.protocol === "https:" && !/^(localhost|127\.)/.test(location.hostname);
  const genTs = new Date(D.generated.replace(" ", "T")).getTime();
  function renderStatus() {
    const ageH = (Date.now() - genTs) / 3600000;
    $("#status").innerHTML = `<span class="live${ageH > 12 ? " old" : ""}"></span><span><b>${ago(genTs)}</b> 갱신${HOSTED ? " · 6시간마다 자동" : ""}</span>`;
    $("#status").title = "마지막 갱신 " + D.generated;
  }
  renderStatus();
  setInterval(renderStatus, 60000);
  $("#eyebrow").textContent = `Epoch AI · Artificial Analysis 점수 합산 · 모델 ${D.models.length}개`;
  (function footer() {
    const src = SRC_ORDER.filter((s) => D.sources[s] && D.sources[s].ok).map((s) => {
      const I = D.sources[s];
      return `<div class="src"><b><a href="${esc(I.url)}" target="_blank" rel="noopener">${esc(I.name)}</a></b> — ${esc(I.desc)} <span class="muted">(${esc(I.updated || "")})</span></div>`;
    }).join("");
    $("#foot").innerHTML = `<div class="srcs">${src}</div><div>가격: <a href="https://openrouter.ai/models" target="_blank" rel="noopener">OpenRouter</a> · 비용 기록: LiveBench·DeepSWE·CursorBench·ARC-AGI 등</div>` +
      `<div class="fine">Epoch AI 데이터는 CC-BY 4.0 (Epoch AI, "Capabilities & benchmarking", epoch.ai). 지능 지수 출처: Artificial Analysis (artificialanalysis.ai). ` +
      `이 페이지의 점수는 두 기관의 공개 결과를 자체 방식으로 합친 것이며 기관의 공식 순위가 아닙니다. 마지막 갱신 ${esc(D.generated)}</div>`;
  })();

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

  render();
  // 글꼴이 늦게 들어오면 알약 버튼 폭이 바뀌므로 한 번 더 맞춤
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncSegs);
})();
