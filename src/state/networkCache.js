// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

const MAX_CACHE_ENTRIES = 200;

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return '"[unserializable]"';
  }
}

function byteLength(json) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(json).length;
  }
  return json.length;
}

function estimatePayloadBytes(entry) {
  let bytes = 0;
  if (entry.request != null) {
    bytes += byteLength(safeStringify(entry.request));
  }
  if (entry.response != null) {
    bytes += byteLength(safeStringify(entry.response));
  }
  if (entry.responses != null) {
    entry.responses.forEach(r => { bytes += byteLength(safeStringify(r.data ?? r)); });
  }
  if (entry.error != null) {
    bytes += byteLength(safeStringify(entry.error));
  }
  return bytes;
}

const cache = new Map();
const order = [];
const requestIdToEntryId = new Map();
// For server_streaming: group all responses from the same method into one entry
const methodToStreamEntryId = new Map();
let nextEntryId = 1;

function evictIfNeeded() {
  while (order.length > MAX_CACHE_ENTRIES) {
    const oldestId = order.shift();
    if (oldestId != null) {
      cache.delete(oldestId);
    }
  }
}

export function addNetworkEntry(entry) {
  // 1. Try lookup by requestId
  let existingEntryId = entry.requestId ? requestIdToEntryId.get(entry.requestId) : null;

  // 2. For streaming, also try lookup by method (handles polling-style streaming
  //    where each poll creates a new requestId but should accumulate in one row)
  if (!existingEntryId && entry.methodType === 'server_streaming' && entry.method) {
    existingEntryId = methodToStreamEntryId.get(entry.method);
    // Verify the entry still exists in cache (might have been evicted)
    if (existingEntryId && !cache.has(existingEntryId)) {
      methodToStreamEntryId.delete(entry.method);
      existingEntryId = null;
    }
  }

  const existingEntry = existingEntryId ? cache.get(existingEntryId) : null;
  if (existingEntry) {
    if (entry.method && !existingEntry.method) existingEntry.method = entry.method;
    if (entry.methodType && !existingEntry.methodType) existingEntry.methodType = entry.methodType;

    // Register new requestId → same entry (for future deduplication)
    if (entry.requestId && !requestIdToEntryId.has(entry.requestId)) {
      requestIdToEntryId.set(entry.requestId, existingEntry.entryId);
    }

    if (entry.request != null) {
      existingEntry.request = entry.request;
      if (!existingEntry.startTime) {
        existingEntry.startTime = Date.now();
      }
      // For streaming: a new request means a new poll cycle — reset error and completion
      // so the status reflects the fresh stream, not the previous cancelled/completed one.
      if (existingEntry.methodType === 'server_streaming') {
        existingEntry.error = null;
        existingEntry.streamComplete = false;
      }
    }
    if (entry.response != null) {
      if (existingEntry.methodType === 'server_streaming') {
        if (!existingEntry.responses) existingEntry.responses = [];
        if (entry.response !== 'EOF') {
          existingEntry.responses.push({ data: entry.response, timestamp: Date.now() });
        } else {
          existingEntry.streamComplete = true;
        }
        // Update timestamp so the row shows the most recent response time
        existingEntry.timestamp = Date.now();
        existingEntry.endTime = Date.now();
        existingEntry.duration = existingEntry.startTime
          ? existingEntry.endTime - existingEntry.startTime : null;
      } else {
        existingEntry.response = entry.response;
        if (!existingEntry.endTime) {
          existingEntry.endTime = Date.now();
          existingEntry.duration = entry.duration != null
            ? entry.duration
            : (existingEntry.startTime ? existingEntry.endTime - existingEntry.startTime : null);
        }
      }
    }
    if (entry.error != null) {
      existingEntry.error = entry.error;
      if (!existingEntry.endTime) {
        existingEntry.endTime = Date.now();
        existingEntry.duration = entry.duration != null
          ? entry.duration
          : (existingEntry.startTime ? existingEntry.endTime - existingEntry.startTime : null);
      }
    }
    if (entry.requestId != null) existingEntry.requestId = entry.requestId;
    existingEntry.payloadBytes = estimatePayloadBytes(existingEntry);
    return existingEntry;
  }

  const entryId = nextEntryId++;
  const now = Date.now();
  const hasResponse = entry.response != null || entry.error != null;
  const fullEntry = {
    ...entry,
    entryId,
    timestamp: now,
    startTime: entry.request != null ? now : null,
    endTime: hasResponse ? now : null,
    duration: entry.duration != null ? entry.duration : null,
    payloadBytes: estimatePayloadBytes(entry),
  };
  // For streaming entries, accumulate responses in array instead of single field
  if (entry.methodType === 'server_streaming') {
    fullEntry.responses = (entry.response && entry.response !== 'EOF') ? [{ data: entry.response, timestamp: now }] : [];
    fullEntry.streamComplete = entry.response === 'EOF';
    fullEntry.response = null;
    fullEntry.payloadBytes = estimatePayloadBytes(fullEntry);
    // Register method → entryId for future deduplication
    methodToStreamEntryId.set(entry.method, entryId);
  }
  cache.set(entryId, fullEntry);
  order.push(entryId);
  if (entry.requestId) {
    requestIdToEntryId.set(entry.requestId, entryId);
  }
  evictIfNeeded();
  return fullEntry;
}

export function getNetworkEntry(entryId) {
  return cache.get(entryId);
}

export function clearNetworkCache() {
  cache.clear();
  order.length = 0;
  requestIdToEntryId.clear();
  methodToStreamEntryId.clear();
}

export function restoreNetworkEntry(entry) {
  if (!entry || !entry.entryId) return;
  cache.set(entry.entryId, entry);
  if (!order.includes(entry.entryId)) order.push(entry.entryId);
}

export function getAllNetworkEntries() {
  return Array.from(cache.values());
}
