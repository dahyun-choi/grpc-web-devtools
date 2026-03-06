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
  if (entry.error != null) {
    bytes += byteLength(safeStringify(entry.error));
  }
  return bytes;
}

const cache = new Map();
const order = [];
const requestIdToEntryId = new Map();
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
  const existingEntryId = entry.requestId ? requestIdToEntryId.get(entry.requestId) : null;
  const existingEntry = existingEntryId ? cache.get(existingEntryId) : null;
  if (existingEntry) {
    if (entry.method && !existingEntry.method) existingEntry.method = entry.method;
    if (entry.methodType && !existingEntry.methodType) existingEntry.methodType = entry.methodType;
    if (entry.request != null) {
      existingEntry.request = entry.request;
      if (!existingEntry.startTime) {
        existingEntry.startTime = Date.now();
      }
    }
    if (entry.response != null) {
      existingEntry.response = entry.response;
      if (!existingEntry.endTime) {
        existingEntry.endTime = Date.now();
        existingEntry.duration = entry.duration != null
          ? entry.duration
          : (existingEntry.startTime ? existingEntry.endTime - existingEntry.startTime : null);
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
}

export function getAllNetworkEntries() {
  return Array.from(cache.values());
}
