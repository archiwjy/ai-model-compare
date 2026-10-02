// 화면 계산(웹/core.js) 시험 — 추천 규칙 · 검색 · 경계선 · 데이터 정리 · 숫자 표시
//   node --test 테스트/
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const C = require(path.join(HERE, "..", "웹", "core.js"));
const REAL = JSON.parse(fs.readFileSync(path.join(HERE, "시험_데이터.json"), "utf8"));

// ───────── 데이터 정리
test("정상 데이터는 그대로 (모델 수 같음)", () => {
  const { data, problems } = C.normalizeData(REAL);
  assert.equal(data.models.length, REAL.models.length);
  assert.deepEqual(problems, []);
  assert.deepEqual(data.effort_order, REAL.effort_order);
});

test("망가진 데이터: 화면을 그릴 수 없으면 알기 쉬운 오류", () => {
  for (const bad of [null, undefined, "문자열", 5, [], {}, { models: "x" }, { models: null }]) {
    assert.throws(() => C.normalizeData(bad), (e) => e instanceof C.DataError && /데이터|모델/.test(e.message));
  }
});

test("망가진 모델·등급은 빼고 나머지는 살림", () => {
  const ok = { key: "ok", name: "정상", company: "A", date: "2026-01-01", variants: [{ effort: "high", src: { aa: { m: 150, var: 4 } }, cost: 0.1, cost_kind: "측정" }] };
  const raw = {
    generated: "2026-10-02 18:00",
    models: [
      ok, null, 5, "x", { key: "" }, { key: "no-variants" }, { key: "ok", variants: [] },   // 키 중복
      { key: "bad-parts", name: "<img src=x>", company: null, date: "2026-13-45", price: { in: null, out: "x" }, efforts_supported: "high",
        variants: [null, { effort: "" }, { effort: "low", src: { aa: { m: 150, var: 0 }, epoch: { m: null, var: 2 } } },
          { effort: "high", src: { aa: { m: "160", var: "4" } }, cost: -1 }, { effort: "max", src: { aa: { m: 1e9, var: 1 } }, cost: "abc" },
          { effort: "xhigh", src: { aa: { m: 160, var: 4 } }, cost: 0.2, cost_kind: "모름", cost_src: ["A", 5] }] },
    ],
  };
  const { data, problems } = C.normalizeData(raw);
  assert.deepEqual(data.models.map((m) => m.key), ["ok", "bad-parts"]);
  assert.ok(problems.length === 1 && /6개/.test(problems[0]));
  const m = data.models[1];
  assert.equal(m.company, "기타");
  assert.equal(m.date, null);
  assert.equal(m.price, null);
  assert.equal(m.efforts_supported, null);
  assert.equal(m.name, "<img src=x>");                       // 이름은 그대로 두고 화면에서 esc 로 안전하게 표시
  const byE = Object.fromEntries(m.variants.map((v) => [v.effort, v]));
  assert.deepEqual(Object.keys(byE).sort(), ["high", "low", "max", "xhigh"]);
  assert.deepEqual(byE.low.src, {});                         // 분산 0 · 점수 없음 → 뺌
  assert.equal(byE.high.src.aa.m, 160);                      // 숫자 글자는 숫자로
  assert.equal(byE.high.cost, null);                          // 음수 비용 → 없음
  assert.deepEqual(byE.max.src, {});                          // 말이 안 되는 점수(10억) → 뺌
  assert.equal(byE.xhigh.cost_kind, "가격 추정");             // 모르는 비용 종류 → 가장 덜 믿는 쪽
  assert.deepEqual(byE.xhigh.cost_src, ["A"]);
  assert.deepEqual(data.effort_order, C.EFFORT_ORDER);       // 등급 순서가 없으면 기본 순서
  assert.deepEqual(data.sources, {});
});

test("이름 겹침 구분", () => {
  const ms = C.uniqueNames([{ name: "A", date: "2026-01-02", key: "a1" }, { name: "A", date: "2026-02-02", key: "a2" }, { name: "A", date: "2026-02-09", key: "a3" }, { name: "B", date: null, key: "b" }]);
  assert.deepEqual(ms.map((m) => m.name), ["A (2026-01)", "A (a2)", "A (a3)", "B"]);
});

// ───────── 점수
test("종합 점수 = 오차의 역수로 가중 평균, 추정값만 있으면 없음", () => {
  const r = C.scoreVariant({ src: { epoch: { m: 160, var: 4 }, aa: { m: 164, var: 4 } } }, ["epoch", "aa"]);
  assert.equal(r.score, 162);
  assert.ok(Math.abs(r.se - Math.sqrt(2)) < 1e-9);
  assert.equal(r.disagree, 4);
  assert.equal(C.scoreVariant({ src: { epoch: { m: 160, var: 4, est: "max" } } }, ["epoch", "aa"]), null);
  assert.equal(C.scoreVariant({ src: {} }, ["epoch", "aa"]), null);
});

test("정답률 표시", () => {
  assert.equal(C.fmtAcc(0.003), "1% 미만");
  assert.equal(C.fmtAcc(0.995), "99% 초과");
  assert.equal(C.fmtAcc(0.5), "50%");
  const d = C.DIFFICULTY.vhard;
  assert.ok(C.accuracy(200, d) <= 0.995 && C.accuracy(0, d) >= 0.005);
});

// ───────── 숫자 표시
test("비용 표시 자릿수", () => {
  const cases = [[0.00043, "$0.00043"], [0.0073, "$0.0073"], [0.00995, "$0.010"], [0.0009996, "$0.0010"], [0.648, "$0.648"],
    [0.99996, "$1.00"], [12.345, "$12.35"], [99.996, "$100"], [1234.5, "$1235"]];
  for (const [c, want] of cases) assert.equal(C.fmtCost(c), want, String(c));
  for (const bad of [0, -1, NaN, Infinity, null, undefined, "1"]) assert.equal(C.fmtCost(bad), "—");
});

test("가격표 표시 (작은 값도 자릿수 유지)", () => {
  assert.equal(C.fmtPrice(0.0051), "$0.0051");
  assert.equal(C.fmtPrice(0.021), "$0.021");
  assert.equal(C.fmtPrice(4), "$4");
  assert.equal(C.fmtPrice(2.5), "$2.5");
  assert.equal(C.fmtPrice(20), "$20");
  assert.equal(C.fmtPrice(0), "$0");
  for (const bad of [-1, NaN, null, "x"]) assert.equal(C.fmtPrice(bad), "—");
});

test("절약 % (비교 불가면 null, 99% 상한)", () => {
  assert.equal(C.savePct(0.64, 1), 36);
  assert.equal(C.savePct(0.0001, 1), 99);
  assert.equal(C.savePct(null, 1), null);
  assert.equal(C.savePct(1, 0), null);
});

// ───────── 날짜·시각
test("한국 시간 해석은 어느 나라에서 열어도 같음", () => {
  assert.equal(C.parseKST("2026-10-02 18:00"), Date.UTC(2026, 9, 2, 9, 0));
  for (const bad of ["", "날짜 아님", "2026-13-01 00:00", "2026-10-02 25:00", null, 5]) assert.ok(Number.isNaN(C.parseKST(bad)), String(bad));
  const t = C.parseKST("2026-10-02 18:00");
  assert.equal(C.ago(t, t + 60000), "방금");
  assert.equal(C.ago(t, t + 3 * 3600000), "3시간 전");
  assert.equal(C.ago(NaN, t), "?");
});

test("기간 기준일: 월말·기기 시간대", () => {
  assert.equal(C.monthsAgo(6, new Date(2026, 7, 31)), "2026-02-28");
  assert.equal(C.monthsAgo(3, new Date(2026, 0, 15)), "2025-10-15");
  assert.equal(C.monthsAgo(12, new Date(2028, 1, 29)), "2027-02-28");
  assert.equal(C.daysSince("2026-10-01", new Date(2026, 9, 2, 8, 0)), 1);
  assert.equal(C.daysSince(null, new Date()), Infinity);
  assert.equal(C.daysSince("2026-02-30", new Date()), Infinity);
});

// ───────── 색·글자
test("색 섞기 · HTML 안전 글자", () => {
  assert.equal(C.mixHex("#ff0000", "#0000ff", 0.5), "#800080");
  assert.equal(C.mixHex("#f00", "#00f", 1), "#ff0000");
  assert.equal(C.mixHex("red", "#000000", 0.5), "red");
  assert.equal(C.esc(`<img src=x onerror="a('b')">&`), "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;");
  assert.equal(C.esc(null), "");
});

// ───────── 검색
const hay = (name, key = "", co = "") => C.makeHay(`${name} ${key} ${co}`);
test("검색: 한글 이름 · 쉼표 여러 개 · 붙여 쓰기", () => {
  assert.deepEqual(C.searchTerms("제미나이, gpt"), ["=gemini", "gpt"]);
  assert.deepEqual(C.searchTerms("클로드 오퍼스"), ["=claude =opus"]);
  assert.ok(C.matchSearch(hay("Claude Opus 5.5"), C.searchTerms("clau")));            // 영어는 앞부분만 쳐도 됨
  assert.ok(C.matchSearch(hay("Claude Opus 5.5", "claude-opus-5-5", "Anthropic"), C.searchTerms("클로드오퍼스")));
  assert.ok(C.matchSearch(hay("GPT-5.5", "gpt-5-5", "OpenAI"), C.searchTerms("gpt5")));
  assert.ok(C.matchSearch(hay("Claude Opus 5.5"), C.searchTerms("claude opus")));
  assert.ok(!C.matchSearch(hay("Claude Sonnet 5.5"), C.searchTerms("claude opus")));
});

test("검색: 단어 안의 글자에는 맞지 않음 (미니 → Gemini 아님, 솔 → Solar 아님)", () => {
  assert.ok(!C.matchSearch(hay("Gemini 1.5 Pro", "gemini-1-5-pro", "Google"), C.searchTerms("미니")));
  assert.ok(C.matchSearch(hay("GPT-5 mini", "gpt-5-mini", "OpenAI"), C.searchTerms("미니")));
  assert.ok(!C.matchSearch(hay("Solar Mini 4", "solar-mini-4", "Upstage"), C.searchTerms("솔")));
  assert.ok(C.matchSearch(hay("GPT-6.1 Sol", "gpt-6-1-sol", "OpenAI"), C.searchTerms("솔")));
  assert.ok(C.matchSearch(hay("Solar Mini 4", "solar-mini-4", "Upstage"), C.searchTerms("솔라")));
  assert.ok(C.matchSearch(hay("Ministral 3 14B", "ministral-3-14b", "Mistral"), C.searchTerms("미니스트랄")));
  assert.ok(!C.matchSearch(hay("HyperNova 60B", "hypernova-60b"), C.searchTerms("노바")));
});

test("검색: 기호만 친 검색어는 무시", () => {
  for (const q of ["-", ".", "_", "·", " , ", "---"]) assert.deepEqual(C.searchTerms(q), [], q);
  assert.deepEqual(C.searchTerms("<script>"), ["<script>"]);
  assert.ok(!C.matchSearch(hay("GPT-5"), C.searchTerms("<script>")));
});

// ───────── 경계선
const P = (key, x, score, se = 1, model = key) => ({ key, x, score, se, model });
test("경계선: 나보다 싸면서 똑똑한 점이 없으면 경계선 위", () => {
  const pts = [P("a", 0.1, 150), P("b", 0.2, 155), P("c", 0.3, 154), P("d", 0.5, 160), P("e", 1, 159.9), P("f", 0, 170), P("g", NaN, 170)];
  const fr = C.frontier(pts);
  assert.deepEqual(fr.front.map((p) => p.key), ["a", "b", "d"]);
  assert.equal(fr.status.get("c").st, "near");     // 1점 낮음 < 오차 √2
  assert.equal(fr.status.get("e").st, "near");
  assert.ok(!fr.status.has("f") && !fr.status.has("g"));   // 비용 0·NaN 은 계산에서 뺌
  assert.equal(fr.levelAt(0.25), 155);
  assert.equal(C.frontier([P("a", 1, 1)]).front.length, 0);
});

// ───────── 오늘의 답
test("가성비 추천: 비용 10% 안 차이는 같은 값 → 점수 높은 쪽 (high 대신 xhigh)", () => {
  // 실제 사례 (v7.3): high $0.634 · xhigh $0.648 → 2% 차이라 1점 높은 xhigh
  const pts = [P("max", 1.0, 168.0, 1.5, "opus"), P("xhigh", 0.648, 166.9, 1.5, "opus"), P("high", 0.634, 165.9, 1.5, "opus"),
    P("sol-max", 0.19, 165.3, 1.5, "sol"), P("sol-x", 0.115, 164.4, 1.5, "sol"), P("low", 0.05, 150, 1.5, "x")];
  const fr = C.frontier(pts);
  const r = C.picks(pts, fr.front);
  assert.equal(r.top.key, "max");
  assert.equal(r.value.key, "xhigh");
  assert.deepEqual(r.valueRows.map((p) => p.key), ["xhigh", "sol-max", "sol-x"]);   // high 는 2%만 싸서 건너뜀
  assert.equal(r.alt.key, "sol-x");
  assert.equal(r.rival.key, "sol-max");
  assert.equal(r.next.key, "max");
});

test("가성비 2·3위는 그래프 경계선 위의 점만, 바로 앞보다 10% 이상 싼 것만", () => {
  const pts = [P("top", 1, 170, 1), P("v", 0.5, 169, 1), P("a", 0.48, 160, 1), P("b", 0.3, 158, 1), P("off", 0.2, 120, 1), P("c", 0.1, 150, 1)];
  const fr = C.frontier(pts);
  const r = C.picks(pts, fr.front);
  assert.equal(r.value.key, "v");
  assert.deepEqual(r.valueRows.map((p) => p.key), ["v", "b", "c"]);   // a 는 4%만 싸서 건너뜀, off 는 경계선 아래
  for (const p of r.valueRows.slice(1)) assert.ok(fr.front.includes(p));
});

test("추천 후보가 없거나 하나뿐", () => {
  assert.equal(C.picks([], []), null);
  assert.equal(C.picks([P("a", NaN, 1)], []), null);
  const r = C.picks([P("a", 1, 150)], []);
  assert.equal(r.top.key, "a");
  assert.equal(r.value.key, "a");
  assert.equal(r.alt, null);
  assert.equal(r.rival, null);
});

test("실제 데이터로 오늘의 답: 1위·가성비 1위가 정해지고 규칙을 지킴", () => {
  const { data } = C.normalizeData(REAL);
  const pts = [];
  for (const m of data.models) for (const v of m.variants) {
    const s = C.scoreVariant(v, ["epoch", "aa"]);
    if (!s || v.cost == null || v.cost_kind === "가격 추정") continue;
    pts.push({ key: m.key + "|" + v.effort, model: m.key, x: v.cost / C.accuracy(s.score, C.DIFFICULTY.vhard), score: s.score, se: s.se });
  }
  const fr = C.frontier(pts);
  const r = C.picks(pts, fr.front);
  assert.ok(r && r.top && r.value);
  assert.ok(r.top.score >= Math.max(...pts.map((p) => p.score)) - 1e-9);
  assert.ok(r.top.score - r.value.score <= r.band(r.value) + 1e-9);                       // 사실상 동급
  for (const p of r.near) if (p.x * 1.1 < r.value.x) assert.fail("더 싼 동급 후보가 10% 넘게 쌈: " + p.key);
  for (let i = 1; i < r.valueRows.length; i++) assert.ok(r.valueRows[i].x * 1.1 <= r.valueRows[i - 1].x + 1e-12);
});

// ───────── 가성비 점수 · 확대 · 눈금
test("가성비 점수 0~100", () => {
  const f = C.valueScaler([{ score: 150, cost: 0.1 }, { score: 160, cost: 1 }, { score: 140, cost: 1 }]);
  assert.equal(f({ score: 150, cost: 0.1 }), 80);
  assert.equal(f({ score: 160, cost: 1 }), 100);
  assert.equal(f({ score: 140, cost: 1 }), 0);
  assert.equal(f({ score: 150, cost: null }), null);
  assert.equal(C.valueScaler([])({ score: 1, cost: 1 }), null);
});

test("확대 범위는 전체 안으로, 전체와 같으면 null", () => {
  const full = { x0: 0.01, x1: 10, y0: 100, y1: 170 };
  assert.equal(C.clampView(full, full), null);
  const v = C.clampView({ x0: 0.001, x1: 0.02, y0: 90, y1: 120 }, full);
  assert.ok(v.x0 >= full.x0 - 1e-12 && v.y0 >= full.y0);
  const tiny = C.clampView({ x0: 1, x1: 1.0001, y0: 150, y1: 150.1 }, full);
  assert.ok(Math.log10(tiny.x1 / tiny.x0) >= 0.12 - 1e-9 && tiny.y1 - tiny.y0 >= 1.5 - 1e-9);
  assert.equal(C.clampView({ x0: 0, x1: 1, y0: 1, y1: 2 }, full), null);
  assert.equal(C.clampView(null, full), null);
});

test("로그 눈금: 읽기 좋은 값, 이상한 범위에서도 끝남", () => {
  assert.deepEqual(C.logTicks(0.01, 10), [0.01, 0.03, 0.1, 0.3, 1, 3, 10]);
  assert.ok(C.logTicks(0.2, 0.5).length >= 3);
  for (const [a, b] of [[0, 1], [-1, 1], [1, 1], [NaN, 2], [1, Infinity], [1e-300, 1e300]]) assert.ok(C.logTicks(a, b).length <= 40);
});

// ───────── 등급
const EG = { DeepSeek: { param: "reasoning_effort", value: { low: "low", high: "high", max: "max" }, apps: [] },
  OpenAI: { param: "reasoning_effort", value: { none: "none", minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, apps: [] },
  Anthropic: { param: "effort", value: { low: "low", high: "high", max: "max" }, apps: [] } };
test("고를 수 있는 등급: 회사와 OpenRouter 의 이름이 다르면 회사 공식 등급표를 믿음 (DeepSeek)", () => {
  const ds = { efforts_supported: ["xhigh", "high"], reasoning_mandatory: null };
  assert.ok(C.canSelect(ds, "max", EG.DeepSeek));
  const astra = { efforts_supported: ["minimal", "low", "medium", "high", "xhigh"], reasoning_mandatory: true };
  assert.ok(!C.canSelect(astra, "none", EG.OpenAI));         // 생각 필수 → none 못 고름
  assert.ok(!C.canSelect(astra, "max", EG.OpenAI));          // OpenAI 이름 체계와 같은데 목록에 없음
  assert.ok(C.canSelect({ efforts_supported: null, reasoning_mandatory: null }, "max", undefined));
  assert.ok(C.canSelect(astra, "thinking", EG.OpenAI));
});

test("설정 방법 안내: 기본·생각 켬은 올바른 문구, 회사 안내가 없어도 멈추지 않음", () => {
  const m = { key: "x", efforts_supported: null, reasoning_mandatory: null };
  assert.equal(C.howToSet(m, "default", undefined)[0].v, "따로 설정하지 않음 (기본값)");
  assert.match(C.howToSet(m, "thinking", EG.Anthropic)[0].v, /생각\(추론\) 켜기/);
  assert.match(C.howToSet(m, "none", EG.Anthropic)[0].v, /끄기/);
  assert.equal(C.howToSet(m, "high", EG.Anthropic)[0].v, 'effort = "high"');
  assert.equal(C.howToSet(m, "default", EG.Anthropic)[0].v, "따로 설정하지 않음 (기본값)");
});

test("기본 등급: 공식 문서 값이 먼저", () => {
  assert.equal(C.defaultEffort({ key: "claude-opus-5-5", effort_default_or: "high" }, { "claude-opus-5-5": "medium" }), "medium");
  assert.equal(C.defaultEffort({ key: "y", effort_default_or: "high" }, {}), "high");
  assert.equal(C.defaultEffort({ key: "y", effort_default_or: null }, {}), null);
});

test("등급 정렬: 처음 보는 등급은 비용으로 자리", () => {
  const idx = (e) => { const i = C.EFFORT_ORDER.indexOf(e); return i < 0 ? 99 : i; };
  const vs = C.sortEfforts([{ effort: "max", cost: 2 }, { effort: "turbo", cost: 1.5 }, { effort: "low", cost: 0.2 }, { effort: "odd", cost: null }], idx);
  assert.deepEqual(vs.map((v) => v.effort), ["low", "turbo", "max", "odd"]);
});

test("회사 색 자리: 지난번 자리 유지, 최근 상위 회사", () => {
  const M = (company, date, score) => ({ company, date, best: { score } });
  const all = [M("A", "2026-09-01", 160), M("B", "2026-09-01", 165), M("C", "2025-01-01", 170), M("기타", "2026-09-01", 199)];
  const r = C.pickCompanies(all, "2026-04-01", { A: 3 }, 2, 5);
  assert.deepEqual(r.top, ["B", "A"]);
  assert.equal(r.slot.A, 3);
  assert.equal(r.slot.B, 0);
  const r2 = C.pickCompanies(all, "2026-04-01", { A: 9, B: "x" }, 3, 5);
  assert.deepEqual(r2.top, ["B", "A", "C"]);       // 최근 모델이 모자라면 전체 기간으로 채움
  assert.deepEqual(new Set(Object.values(r2.slot)).size, 3);
});
