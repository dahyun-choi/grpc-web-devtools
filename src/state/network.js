// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import { createSlice } from "@reduxjs/toolkit";
import Fuse from 'fuse.js';
import { setFilterValue, setGlobalSearchValue } from "./toolbar";
import { addNetworkEntry, clearNetworkCache, getNetworkEntry } from "./networkCache";

var options = {
  shouldSort: false,
  threshold: 0.1,
  distance: 10000,
  keys: [
    'method',
  ]
};
var fuse = new Fuse([], options);

const networkSlice = createSlice({
  name: 'network',
  initialState: {
    preserveLog: true,
    selectedIdx: null,
    selectedEntry: null,
    log: [],
    _filterValue: '',
    _logBak: [],
    _globalSearchValue: '',
    _logBakBeforeGlobalSearch: [],
  },
  reducers: {
    networkLog(state, action) {
      const { log, _filterValue, _logBak } = state;
      const { payload, } = action;
      if (payload.method) {
        const parts = payload.method.split('/')
        payload.endpoint = parts.pop() || parts.pop();
      }

      // Check if entry already exists (by entryId)
      const existingIdx = log.findIndex(e => e.entryId === payload.entryId);
      const existingIdxBak = _logBak.findIndex(e => e.entryId === payload.entryId);

      if (_filterValue.length > 0) {
        if (existingIdxBak >= 0) {
          // Update existing entry in backup
          _logBak[existingIdxBak] = payload;
        } else {
          // Add new entry
          _logBak.push(payload);
        }
        fuse.setCollection(_logBak);
        state.log = fuse.search(_filterValue).map(result => result.item || result);
      } else {
        if (existingIdx >= 0) {
          // Update existing entry
          log[existingIdx] = payload;
        } else {
          // Add new entry
          log.push(payload);
        }
      }
    },
    selectLogEntry(state, action) {
      const { payload: idx } = action;
      const entry = state.log[idx];
      if (entry) {
        state.selectedIdx = idx;
        state.selectedEntry = entry;
      }
    },
    clearLog(state, action) {
      const { payload: { force } = {} } = action;
      if (state.preserveLog && !force) {
        return;
      }
      state.selectedIdx = null;
      state.selectedEntry = null;
      state.log = [];
      state._logBak = [];
    },
    setPreserveLog(state, action) {
      const { payload } = action;
      state.preserveLog = payload;
    },
    setFilteredLog(state, action) {
      const { payload } = action;
      state.log = payload;
    },
    setEntryDuration(state, action) {
      const { entryId, duration } = action.payload;
      const entry = state.log.find(e => e.entryId === entryId);
      if (entry) entry.duration = duration;
      const bakEntry = state._logBak.find(e => e.entryId === entryId);
      if (bakEntry) bakEntry.duration = duration;
    },
  },
  extraReducers: {
    [setFilterValue]: (state, action) => {

      const { payload: filterValue = '' } = action;
      state._filterValue = filterValue;
      if (filterValue.length === 0) {
        state.log = state._logBak;
        state._logBak = [];
        return;
      }

      if (state._logBak.length === 0 && state.log.length !== 0) {
        state._logBak = state.log;
      }
      fuse.setCollection(state._logBak);
      state.log = fuse.search(filterValue).map(result => result.item || result);
    },
    [setGlobalSearchValue]: (state, action) => {
      const { payload: globalSearchValue = '' } = action;
      state._globalSearchValue = globalSearchValue;

      // 전역 검색 해제
      if (globalSearchValue.length === 0) {
        if (state._logBakBeforeGlobalSearch.length > 0) {
          state.log = state._logBakBeforeGlobalSearch;
          state._logBakBeforeGlobalSearch = [];
        }
        return;
      }

      // 백업이 없으면 현재 로그 백업
      if (state._logBakBeforeGlobalSearch.length === 0) {
        state._logBakBeforeGlobalSearch = [...state.log];
      }

      // 여기서는 state 변경하지 않고 thunk에서 처리
    },
  },
});

const { actions, reducer } = networkSlice;
export const { networkLog, selectLogEntry, clearLog, setPreserveLog, setEntryDuration } = actions;

function buildSummaryEntry(entry) {
  // Extract status code from error
  let statusCode = null;

  if (entry.error) {
    // Extract gRPC error code
    if (typeof entry.error === 'object') {
      statusCode = entry.error.code;
      // If code is not set, try to parse from message
      if (statusCode == null && entry.error.message) {
        const match = entry.error.message.match(/code = (\w+)/);
        if (match) {
          // Convert gRPC status name to code
          const grpcStatusCodes = {
            'OK': 0, 'CANCELLED': 1, 'UNKNOWN': 2, 'INVALID_ARGUMENT': 3,
            'DEADLINE_EXCEEDED': 4, 'NOT_FOUND': 5, 'ALREADY_EXISTS': 6,
            'PERMISSION_DENIED': 7, 'RESOURCE_EXHAUSTED': 8, 'FAILED_PRECONDITION': 9,
            'ABORTED': 10, 'OUT_OF_RANGE': 11, 'UNIMPLEMENTED': 12,
            'INTERNAL': 13, 'UNAVAILABLE': 14, 'DATA_LOSS': 15, 'UNAUTHENTICATED': 16
          };
          statusCode = grpcStatusCodes[match[1]] !== undefined ? grpcStatusCodes[match[1]] : match[1];
        }
      }
    } else {
      statusCode = entry.error;
    }
  } else if (entry.response || (entry.responses && entry.responses.length > 0)) {
    statusCode = 0; // OK
  } else if (entry.responseBodyBase64 && entry.responseStatus === 200) {
    // HTTP 200 but response not decoded yet - still OK
    statusCode = 0; // OK
  }

  return {
    entryId: entry.entryId,
    method: entry.method,
    methodType: entry.methodType,
    request: !!entry.request,
    response: !!(entry.response || (entry.responses && entry.responses.length > 0)),
    error: entry.error,
    requestId: entry.requestId,
    timestamp: entry.timestamp,
    duration: entry.duration,
    statusCode: statusCode,
    isRepeat: !!entry.isRepeat,
    streamCount: entry.responses?.length ?? null,
    streamComplete: entry.streamComplete ?? false,
  };
}

export const logNetworkEntry = (data) => (dispatch) => {
  const fullEntry = addNetworkEntry(data);
  dispatch(networkLog(buildSummaryEntry(fullEntry)));
  return fullEntry; // Return for linking with raw cache
};

export const clearLogAndCache = (payload) => (dispatch) => {
  clearNetworkCache();
  dispatch(clearLog(payload));

  // Clear raw requests cache (both memory and storage)
  if (window.__GRPCWEB_DEVTOOLS_CLEAR_RAW_CACHE__) {
    window.__GRPCWEB_DEVTOOLS_CLEAR_RAW_CACHE__();
  }
};

function searchInJSON(obj, searchText) {
  if (!obj) return false;

  try {
    const jsonStr = JSON.stringify(obj).toLowerCase();
    return jsonStr.includes(searchText.toLowerCase());
  } catch (e) {
    return false;
  }
}

export const applyGlobalSearch = (globalSearchValue) => (dispatch, getState) => {
  // 먼저 setGlobalSearchValue를 실행하여 백업 생성
  dispatch(setGlobalSearchValue(globalSearchValue));

  // 검색어가 없으면 여기서 종료 (extraReducer에서 복원 처리됨)
  if (!globalSearchValue || globalSearchValue.length === 0) {
    return;
  }

  // 백업이 생성된 후의 state를 가져옴
  const state = getState();

  // 항상 백업된 원본 리스트에서 필터링
  const allEntries = state.network._logBakBeforeGlobalSearch.length > 0
    ? state.network._logBakBeforeGlobalSearch
    : state.network.log;

  const filtered = allEntries.filter(summaryEntry => {
    const fullEntry = getNetworkEntry(summaryEntry.entryId);
    if (!fullEntry) return false;

    // method, request, response, error 모두 검색
    return (
      searchInJSON(fullEntry.method, globalSearchValue) ||
      searchInJSON(fullEntry.request, globalSearchValue) ||
      searchInJSON(fullEntry.response, globalSearchValue) ||
      searchInJSON(fullEntry.error, globalSearchValue)
    );
  });

  // 필터링된 결과를 state에 반영
  dispatch({ type: 'network/setFilteredLog', payload: filtered });
};

export default reducer
