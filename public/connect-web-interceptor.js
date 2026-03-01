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
      if (window.__grpcWebDevtoolsRawRequests) {
        window.__grpcWebDevtoolsRawRequests.set(requestId, window.__grpcWebDevtoolsPendingRequest);
        console.log('[Connect-web] Associated raw request with ID:', requestId);
      } else {
        console.error('[Connect-web] __grpcWebDevtoolsRawRequests not found on window');
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

  /**
   * Since we are loading inject.js as a script, the order at which it is loaded is not guaranteed.
   * So we will publish a custom event that can be used, to be used to assign the interceptor.
   */
  const readyEvent = new CustomEvent("connect-web-dev-tools-ready");
  window.dispatchEvent(readyEvent);
}
