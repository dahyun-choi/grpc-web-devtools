// Check if already initialized by grpc-web-interceptor
if (typeof __grpcWebDevtoolsRequestId === 'undefined') {
  var __grpcWebDevtoolsRequestId = 1;
}

/**
 * Reads the message from the stream and posts it to the window.
 * This is a generator function that will be passed to the response stream.
 */
async function* readMessage(req, stream, requestId) {
  for await (const m of stream) {
    if (m) {
      const resp = m.toJson?.();
      window.postMessage({
        type: "__GRPCWEB_DEVTOOLS__",
        methodType: "server_streaming",
        method: req.method.name,
        requestId,
        request: req.message.toJson?.(),
        response: resp,
      }, "*");
    }
    yield m;
  }
}

/**
 * This interceptor will be passed every request and response. We will take that request and response
 * and post a message to the window. This will allow us to access this message in the content script. This
 * is all to make the manifest v3 happy.
 */
if (typeof window.__CONNECT_WEB_DEVTOOLS__ === 'undefined') {
  const interceptor = (next) => async (req) => {
  const requestId = __grpcWebDevtoolsRequestId++;

  // Capture pending raw request and associate with requestId
  setTimeout(() => {
    if (window.__grpcWebDevtoolsPendingRequest) {
      const rawReq = window.__grpcWebDevtoolsPendingRequest;
      if (window.__grpcWebDevtoolsRawRequests) {
        window.__grpcWebDevtoolsRawRequests.set(requestId, rawReq);
      }

      // Forward raw body to panel so Repeat can find it in rawRequestsCache.
      // DebuggerCapture used to do this, but it is now lazy-attached.
      let bodyBase64 = null;
      try {
        if (rawReq.body instanceof ArrayBuffer) {
          const bytes = new Uint8Array(rawReq.body);
          let bin = '';
          for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
          bodyBase64 = btoa(bin);
        } else if (rawReq.body instanceof Uint8Array) {
          let bin = '';
          for (let i = 0; i < rawReq.body.length; i++) bin += String.fromCharCode(rawReq.body[i]);
          bodyBase64 = btoa(bin);
        }
      } catch (_) {}

      if (bodyBase64) {
        window.postMessage({
          type: '__GRPCWEB_DEVTOOLS_RAW_REQUEST__',
          requestId: requestId,
          rawRequest: {
            url: rawReq.url,
            method: rawReq.method,
            headers: rawReq.headers || {},
            body: bodyBase64,
            encoding: 'base64',
            timestamp: rawReq.timestamp,
          }
        }, '*');
      }

      delete window.__grpcWebDevtoolsPendingRequest;
    }
  }, 10);

  try {
    const resp = await next(req);
    if (!resp.stream) {
      window.postMessage({
        type: "__GRPCWEB_DEVTOOLS__",
        methodType: "unary",
        method: req.method.name,
        requestId,
        request: req.message.toJson(),
        response: resp.message.toJson(),
      }, "*")
      return resp;
    } else {
      return {
        ...resp,
        message: readMessage(req, resp.message, requestId),
      }
    }
  } catch (e) {
    window.postMessage({
      type: "__GRPCWEB_DEVTOOLS__",
      methodType: req.stream ? "server_streaming" : "unary",
      method: req.method.name,
      requestId,
      request: req.message.toJson?.(),
      response: undefined,
      error: {
        message: e.message,
        code: e.code,
      }
    }, "*")
    throw e;
  }
  };

  window.__CONNECT_WEB_DEVTOOLS__ = interceptor;
}

// Always dispatch ready event — js-client-interceptor.js may have already set
// window.__CONNECT_WEB_DEVTOOLS__ (MAIN world, runs before page scripts), so the
// if-block above is skipped. Dispatching here ensures the app's listener always fires
// and picks up whichever interceptor is currently registered.
const readyEvent = new CustomEvent("connect-web-dev-tools-ready");
window.dispatchEvent(readyEvent);
