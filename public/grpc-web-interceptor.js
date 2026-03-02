// gRPC-web interceptor for DevTools

// Check if already initialized by connect-web-interceptor
if (typeof __grpcWebDevtoolsRequestId === 'undefined') {
  var __grpcWebDevtoolsRequestId = 1;
}
if (typeof __grpcWebDevtoolsClients === 'undefined') {
  var __grpcWebDevtoolsClients = [];
}
if (typeof __grpcWebDevtoolsMethodInfo === 'undefined') {
  var __grpcWebDevtoolsMethodInfo = new Map();
}

// Store raw HTTP requests for repeat functionality on window object
if (typeof window.__grpcWebDevtoolsRawRequests === 'undefined') {
  window.__grpcWebDevtoolsRawRequests = new Map();
}
const __grpcWebDevtoolsRawRequests = window.__grpcWebDevtoolsRawRequests;

console.log('[gRPC DevTools] Injected script loaded');

// Intercept XMLHttpRequest to capture raw request data
const OriginalXHR = XMLHttpRequest;
const OriginalXHROpen = OriginalXHR.prototype.open;
const OriginalXHRSend = OriginalXHR.prototype.send;
const OriginalXHRSetRequestHeader = OriginalXHR.prototype.setRequestHeader;

OriginalXHR.prototype.open = function(method, url, ...args) {
  this.__grpcWebDevtools = {
    method: method,
    url: url,
    headers: {}
  };
  return OriginalXHROpen.apply(this, [method, url, ...args]);
};

OriginalXHR.prototype.setRequestHeader = function(header, value) {
  if (this.__grpcWebDevtools) {
    this.__grpcWebDevtools.headers[header] = value;
  }
  return OriginalXHRSetRequestHeader.apply(this, arguments);
};

OriginalXHR.prototype.send = function(body) {
  if (this.__grpcWebDevtools && this.__grpcWebDevtools.url) {
    const url = this.__grpcWebDevtools.url;

    // Store raw request data temporarily by URL
    // We'll get the actual requestId from window.postMessage
    const contentType = this.__grpcWebDevtools.headers['content-type'] || this.__grpcWebDevtools.headers['Content-Type'] || '';
    if (contentType.includes('application/grpc') || url.includes('/')) {
      // Store by URL temporarily
      window.__grpcWebDevtoolsPendingRequest = {
        method: this.__grpcWebDevtools.method,
        url: url,
        headers: {...this.__grpcWebDevtools.headers},
        body: body,
        timestamp: Date.now()
      };

      console.log('[gRPC DevTools] Pending raw request:', url);
    }
  }

  return OriginalXHRSend.apply(this, arguments);
};

console.log('[gRPC DevTools] XMLHttpRequest intercepted');

// Intercept fetch to capture raw request data
const OriginalFetch = window.fetch;
window.fetch = function(url, options) {
  // Capture request details
  if (options && options.body) {
    const urlStr = typeof url === 'string' ? url : url?.toString?.() || '';

    // Store all requests with body
    window.__grpcWebDevtoolsPendingRequest = {
      method: options.method || 'POST',
      url: urlStr,
      headers: options.headers || {},
      body: options.body,
      timestamp: Date.now()
    };
  }

  return OriginalFetch.apply(this, arguments);
};

console.log('[gRPC DevTools] fetch intercepted');

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

    // Capture pending raw request and associate with requestId
    setTimeout(() => {
      if (window.__grpcWebDevtoolsPendingRequest) {
        const rawRequest = window.__grpcWebDevtoolsPendingRequest;
        __grpcWebDevtoolsRawRequests.set(requestId, rawRequest);
        console.log('[gRPC DevTools] Associated raw request with ID:', requestId);

        // Convert body to base64 and send to content script
        let bodyBase64 = null;
        if (rawRequest.body) {
          if (rawRequest.body instanceof ArrayBuffer) {
            const bytes = new Uint8Array(rawRequest.body);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            bodyBase64 = btoa(binary);
          } else if (rawRequest.body instanceof Uint8Array) {
            let binary = '';
            for (let i = 0; i < rawRequest.body.length; i++) {
              binary += String.fromCharCode(rawRequest.body[i]);
            }
            bodyBase64 = btoa(binary);
          } else if (typeof rawRequest.body === 'string') {
            bodyBase64 = btoa(rawRequest.body);
          }
        }

        // Post raw request data to content script
        if (bodyBase64) {
          window.postMessage({
            type: '__GRPCWEB_DEVTOOLS_RAW_REQUEST__',
            requestId: requestId,
            rawRequest: {
              url: rawRequest.url,
              method: rawRequest.method,
              headers: rawRequest.headers,
              body: bodyBase64,
              encoding: 'base64'
            }
          }, '*');

          console.log('[Page] Sent raw request for ID:', requestId, 'body length:', bodyBase64.length);
        }

        delete window.__grpcWebDevtoolsPendingRequest;
      }
    }, 10);

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

      // Capture pending raw request and associate with requestId
      setTimeout(() => {
        if (window.__grpcWebDevtoolsPendingRequest) {
          const rawRequest = window.__grpcWebDevtoolsPendingRequest;
          __grpcWebDevtoolsRawRequests.set(requestId, rawRequest);
          console.log('[gRPC DevTools] Associated raw request with ID:', requestId);

          // Convert body to base64 and send to content script
          let bodyBase64 = null;
          if (rawRequest.body) {
            if (rawRequest.body instanceof ArrayBuffer) {
              const bytes = new Uint8Array(rawRequest.body);
              let binary = '';
              for (let i = 0; i < bytes.length; i++) {
                binary += String.fromCharCode(bytes[i]);
              }
              bodyBase64 = btoa(binary);
            } else if (rawRequest.body instanceof Uint8Array) {
              let binary = '';
              for (let i = 0; i < rawRequest.body.length; i++) {
                binary += String.fromCharCode(rawRequest.body[i]);
              }
              bodyBase64 = btoa(binary);
            } else if (typeof rawRequest.body === 'string') {
              bodyBase64 = btoa(rawRequest.body);
            }
          }

          // Post raw request data to content script
          if (bodyBase64) {
            window.postMessage({
              type: '__GRPCWEB_DEVTOOLS_RAW_REQUEST__',
              requestId: requestId,
              rawRequest: {
                url: rawRequest.url,
                method: rawRequest.method,
                headers: rawRequest.headers,
                body: bodyBase64,
                encoding: 'base64'
              }
            }, '*');

            console.log('[Page] Sent raw request for ID:', requestId, 'body length:', bodyBase64.length);
          }

          delete window.__grpcWebDevtoolsPendingRequest;
        }
      }, 10);

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
}

// Poll for repeat requests using data-* attributes
setInterval(function() {
  // Check for trigger attribute
  const trigger = document.documentElement.getAttribute('data-grpc-repeat-trigger');

  if (trigger) {
    console.log('[Page] Repeat triggered');

    // Get all data from attributes
    const url = document.documentElement.getAttribute('data-repeat-url');
    const httpMethod = document.documentElement.getAttribute('data-repeat-method');
    const grpcMethod = document.documentElement.getAttribute('data-repeat-grpc');
    const bodyBase64 = document.documentElement.getAttribute('data-repeat-body');
    const encoding = document.documentElement.getAttribute('data-repeat-encoding');
    const headersStr = document.documentElement.getAttribute('data-repeat-headers');
    const requestStr = document.documentElement.getAttribute('data-repeat-request');
    const responseStr = document.documentElement.getAttribute('data-repeat-response');

    // Clear immediately to prevent reprocessing
    document.documentElement.removeAttribute('data-grpc-repeat-trigger');
    document.documentElement.removeAttribute('data-repeat-url');
    document.documentElement.removeAttribute('data-repeat-method');
    document.documentElement.removeAttribute('data-repeat-grpc');
    document.documentElement.removeAttribute('data-repeat-body');
    document.documentElement.removeAttribute('data-repeat-encoding');
    document.documentElement.removeAttribute('data-repeat-headers');
    document.documentElement.removeAttribute('data-repeat-request');
    document.documentElement.removeAttribute('data-repeat-response');

    console.log('[Page] Executing repeat:', grpcMethod);

    if (!bodyBase64) {
      console.error('[Page] No body found');
      return;
    }

    try {
      const headers = JSON.parse(headersStr);
      const request = JSON.parse(requestStr);
      const response = JSON.parse(responseStr);

      // Convert base64 to Uint8Array
      function base64ToUint8Array(base64) {
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
      }

      // Prepare body based on encoding
      let bodyData;
      if (encoding === 'base64') {
        console.log('[Page] Decoding base64 body, length:', bodyBase64.length);
        bodyData = base64ToUint8Array(bodyBase64);
      } else {
        console.log('[Page] Converting string body, length:', bodyBase64.length);
        bodyData = new TextEncoder().encode(bodyBase64);
      }

      // Generate a new request ID for the repeated request
      if (typeof __grpcWebDevtoolsRequestId !== 'undefined') {
        var repeatRequestId = __grpcWebDevtoolsRequestId++;
      } else {
        var repeatRequestId = Math.floor(Math.random() * 1000000);
      }

      console.log('[Page] gRPC method:', grpcMethod, 'Body length:', bodyData.length);

      // Send initial request notification
      window.postMessage({
        type: "__GRPCWEB_DEVTOOLS__",
        method: grpcMethod,
        methodType: "unary",
        requestId: repeatRequestId,
        request: request
      }, "*");

      // Execute fetch
      fetch(url, {
        method: httpMethod,
        headers: headers,
        body: bodyData,
        credentials: 'omit'
      })
      .then(response => {
        console.log('[Page] Repeat fetch completed:', response.status);

        if (response.ok) {
          return response.arrayBuffer().then(buffer => {
            // Send successful response notification
            window.postMessage({
              type: "__GRPCWEB_DEVTOOLS__",
              method: grpcMethod,
              methodType: "unary",
              requestId: repeatRequestId,
              request: request,
              response: response
            }, "*");

            console.log('[Page] Response received:', buffer.byteLength, 'bytes');
          });
        } else {
          // Send error response notification
          window.postMessage({
            type: "__GRPCWEB_DEVTOOLS__",
            method: grpcMethod,
            methodType: "unary",
            requestId: repeatRequestId,
            request: request,
            error: {
              code: response.status,
              message: response.statusText
            }
          }, "*");

          console.log('[Page] Response error:', response.status, response.statusText);
        }
      })
      .catch(err => {
        console.error('[Page] Repeat fetch failed:', err);

        // Send error notification
        window.postMessage({
          type: "__GRPCWEB_DEVTOOLS__",
          method: grpcMethod,
          methodType: "unary",
          requestId: repeatRequestId,
          request: request,
          error: {
            code: 0,
            message: err.message
          }
        }, "*");
      });
    } catch (e) {
      console.error('[Page] Failed to execute repeat:', e);
    }

    return;
  }

  // Legacy: check for requestId-based repeat (old method)
  const requestId = document.documentElement.getAttribute('data-grpc-repeat-id');

  if (!requestId) return;

  console.log('[Page] Repeat data detected, requestId:', requestId);

  // Clear immediately to prevent reprocessing
  document.documentElement.removeAttribute('data-grpc-repeat-id');
  document.documentElement.removeAttribute('data-grpc-repeat-timestamp');
  console.log('[gRPC DevTools] Request ID:', requestId);

  // Convert string to number
  const requestIdNum = parseInt(requestId, 10);

  // Find raw request by requestId
  const rawRequest = __grpcWebDevtoolsRawRequests.get(requestIdNum);
  if (!rawRequest) {
    console.error('[gRPC DevTools] Raw request not found for ID:', requestId);
    console.error('[gRPC DevTools] Available request IDs:', Array.from(__grpcWebDevtoolsRawRequests.keys()));
    return;
  }

  console.log('[gRPC DevTools] Found raw request:', rawRequest.url);
  console.log('[gRPC DevTools] Headers:', rawRequest.headers);
  console.log('[gRPC DevTools] Body type:', rawRequest.body?.constructor?.name);

  try {
    // Re-send the request using fetch with exact same data
    fetch(rawRequest.url, {
      method: rawRequest.method,
      headers: rawRequest.headers,
      body: rawRequest.body,
      credentials: 'include', // Include cookies
      mode: 'cors'
    })
    .then(response => {
      console.log('[gRPC DevTools] Repeat request completed:', response.status);
      return response.arrayBuffer();
    })
    .then(buffer => {
      console.log('[gRPC DevTools] Response received:', buffer.byteLength, 'bytes');
    })
    .catch(err => {
      console.error('[gRPC DevTools] Repeat request failed:', err);
    });
  } catch (e) {
    console.error('[gRPC DevTools] Failed to repeat request:', e);
  }
}, 100);

console.log('[gRPC DevTools] Repeat polling started');
