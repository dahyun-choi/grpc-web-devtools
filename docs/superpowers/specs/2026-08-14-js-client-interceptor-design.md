# JS Client Interceptor — 설계 스펙

**날짜:** 2026-08-14  
**브랜치:** feat/js-intercept  
**목표:** proto 파일 없이 JS 레이어에서 gRPC 호출을 가로채어 인증이 유지된 채로 Edit & Repeat 가능하게 한다.

---

## 배경

현재 Edit & Repeat는 XHR/fetch 레벨에서 바이너리 protobuf를 캡처한 후, raw fetch로 재전송한다. 이 방식의 문제:
- Authorization 헤더 등 인증 정보를 수동으로 포함해야 함
- CORS 제약으로 실패하는 경우 존재
- proto 파일 없이 요청 내용을 JSON으로 편집 불가

gRPC Request Inspector(크롬 익스텐션)는 grpc-web/connect-web 라이브러리의 JS 메서드를 monkey-patch하여, 직렬화 전 JS 객체 레벨에서 요청을 캡처한다. replay 시 원본 클라이언트 클로저를 재호출하므로 인증이 자동으로 유지된다.

---

## 범위

### 포함
- `public/js-client-interceptor.js` 신규 파일 (grpc-web + connect-web 지원)
- `public/content-script.js` 수정: 새 interceptor 주입 + replay 메시지 relay
- `public/manifest.json` 수정: `js-client-interceptor.js` web_accessible_resources 추가
- `src/` DevTools 패널 수정: replayToken 기반 JS replay 경로 추가

### 제외
- protobuf-ts 지원 (추후 필요 시 추가)
- 기존 XHR 레벨 interceptor 제거
- RequestGenerator 변경

---

## 아키텍처

```
[페이지 JS 레이어]
  js-client-interceptor.js     ← 신규 (monkey-patch, JS 객체 레벨)
  grpc-web-interceptor.js      ← 기존 유지 (XHR/fetch 레벨, 안전망)
       ↓ window.postMessage(__GRPCWEB_DEVTOOLS__)
[content-script.js]
       ↓ chrome.runtime.port
[background.js]                ← 변경 없음
       ↓
[DevTools 패널]
  replayToken 있음 → JS replay 경로 (인증 자동)
  replayToken 없음 → 기존 raw fetch 경로 유지
```

---

## 컴포넌트 상세

### 1. `public/js-client-interceptor.js` (신규)

**책임:** grpc-web/connect-web 클라이언트 메서드 monkey-patch, 요청 캡처, replay 처리

**전역 등록:**
```js
window.__GRPCWEB_DEVTOOLS__ = function(clients) { ... }   // grpc-web
window.__CONNECT_WEB_DEVTOOLS__ = next => req => ...      // connect-web
```

**캡처 시 postMessage 포맷:**
```js
window.postMessage({
  type: "__GRPCWEB_DEVTOOLS__",
  transport: "grpc-web" | "connect-web",
  method,
  methodType: "unary" | "server_streaming",
  requestId,
  request,       // JS 객체 (toObject() 결과)
  replayToken,   // 랜덤 토큰, registry에 invoke 클로저 저장
  __jsIntercepted: true,   // XHR 레벨 중복 방지 마커
  phase: "start" | "complete" | "error" | "message",
}, "*");
```

**Replay 흐름:**
1. `window.addEventListener("message")` 에서 `__GRPCWEB_DEVTOOLS_REPLAY_REQUEST__` 타입 수신
2. `registry.get(replayToken).invoke(editedJson, command)` 호출
3. invoke 내부: `originalRequest.constructor.fromJson(editedJson)` → 원본 gRPC 메서드 재호출
4. ACK 또는 REJECTED를 `window.postMessage`로 반환

**Registry 관리:**
- 최대 100개, LRU 방식으로 오래된 것 제거
- 페이지 unload/hide 시 clear

**중복 캡처 방지:**
- `__jsIntercepted: true` 마커를 포함한 postMessage를 content-script가 수신하면, 같은 requestId에 대해 XHR 레벨 이벤트가 와도 무시

### 2. `public/content-script.js` 수정

**추가 사항:**
```js
// js-client-interceptor.js 주입 추가
inject("js-client-interceptor.js");

// JS replay 요청 relay (DevTools → 페이지)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "js_replay_request") {
    window.postMessage({ type: "__GRPCWEB_DEVTOOLS_REPLAY_REQUEST__", ...msg.data }, "*");
  }
});

// JS replay 결과 relay (페이지 → DevTools)
window.addEventListener("message", (event) => {
  if (event.data?.type === "__GRPCWEB_DEVTOOLS_REPLAY_ACK__" ||
      event.data?.type === "__GRPCWEB_DEVTOOLS_REPLAY_REJECTED__") {
    chrome.runtime.sendMessage({ action: "js_replay_result", data: event.data });
  }
});
```

### 3. `public/manifest.json` 수정

`web_accessible_resources`에 `"js-client-interceptor.js"` 추가.

### 4. DevTools 패널 (`src/`) 수정

**`NetworkDetails.js` 또는 Edit & Repeat 진입점:**

```js
// replayToken이 있으면 JS replay 사용
if (entry.replayToken) {
  chrome.runtime.sendMessage({
    action: "js_replay_request",
    data: {
      replayToken: entry.replayToken,
      transport: entry.transport,
      request: editedJson,         // 사용자가 편집한 JSON
      captureId: entry.captureId,
    }
  });
} else {
  // 기존 data-* attribute 방식
  repeatViaRawFetch(entry);
}
```

---

## 데이터 흐름 — JS Replay

```
사용자가 "Edit & Repeat" 클릭 (replayToken 있음)
  ↓
DevTools 패널: chrome.runtime.sendMessage({ action: "js_replay_request", ... })
  ↓
content-script: window.postMessage({ type: "__GRPCWEB_DEVTOOLS_REPLAY_REQUEST__", ... })
  ↓
js-client-interceptor.js: registry.get(replayToken).invoke(editedJson)
  ↓
원본 gRPC 클라이언트 메서드 재호출 (인증 자동 유지)
  ↓
응답 캡처 → window.postMessage({ type: "__GRPCWEB_DEVTOOLS__", phase: "complete", ... })
  ↓
DevTools 패널: 새 항목으로 표시
```

---

## 엣지 케이스

| 케이스 | 처리 |
|--------|------|
| 페이지 새로고침 후 replay | registry 소멸 → REJECTED 반환, 기존 raw fetch 폴백 안내 |
| JS intercept 미지원 라이브러리 | XHR 레벨 캡처만 동작, replayToken 없음 → 기존 경로 |
| grpc-web 라이브러리 미초기화 상태에서 주입 | `__GRPCWEB_DEVTOOLS__` 함수만 등록, 라이브러리가 나중에 호출 시 동작 |
| 동일 요청 XHR + JS 양쪽 캡처 | `__jsIntercepted: true` 마커로 XHR 레벨 무시 |

---

## 파일 변경 요약

| 파일 | 변경 유형 |
|------|-----------|
| `public/js-client-interceptor.js` | 신규 생성 |
| `public/content-script.js` | 수정 (주입 추가, relay 로직) |
| `public/manifest.json` | 수정 (web_accessible_resources) |
| `src/components/NetworkDetails.js` | 수정 (JS replay 경로 분기) |
| `src/state/network.js` | 수정 (replayToken 필드 추가) |
