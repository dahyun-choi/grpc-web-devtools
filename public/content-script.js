// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

// Inject grpc-web interceptor script
var grpcWebScript = document.createElement('script');
grpcWebScript.src = chrome.runtime.getURL('grpc-web-interceptor.js');
grpcWebScript.onload = function () {
  this.remove();
};
(document.head || document.documentElement).appendChild(grpcWebScript);

// Old inline injection code removed - now using external grpc-web-interceptor.js file
const injectContent_REMOVED = `
let __grpcWebDevtoolsRequestId = 1;
let __grpcWebDevtoolsClients = [];
const __grpcWebDevtoolsMethodInfo = new Map();

console.log('[gRPC DevTools] Injected script loaded (inline)');

window.__GRPCWEB_DEVTOOLS__ = function (clients) {
  if (clients.constructor !== Array) {
    return
  }
  __grpcWebDevtoolsClients = clients;
  const postType = "__GRPCWEB_DEVTOOLS__";
  var StreamInterceptor = function (method, request, stream) {
    this._callbacks = {};
    const methodType = "server_streaming";
    const requestId = __grpcWebDevtoolsRequestId++;
    this._requestId = requestId;
    window.postMessage({
      type: postType,
      method,
      methodType,
      requestId,
      request: request.toObject(),
    });
    stream.on('data', response => {
      window.postMessage({
        type: postType,
        method,
        methodType,
        requestId,
        response: response.toObject(),
      });
      if (!!this._callbacks['data']) {
        this._callbacks['data'](response);
      }
    });
    stream.on('status', status => {
      if (status.code === 0) {
        window.postMessage({
          type: postType,
          method,
          methodType,
          requestId,
          response: "EOF",
        });
      }
      if (!!this._callbacks['status']) {
        this._callbacks['status'](status);
      }
    });
    stream.on('error', error => {
      if (error.code !== 0) {
        window.postMessage({
          type: postType,
          method,
          methodType,
          requestId,
          error: {
            code: error.code,
            message: error.message,
          },
        });
      }
      if (!!this._callbacks['error']) {
        this._callbacks['error'](error);
      }
    });
    this._stream = stream;
  }
  StreamInterceptor.prototype.on = function (type, callback) {
    this._callbacks[type] = callback;
    return this;
  }
  StreamInterceptor.prototype.cancel = function () {
    this._stream.cancel()
  }
  clients.map(client => {
    client.client_.rpcCall_ = client.client_.rpcCall;
    client.client_.rpcCall2 = function (method, request, metadata, methodInfo, callback) {
      // Store method info for repeat functionality
      if (!__grpcWebDevtoolsMethodInfo.has(method)) {
        __grpcWebDevtoolsMethodInfo.set(method, {
          client: client,
          RequestType: request.constructor,
          metadata: metadata,
          descriptor: methodInfo,
          isStreaming: false
        });
      }

      var posted = false;
      var requestId = __grpcWebDevtoolsRequestId++;
      var newCallback = function (err, response) {
        if (!posted) {
          window.postMessage({
            type: postType,
            method,
            methodType: "unary",
            requestId,
            request: request.toObject(),
            response: err ? undefined : response.toObject(),
            error: err || undefined,
          }, "*")
          posted = true;
        }
        callback(err, response)
      }
      return this.rpcCall_(method, request, metadata, methodInfo, newCallback);
    }
    client.client_.rpcCall = client.client_.rpcCall2;
    client.client_.unaryCall = function (method, request, metadata, methodInfo) {
      return new Promise((resolve, reject) => {
        this.rpcCall2(method, request, metadata, methodInfo, function (error, response) {
          error ? reject(error) : resolve(response);
        });
      });
    };
    client.client_.serverStreaming_ = client.client_.serverStreaming;
    client.client_.serverStreaming2 = function (method, request, metadata, methodInfo) {
      // Store method info for repeat functionality
      if (!__grpcWebDevtoolsMethodInfo.has(method)) {
        __grpcWebDevtoolsMethodInfo.set(method, {
          client: client,
          RequestType: request.constructor,
          metadata: metadata,
          descriptor: methodInfo,
          isStreaming: true
        });
      }

      var stream = client.client_.serverStreaming_(method, request, metadata, methodInfo);
      var si = new StreamInterceptor(method, request, stream);
      return si;
    }
    client.client_.serverStreaming = client.client_.serverStreaming2;
  })

  // Poll for repeat requests on documentElement property
  setInterval(function() {
    const data = document.documentElement.__grpcWebDevtoolsRepeatData;
    if (!data) return;

    console.log('[Page] Repeat data detected:', data);

    // Clear immediately to prevent reprocessing
    delete document.documentElement.__grpcWebDevtoolsRepeatData;

    const { method, request } = data;
    console.log('[gRPC DevTools] Method:', method);
    console.log('[gRPC DevTools] Request data:', request);
    console.log('[gRPC DevTools] Available methods:', Array.from(__grpcWebDevtoolsMethodInfo.keys()));

    // Find method info
    const methodInfo = __grpcWebDevtoolsMethodInfo.get(method);
    if (!methodInfo) {
      console.error('[gRPC DevTools] Method info not found for:', method);
      console.error('[gRPC DevTools] Available methods:', Array.from(__grpcWebDevtoolsMethodInfo.keys()));
      return;
    }

    const { client, RequestType, metadata, isStreaming } = methodInfo;

    if (!client || !RequestType) {
      console.error('[gRPC DevTools] Invalid method info');
      return;
    }

    try {
      // Create new request message from stored data
      const requestMessage = new RequestType();

      // Reconstruct the request from plain object
      if (request && typeof request === 'object') {
        Object.keys(request).forEach(key => {
          if (request[key] !== undefined && request[key] !== null) {
            const setterName = 'set' + key.charAt(0).toUpperCase() + key.slice(1);
            if (typeof requestMessage[setterName] === 'function') {
              requestMessage[setterName](request[key]);
            }
          }
        });
      }

      console.log('[gRPC DevTools] Repeating request for:', method);

      // Execute the request
      if (isStreaming) {
        client.client_.serverStreaming(method, requestMessage, metadata || {}, methodInfo.descriptor);
      } else {
        client.client_.unaryCall(method, requestMessage, metadata || {}, methodInfo.descriptor)
          .then(() => {
            console.log('[gRPC DevTools] Repeat request completed');
          })
          .catch(err => {
            console.error('[gRPC DevTools] Repeat request failed:', err);
          });
      }
    } catch (e) {
      console.error('[gRPC DevTools] Failed to repeat request:', e);
    }
  }, 100);

  console.log('[gRPC DevTools] Repeat polling started');

  // Also keep window message listener for backwards compatibility
  window.addEventListener('message', function(event) {
    if (event.source !== window) return;

    console.log('[Page] Window message received, type:', event.data?.type);

    if (event.data.type === '__GRPCWEB_DEVTOOLS_REPEAT__') {
      const { method, request } = event.data;
      console.log('[gRPC DevTools] Repeat request received (window message):', method);
      console.log('[gRPC DevTools] Request data:', request);
      console.log('[gRPC DevTools] Available methods:', Array.from(__grpcWebDevtoolsMethodInfo.keys()));

      // Find method info
      const methodInfo = __grpcWebDevtoolsMethodInfo.get(method);
      if (!methodInfo) {
        console.error('[gRPC DevTools] Method info not found for:', method);
        console.error('[gRPC DevTools] Available methods:', Array.from(__grpcWebDevtoolsMethodInfo.keys()));
        return;
      }

      const { client, RequestType, metadata, isStreaming } = methodInfo;

      if (!client || !RequestType) {
        console.error('[gRPC DevTools] Invalid method info');
        return;
      }

      try {
        // Create new request message from stored data
        const requestMessage = new RequestType();

        // Reconstruct the request from plain object
        if (request && typeof request === 'object') {
          Object.keys(request).forEach(key => {
            if (request[key] !== undefined && request[key] !== null) {
              const setterName = 'set' + key.charAt(0).toUpperCase() + key.slice(1);
              if (typeof requestMessage[setterName] === 'function') {
                requestMessage[setterName](request[key]);
              }
            }
          });
        }

        console.log('[gRPC DevTools] Repeating request for:', method);

        // Execute the request
        if (isStreaming) {
          client.client_.serverStreaming(method, requestMessage, metadata || {}, methodInfo.descriptor);
        } else {
          client.client_.unaryCall(method, requestMessage, metadata || {}, methodInfo.descriptor)
            .then(() => {
              console.log('[gRPC DevTools] Repeat request completed');
            })
            .catch(err => {
              console.error('[gRPC DevTools] Repeat request failed:', err);
            });
        }
      } catch (e) {
        console.error('[gRPC DevTools] Failed to repeat request:', e);
      }
    }
  });
}
`
// Old inline injection removed - now using external file above

// Inject script for connect-web
var cs = document.createElement('script');
cs.src = chrome.runtime.getURL('connect-web-interceptor.js');
cs.onload = function () {
  this.remove();
};
(document.head || document.documentElement).appendChild(cs);

var port;
var fallbackRequestId = 1;

function setupPortIfNeeded() {
  if (!port && chrome && chrome.runtime) {
    port = chrome.runtime.connect(null, { name: "content" });
    port.postMessage({ action: "init" });
    port.onMessage.addListener(handlePortMessage);
    port.onDisconnect.addListener(() => {
      port = null;
      window.removeEventListener("message", handleMessageEvent, false);
    });
  }
}

function handlePortMessage(message) {
  console.log('[Content Script] ========== MESSAGE RECEIVED ==========');
  console.log('[Content Script] Message:', message);
  console.log('[Content Script] Action:', message.action);

  if (message.action === "triggerRepeat") {
    console.log('[Content Script] ========== TRIGGER REPEAT ==========');
    console.log('[Content Script] Processing triggerRepeat action');

    const data = message.data;
    console.log('[Content Script] Received data:', JSON.stringify(data, null, 2));

    if (!data) {
      console.error('[Content Script] No data in message');
      return;
    }

    // Set data attributes on documentElement for grpc-web-interceptor.js to pick up
    document.documentElement.setAttribute('data-grpc-repeat-trigger', 'true');
    document.documentElement.setAttribute('data-repeat-url', data.url);
    document.documentElement.setAttribute('data-repeat-method', data.method);
    document.documentElement.setAttribute('data-repeat-grpc', data.grpcMethod);
    document.documentElement.setAttribute('data-repeat-body', data.body);
    document.documentElement.setAttribute('data-repeat-encoding', data.encoding);
    document.documentElement.setAttribute('data-repeat-headers', JSON.stringify(data.headers));
    document.documentElement.setAttribute('data-repeat-request', JSON.stringify(data.request));
    document.documentElement.setAttribute('data-repeat-response', JSON.stringify(data.response));

    console.log('[Content Script] ✓ Set data attributes for repeat');
    console.log('[Content Script]   URL:', data.url);
    console.log('[Content Script]   Body length:', data.body?.length || 0);
    console.log('[Content Script]   Headers:', Object.keys(data.headers || {}));
  }

  if (message.action === "notifyRepeat") {
    console.log('[Content Script] ========== NOTIFY REPEAT ==========');
    console.log('[Content Script] Processing notifyRepeat action');

    const data = message.data;
    console.log('[Content Script] Received data:', JSON.stringify(data, null, 2));

    if (!data) {
      console.error('[Content Script] No data in message');
      return;
    }

    // Use requestId from panel, or generate a new one if not provided
    const requestId = data.requestId || Math.floor(Math.random() * 1000000);
    console.log('[Content Script] Using requestId:', requestId);

    // Decode response body if available
    let responseData = data.response;
    if (!responseData || Object.keys(responseData).length === 0) {
      // If decoded response is empty but we have raw body, try to decode it
      if (data.responseBodyBase64) {
        console.log('[Content Script] Decoded response empty, using raw body');
        // For now, keep the decoded response empty
        // The body will be displayed as raw base64 or decoded later
        responseData = data.response || {};
      }
    }

    const payload = {
      type: "__GRPCWEB_DEVTOOLS__",
      method: data.grpcMethod,
      methodType: "unary",
      requestId: requestId,
      request: data.request,
      response: responseData,
      responseBodyBase64: data.responseBodyBase64 // Pass through for storage
    };

    console.log('[Content Script] ========== PAYLOAD TO POST ==========');
    console.log('[Content Script] Request:', JSON.stringify(payload.request, null, 2));
    console.log('[Content Script] Response:', JSON.stringify(payload.response, null, 2));
    console.log('[Content Script] Response body base64 length:', data.responseBodyBase64?.length || 0);
    console.log('[Content Script] =====================================');

    // Post message to page context
    window.postMessage(payload, "*");

    console.log('[Content Script] ✓ Posted repeat notification with requestId:', requestId);
  }
}

function sendGRPCNetworkCall(data) {
  if (!data.requestId) {
    data.requestId = fallbackRequestId++;
  }
  setupPortIfNeeded();
  if (port) {
    port.postMessage({
      action: "gRPCNetworkCall",
      target: "panel",
      data,
    });
  }
}

function handleMessageEvent(event) {
  if (event.source != window) return;

  if (event.data.type && event.data.type == "__GRPCWEB_DEVTOOLS__") {
    sendGRPCNetworkCall(event.data);
  }

  // Listen for raw request data from page context (sent by grpc-web-interceptor.js)
  if (event.data.type && event.data.type == "__GRPCWEB_DEVTOOLS_RAW_REQUEST__") {
    setupPortIfNeeded();
    if (port) {
      port.postMessage({
        action: "gRPCRawRequest",
        target: "panel",
        data: event.data
      });
      console.log('[Content Script] Forwarded raw request for ID:', event.data.requestId);
    }
  }
}

window.addEventListener("message", handleMessageEvent, false);
