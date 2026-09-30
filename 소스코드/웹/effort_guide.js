// 회사별 추론(노력) 등급 공식 명칭과 설정 방법 (2026-09-30 공식 문서 기준)
// 회사가 이름을 바꾸면 이 파일만 고치면 된다.
//
// effort 키: none, minimal, low, medium, high, xhigh, max, default(등급 없이 기본), thinking(추론 켬, 등급 모름)
// 각 회사 항목:
//   param   : API에서 쓰는 설정 이름
//   value   : 등급 → API에 넣는 값 (없으면 그 등급은 API로 직접 고를 수 없음)
//   apps    : [{ name: "앱 이름", how: "고르는 곳", labels: { 등급: "화면에 보이는 이름" }, note }]
//   note    : 회사 전체 참고사항
window.EFFORT_GUIDE = {
  OpenAI: {
    param: "reasoning_effort",
    paramFull: 'API: reasoning.effort (Responses) · reasoning_effort (Chat Completions)',
    value: { none: "none", minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" },
    apps: [
      {
        name: "ChatGPT", how: "생각(Thinking) 슬라이더",
        labels: { medium: "Medium", high: "High", xhigh: "Extra High" },
        only: ["gpt-5-6-sol"],
        note: "ChatGPT 슬라이더는 GPT-5.6 Sol 전용이에요 (Instant / Medium / High / Extra High). Pro 모델은 모델 목록에서 따로 고릅니다.",
      },
      {
        name: "Codex", how: "추론 수준 선택 (설정 키 model_reasoning_effort)",
        labels: { low: "Light (터미널: Low)", medium: "Medium", high: "High", xhigh: "Extra High", max: "Max", ultra: "Ultra" },
        only: ["gpt-6-astra", "gpt-6-1-sol", "gpt-6-sol", "gpt-6-luna", "gpt-5-6-sol", "gpt-5-6-terra", "gpt-5-6-luna"],
        note: "Codex·ChatGPT Work 에는 Max 위에 'Ultra'(여러 에이전트가 나눠 일한 뒤 합치는 모드)가 있어요. API 등급이 아니고 아직 어느 평가기관도 점수·비용을 재지 않아 그래프에는 없어요 (재기 시작하면 자동으로 나타남). GPT-6 Luna 는 Ultra 가 없어요.",
      },
    ],
    note: "Pro 모델(예: GPT-6 Astra Pro)은 같은 모델의 'pro 모드'로, API에선 reasoning.mode = pro 로 켭니다.",
  },
  Anthropic: {
    param: "effort",
    paramFull: "API: output_config.effort",
    value: { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" },
    apps: [
      {
        name: "Claude 앱·웹", how: "보내기 버튼 옆 모델 이름 → Effort(노력)",
        labels: { low: "낮음 (Low)", medium: "중간 (Medium)", high: "높음 (High)", xhigh: "매우 높음 (Extra high)", max: "최대 (Max)" },
      },
      {
        name: "Claude Code", how: "/effort 명령 (또는 /model 에서 ← → 화살표)",
        labels: { low: "/effort low", medium: "/effort medium", high: "/effort high", xhigh: "/effort xhigh", max: "/effort max" },
      },
    ],
    none: "생각 끔 (예전 모델만 가능)",
    note: "Opus 5·5.5, Sonnet 5.5, Fable 5.1 은 생각(Thinking)을 끌 수 없어요.",
  },
  Google: {
    param: "thinking_level",
    paramFull: "API: thinking_config.thinking_level (JS: thinkingLevel)",
    value: { minimal: "minimal", low: "low", medium: "medium", high: "high" },
    apps: [
      {
        name: "Gemini 앱", how: "모델 이름 → 사고 수준",
        labels: {},
        note: "Gemini 앱은 '표준 사고 / 확장된 사고 / Deep Think' 로만 고를 수 있고, 위 등급과 1:1로 맞지 않아요.",
      },
    ],
    none: "생각 끔",
  },
  xAI: {
    param: "reasoning_effort",
    paramFull: "API: reasoning_effort",
    value: { low: "low", medium: "medium", high: "high", xhigh: "xhigh" },
    apps: [],
    note: "Grok 은 추론을 끌 수 없어요. 앱(Auto / Fast / Expert / Heavy)과 등급의 대응은 공식 안내가 없어요.",
  },
  DeepSeek: {
    param: "reasoning_effort",
    paramFull: 'API: reasoning_effort (+ 생각 켜기/끄기: thinking.type = "enabled"/"disabled")',
    value: { low: "low", high: "high", max: "max" },
    apps: [],
    none: 'thinking 끔 (thinking.type = "disabled")',
    note: "DeepSeek 은 실제로 low / high / max 세 단계만 있어요 (medium → high, xhigh → high 로 처리).",
  },
  Alibaba: {
    param: "enable_thinking",
    paramFull: "API: enable_thinking (켜기/끄기) + thinking_budget (생각 길이 제한)",
    value: {},
    apps: [],
    none: "생각 끔 (enable_thinking = false)",
    onOff: true,
    note: "Qwen 은 단계 대신 '생각 켜기/끄기'와 생각 길이 제한(thinking_budget)으로 조절해요.",
  },
  Zhipu: {
    param: "thinking",
    paramFull: 'API: thinking.type = "enabled" / "disabled"',
    value: {},
    apps: [],
    none: 'thinking 끔 (thinking.type = "disabled")',
    onOff: true,
    note: "GLM 은 단계 없이 '생각 켜기/끄기'만 있어요 (GLM-5.3 은 끌 수 없음).",
  },
  Moonshot: {
    param: "thinking",
    paramFull: 'API: thinking.type = "enabled" / "disabled"',
    value: {},
    apps: [],
    none: 'thinking 끔 (thinking.type = "disabled")',
    onOff: true,
    note: "Kimi 는 단계 없이 '생각 켜기/끄기'만 있어요 (Kimi K3 는 끌 수 없음).",
  },
};

// 공식 문서의 모델별 기본 등급 (가격 사이트 정보보다 우선)
window.EFFORT_DEFAULTS = {
  "claude-opus-5-5": "medium",
  "claude-fable-5-1": "high", "claude-fable-5": "high", "claude-sonnet-5-5": "high", "claude-opus-5": "high",
  "gpt-6-astra": "medium", "gpt-6-1-sol": "medium", "gpt-6-sol": "medium", "gpt-6-luna": "medium",
  "gpt-5-6-sol": "medium", "gpt-5-6-terra": "medium", "gpt-5-6-luna": "medium", "gpt-5-5": "medium",
  "gemini-3-8-flash": "medium", "gemini-3-7-flash": "medium", "gemini-3-6-flash": "medium",
  "gemini-3-5-flash-lite": "minimal", "gemini-3-1-pro": "high", "gemini-3-1-pro-preview": "high",
  "grok-4-7": "high", "grok-4-6": "high", "deepseek-v4-1-flash": "high",
};
