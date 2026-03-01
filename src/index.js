/* global chrome */

import React from 'react';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';
import { configureStore } from "@reduxjs/toolkit";
import App from './App';
import './index.css';
import networkReducer, { logNetworkEntry, clearLogAndCache } from './state/network';
import toolbarReducer from './state/toolbar';
import clipboardReducer from './state/clipboard';
import protoManager from './utils/ProtoManager';

var port, tabId

function _cleanupListeners() {
  try {
    if (port) {
      port.onMessage.removeListener(_onMessageRecived);
    }
    if (chrome && chrome.tabs && chrome.tabs.onUpdated) {
      chrome.tabs.onUpdated.removeListener(_onTabUpdated);
    }
  } catch (error) {
    // no-op: devtools panel may not exist
  }
}

function _setupPort() {
  try {
    port = chrome.runtime.connect(null, { name: "panel" });
    port.postMessage({ tabId, action: "init" });
    port.onMessage.addListener(_onMessageRecived);
    port.onDisconnect.addListener(_onPortDisconnected);

    // Expose port and tabId to window for repeat functionality
    window.__GRPCWEB_DEVTOOLS_PORT__ = port;
    window.__GRPCWEB_DEVTOOLS_TAB_ID__ = tabId;
    console.log('[Index] Port connected and exposed, tabId:', tabId);
  } catch (error) {
    console.error('[Index] Failed to setup port:', error);
  }
}

function _onPortDisconnected() {
  console.log('[Index] Port disconnected, reconnecting...');
  _cleanupListeners();
  // Reconnect after a short delay
  setTimeout(_setupPort, 100);
}

// Setup port for communication with the background script
if (chrome) {
  try {
    tabId = chrome.devtools.inspectedWindow.tabId;
    _setupPort();
    chrome.tabs.onUpdated.addListener(_onTabUpdated);
    window.addEventListener('unload', _cleanupListeners);
  } catch (error) {
    console.warn("not running app in chrome extension panel")
  }
}

// Initialize ProtoManager
protoManager.initialize().then(() => {
  console.log('[Index] ProtoManager initialized');
}).catch(err => {
  console.error('[Index] Failed to initialize ProtoManager:', err);
});

const store = configureStore({
  reducer: {
    network: networkReducer,
    toolbar: toolbarReducer,
    clipboard: clipboardReducer,
  }
});

// Store raw HTTP requests for repeat functionality
const rawRequestsCache = new Map();
const MAX_RAW_CACHE_SIZE = 500; // Increased from default

function addToRawCache(requestId, data) {
  // Remove oldest entries if cache is too large
  if (rawRequestsCache.size >= MAX_RAW_CACHE_SIZE) {
    const firstKey = rawRequestsCache.keys().next().value;
    rawRequestsCache.delete(firstKey);
    console.log('[Index] Raw cache full, removed oldest entry:', firstKey);
  }

  rawRequestsCache.set(requestId, data);
  console.log('[Index] ✓ Cached raw request for ID:', requestId, 'Cache size:', rawRequestsCache.size);
}

// Listen to network requests to capture raw body
if (chrome && chrome.devtools && chrome.devtools.network) {
  console.log('[Index] Registering network listener');

  chrome.devtools.network.onRequestFinished.addListener(function(request) {
    console.log('[Index] Network request finished:', request.request.url, request.request.method);

    // Check if this is a gRPC request
    const contentType = request.request.headers.find(h =>
      h.name.toLowerCase() === 'content-type'
    );

    console.log('[Index] Content-Type:', contentType?.value);

    // gRPC requests can use application/grpc-web, application/grpc-web+proto, or text/plain
    const isGrpc = contentType && (
      contentType.value.includes('application/grpc') ||
      contentType.value.includes('grpc') ||
      (contentType.value.includes('text/plain') && request.request.url.includes('/'))
    );

    if (isGrpc) {
      console.log('[Index] gRPC request detected, getting content');

      request.getContent(function(body, encoding) {
        console.log('[Index] Got content, encoding:', encoding, 'body type:', typeof body, 'body length:', body?.length);

        if (body && body.length > 0) {
          console.log('[Index] Body first 50 chars:', body.substring(0, 50));
        }

        // Find matching requestId from our store
        const state = store.getState();
        console.log('[Index] Network log entries:', state.network.log.length);

        // Find matching entries by URL
        const matchingEntries = state.network.log.filter(entry => {
          // entry.method can be:
          // - "https://example.com/package.Service/MethodName" (URL format)
          // - "package.Service/MethodName" (clean format)

          // Simple match: exact URL match or URL contains method
          const urlMatch = entry.method === request.request.url ||
                          request.request.url === entry.method ||
                          request.request.url.includes(entry.method) ||
                          entry.method.includes(request.request.url);

          return urlMatch;
        });

        console.log('[Index] Found', matchingEntries.length, 'matching entries for URL:', request.request.url);

        // Get the most recent matching entry (last in the log) that doesn't have a cached request yet
        const matchingEntry = matchingEntries.reverse().find(entry => {
          return !rawRequestsCache.has(entry.requestId);
        });

        if (matchingEntry) {
          console.log('[Index] ✓ Matched entry:', matchingEntry.requestId, matchingEntry.method);
        } else {
          console.warn('[Index] ✗ No matching entry found for URL:', request.request.url);
          console.log('[Index] Available entries:', state.network.log.map(e => ({ id: e.requestId, method: e.method })).slice(-5));
        }

        if (matchingEntry) {
          // Store the raw body exactly as received
          addToRawCache(matchingEntry.requestId, {
            url: request.request.url,
            method: request.request.method,
            headers: request.request.headers,
            responseHeaders: request.response.headers,
            responseStatus: request.response.status,
            responseStatusText: request.response.statusText,
            body: body, // Keep original body
            encoding: encoding // 'base64' or empty string
          });
        }
      });
    }
  });

  console.log('[Index] Network listener registered');
} else {
  console.error('[Index] chrome.devtools.network not available');
}

// Expose cache to window for repeat functionality
window.__GRPCWEB_DEVTOOLS_RAW_CACHE__ = rawRequestsCache;

function _onMessageRecived({ action, data }) {
  if (action === "gRPCNetworkCall") {
    console.log('[Index] ========== gRPC Network Call Received ==========');
    console.log('[Index] Request ID:', data.requestId);
    console.log('[Index] Method:', data.method);
    console.log('[Index] Request data:', data.request);

    store.dispatch(logNetworkEntry(data));
    console.log('[Index] ================================================');
  } else if (action === "gRPCRawRequest") {
    console.log('[Index] ========== Raw Request Received ==========');
    console.log('[Index] Request ID:', data.requestId);

    if (data.rawRequest && data.requestId) {
      const rawReq = data.rawRequest;
      console.log('[Index] Raw request URL:', rawReq.url);
      console.log('[Index] Raw request method:', rawReq.method);
      console.log('[Index] Raw request body length:', rawReq.body?.length || 0);
      console.log('[Index] Raw request encoding:', rawReq.encoding);

      // Convert headers object to array format if needed
      let headers = rawReq.headers;
      if (headers && !Array.isArray(headers)) {
        headers = Object.keys(headers).map(key => ({ name: key, value: headers[key] }));
      }

      // Store in raw cache
      addToRawCache(data.requestId, {
        url: rawReq.url,
        method: rawReq.method,
        headers: headers || [],
        body: rawReq.body,
        encoding: rawReq.encoding
      });

      console.log('[Index] ✓ Cached RAW request body for ID:', data.requestId);
      console.log('[Index] Cache size:', rawRequestsCache.size);

      // Log first few bytes
      if (rawReq.body && rawReq.encoding === 'base64') {
        try {
          const binaryString = atob(rawReq.body.substring(0, 100));
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < Math.min(20, binaryString.length); i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          console.log('[Index] First 20 bytes:', Array.from(bytes.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' '));
        } catch (e) {
          console.warn('[Index] Could not decode first bytes:', e.message);
        }
      }
    }
    console.log('[Index] ================================================');
  }
}

function _onTabUpdated(tId, { status }) {
  if (tId === tabId && status === "loading") {
    const state = store.getState();
    if (!state.network.preserveLog) {
      store.dispatch(clearLogAndCache());
    }
  }
}

ReactDOM.render(
  <Provider store={store}>
    <App />
  </Provider>,
  document.getElementById('root')
);

