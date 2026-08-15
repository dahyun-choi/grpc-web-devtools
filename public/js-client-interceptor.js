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

  // Patch window.fetch HERE (synchronous, MAIN world, document_start) so the patch
  // is in place before connect-web or any page script captures the fetch reference.
  // grpc-web-interceptor.js does the same but via async <script> tag — too late.
  const _origFetch = window.fetch;
  window.fetch = function(url, options) {
    if (options && options.body) {
      const urlStr = typeof url === 'string' ? url : (url && url.toString ? url.toString() : '');
      window.__grpcWebDevtoolsPendingRequest = {
        method: options.method || 'POST',
        url: urlStr,
        headers: options.headers || {},
        body: options.body,
        timestamp: Date.now(),
      };
    }
    return _origFetch.apply(this, arguments);
  };

  if (typeof window.__grpcWebDevtoolsRequestId === 'undefined') {
    window.__grpcWebDevtoolsRequestId = 1;
  }
  function nextRequestId() { return window.__grpcWebDevtoolsRequestId++; }

  const registry = new Map();

  if (!window.__grpcWebJsInterceptedMethods) {
    window.__grpcWebJsInterceptedMethods = new Map();
  }
  const interceptedMethods = window.__grpcWebJsInterceptedMethods;

  // Step 2: replayToken generation + registry management
  function randomToken() {
    const arr = new Uint32Array(4);
    (window.crypto || window.msCrypto).getRandomValues(arr);
    return Array.from(arr, v => v.toString(36)).join('-');
  }

  function registerHandle(invoke) {
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
    registry.delete(token);
    registry.set(token, h);
    return h;
  }

  // Step 3: postMessage helpers + serialization/reconstruction
  function post(payload) {
    try { window.postMessage({ type: POST_TYPE, __jsIntercepted: true, ...payload }, '*'); }
    catch (_) {}
  }

  function serializeGrpcWeb(request) {
    try {
      if (request && typeof request.toObject === 'function') return request.toObject();
      return request;
    } catch (_) { return { __serializationError: true }; }
  }

  function serializeConnectWeb(request) {
    try {
      if (request && typeof request.toJson === 'function') return request.toJson({ emitDefaultValues: true });
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

  // Step 4: instrumentGrpcWebClient
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

    if (typeof origServerStreaming === 'function') {
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
  }

  // Step 5: Register window.__GRPCWEB_DEVTOOLS__
  const prevGrpcDevtools = window.__GRPCWEB_DEVTOOLS__;
  window.__GRPCWEB_DEVTOOLS__ = function(clients) {
    if (Array.isArray(clients)) clients.forEach(instrumentGrpcWebClient);
    if (typeof prevGrpcDevtools === 'function') prevGrpcDevtools(clients);
  };

  // Step 6: Register window.__CONNECT_WEB_DEVTOOLS__
  // Use Object.defineProperty so our handler wins regardless of script execution order.
  // Dynamically inserted <script> tags are async — connect-web-interceptor.js may run
  // after us and overwrite a plain assignment. The setter silently ignores such writes.
  var _cwFactory = (next) => async (req) => {
    const requestId = nextRequestId();
    const requestPayload = serializeConnectWeb(req.message);
    const methodName = req.method && req.method.name ? req.method.name : String(req.url || '');
    const methodType = req.stream ? 'server_streaming' : 'unary';
    const replayToken = registerHandle((json, _cmd) => {
      const replayReq = reconstructConnectWeb(req.message, json);
      return next({ ...req, message: replayReq });
    });

    interceptedMethods.set(methodName, Date.now());
    post({ transport: TRANSPORT_CONNECT, phase: 'start', method: methodName, methodType, requestId, request: requestPayload, replayToken });

    try {
      const response = await next(req);
      post({ transport: TRANSPORT_CONNECT, phase: 'complete', method: methodName, methodType, requestId, response: serializeConnectWeb(response.message) });
      return response;
    } catch (error) {
      post({ transport: TRANSPORT_CONNECT, phase: 'error', method: methodName, methodType, requestId, error: { code: error.code, message: error.message } });
      throw error;
    }
  };
  Object.defineProperty(window, '__CONNECT_WEB_DEVTOOLS__', {
    get: function() { return _cwFactory; },
    set: function() { /* ignored — js-client-interceptor owns this property */ },
    configurable: true,
    enumerable: true,
  });

  // Step 7: Replay listener + cleanup
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
})();
