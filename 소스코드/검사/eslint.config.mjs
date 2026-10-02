// 화면 코드(자바스크립트) 검사 규칙 (ESLint) — 검사.py 가 도구 폴더로 복사해서 씀
//  (구글 드라이브 안에는 node_modules 를 두지 않기 때문에, 규칙 파일만 여기 두고 도구는 드라이브 밖에 설치)
import js from "@eslint/js";
import globals from "globals";

const strict = {
  "no-use-before-define": ["error", { functions: false, classes: true, variables: true }],
  "no-shadow": "error",
  "eqeqeq": ["error", "smart"],
  "no-unused-vars": ["error", { args: "after-used", caughtErrors: "none" }],
  "prefer-const": "error",
  "no-var": "error",
  "consistent-return": "error",
  "no-eval": "error",
  "no-implied-eval": "error",
  "no-new-func": "error",
  "no-script-url": "error",
  "no-alert": "error",
  "no-self-compare": "error",
  "no-template-curly-in-string": "error",
  "no-unmodified-loop-condition": "error",
  "no-unreachable-loop": "error",
  "no-constructor-return": "error",
  "no-promise-executor-return": "error",
  "array-callback-return": "error",
  "no-empty": ["error", { allowEmptyCatch: true }],
};

export default [
  { ignores: ["**/lib/**", "**/data.js", "**/node_modules/**"] },
  js.configs.recommended,
  {
    files: ["웹/**/*.js"],
    languageOptions: { ecmaVersion: 2023, sourceType: "script", globals: { ...globals.browser, echarts: "readonly" } },
    rules: strict,
  },
  {
    files: ["웹/core.js"],
    languageOptions: { globals: { module: "writable" } },
  },
  {
    files: ["웹/sw.js"],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    files: ["테스트/**/*.mjs", "검사/**/*.mjs"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: { ...globals.node } },
    rules: { ...strict, "no-promise-executor-return": "off" },
  },
  {
    // 화면 시험: 일부 함수는 브라우저 안에서 실행됨 (document·window·echarts 를 씀)
    files: ["테스트/화면_시험.mjs"],
    languageOptions: { globals: { ...globals.browser, echarts: "readonly" } },
  },
];
