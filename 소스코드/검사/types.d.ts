// 화면 코드 타입 검사용 선언 (실행에는 쓰이지 않음)
//  · echarts 는 lib/echarts.min.js 로 들어오는 그래프 도구
//  · window 에 붙는 값들: data.js · effort_guide.js · core.js 가 넣음
declare const echarts: any;

interface Window {
  MODEL_DATA?: any;
  EFFORT_GUIDE?: Record<string, any>;
  EFFORT_GUIDE_DATE?: string;
  EFFORT_DEFAULTS?: Record<string, string>;
  AICore?: any;
  __rvReady?: boolean;
}

// core.js 를 node 시험에서 require 할 때 쓰는 모듈 객체 (브라우저에는 없음)
declare var module: { exports: any } | undefined;
