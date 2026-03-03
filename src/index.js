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
import DebuggerCapture from './utils/DebuggerCapture';

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

    // Handle DevTools panel visibility changes
    // When panel becomes visible again, reconnect port to ensure message delivery
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) {
        console.log('[Index] Panel became visible, checking port connection');

        // Check if port is still connected by trying to send a ping
        try {
          if (port) {
            port.postMessage({ tabId, action: 'ping' });
            console.log('[Index] Port still connected');
          } else {
            console.log('[Index] Port is null, reconnecting...');
            _setupPort();
          }
        } catch (err) {
          console.error('[Index] Port ping failed, reconnecting...', err);
          _cleanupListeners();
          _setupPort();
        }
      }
    });

    // Initialize DebuggerCapture for reliable raw request capture
    console.log('[Index] Initializing DebuggerCapture for tab:', tabId);

    debuggerCapture = new DebuggerCapture(tabId, (requestId, rawData) => {
      console.log('[DebuggerCapture] Raw request callback:', requestId);

      // Prepare cache entry
      const cacheEntry = {
        url: rawData.url,
        method: rawData.method,
        headers: Object.keys(rawData.headers || {}).map(key => ({
          name: key,
          value: rawData.headers[key]
        })),
        body: rawData.body,
        encoding: rawData.encoding,
        timestamp: rawData.timestamp // Include timestamp for composite key matching
      };

      // Add response headers if available
      if (rawData.responseHeaders) {
        cacheEntry.responseStatus = rawData.responseStatus;
        cacheEntry.responseStatusText = rawData.responseStatusText;
        cacheEntry.responseHeaders = Object.keys(rawData.responseHeaders).map(key => ({
          name: key,
          value: rawData.responseHeaders[key]
        }));
      }

      // Add to raw cache
      addToRawCache(requestId, cacheEntry);
    });

    // Enable debugger capture
    debuggerCapture.enable().then(() => {
      console.log('[Index] ✓ DebuggerCapture enabled');
    }).catch(err => {
      console.error('[Index] Failed to enable DebuggerCapture:', err);
      console.log('[Index] Falling back to traditional interceptor method');
    });

    // Cleanup on unload
    window.addEventListener('unload', () => {
      if (debuggerCapture) {
        debuggerCapture.disable();
      }
    });
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
const MAX_RAW_CACHE_SIZE = 500;

// DebuggerCapture instance for reliable raw request capture
let debuggerCapture = null;
const STORAGE_KEYS = {
  RAW_CACHE: 'grpc_devtools_raw_cache_v1',
  RAW_CACHE_METADATA: 'grpc_devtools_raw_cache_metadata_v1'
};
const MAX_STORAGE_AGE_DAYS = 7; // 7일 이상 데이터 자동 삭제

let saveTimeout = null;

// Save raw cache to chrome.storage.local
async function saveRawCacheToStorage() {
  try {
    const cacheArray = Array.from(rawRequestsCache.entries()).map(([id, data]) => ({
      id,
      data,
      timestamp: Date.now()
    }));

    await chrome.storage.local.set({
      [STORAGE_KEYS.RAW_CACHE]: cacheArray,
      [STORAGE_KEYS.RAW_CACHE_METADATA]: {
        lastSaved: Date.now(),
        count: cacheArray.length
      }
    });

    console.log('[Index] ✓ Saved raw cache to storage:', cacheArray.length, 'entries');
  } catch (error) {
    console.error('[Index] Failed to save raw cache:', error);
  }
}

// Load raw cache from chrome.storage.local
async function loadRawCacheFromStorage() {
  try {
    const result = await chrome.storage.local.get([
      STORAGE_KEYS.RAW_CACHE,
      STORAGE_KEYS.RAW_CACHE_METADATA
    ]);

    if (result[STORAGE_KEYS.RAW_CACHE]) {
      const cacheArray = result[STORAGE_KEYS.RAW_CACHE];
      const now = Date.now();
      const maxAge = MAX_STORAGE_AGE_DAYS * 24 * 60 * 60 * 1000;

      // Filter out old entries
      const validEntries = cacheArray.filter(entry => {
        const age = now - (entry.timestamp || 0);
        return age < maxAge;
      });

      // IMPORTANT: Do NOT restore cache from storage for now
      // Storage can have corrupted/mismatched data from previous sessions
      // Only use fresh raw requests captured in current session
      console.log('[Index] ⚠ Skipping storage restore to prevent ID mismatch');
      console.log('[Index] Found', validEntries.length, 'entries in storage (not restored)');

      // Clear corrupted storage
      await chrome.storage.local.remove([STORAGE_KEYS.RAW_CACHE, STORAGE_KEYS.RAW_CACHE_METADATA]);
      console.log('[Index] ✓ Cleared storage cache');

      /* Disabled for now - causes ID mismatch
      rawRequestsCache.clear();
      validEntries.forEach(entry => {
        rawRequestsCache.set(entry.id, entry.data);
      });
      */
    }
  } catch (error) {
    console.error('[Index] Failed to load raw cache:', error);
  }
}

// Track which raw requests have been linked to entries
const linkedRawRequests = new Set();

function findMostRecentRawRequestByUrl(url, entryTimestamp) {
  let bestMatch = null;
  let bestMatchKey = null;
  let bestTimeDiff = Infinity;

  for (const [key, value] of rawRequestsCache.entries()) {
    // Skip if already linked to an entry
    if (linkedRawRequests.has(key)) {
      continue;
    }

    // Skip non-Chrome requestId keys (composite keys, entryId keys)
    if (typeof key === 'number' || key.includes('@')) {
      continue;
    }

    // Check URL match
    if (value.url === url || value.url.includes(url) || url.includes(value.url)) {
      const timeDiff = Math.abs((value.timestamp || 0) - entryTimestamp);

      if (timeDiff < bestTimeDiff) {
        bestTimeDiff = timeDiff;
        bestMatch = value;
        bestMatchKey = key;
      }
    }
  }

  if (bestMatch && bestMatchKey) {
    // Mark as linked
    linkedRawRequests.add(bestMatchKey);
    console.log('[Index] Found unlinked raw request:', bestMatchKey, 'time diff:', bestTimeDiff, 'ms');
  }

  return bestMatch;
}

function addToRawCache(requestId, data) {
  // Remove oldest entries if cache is too large
  if (rawRequestsCache.size >= MAX_RAW_CACHE_SIZE) {
    const firstKey = rawRequestsCache.keys().next().value;
    rawRequestsCache.delete(firstKey);
    console.log('[Index] Raw cache full, removed oldest entry:', firstKey);
  }

  // Store with Chrome requestId as primary key
  rawRequestsCache.set(requestId, data);

  // ALSO store with URL+timestamp composite key for precise matching
  // This allows finding the exact request when same URL has multiple calls
  if (data.url && data.timestamp) {
    const compositeKey = `${data.url}@${data.timestamp}`;
    rawRequestsCache.set(compositeKey, data);
    console.log('[Index] ✓ Cached with composite key:', compositeKey);
  }

  console.log('[Index] ✓ Cached raw request for ID:', requestId, 'Cache size:', rawRequestsCache.size);

  // Debounced save (5초 후 저장, 연속 호출 시 지연)
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveRawCacheToStorage();
  }, 5000);
}

// Decode gRPC response body from base64
function decodeGrpcResponseBody(responseBodyBase64, method) {
  try {
    console.log('[Index] Attempting to decode response body, length:', responseBodyBase64.length);

    // Decode base64 to bytes
    const binaryString = atob(responseBodyBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    console.log('[Index] Decoded bytes length:', bytes.length);

    // Try to decode with ProtoManager if available
    if (protoManager.isReady()) {
      console.log('[Index] ProtoManager ready, attempting to decode response');

      // Parse gRPC-web frame format: [1 byte flags][4 bytes message length][message bytes]
      if (bytes.length > 5) {
        const compressionFlag = bytes[0];
        const messageLength = (bytes[1] << 24) | (bytes[2] << 16) | (bytes[3] << 8) | bytes[4];
        const messageBytes = bytes.slice(5, 5 + messageLength);

        console.log('[Index] Compression flag:', compressionFlag);
        console.log('[Index] Message length:', messageLength);
        console.log('[Index] Message bytes length:', messageBytes.length);

        // Get message type info
        const typeInfo = protoManager.getMessageType(method);
        if (typeInfo && typeInfo.responseType) {
          console.log('[Index] Response type:', typeInfo.responseType.name);

          // Decode the message using manualDecode
          const decoded = protoManager.manualDecode(typeInfo.responseType, messageBytes);
          if (decoded) {
            console.log('[Index] ✓ Successfully decoded response:', decoded);
            return decoded;
          } else {
            console.warn('[Index] manualDecode returned null');
          }
        } else {
          console.warn('[Index] Could not find responseType for method:', method);
        }
      } else {
        console.warn('[Index] Response too short for gRPC-web frame format:', bytes.length);
      }
    } else {
      console.warn('[Index] ProtoManager not ready, cannot decode response');
    }
  } catch (error) {
    console.error('[Index] Failed to decode responseBodyBase64:', error);
  }

  return null;
}

// Export decode function to window for use in repeat functionality
window.__GRPCWEB_DEVTOOLS_DECODE_RESPONSE__ = decodeGrpcResponseBody;

// Load raw cache from storage on startup
if (chrome && chrome.storage) {
  loadRawCacheFromStorage()
    .then(() => {
      console.log('[Index] Raw cache initialization complete');
    })
    .catch(err => {
      console.error('[Index] Failed to load raw cache from storage:', err);
    });
}

// Save before unload
window.addEventListener('beforeunload', () => {
  saveRawCacheToStorage();
});

// Periodic save (30초마다)
setInterval(() => {
  if (rawRequestsCache.size > 0) {
    saveRawCacheToStorage();
  }
}, 30000);

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

      // NOTE: request.getContent() returns RESPONSE body, not request body!
      // We don't use it for request body - only grpc-web-interceptor.js provides request body
      // But we still call it to store response headers
      request.getContent(function(body, encoding) {
        console.log('[Index] Got RESPONSE content (not request), length:', body?.length);

        // Find matching requestId from our store
        const state = store.getState();

        // Find matching entries by URL
        const matchingEntries = state.network.log.filter(entry => {
          const urlMatch = entry.method === request.request.url ||
                          request.request.url === entry.method ||
                          request.request.url.includes(entry.method) ||
                          entry.method.includes(request.request.url);
          return urlMatch;
        });

        console.log('[Index] Found', matchingEntries.length, 'matching entries for URL:', request.request.url);

        // Get the most recent matching entry that doesn't have response headers yet
        const matchingEntry = matchingEntries.reverse().find(entry => {
          const cached = rawRequestsCache.get(entry.requestId);
          return cached && !cached.responseHeaders;
        });

        if (matchingEntry) {
          console.log('[Index] ✓ Adding response headers for entry:', matchingEntry.requestId);
          const cached = rawRequestsCache.get(matchingEntry.requestId);
          if (cached) {
            // Add response headers to existing cache entry
            cached.responseHeaders = request.response.headers;
            cached.responseStatus = request.response.status;
            cached.responseStatusText = request.response.statusText;
          }
        }
      });
    }
  });

  console.log('[Index] Network listener registered');
} else {
  console.error('[Index] chrome.devtools.network not available');
}

// Expose cache and clear function to window for repeat functionality
window.__GRPCWEB_DEVTOOLS_RAW_CACHE__ = rawRequestsCache;

// Expose clear function for clearing raw cache (called from Toolbar clear button)
window.__GRPCWEB_DEVTOOLS_CLEAR_RAW_CACHE__ = function() {
  rawRequestsCache.clear();
  linkedRawRequests.clear();
  console.log('[Index] Raw cache and linked requests cleared via clear function');

  // Clear storage
  if (chrome && chrome.storage) {
    chrome.storage.local.remove([STORAGE_KEYS.RAW_CACHE, STORAGE_KEYS.RAW_CACHE_METADATA])
      .then(() => {
        console.log('[Index] ✓ Cleared raw cache from storage');
      })
      .catch(err => {
        console.error('[Index] Failed to clear storage cache:', err);
      });
  }
};

function _onMessageRecived({ action, data }) {
  if (action === "gRPCNetworkCall") {
    console.log('[Index] ========== gRPC Network Call Received ==========');
    console.log('[Index] Request ID:', data.requestId);
    console.log('[Index] Method:', data.method);
    console.log('[Index] Request data:', data.request);
    console.log('[Index] Full data object:', JSON.stringify(data, null, 2));

    // Check HTTP response status
    if (data.responseStatus !== undefined) {
      console.log('[Index] ✓ HTTP response status found:', data.responseStatus, 'ok:', data.responseOk);

      // If HTTP status is not OK (200), treat as error
      if (!data.responseOk || data.responseStatus !== 200) {
        console.log('[Index] HTTP error detected, status:', data.responseStatus);
        data.error = {
          code: 13, // gRPC INTERNAL error
          message: `HTTP ${data.responseStatus}`
        };
        // Don't try to decode response body on error
      } else {
        console.log('[Index] ✓ HTTP 200 OK, will attempt to decode response');
      }
    } else {
      console.log('[Index] ⚠ No responseStatus in data');
    }

    // Check if responseBodyBase64 exists and needs decoding
    // Decode even if response exists (might be placeholder from repeat)
    if (data.responseBodyBase64 && !data.error) {
      console.log('[Index] responseBodyBase64 found, attempting to decode...');
      console.log('[Index] Base64 length:', data.responseBodyBase64.length);

      try {
        // Decode base64 to bytes
        const binaryString = atob(data.responseBodyBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        console.log('[Index] Decoded bytes length:', bytes.length);
        console.log('[Index] First 20 bytes (hex):', Array.from(bytes.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' '));

        // Try to decode with ProtoManager if available
        if (protoManager.isReady()) {
          console.log('[Index] ProtoManager ready, attempting to decode response');

          // Parse gRPC-web frame format: [1 byte flags][4 bytes message length][message bytes]
          if (bytes.length > 5) {
            const compressionFlag = bytes[0];
            const messageLength = (bytes[1] << 24) | (bytes[2] << 16) | (bytes[3] << 8) | bytes[4];
            const messageBytes = bytes.slice(5, 5 + messageLength);

            console.log('[Index] Compression flag:', compressionFlag);
            console.log('[Index] Message length:', messageLength);
            console.log('[Index] Message bytes length:', messageBytes.length);

            // Get message type info
            const typeInfo = protoManager.getMessageType(data.method);
            if (typeInfo && typeInfo.responseType) {
              console.log('[Index] Response type:', typeInfo.responseType.name);

              // Decode the message using manualDecode
              const decoded = protoManager.manualDecode(typeInfo.responseType, messageBytes);
              if (decoded) {
                data.response = decoded;
                console.log('[Index] ✓ Successfully decoded response:', decoded);
              } else {
                console.warn('[Index] manualDecode returned null');
              }
            } else {
              console.warn('[Index] Could not find responseType for method:', data.method);
            }
          } else {
            console.warn('[Index] Response too short for gRPC-web frame format:', bytes.length);
          }
        } else {
          console.warn('[Index] ProtoManager not ready, cannot decode response');
          console.warn('[Index] Upload proto files in Settings to see decoded responses');
        }
      } catch (error) {
        console.error('[Index] Failed to decode responseBodyBase64:', error);
      }
    }

    console.log('[Index] ========== Before logNetworkEntry ==========');
    console.log('[Index] data.request:', !!data.request);
    console.log('[Index] data.response:', !!data.response);
    console.log('[Index] data.error:', !!data.error);
    console.log('[Index] data.responseBodyBase64:', !!data.responseBodyBase64);

    const fullEntry = store.dispatch(logNetworkEntry(data));

    console.log('[Index] ========== After logNetworkEntry ==========');
    console.log('[Index] Created entry with entryId:', fullEntry.entryId);
    console.log('[Index] Entry has response:', !!fullEntry.response);
    console.log('[Index] Entry has error:', !!fullEntry.error);

    // Link entryId with most recent unlinked raw request
    // This handles the case where same URL has multiple simultaneous requests
    if (fullEntry && fullEntry.method) {
      const matchingRawRequest = findMostRecentRawRequestByUrl(fullEntry.method, fullEntry.timestamp);
      if (matchingRawRequest) {
        // Store raw request with entryId as key for direct lookup
        rawRequestsCache.set(fullEntry.entryId, matchingRawRequest);
        console.log('[Index] ✓ Linked entryId', fullEntry.entryId, 'with raw request');
      } else {
        console.log('[Index] ⚠ No matching raw request found for entryId:', fullEntry.entryId);
      }
    }

    console.log('[Index] Raw cache size:', rawRequestsCache.size);
    console.log('[Index] Raw cache keys:', Array.from(rawRequestsCache.keys()));
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
      console.log('[Index] All cached IDs:', Array.from(rawRequestsCache.keys()));

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

      // Clear raw requests cache using exposed function
      if (window.__GRPCWEB_DEVTOOLS_CLEAR_RAW_CACHE__) {
        window.__GRPCWEB_DEVTOOLS_CLEAR_RAW_CACHE__();
      }
    }
  }
}

ReactDOM.render(
  <Provider store={store}>
    <App />
  </Provider>,
  document.getElementById('root')
);

