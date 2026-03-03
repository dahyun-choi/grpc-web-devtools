/* global chrome */

/**
 * DebuggerCapture - Uses chrome.debugger API to capture raw HTTP request bodies
 * This provides 100% reliable capture of gRPC request bodies without timing issues
 */

class DebuggerCapture {
  constructor(tabId, onRawRequest) {
    this.tabId = tabId;
    this.onRawRequest = onRawRequest; // Callback: (requestId, rawData) => void
    this.enabled = false;
    this.requestMap = new Map(); // requestId -> request data

    console.log('[DebuggerCapture] Created for tab:', tabId);
  }

  async enable() {
    if (this.enabled) {
      console.log('[DebuggerCapture] Already enabled');
      return;
    }

    try {
      console.log('[DebuggerCapture] Attaching debugger to tab:', this.tabId);

      // Attach debugger (protocol version 1.3)
      await chrome.debugger.attach({ tabId: this.tabId }, '1.3');

      console.log('[DebuggerCapture] ✓ Debugger attached');

      // Enable Network domain to capture requests
      await chrome.debugger.sendCommand(
        { tabId: this.tabId },
        'Network.enable'
      );

      console.log('[DebuggerCapture] ✓ Network domain enabled');

      // Listen for debugger events
      chrome.debugger.onEvent.addListener(this._handleEvent.bind(this));

      // Listen for debugger detach
      chrome.debugger.onDetach.addListener(this._handleDetach.bind(this));

      this.enabled = true;

      console.log('[DebuggerCapture] ✓ Ready to capture requests');
    } catch (err) {
      console.error('[DebuggerCapture] Failed to enable:', err);
      throw err;
    }
  }

  async disable() {
    if (!this.enabled) {
      return;
    }

    try {
      console.log('[DebuggerCapture] Detaching debugger from tab:', this.tabId);

      await chrome.debugger.detach({ tabId: this.tabId });

      this.enabled = false;
      this.requestMap.clear();

      console.log('[DebuggerCapture] ✓ Debugger detached');
    } catch (err) {
      console.error('[DebuggerCapture] Failed to disable:', err);
    }
  }

  _handleEvent(source, method, params) {
    // Only process events for our tab
    if (source.tabId !== this.tabId) {
      return;
    }

    // Handle Network.requestWillBeSent - captures request details including body
    if (method === 'Network.requestWillBeSent') {
      this._handleRequestWillBeSent(params);
    }

    // Handle Network.responseReceived - could be used for additional info
    if (method === 'Network.responseReceived') {
      this._handleResponseReceived(params);
    }
  }

  _handleRequestWillBeSent(params) {
    const { requestId, request } = params;
    const { url, method, headers, postData } = request;

    // Skip OPTIONS preflight requests - they have no POST data
    if (method === 'OPTIONS') {
      console.log('[DebuggerCapture] Skipping OPTIONS preflight request:', requestId);
      return;
    }

    // Check if this is a gRPC request
    const contentType = headers['content-type'] || headers['Content-Type'] || '';
    const isGrpc = contentType.includes('application/grpc') ||
                   contentType.includes('grpc') ||
                   url.includes('/opgwv1.') || // Common gRPC path pattern
                   url.includes('/grpc.');

    if (!isGrpc) {
      // Not a gRPC request, skip
      return;
    }

    console.log('[DebuggerCapture] Captured gRPC request:', {
      requestId,
      url,
      method,
      hasPostData: !!postData,
      postDataType: typeof postData,
      postDataLength: postData?.length
    });

    // Store request data
    const rawRequestData = {
      requestId,
      url,
      method,
      headers,
      body: postData || null,
      encoding: 'utf8', // postData is usually a string
      timestamp: Date.now()
    };

    this.requestMap.set(requestId, rawRequestData);

    // Convert body to base64 if present
    if (postData) {
      // postData from Chrome DevTools Protocol is a string that may contain binary data
      // For gRPC (protobuf), this is binary data encoded as Latin-1 string
      // We need to preserve it exactly as-is
      let bodyBase64;

      try {
        // Direct btoa - postData should already be a binary string (Latin-1)
        bodyBase64 = btoa(postData);

        // Log first few bytes for debugging
        const firstBytes = postData.substring(0, Math.min(20, postData.length))
          .split('')
          .map(c => c.charCodeAt(0).toString(16).padStart(2, '0'))
          .join(' ');
        console.log('[DebuggerCapture] First 20 bytes (hex):', firstBytes);
      } catch (e) {
        console.error('[DebuggerCapture] btoa failed, trying fallback:', e);
        // Fallback: if btoa fails, try encoding via Uint8Array
        const encoder = new TextEncoder();
        const bytes = encoder.encode(postData);
        const binaryString = String.fromCharCode.apply(null, bytes);
        bodyBase64 = btoa(binaryString);
      }

      rawRequestData.body = bodyBase64;
      rawRequestData.encoding = 'base64';

      console.log('[DebuggerCapture] ✓ Captured raw request body:', {
        requestId,
        url,
        bodyLength: bodyBase64.length,
        originalLength: postData.length,
        ratio: (bodyBase64.length / postData.length).toFixed(2)
      });

      // Call the callback with raw request data
      if (this.onRawRequest) {
        this.onRawRequest(requestId, rawRequestData);
      }
    } else {
      console.log('[DebuggerCapture] No POST data for request:', requestId);
    }
  }

  _handleResponseReceived(params) {
    const { requestId, response } = params;

    // Update request map with response info
    const requestData = this.requestMap.get(requestId);
    if (requestData) {
      requestData.responseStatus = response.status;
      requestData.responseStatusText = response.statusText;
      requestData.responseHeaders = response.headers;

      console.log('[DebuggerCapture] ✓ Captured response headers:', {
        requestId,
        url: requestData.url,
        status: response.status,
        headersCount: Object.keys(response.headers || {}).length
      });

      // Update cache via callback
      if (this.onRawRequest) {
        this.onRawRequest(requestId, requestData);
      }
    }
  }

  _handleDetach(source, reason) {
    if (source.tabId === this.tabId) {
      console.log('[DebuggerCapture] Debugger detached, reason:', reason);
      this.enabled = false;
      this.requestMap.clear();
    }
  }

  getRawRequest(requestId) {
    return this.requestMap.get(requestId);
  }

  getAllRawRequests() {
    return Array.from(this.requestMap.values());
  }
}

export default DebuggerCapture;
