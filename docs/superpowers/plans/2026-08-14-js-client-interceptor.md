# JS Client Interceptor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** proto 파일 없이 JS 레이어에서 gRPC 호출을 monkey-patch하여, 인증이 자동 유지된 채로 Edit & Repeat가 동작하도록 `js-client-interceptor.js`를 추가한다.

**Architecture:** `js-client-interceptor.js`를 MAIN world에 주입하여 grpc-web/connect-web 클라이언트를 monkey-patch한다. 캡처된 요청에 `replayToken`을 부여하고 registry에 invoke 클로저를 저장한다. Edit & Repeat 시 DevTools 패널 → background → content → page 경로로 replay 요청을 라우팅하고, 원본 gRPC 클라이언트를 재호출한다.

**Tech Stack:** Vanilla JS (interceptor), Chrome Extension APIs (MV3 ports), React/Redux (패널)

**Worktree:** `/Users/hmc/Documents/Github/grpc-web-devtools/.worktrees/feat/js-intercept`

---

## File Map

| 파일 | 변경 |
|------|------|
| `public/js-client-interceptor.js` | 신규 생성 (약 250줄) |
| `public/manifest.json` | web_accessible_resources에 추가 |
| `public/content-script.js` | 주입 추가 + replay relay |
| `public/background.js` | js_replay_request/rejected 라우팅 |
| `src/state/network.js` | buildSummaryEntry에 replayToken/transport 추가 |
| `src/index.js` | js_replay_rejected 처리 |
| `src/components/NetworkDetails.js` | JS replay 경로 분기 추가 |

---

## Task 1: `public/js-client-interceptor.js` 생성 — grpc-web monkey-patch

**Files:**
- Create: `public/js-client-interceptor.js`

- [ ] **Step 1: 파일 생성 — IIFE 껍데기, 공유 상태**

```js
// public/js-client-interceptor.js
(() => {
  const POST_TYPE = "__GRPCWEB_DEVTOOLS__";
  const REPLAY_REQUEST_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_REQUEST__";
  const REPLAY_ACK_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_ACK__";
  const REPLAY_REJECTED_TYPE = "__GRPCWEB_DEVTOOLS_REPLAY_REJECTED__";
  const TRANSPORT_GRPC = "grpc-web";
  const TRANSPORT_CONNECT = "connect-web";
  const MAX_HANDLES = 100;
  const INSTRUMENTED = "__grpcJsInterceptorInstrumented__";

  // Shared requestId counter with grpc-web-interceptor.js
  if (typeof window.__grpcWebDevtoolsRequestId === 'undefined') {
    window.__grpcWebDevtoolsRequestId = 1;
  }
  function nextRequestId() {
    return window.__grpcWebDevtoolsRequestId++;
  }

  // Registry: Map<replayToken, { invoke: Function }>
  const registry = new Map();

  // De-dup: methods recently captured by JS interceptor (skip XHR level)
  if (!window.__grpcWebJsInterceptedMethods) {
    window.__grpcWebJsInterceptedMethods = new Map(); // method -> capturedAt (ms)
  }
  const interceptedMethods = window.__grpcWebJsInterceptedMethods;
})();
```

- [ ] **Step 2: replayToken 생성 + registry 관리 함수 추가**

위 IIFE 내부에 추가:

```js
  function randomToken() {
    const arr = new Uint32Array(4);
    (window.crypto || window.msCrypto).getRandomValues(arr);
    return Array.from(arr, v => v.toString(36)).join('-');
  }

  function registerHandle(invoke) {
    // LRU: evict oldest when over limit
    if (registry.size >= MAX_HANDLES) {
      registry.delete(registry.keys().next().value);
    }
    let token;
    for (let i = 0; i < 8; i++) {
      const t = randomToken();
      if (!registry.has(t)) { token = t; break; }
    }
    if (!token) return null;
    registry.set(token, { invoke });
    return token;
  }

  function getHandle(token) {
    const h = registry.get(token);
    if (!h) return null;
    // LRU refresh
    registry.delete(token);
    registry.set(token, h);
    return h;
  }
```

- [ ] **Step 3: postMessage 헬퍼 + 직렬화 함수 추가**

```js
  function post(payload) {
    try { window.postMessage({ type: POST_TYPE, __jsIntercepted: true, ...payload }, '*'); }
    catch (_) {}
  }

  function serializeGrpcWeb(request) {
    try {
      if (request && typeof request.toObject === 'function') {
        return request.toObject();
      }
      return request;
    } catch (_) { return { __serializationError: true }; }
  }

  function serializeConnectWeb(request) {
    try {
      if (request && typeof request.toJson === 'function') {
        return request.toJson({ emitDefaultValues: true });
      }
      return request;
    } catch (_) { return { __serializationError: true }; }
  }

  function reconstructGrpcWeb(originalRequest, json) {
    if (!originalRequest || typeof originalRequest.constructor !== 'function') {
      throw new Error('Cannot reconstruct: no original request constructor');
    }
    const msg = new originalRequest.constructor();
    Object.keys(json).forEach(key => {
      const setter = 'set' + key.charAt(0).toUpperCase() + key.slice(1);
      if (typeof msg[setter] === 'function') {
        try { msg[setter](json[key]); } catch (_) {}
      }
    });
    return msg;
  }

  function reconstructConnectWeb(originalRequest, json) {
    const C = originalRequest && originalRequest.constructor;
    if (!C) throw new Error('Cannot reconstruct connect-web request');
    if (typeof C.fromJson === 'function') return C.fromJson(json);
    if (typeof C.fromJsonString === 'function') return C.fromJsonString(JSON.stringify(json));
    try { return new C(json); } catch (_) {}
    throw new Error('No supported fromJson method on connect-web request type');
  }
```

- [ ] **Step 4: grpc-web instrumentClient 함수 추가**

```js
  function instrumentGrpcWebClient(client) {
    const target = client && client.client_;
    if (!target || target[INSTRUMENTED]) return;
    const origRpcCall = target.rpcCall;
    const origServerStreaming = target.serverStreaming;
    if (typeof origRpcCall !== 'function') return;
    Object.defineProperty(target, INSTRUMENTED, { value: true, configurable: true });

    target.rpcCall = function rpcCall(method, request, metadata, methodInfo, callback) {
      const requestId = nextRequestId();
      const requestPayload = serializeGrpcWeb(request);
      const replayToken = registerHandle((json, _cmd) => {
        const replayReq = reconstructGrpcWeb(request, json);
        return target.rpcCall(method, replayReq, metadata, methodInfo, () => {});
      });

      interceptedMethods.set(method, Date.now());
      post({ transport: TRANSPORT_GRPC, phase: 'start', method, methodType: 'unary', requestId, request: requestPayload, replayToken });

      return origRpcCall.call(this, method, request, metadata, methodInfo, (error, response) => {
        if (error) {
          post({ transport: TRANSPORT_GRPC, phase: 'error', method, methodType: 'unary', requestId, error: { code: error.code, message: error.message } });
        } else {
          post({ transport: TRANSPORT_GRPC, phase: 'complete', method, methodType: 'unary', requestId, response: serializeGrpcWeb(response) });
        }
        if (typeof callback === 'function') callback(error, response);
      });
    };

    target.serverStreaming = function serverStreaming(method, request, metadata, methodInfo) {
      const requestId = nextRequestId();
      const requestPayload = serializeGrpcWeb(request);
      const replayToken = registerHandle((json, _cmd) => {
        const replayReq = reconstructGrpcWeb(request, json);
        return origServerStreaming.call(target, method, replayReq, metadata, methodInfo);
      });

      interceptedMethods.set(method, Date.now());
      post({ transport: TRANSPORT_GRPC, phase: 'start', method, methodType: 'server_streaming', requestId, request: requestPayload, replayToken });

      const stream = origServerStreaming.call(this, method, request, metadata, methodInfo);
      stream.on('data', resp => {
        post({ transport: TRANSPORT_GRPC, phase: 'message', method, methodType: 'server_streaming', requestId, response: serializeGrpcWeb(resp) });
      });
      stream.on('status', status => {
        if (status.code === 0) {
          post({ transport: TRANSPORT_GRPC, phase: 'complete', method, methodType: 'server_streaming', requestId });
        }
      });
      stream.on('error', err => {
        post({ transport: TRANSPORT_GRPC, phase: 'error', method, methodType: 'server_streaming', requestId, error: { code: err.code, message: err.message } });
      });
      return stream;
    };
  }
```

- [ ] **Step 5: `window.__GRPCWEB_DEVTOOLS__` 등록 (grpc-web 진입점)**

```js
  // grpc-web library calls window.__GRPCWEB_DEVTOOLS__(clients) if defined
  const prevGrpcDevtools = window.__GRPCWEB_DEVTOOLS__;
  window.__GRPCWEB_DEVTOOLS__ = function(clients) {
    if (Array.isArray(clients)) clients.forEach(instrumentGrpcWebClient);
    // Call previous handler if existed (e.g., from the old grpc-web-interceptor.js)
    if (typeof prevGrpcDevtools === 'function') prevGrpcDevtools(clients);
  };
```

- [ ] **Step 6: connect-web 인터셉터 팩토리 등록**

```js
  // connect-web library uses window.__CONNECT_WEB_DEVTOOLS__ as an interceptor factory
  window.__CONNECT_WEB_DEVTOOLS__ = (next) => async (req) => {
    const requestId = nextRequestId();
    const requestPayload = serializeConnectWeb(req.message);
    const methodName = req.method && req.method.name ? req.method.name : String(req.url || '');
    const replayToken = registerHandle((json, _cmd) => {
      const replayReq = reconstructConnectWeb(req.message, json);
      return next({ ...req, message: replayReq });
    });

    interceptedMethods.set(methodName, Date.now());
    post({ transport: TRANSPORT_CONNECT, phase: 'start', method: methodName, methodType: req.stream ? 'server_streaming' : 'unary', requestId, request: requestPayload, replayToken });

    try {
      const response = await next(req);
      post({ transport: TRANSPORT_CONNECT, phase: 'complete', method: methodName, methodType: 'unary', requestId, response: serializeConnectWeb(response.message) });
      return response;
    } catch (error) {
      post({ transport: TRANSPORT_CONNECT, phase: 'error', method: methodName, methodType: 'unary', requestId, error: { code: error.code, message: error.message } });
      throw error;
    }
  };
```

- [ ] **Step 7: replay 리스너 등록 + 클린업**

```js
  function handleReplay(event) {
    const data = event.source === window ? event.data : null;
    if (!data || data.type !== REPLAY_REQUEST_TYPE) return;
    const { replayToken, transport, request: editedJson, captureId, replayAttemptId } = data;

    const base = { captureId, replayToken, replayAttemptId };

    if (typeof replayToken !== 'string') {
      window.postMessage({ type: REPLAY_REJECTED_TYPE, ...base, reason: 'replayToken is missing' }, '*');
      return;
    }
    const handle = getHandle(replayToken);
    if (!handle) {
      window.postMessage({ type: REPLAY_REJECTED_TYPE, ...base, reason: 'Replay handle expired or not found. Reload the page and retry.' }, '*');
      return;
    }
    if (!editedJson || typeof editedJson !== 'object') {
      window.postMessage({ type: REPLAY_REJECTED_TYPE, ...base, reason: 'Invalid replay request body' }, '*');
      return;
    }
    try {
      const result = handle.invoke(editedJson, data);
      const p = result && typeof result.then === 'function' ? result : Promise.resolve();
      p.catch(() => {});
      window.postMessage({ type: REPLAY_ACK_TYPE, ...base }, '*');
    } catch (error) {
      window.postMessage({ type: REPLAY_REJECTED_TYPE, ...base, reason: error.message || 'Replay failed' }, '*');
    }
  }

  window.addEventListener('message', handleReplay, false);
  window.addEventListener('pagehide', () => registry.clear(), false);
  window.addEventListener('unload', () => registry.clear(), false);
```

- [ ] **Step 8: 파일 저장 확인 (lint/syntax)**

```bash
cd /Users/hmc/Documents/Github/grpc-web-devtools/.worktrees/feat/js-intercept
node --check public/js-client-interceptor.js
```

Expected: 오류 없이 종료

- [ ] **Step 9: 커밋**

```bash
cd /Users/hmc/Documents/Github/grpc-web-devtools/.worktrees/feat/js-intercept
git add public/js-client-interceptor.js
git commit -m "feat: js-client-interceptor.js 추가 — grpc-web/connect-web monkey-patch"
```

---

## Task 2: `public/grpc-web-interceptor.js` — JS intercept와 중복 캡처 방지

**Files:**
- Modify: `public/grpc-web-interceptor.js`

**전략:** JS interceptor와 XHR interceptor가 같은 gRPC 호출을 캡처하면 DevTools에 중복 항목이 생긴다. 두 interceptor는 서로 다른 requestId를 생성하므로 requestId로 dedup할 수 없다. 대신 `window.__grpcWebJsInterceptedMethods` Map(method → capturedAt)을 사용한다. JS interceptor가 method를 캡처하면 이 Map에 기록하고, XHR interceptor는 같은 method를 3초 이내에 캡처하면 `__GRPCWEB_DEVTOOLS__` 이벤트 전송을 건너뛴다. **단, raw request 저장(`__GRPCWEB_DEVTOOLS_RAW_REQUEST__`)은 건너뛰지 않는다** — raw fetch fallback에 필요하기 때문이다.

- [ ] **Step 1: 중복 방지 헬퍼 함수 추가**

파일 맨 위(전역 변수 선언부 이후)에 추가:

```js
// Skip __GRPCWEB_DEVTOOLS__ postMessage if JS-level interceptor already captured this method.
// Raw request storage (__GRPCWEB_DEVTOOLS_RAW_REQUEST__) is NOT skipped — needed for fallback.
function shouldSkipXhrDevtoolsEvent(method) {
  const jsMap = window.__grpcWebJsInterceptedMethods;
  if (!jsMap || !method) return false;
  const capturedAt = jsMap.get(method);
  if (!capturedAt) return false;
  return (Date.now() - capturedAt) < 3000;
}
```

- [ ] **Step 2: `__GRPCWEB_DEVTOOLS__` postMessage 호출부에 체크 추가**

`grpc-web-interceptor.js`에서 `window.postMessage({ type: "__GRPCWEB_DEVTOOLS__"` 를 보내는 모든 곳(약 3~4개소)을 찾아 감싼다:

```js
// 기존:
window.postMessage({ type: "__GRPCWEB_DEVTOOLS__", method: grpcMethod, ... }, "*");

// 변경:
if (!shouldSkipXhrDevtoolsEvent(grpcMethod || method)) {
  window.postMessage({ type: "__GRPCWEB_DEVTOOLS__", method: grpcMethod, ... }, "*");
}
```

`__GRPCWEB_DEVTOOLS_RAW_REQUEST__` 타입 전송은 변경하지 않는다.

- [ ] **Step 3: syntax 확인**

```bash
cd /Users/hmc/Documents/Github/grpc-web-devtools/.worktrees/feat/js-intercept
node --check public/grpc-web-interceptor.js
```

- [ ] **Step 4: 커밋**

```bash
git add public/grpc-web-interceptor.js
git commit -m "fix: JS intercept 캡처 시 XHR 레벨 중복 DevTools 이벤트 방지"
```

---

## Task 3: `public/manifest.json` 업데이트

**Files:**
- Modify: `public/manifest.json`

- [ ] **Step 1: web_accessible_resources에 추가**

`public/manifest.json`의 `web_accessible_resources[0].resources` 배열에 `"js-client-interceptor.js"` 추가:

```json
"web_accessible_resources": [
  {
    "resources": [
      "grpc-web-interceptor.js",
      "connect-web-interceptor.js",
      "js-client-interceptor.js"
    ],
    "matches": ["<all_urls>"]
  }
]
```

- [ ] **Step 2: 커밋**

```bash
cd /Users/hmc/Documents/Github/grpc-web-devtools/.worktrees/feat/js-intercept
git add public/manifest.json
git commit -m "feat: manifest에 js-client-interceptor.js 추가"
```

---

## Task 4: `public/content-script.js` 업데이트

**Files:**
- Modify: `public/content-script.js`

- [ ] **Step 1: js-client-interceptor.js 주입 — 기존 주입 코드 위에 추가**

`content-script.js` 맨 위 (grpcWebScript 생성 직전)에 추가:

```js
// Inject JS client interceptor FIRST (before XHR-level interceptor)
var jsClientScript = document.createElement('script');
jsClientScript.src = chrome.runtime.getURL('js-client-interceptor.js');
jsClientScript.onload = function() { this.remove(); };
(document.head || document.documentElement).appendChild(jsClientScript);
```

- [ ] **Step 2: replay 요청 relay (background → page) 추가**

`handlePortMessage` 함수 내부 마지막에 추가:

```js
  if (message.action === 'js_replay_request') {
    const data = message.data;
    if (!data) return;
    window.postMessage({
      type: '__GRPCWEB_DEVTOOLS_REPLAY_REQUEST__',
      replayToken: data.replayToken,
      transport: data.transport,
      request: data.request,
      captureId: data.captureId,
      replayAttemptId: data.replayAttemptId,
    }, '*');
  }
```

- [ ] **Step 3: replay 결과 relay (page → background) 추가**

`handleMessageEvent` 함수 내부에 기존 `__GRPCWEB_DEVTOOLS__` 처리 아래에 추가:

```js
  if (event.data.type === '__GRPCWEB_DEVTOOLS_REPLAY_ACK__' ||
      event.data.type === '__GRPCWEB_DEVTOOLS_REPLAY_REJECTED__') {
    setupPortIfNeeded();
    if (port) {
      port.postMessage({
        action: event.data.type === '__GRPCWEB_DEVTOOLS_REPLAY_ACK__'
          ? 'js_replay_ack'
          : 'js_replay_rejected',
        target: 'panel',
        data: {
          captureId: event.data.captureId,
          replayToken: event.data.replayToken,
          replayAttemptId: event.data.replayAttemptId,
          reason: event.data.reason,
        },
      });
    }
  }
```

- [ ] **Step 4: syntax 확인**

```bash
cd /Users/hmc/Documents/Github/grpc-web-devtools/.worktrees/feat/js-intercept
node --check public/content-script.js
```

- [ ] **Step 5: 커밋**

```bash
git add public/content-script.js
git commit -m "feat: content-script에 js-client-interceptor 주입 및 replay relay 추가"
```

---

## Task 5: `public/background.js` 업데이트

**Files:**
- Modify: `public/background.js`

- [ ] **Step 1: js_replay_request / js_replay_ack / js_replay_rejected 라우팅 추가**

`extensionListener` 함수 내부의 기존 `if (message.action == "ping")` 블록 아래에 추가:

```js
    // JS replay: panel → content (relay replay request)
    if (message.action === 'js_replay_request') {
      if (connections[tabId] && connections[tabId].content) {
        try {
          connections[tabId].content.postMessage({ action: 'js_replay_request', data: message.data });
        } catch (err) {
          console.error('[Background] js_replay_request forward failed:', err);
        }
      }
      return;
    }

    // JS replay result: content → panel (relay ack/rejected)
    if (message.action === 'js_replay_ack' || message.action === 'js_replay_rejected') {
      if (connections[tabId] && connections[tabId].panel) {
        try {
          connections[tabId].panel.postMessage({ action: message.action, target: 'panel', data: message.data });
        } catch (err) {
          console.error('[Background] js_replay result forward failed:', err);
        }
      }
      return;
    }
```

- [ ] **Step 2: syntax 확인**

```bash
cd /Users/hmc/Documents/Github/grpc-web-devtools/.worktrees/feat/js-intercept
node --check public/background.js
```

- [ ] **Step 3: 커밋**

```bash
git add public/background.js
git commit -m "feat: background.js에 JS replay 라우팅 추가"
```

---

## Task 6: `src/state/network.js` — replayToken/transport 필드 추가

**Files:**
- Modify: `src/state/network.js`

- [ ] **Step 1: buildSummaryEntry에 replayToken, transport 추가**

`buildSummaryEntry` 함수의 return 객체에 두 필드를 추가한다.

현재:
```js
  return {
    entryId: entry.entryId,
    ...
    streamComplete: entry.streamComplete ?? false,
  };
```

변경:
```js
  return {
    entryId: entry.entryId,
    ...
    streamComplete: entry.streamComplete ?? false,
    replayToken: entry.replayToken ?? null,
    transport: entry.transport ?? null,
  };
```

- [ ] **Step 2: 커밋**

```bash
cd /Users/hmc/Documents/Github/grpc-web-devtools/.worktrees/feat/js-intercept
git add src/state/network.js
git commit -m "feat: network summary에 replayToken/transport 필드 추가"
```

---

## Task 7: `src/index.js` — JS replay 처리 추가

**Files:**
- Modify: `src/index.js`

- [ ] **Step 1: js_replay_rejected 핸들러 추가**

`_onMessageRecived` 함수 내부의 `} else if (action === "gRPCRawRequest") {` 블록 아래에 추가:

```js
  } else if (action === 'js_replay_ack') {
    // No-op: the new gRPC call will appear as a normal gRPCNetworkCall entry
    console.log('[Index] JS replay ACK received');
  } else if (action === 'js_replay_rejected') {
    console.warn('[Index] JS replay REJECTED:', data && data.reason);
    // Surface error to user via window message for NetworkDetails to pick up
    window.dispatchEvent(new CustomEvent('grpc-devtools-replay-rejected', {
      detail: { reason: (data && data.reason) || 'Replay failed', replayAttemptId: data && data.replayAttemptId }
    }));
```

- [ ] **Step 2: gRPCNetworkCall 처리에서 replayToken/transport 패스스루 확인**

`logNetworkEntry(data)` 호출 시 `data`에 `replayToken`, `transport`가 있으면 `addNetworkEntry`가 저장하고 `buildSummaryEntry`가 반환한다. 추가 코드 불필요 — 이미 `data` 객체 전체가 `addNetworkEntry`로 전달됨.

단, `gRPCNetworkCall`에 `__jsIntercepted` 마커 포함 여부 확인: content-script가 `event.data`를 그대로 포워드하므로 자동으로 포함됨.

- [ ] **Step 3: 커밋**

```bash
cd /Users/hmc/Documents/Github/grpc-web-devtools/.worktrees/feat/js-intercept
git add src/index.js
git commit -m "feat: index.js에 JS replay ack/rejected 핸들러 추가"
```

---

## Task 8: `src/components/NetworkDetails.js` — JS replay 경로 추가

**Files:**
- Modify: `src/components/NetworkDetails.js`

- [ ] **Step 1: _jsReplay 헬퍼 메서드 추가**

클래스 내부에 새 메서드를 추가한다 (`_repeatRequest` 메서드 위):

```js
  _jsReplay = (editedJson) => {
    const { entry } = this.props;
    if (!entry || !entry.replayToken) return false;

    const replayAttemptId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Listen for rejection (one-shot)
    const onRejected = (event) => {
      if (event.detail && event.detail.replayAttemptId === replayAttemptId) {
        window.removeEventListener('grpc-devtools-replay-rejected', onRejected);
        console.warn('[Panel] JS replay rejected:', event.detail.reason);
        this.setState({ repeated: false, editSent: false });
        alert(`Replay failed: ${event.detail.reason}\n\nFall back to raw fetch repeat if available.`);
      }
    };
    window.addEventListener('grpc-devtools-replay-rejected', onRejected);
    // Auto-cleanup after 10s
    setTimeout(() => window.removeEventListener('grpc-devtools-replay-rejected', onRejected), 10000);

    const port = window.__GRPCWEB_DEVTOOLS_PORT__;
    const tabId = window.__GRPCWEB_DEVTOOLS_TAB_ID__;
    if (!port) {
      console.error('[Panel] No port available for JS replay');
      return false;
    }

    port.postMessage({
      tabId,
      action: 'js_replay_request',
      data: {
        replayToken: entry.replayToken,
        transport: entry.transport,
        request: editedJson,
        captureId: entry.entryId,  // entryId를 captureId로 사용 (entry.captureId 필드는 없음)
        replayAttemptId,
      },
    });
    return true;
  };
```

- [ ] **Step 2: _repeatRequest에 JS replay 분기 추가**

`_repeatRequest` 함수 내부 시작 부분에 추가 (기존 로직 앞에):

```js
  _repeatRequest = () => {
    const { entry } = this.props;
    if (!entry) return;

    // JS replay path (preferred when available)
    if (entry.replayToken) {
      const cachedEntry = entry.entryId ? getNetworkEntry(entry.entryId) : null;
      const request = (cachedEntry || entry).request || {};
      const sent = this._jsReplay(request);
      if (sent) {
        this.setState({ repeated: true });
        setTimeout(() => this.setState({ repeated: false }), 2000);
        return;
      }
    }

    // Fall through to existing raw fetch repeat logic
    // (existing code continues below unchanged)
```

- [ ] **Step 3: Edit & Repeat (_editRepeat 또는 _startEdit 흐름)에 JS replay 분기 추가**

`_editRepeat` 관련 전송 직전 부분을 찾아 JS replay 분기를 추가한다.
파일에서 `editedData` 또는 `editMode`를 사용하는 전송 코드를 찾아 아래 패턴으로 감싼다:

```js
    // Try JS replay first
    if (entry.replayToken && editedData && editedData.request) {
      const sent = this._jsReplay(editedData.request);
      if (sent) {
        this.setState({ editSent: true });
        setTimeout(() => this.setState({ editSent: false, editMode: false }), 2000);
        return;
      }
    }

    // Fall through to existing raw fetch edit & repeat logic
```

- [ ] **Step 4: 빌드 확인**

```bash
cd /Users/hmc/Documents/Github/grpc-web-devtools/.worktrees/feat/js-intercept
npm run build 2>&1 | tail -20
```

Expected: `Compiled successfully` 또는 경고만 (오류 없음)

- [ ] **Step 5: 커밋**

```bash
git add src/components/NetworkDetails.js
git commit -m "feat: Edit & Repeat에 JS replay 경로 추가"
```

---

## Task 9: 통합 검증 빌드

**Files:**
- Build output: `build/`

- [ ] **Step 1: 클린 빌드**

```bash
cd /Users/hmc/Documents/Github/grpc-web-devtools/.worktrees/feat/js-intercept
npm run build 2>&1 | tail -30
```

Expected: `Compiled successfully`

- [ ] **Step 2: 빌드 결과물에 새 파일 포함 확인**

```bash
ls build/ | grep js-client-interceptor
```

Expected: `js-client-interceptor.js` 출력

- [ ] **Step 3: manifest 확인**

```bash
grep "js-client-interceptor" build/manifest.json
```

Expected: `"js-client-interceptor.js"` 포함

- [ ] **Step 4: 수동 테스트 — Chrome에 로드**

1. Chrome → `chrome://extensions/` → 개발자 모드 활성화
2. "압축해제된 확장 프로그램 로드" → `build/` 폴더 선택
3. grpc-web을 사용하는 페이지 열기 (예: Shucle 앱)
4. DevTools → gRPC-Web 탭 열기
5. 요청 발생 후 항목 클릭 → `replayToken` 있는지 확인 (콘솔에서 `window.__GRPCWEB_DEVTOOLS_PORT__` 확인)
6. "Repeat" 클릭 → 새 항목 추가되는지 확인
7. "Edit & Repeat" → JSON 수정 후 전송 → 수정된 값으로 새 항목 추가되는지 확인

- [ ] **Step 5: 최종 커밋**

```bash
cd /Users/hmc/Documents/Github/grpc-web-devtools/.worktrees/feat/js-intercept
git add -A
git commit -m "chore: JS interceptor 통합 검증 완료"
```
