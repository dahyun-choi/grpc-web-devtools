// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

/* global chrome */

import React, { Component } from "react";
import ReactJson from "react-json-view";
import { connect } from "react-redux";
import { getNetworkEntry } from "../state/networkCache";
import { setSettingsOpen } from "../state/toolbar";
import { clearPendingAction } from "../state/network";
import MinusIcon from "../icons/Minus";
import PlusIcon from "../icons/Plus";
import CopyIcon from "../icons/Copy";
import RepeatIcon from "../icons/Repeat";
import protoManager from "../utils/ProtoManager";
import "./NetworkDetails.css";

const LARGE_PAYLOAD_BYTES = 1024 * 1024;
const VERY_LARGE_PAYLOAD_BYTES = 5 * 1024 * 1024;

// Removed arrayBufferToBase64 - now defined inline where needed

function formatBytes(value) {
  if (!Number.isFinite(value)) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatStreamTime(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

class StreamResponseItem extends Component {
  state = { collapsed: true };

  componentDidUpdate(prevProps) {
    if (prevProps.parentCollapsed !== this.props.parentCollapsed) {
      this.setState({ collapsed: this.props.parentCollapsed !== false });
    }
  }

  _toggle = () => this.setState(s => ({ collapsed: !s.collapsed }));

  render() {
    const { index, item, theme } = this.props;
    const { collapsed } = this.state;
    const response = item.data ?? item;
    const timeStr = formatStreamTime(item.timestamp);
    return (
      <div className="stream-response-item">
        <div className="stream-response-header" onClick={this._toggle}>
          <span className="stream-response-toggle">{collapsed ? '▶' : '▼'}</span>
          <span className="stream-response-index">Message {index + 1}</span>
          {timeStr && <span className="stream-response-time">{timeStr}</span>}
        </div>
        {!collapsed && (
          <div className="stream-response-body">
            <ReactJson
              name={false}
              theme={theme}
              style={{ backgroundColor: "transparent" }}
              enableClipboard={false}
              collapsed={1}
              displayDataTypes={false}
              displayObjectSize={false}
              src={response}
            />
          </div>
        )}
      </div>
    );
  }
}

function diffLines(oldStr, newStr) {
  const a = oldStr.split('\n');
  const b = newStr.split('\n');
  const m = a.length;
  const n = b.length;
  if (m > 800 || n > 800) {
    return [{ type: 'same', value: '(payload too large to diff)' }];
  }
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const result = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.unshift({ type: 'same', value: a[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'add', value: b[j - 1] });
      j--;
    } else {
      result.unshift({ type: 'remove', value: a[i - 1] });
      i--;
    }
  }
  return result;
}

class NetworkDetails extends Component {
  state = {
    jsonCollapsed: 1,
    lastEntryId: null,
    searchText: '',
    copied: false,
    repeated: false,
    editSent: false,
    editMode: false,
    editedData: null,
    requestTab: 'body', // 'headers' or 'body'
    responseTab: 'body', // 'headers' or 'body'
    requestCollapsed: false,
    responseCollapsed: false,
    requestCopied: false,
    responseCopied: false,
    splitPosition: 50, // Percentage of request section height
    isDragging: false,
    showDiff: false,
    fieldTooltip: null, // { x, y, name, info, pinned }
  };

  jsonContainerRef = React.createRef();
  containerRef = React.createRef();
  highlightTimeout = null;

  componentDidUpdate(prevProps, prevState) {
    const prevEntryId = prevProps.entry?.entryId ?? null;
    const nextEntryId = this.props.entry?.entryId ?? null;
    const entryChanged = prevEntryId !== nextEntryId && this.state.lastEntryId !== nextEntryId;

    if (entryChanged) {
      const isRepeat = this.props.entry?.isRepeat;
      const defaultTab = isRepeat ? 'diff' : 'body';
      this.setState({
        jsonCollapsed: 1,
        lastEntryId: nextEntryId,
        searchText: '',
        copied: false,
        repeated: false,
        editSent: false,
        editMode: false,
        editedData: null,
        requestTab: defaultTab,
        responseTab: defaultTab,
        requestCollapsed: false,
        responseCollapsed: false,
        requestCopied: false,
        responseCopied: false,
        showDiff: !!isRepeat,
        fieldTooltip: null,
      });
    }

    const { pendingAction } = this.props;
    if (pendingAction && pendingAction !== prevProps.pendingAction) {
      if (this.props.entry?.entryId === pendingAction.entryId) {
        this.props.clearPendingAction();
        if (pendingAction.type === 'repeat') this._repeatRequest();
        else if (pendingAction.type === 'edit') this._startEdit();
      }
    }

    // 검색어가 변경되거나 전역 검색어가 변경되거나 entry가 변경되면 하이라이트 업데이트
    const prevGlobalSearch = prevProps.globalSearchValue || '';
    const nextGlobalSearch = this.props.globalSearchValue || '';

    const prevSearch = prevState.searchText || prevGlobalSearch;
    const nextSearch = this.state.searchText || nextGlobalSearch;

    if (prevSearch !== nextSearch || entryChanged) {
      // Check if payload is very large - skip highlights for performance
      const entry = this.props.entry;
      const cachedEntry = entry?.entryId ? getNetworkEntry(entry.entryId) : null;
      const payloadBytes = cachedEntry?.payloadBytes;
      const isVeryLargePayload = payloadBytes && payloadBytes >= VERY_LARGE_PAYLOAD_BYTES;

      if (!isVeryLargePayload) {
        this._applyHighlights();
      }
    }
  }

  componentDidMount() {
    document.addEventListener('mousemove', this._handleMouseMove);
    document.addEventListener('mouseup', this._handleMouseUp);
  }

  componentWillUnmount() {
    this._clearHighlights();
    if (this.highlightTimeout) {
      clearTimeout(this.highlightTimeout);
    }
    document.removeEventListener('mousemove', this._handleMouseMove);
    document.removeEventListener('mouseup', this._handleMouseUp);
  }

  render() {
    const { entry, splitPanel } = this.props;
    const { splitPosition, isDragging } = this.state;

    if (!splitPanel) {
      return (
        <div className="widget vbox details-container" ref={this.containerRef}>
          {this._renderMergedSection(entry)}
          {this._renderFieldTooltip()}
        </div>
      );
    }

    return (
      <div className="widget vbox details-container" ref={this.containerRef}>
        {this._renderRequestSection(entry, splitPosition)}
        <div
          className={`split-divider ${isDragging ? 'dragging' : ''}`}
          onMouseDown={this._handleMouseDown}
        >
          <div className="split-handle"></div>
        </div>
        {this._renderResponseSection(entry, 100 - splitPosition)}
        {this._renderFieldTooltip()}
      </div>
    );
  }

  _renderMergedSection = (entry) => {
    if (!entry) return null;

    const cachedEntry = entry.entryId ? getNetworkEntry(entry.entryId) : null;
    const entryToRender = cachedEntry || entry;
    const { method, request, response, responses, streamComplete, error, requestId } = entryToRender;
    const { jsonCollapsed, editMode, editedData, repeated, editSent, requestCopied, requestCollapsed, showDiff } = this.state;

    // Raw request lookup (same strategies as _renderRequestSection)
    const rawCache = window.__GRPCWEB_DEVTOOLS_RAW_CACHE__;
    let rawRequest = null;
    if (requestId !== undefined) rawRequest = rawCache?.get(requestId);
    if (!rawRequest && entry.entryId !== undefined) rawRequest = rawCache?.get(entry.entryId);
    if (!rawRequest && method && entryToRender.timestamp && rawCache) {
      rawRequest = rawCache.get(`${method}@${entryToRender.timestamp}`) || null;
    }
    if (!rawRequest && method && rawCache) {
      let best = null, bestScore = Infinity;
      const ts = entryToRender.timestamp || Date.now();
      for (const [, v] of rawCache.entries()) {
        if (v.url === method || v.url.includes(method) || method.includes(v.url)) {
          const diff = Math.abs(ts - (v.timestamp || 0));
          if (diff < bestScore) { bestScore = diff; best = v; }
        }
      }
      rawRequest = best;
    }

    const merged = {};
    if (request != null) merged.request = editMode && editedData?.request ? editedData.request : request;
    if (error != null) merged.response = error;
    else if (responses && responses.length > 0) merged.responses = responses.map(r => r.data ?? r);
    else if (response != null) merged.response = response;

    const theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "twilight" : "rjv-default";

    return (
      <div className={`request-section${editMode ? ' edit-mode' : ''}`} style={{ height: '100%' }}>
        <div className="section-header">
          <span className="section-title">Request / Response</span>
          {editMode && <span className="edit-mode-badge">✏ Editing</span>}
          <div className="section-actions">
            {editMode ? (
              <>
                <button className="action-button send" onClick={this._sendEditedRequest}>
                  <span>Send</span>
                  <RepeatIcon />
                </button>
                <button className="action-button" onClick={this._cancelEdit}>
                  <span>Cancel</span>
                </button>
              </>
            ) : (
              <>
                <button className={`action-button ${editSent ? 'repeated' : ''}`} onClick={this._startEdit}>
                  <span>{editSent ? 'Sent!!!' : 'Edit & Repeat'}</span>
                </button>
                <button
                  className={`action-button ${repeated ? 'repeated' : ''}`}
                  onClick={this._repeatRequest}
                  title={rawRequest?.body
                    ? 'Repeat this request with original body'
                    : 'Cannot repeat: Original body not available'}
                >
                  <span>{repeated ? 'Sent!!!' : 'Repeat'}</span>
                  <RepeatIcon />
                </button>
              </>
            )}
            {!editMode && entry.isRepeat && (
              <button
                className={`action-button${showDiff ? ' active' : ''}`}
                onClick={() => this.setState(s => ({ showDiff: !s.showDiff }))}
              >
                <span>{showDiff ? 'Body' : 'Diff'}</span>
              </button>
            )}
            <button className={`action-button ${requestCopied ? 'copied' : ''}`} onClick={this._copyRequestToClipboard}>
              <span>{requestCopied ? 'Copied!' : 'Copy'}</span>
              <CopyIcon />
            </button>
            <button className="action-button" onClick={this._toggleRequestExpand}>
              <span>{requestCollapsed === false ? 'Collapse' : 'Expand'}</span>
              {requestCollapsed === false ? <MinusIcon /> : <PlusIcon />}
            </button>
          </div>
        </div>
        <div className="section-content">
          {showDiff && entry.isRepeat ? (
            <div className="merged-diff-view">
              <div className="diff-section-label">Request</div>
              {this._renderInlineDiff(entry, 'request')}
              <div className="diff-section-label">Response</div>
              {this._renderInlineDiff(entry, 'response')}
            </div>
          ) : (
            <ReactJson
              key={`merged-${entry.entryId}-${requestCollapsed}-${editMode}`}
              name={false}
              theme={theme}
              style={{ backgroundColor: "transparent" }}
              enableClipboard={false}
              collapsed={requestCollapsed}
              displayDataTypes={false}
              displayObjectSize={false}
              src={merged}
              onEdit={editMode ? this._onJsonEditMerged : false}
              onAdd={editMode ? this._onJsonEditMerged : false}
              onDelete={editMode ? this._onJsonEditMerged : false}
            />
          )}
        </div>
      </div>
    );
  };

  _renderRequestSection = (entry, heightPercent) => {
    if (!entry) return null;

    const cachedEntry = entry.entryId ? getNetworkEntry(entry.entryId) : null;
    const entryToRender = cachedEntry || entry;
    const { method, request, requestId } = entryToRender;
    const { requestTab, requestCollapsed, editMode, editedData, repeated, editSent, requestCopied } = this.state;
    const fieldInspectorEnabled = this.props.fieldInspector;

    const rawCache = window.__GRPCWEB_DEVTOOLS_RAW_CACHE__;

    // Try to get raw request using same fallback strategy as Repeat
    let rawRequest = null;

    // Strategy 1: Use requestId
    if (requestId !== undefined) {
      rawRequest = rawCache?.get(requestId);
    }

    // Strategy 2: Use entryId
    if (!rawRequest && entry.entryId !== undefined) {
      rawRequest = rawCache?.get(entry.entryId);
    }

    // Strategy 3: Composite key (URL@timestamp) - precise matching
    if (!rawRequest && method && entryToRender.timestamp && rawCache) {
      const compositeKey = `${method}@${entryToRender.timestamp}`;
      rawRequest = rawCache.get(compositeKey);
      if (rawRequest) {
        console.log('[NetworkDetails] ✓ Composite key match:', compositeKey);
      }
    }

    // Strategy 4: URL-based matching with timestamp proximity
    // For same URL, select the one closest to entry's timestamp
    if (!rawRequest && method && rawCache) {
      let bestMatch = null;
      let bestMatchScore = Infinity;
      const entryTimestamp = entryToRender.timestamp || Date.now();

      for (const [cacheKey, cacheValue] of rawCache.entries()) {
        if (cacheValue.url === method ||
            cacheValue.url.includes(method) ||
            method.includes(cacheValue.url)) {
          // Calculate time difference (prefer closest timestamp)
          const cacheTimestamp = cacheValue.timestamp || 0;
          const timeDiff = Math.abs(entryTimestamp - cacheTimestamp);

          if (timeDiff < bestMatchScore) {
            bestMatchScore = timeDiff;
            bestMatch = cacheValue;
          }
        }
      }

      if (bestMatch) {
        rawRequest = bestMatch;
        console.log('[NetworkDetails] URL match: selected by timestamp diff:', bestMatchScore, 'ms');
      }
    }

    // DEBUG: Log raw cache status
    console.log('[NetworkDetails] Rendering request section');
    console.log('[NetworkDetails] Entry requestId:', requestId);
    console.log('[NetworkDetails] Entry entryId:', entry.entryId);
    console.log('[NetworkDetails] Entry method:', method);
    console.log('[NetworkDetails] Raw cache exists:', !!rawCache);
    console.log('[NetworkDetails] Raw cache size:', rawCache?.size);
    console.log('[NetworkDetails] Raw request found:', !!rawRequest);
    console.log('[NetworkDetails] Raw request has headers:', !!rawRequest?.headers);
    console.log('[NetworkDetails] Raw request has body:', !!rawRequest?.body);
    if (rawRequest) {
      console.log('[NetworkDetails] Raw request keys:', Object.keys(rawRequest));
    }

    return (
      <div className={`request-section${editMode ? ' edit-mode' : ''}`} style={{ height: `${heightPercent}%` }}>
        <div className="section-header">
          <span className="section-title">Request</span>
          {editMode && <span className="edit-mode-badge">✏ Editing</span>}
          <div className="section-tabs">
            {entry.isRepeat && (
              <button
                className={`tab-button ${requestTab === 'diff' ? 'active' : ''}`}
                onClick={() => this.setState({ requestTab: 'diff' })}
              >
                Diff
              </button>
            )}
            <button
              className={`tab-button ${requestTab === 'headers' ? 'active' : ''}`}
              onClick={() => this.setState({ requestTab: 'headers' })}
            >
              Headers
            </button>
            <button
              className={`tab-button ${requestTab === 'body' ? 'active' : ''}`}
              onClick={() => this.setState({ requestTab: 'body' })}
            >
              Body
            </button>
          </div>
          <div className="section-actions">
            {editMode ? (
              <>
                <button className="action-button send" onClick={this._sendEditedRequest}>
                  <span>Send</span>
                  <RepeatIcon />
                </button>
                <button className="action-button" onClick={this._cancelEdit}>
                  <span>Cancel</span>
                </button>
              </>
            ) : (
              <>
                <button className={`action-button ${editSent ? 'repeated' : ''}`} onClick={this._startEdit}>
                  <span>{editSent ? 'Sent!!!' : 'Edit & Repeat'}</span>
                </button>
                <button
                  className={`action-button ${repeated ? 'repeated' : ''}`}
                  onClick={() => {
                    console.log('[UI] Repeat button clicked');
                    console.log('[UI] Entry:', entry);
                    console.log('[UI] Raw request:', rawRequest);
                    this._repeatRequest();
                  }}
                  title={rawRequest?.body
                    ? 'Repeat this request with original body'
                    : 'Cannot repeat: Original body not available (will show error)'}
                >
                  <span>{repeated ? 'Sent!!!' : 'Repeat'}</span>
                  <RepeatIcon />
                </button>
              </>
            )}
            <button className={`action-button ${requestCopied ? 'copied' : ''}`} onClick={this._copyRequestToClipboard}>
              <span>{requestCopied ? 'Copied!' : 'Copy'}</span>
              <CopyIcon />
            </button>
            <button className="action-button" onClick={this._toggleRequestExpand}>
              <span>{requestCollapsed === false ? 'Collapse' : 'Expand'}</span>
              {requestCollapsed === false ? <MinusIcon /> : <PlusIcon />}
            </button>
          </div>
        </div>
        <div
          className="section-content"
          onMouseMove={fieldInspectorEnabled && requestTab === 'body' ? (e) => this._onSectionMouseMove(e, 'request') : undefined}
          onMouseLeave={fieldInspectorEnabled ? this._onSectionMouseLeave : undefined}
        >
          {requestTab === 'headers' && this._renderRequestHeaders(rawRequest)}
          {requestTab === 'body' && this._renderRequestBody(method, request, editMode, editedData, requestCollapsed, fieldInspectorEnabled, 'request')}
          {requestTab === 'diff' && this._renderInlineDiff(entry, 'request')}
        </div>
      </div>
    );
  };

  _renderResponseSection = (entry, heightPercent) => {
    if (!entry) return null;

    const cachedEntry = entry.entryId ? getNetworkEntry(entry.entryId) : null;
    const entryToRender = cachedEntry || entry;
    const { method, response, responses, streamComplete, error, requestId } = entryToRender;
    const { responseTab, responseCollapsed, responseCopied } = this.state;
    const fieldInspectorEnabled = this.props.fieldInspector;

    const rawCache = window.__GRPCWEB_DEVTOOLS_RAW_CACHE__;

    // Try to get raw request using same fallback strategy
    let rawRequest = null;

    // Strategy 1: Use requestId
    if (requestId !== undefined) {
      rawRequest = rawCache?.get(requestId);
    }

    // Strategy 2: Use entryId
    if (!rawRequest && entry.entryId !== undefined) {
      rawRequest = rawCache?.get(entry.entryId);
    }

    // Strategy 3: Composite key (URL@timestamp) - precise matching
    if (!rawRequest && method && entryToRender.timestamp && rawCache) {
      const compositeKey = `${method}@${entryToRender.timestamp}`;
      rawRequest = rawCache.get(compositeKey);
      if (rawRequest) {
        console.log('[NetworkDetails] ✓ Composite key match:', compositeKey);
      }
    }

    // Strategy 4: URL-based matching with timestamp proximity
    // For same URL, select the one closest to entry's timestamp
    if (!rawRequest && method && rawCache) {
      let bestMatch = null;
      let bestMatchScore = Infinity;
      const entryTimestamp = entryToRender.timestamp || Date.now();

      for (const [cacheKey, cacheValue] of rawCache.entries()) {
        if (cacheValue.url === method ||
            cacheValue.url.includes(method) ||
            method.includes(cacheValue.url)) {
          // Calculate time difference (prefer closest timestamp)
          const cacheTimestamp = cacheValue.timestamp || 0;
          const timeDiff = Math.abs(entryTimestamp - cacheTimestamp);

          if (timeDiff < bestMatchScore) {
            bestMatchScore = timeDiff;
            bestMatch = cacheValue;
          }
        }
      }

      if (bestMatch) {
        rawRequest = bestMatch;
        console.log('[NetworkDetails] URL match: selected by timestamp diff:', bestMatchScore, 'ms');
      }
    }

    const isStreaming = Array.isArray(responses);

    return (
      <div className="response-section" style={{ height: `${heightPercent}%` }}>
        <div className="section-header">
          <span className="section-title">
            {isStreaming ? `Response Stream${responses.length > 0 ? ` (${responses.length})` : ''}` : 'Response'}
          </span>
          <div className="section-tabs">
            {entry.isRepeat && (
              <button
                className={`tab-button ${responseTab === 'diff' ? 'active' : ''}`}
                onClick={() => this.setState({ responseTab: 'diff' })}
              >
                Diff
              </button>
            )}
            <button
              className={`tab-button ${responseTab === 'headers' ? 'active' : ''}`}
              onClick={() => this.setState({ responseTab: 'headers' })}
            >
              Headers
            </button>
            <button
              className={`tab-button ${responseTab === 'body' ? 'active' : ''}`}
              onClick={() => this.setState({ responseTab: 'body' })}
            >
              Body
            </button>
          </div>
          <div className="section-actions">
            <button className={`action-button ${responseCopied ? 'copied' : ''}`} onClick={this._copyResponseToClipboard}>
              <span>{responseCopied ? 'Copied!' : 'Copy'}</span>
              <CopyIcon />
            </button>
            <button className="action-button" onClick={this._toggleResponseExpand}>
              <span>{responseCollapsed === false ? 'Collapse' : 'Expand'}</span>
              {responseCollapsed === false ? <MinusIcon /> : <PlusIcon />}
            </button>
          </div>
        </div>
        <div
          className="section-content"
          onMouseMove={fieldInspectorEnabled && responseTab === 'body' ? (e) => this._onSectionMouseMove(e, 'response') : undefined}
          onMouseLeave={fieldInspectorEnabled ? this._onSectionMouseLeave : undefined}
        >
          {responseTab === 'headers' && this._renderResponseHeaders(rawRequest)}
          {responseTab === 'body' && (
            isStreaming
              ? this._renderStreamingResponses(responses, streamComplete, responseCollapsed)
              : this._renderResponseBody(response, error, responseCollapsed, fieldInspectorEnabled, 'response')
          )}
          {responseTab === 'diff' && this._renderInlineDiff(entry, 'response')}
        </div>
      </div>
    );
  };

  _renderSearchBar = (entry) => {
    if (!entry) return null;

    const isExpanded = this.state.jsonCollapsed === false;
    const { copied, repeated, editMode } = this.state;

    return (
      <div className="details-search-bar">
        {!editMode && (
          <input
            type="text"
            className="json-search-input"
            placeholder="Search in JSON..."
            value={this.state.searchText}
            onChange={this._onSearchChange}
          />
        )}
        {editMode ? (
          <>
            <button
              className="json-action-button edit-send-button"
              type="button"
              title="Send edited request"
              onClick={this._sendEditedRequest}
            >
              <span>Send</span>
              <RepeatIcon />
            </button>
            <button
              className="json-action-button"
              type="button"
              title="Cancel editing"
              onClick={this._cancelEdit}
            >
              <span>Cancel</span>
            </button>
          </>
        ) : (
          <>
            <button
              className="json-action-button"
              type="button"
              title="Edit and repeat request"
              onClick={this._startEdit}
            >
              <span>Edit & Repeat</span>
            </button>
            <button
              className={`json-action-button ${repeated ? 'repeated' : ''}`}
              type="button"
              title="Repeat request with same parameters"
              onClick={this._repeatRequest}
            >
              <span>{repeated ? 'Sent!!!' : 'Repeat'}</span>
              <RepeatIcon />
            </button>
            <button
              className={`json-action-button ${copied ? 'copied' : ''}`}
              type="button"
              title="Copy JSON to clipboard"
              onClick={this._copyToClipboard}
            >
              <span>{copied ? 'Copied!' : 'Copy'}</span>
              <CopyIcon />
            </button>
            <button
              className="json-action-button"
              type="button"
              title={isExpanded ? "Collapse all" : "Expand all"}
              onClick={this._toggleExpandAll}
            >
              <span>{isExpanded ? "Collapse" : "Expand"}</span>
              {isExpanded ? <MinusIcon /> : <PlusIcon />}
            </button>
          </>
        )}
      </div>
    );
  };
  _renderContent = (entry) => {
    if (entry) {
      const cachedEntry = entry.entryId ? getNetworkEntry(entry.entryId) : null;
      const entryToRender = cachedEntry || entry;
      const { method, request, response, error } = entryToRender;
      const isMissingPayload =
        !cachedEntry && (entry.request || entry.response);
      const payloadBytes = cachedEntry?.payloadBytes;
      const showLargePayloadWarning =
        payloadBytes && payloadBytes >= LARGE_PAYLOAD_BYTES;
      const isVeryLargePayload =
        payloadBytes && payloadBytes >= VERY_LARGE_PAYLOAD_BYTES;
      const theme = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "twilight"
        : "rjv-default";
      // Use edited data if in edit mode, otherwise use original
      var src = this.state.editMode && this.state.editedData
        ? this.state.editedData
        : { method };

      if (!this.state.editMode || !this.state.editedData) {
        if (request) src.request = request;
        if (response) src.response = response;
        if (isMissingPayload) {
          src.payload = "Full payload not available (evicted from cache).";
        }
        if (error) src.error = error;
      }

      // Determine collapse level based on payload size
      let collapseLevel = this.state.jsonCollapsed;
      if (this.state.searchText || this.props.globalSearchValue) {
        collapseLevel = false;
      } else if (isVeryLargePayload) {
        // Very large payloads: collapse everything (level 0)
        collapseLevel = collapseLevel === false ? 0 : collapseLevel;
      } else if (showLargePayloadWarning) {
        // Large payloads: collapse to level 2 minimum
        collapseLevel = collapseLevel === false ? 2 : Math.max(collapseLevel, 2);
      }

      return (
        <div className={`details-scroll-area ${this.state.editMode ? 'edit-mode' : ''}`} ref={this.jsonContainerRef}>
          {showLargePayloadWarning && (
            <div className="payload-warning">
              Large payload (~{formatBytes(payloadBytes)}).
              {isVeryLargePayload ? ' Collapsed for performance.' : ' Rendering may be slow.'}
            </div>
          )}
          {isMissingPayload && (
            <div className="payload-warning">
              Full payload is no longer available (evicted from cache).
            </div>
          )}
          <ReactJson
            key={`json-${entry.entryId}-${this.state.jsonCollapsed}-${this.state.searchText || this.props.globalSearchValue || ''}-${this.state.editMode}`}
            name="grpc"
            theme={theme}
            style={{ backgroundColor: "transparent" }}
            enableClipboard={false}
            collapsed={this.state.editMode ? false : collapseLevel}
            collapseStringsAfterLength={showLargePayloadWarning ? 100 : 200}
            displayDataTypes={false}
            displayObjectSize={false}
            src={src}
            onEdit={this.state.editMode ? this._onJsonEdit : false}
            onAdd={this.state.editMode ? this._onJsonEdit : false}
            onDelete={this.state.editMode ? this._onJsonEdit : false}
          />
        </div>
      );
    }
  };

  _renderRequestHeaders = (rawRequest) => {
    if (!rawRequest || !rawRequest.headers) {
      return <div className="no-data">No request headers available</div>;
    }

    const headers = {};
    if (Array.isArray(rawRequest.headers)) {
      rawRequest.headers.forEach(h => {
        headers[h.name] = h.value;
      });
    } else {
      Object.assign(headers, rawRequest.headers);
    }

    const theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "twilight" : "rjv-default";

    return (
      <ReactJson
        name={false}
        theme={theme}
        style={{ backgroundColor: "transparent" }}
        enableClipboard={false}
        collapsed={false}
        displayDataTypes={false}
        displayObjectSize={false}
        src={headers}
      />
    );
  };

  _renderRequestBody = (method, request, editMode, editedData, collapsed, inspectorEnabled, kind) => {
    if (!request) {
      return <div className="no-data">No request body</div>;
    }

    const theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "twilight" : "rjv-default";
    const src = editMode && editedData ? editedData.request : request;

    return (
      <ReactJson
        key={`request-${this.props.entry?.entryId}-${collapsed}-${editMode}`}
        name={false}
        theme={theme}
        style={{ backgroundColor: "transparent" }}
        enableClipboard={false}
        collapsed={collapsed}
        displayDataTypes={false}
        displayObjectSize={false}
        src={src}
        onEdit={editMode ? this._onJsonEdit : false}
        onAdd={editMode ? this._onJsonEdit : false}
        onDelete={editMode ? this._onJsonEdit : false}
        onSelect={inspectorEnabled ? (s) => this._onFieldSelect(s, kind || 'request') : false}
      />
    );
  };

  _renderResponseHeaders = (rawRequest) => {
    if (!rawRequest || !rawRequest.responseHeaders) {
      return <div className="no-data">Response headers not available</div>;
    }

    const headers = {};

    // Add status info
    if (rawRequest.responseStatus !== undefined) {
      headers[':status'] = `${rawRequest.responseStatus}${rawRequest.responseStatusText ? ' ' + rawRequest.responseStatusText : ''}`;
    }

    // Add response headers
    if (Array.isArray(rawRequest.responseHeaders)) {
      rawRequest.responseHeaders.forEach(h => {
        headers[h.name] = h.value;
      });
    }

    const theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "twilight" : "rjv-default";

    return (
      <ReactJson
        name={false}
        theme={theme}
        style={{ backgroundColor: "transparent" }}
        enableClipboard={false}
        collapsed={false}
        displayDataTypes={false}
        displayObjectSize={false}
        src={headers}
      />
    );
  };

  _renderResponseBody = (response, error, collapsed, inspectorEnabled, kind) => {
    const theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "twilight" : "rjv-default";

    if (error) {
      return (
        <ReactJson
          key={`response-error-${this.props.entry?.entryId}-${collapsed}`}
          name={false}
          theme={theme}
          style={{ backgroundColor: "transparent" }}
          enableClipboard={false}
          collapsed={collapsed}
          displayDataTypes={false}
          displayObjectSize={false}
          src={error}
          onSelect={inspectorEnabled ? (s) => this._onFieldSelect(s, kind || 'response') : false}
        />
      );
    }

    if (!response) {
      return <div className="no-data">No response body</div>;
    }

    return (
      <ReactJson
        key={`response-${this.props.entry?.entryId}-${collapsed}`}
        name={false}
        theme={theme}
        style={{ backgroundColor: "transparent" }}
        enableClipboard={false}
        collapsed={collapsed}
        displayDataTypes={false}
        displayObjectSize={false}
        src={response}
        onSelect={inspectorEnabled ? (s) => this._onFieldSelect(s, kind || 'response') : false}
      />
    );
  };

  _renderStreamingResponses = (responses, streamComplete, responseCollapsed) => {
    const theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "twilight" : "rjv-default";
    if (!responses || responses.length === 0) {
      return <div className="no-data">Waiting for streaming responses...</div>;
    }
    return (
      <div className="stream-responses">
        {responses.map((item, idx) => (
          <StreamResponseItem key={idx} index={idx} item={item} theme={theme} parentCollapsed={responseCollapsed} />
        ))}
        {streamComplete && (
          <div className="stream-complete">✓ Stream complete ({responses.length} messages)</div>
        )}
      </div>
    );
  };

  _toggleRequestExpand = () => {
    this.setState((prevState) => ({
      requestCollapsed: prevState.requestCollapsed === false ? 1 : false,
    }));
  };

  _toggleResponseExpand = () => {
    this.setState((prevState) => ({
      responseCollapsed: prevState.responseCollapsed === false ? 1 : false,
    }));
  };

  _handleMouseDown = (e) => {
    e.preventDefault();
    this.setState({ isDragging: true });
  };

  _handleMouseMove = (e) => {
    if (!this.state.isDragging || !this.containerRef.current) return;

    const container = this.containerRef.current;
    const rect = container.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const percentage = (y / rect.height) * 100;

    // Limit between 20% and 80%
    const clampedPercentage = Math.min(Math.max(percentage, 20), 80);

    this.setState({ splitPosition: clampedPercentage });
  };

  _handleMouseUp = () => {
    if (this.state.isDragging) {
      this.setState({ isDragging: false });
    }
  };

  _toggleExpandAll = () => {
    this.setState((prevState) => ({
      jsonCollapsed: prevState.jsonCollapsed === false ? 1 : false,
    }));
  };

  _startEdit = () => {
    const { entry, openSettings } = this.props;
    if (!entry) return;
    if (!protoManager.isReady()) {
      openSettings();
      return;
    }

    const cachedEntry = entry.entryId ? getNetworkEntry(entry.entryId) : null;
    const entryToRender = cachedEntry || entry;
    const { method, request, response, error } = entryToRender;

    // Create initial editable data
    const editData = { method };
    if (request) editData.request = request;
    if (response) editData.response = response;
    if (error) editData.error = error;

    this.setState({
      editMode: true,
      editedData: editData,
      requestCollapsed: false, // expand all on entering edit mode
    });
  };

  _cancelEdit = () => {
    this.setState({
      editMode: false,
      editedData: null,
    });
  };

  _onJsonEdit = (edit) => {
    // edit object contains: { updated_src, name, namespace, new_value, existing_value }
    // updated_src is the updated request body
    this.setState((prevState) => ({
      editedData: {
        ...prevState.editedData,
        request: edit.updated_src,
      },
    }));
    return true; // Allow the edit
  };

  // For merged view: updated_src is { request: {...}, response: {...} }
  // Extract only the request part for editedData
  _onJsonEditMerged = (edit) => {
    this.setState((prevState) => ({
      editedData: {
        ...prevState.editedData,
        request: edit.updated_src.request,
      },
    }));
    return true;
  };

  _sendEditedRequest = () => {
    console.log('[Panel] ==================== SEND BUTTON CLICKED ====================');
    console.log('[Panel] Current state:', this.state);

    const { entry } = this.props;
    if (!entry) {
      console.error('[Panel] FAIL: No entry found');
      return;
    }

    const editedData = this.state.editedData;
    console.log('[Panel] Edited data from state:', editedData);

    if (!editedData) {
      console.error('[Panel] FAIL: editedData is null/undefined');
      return;
    }

    if (!editedData.request) {
      console.error('[Panel] FAIL: editedData.request is missing');
      return;
    }

    console.log('[Panel] ✓ Validation passed, proceeding...');

    const cachedEntry = entry.entryId ? getNetworkEntry(entry.entryId) : null;
    const entryToRender = cachedEntry || entry;
    const { requestId, method, request: originalRequest } = entryToRender;

    console.log('[Panel] ========== Edit & Repeat Request ==========');
    console.log('[Panel] Method:', method);
    console.log('[Panel] Request ID:', requestId);
    console.log('[Panel] Original request:', JSON.stringify(originalRequest, null, 2));
    console.log('[Panel] Edited request:', JSON.stringify(editedData.request, null, 2));

    // Show differences and detect if anything was actually changed
    let hasChanges = false;
    if (originalRequest && editedData.request) {
      console.log('[Panel] Changes:');
      Object.keys(editedData.request).forEach(key => {
        if (JSON.stringify(originalRequest[key]) !== JSON.stringify(editedData.request[key])) {
          console.log(`  - ${key}: ${JSON.stringify(originalRequest[key])} -> ${JSON.stringify(editedData.request[key])}`);
          hasChanges = true;
        }
      });
    }
    console.log('[Panel] Has changes:', hasChanges);
    console.log('[Panel] ===============================================');

    if (!requestId) {
      console.warn('[Panel] No request ID');
      return;
    }

    // Get raw request from cache using multiple strategies (same as _repeatRequest)
    const rawCache = window.__GRPCWEB_DEVTOOLS_RAW_CACHE__;
    if (!rawCache) {
      console.error('[Panel] Raw cache not available');
      return;
    }

    console.log('[Panel] Raw cache size:', rawCache.size);
    console.log('[Panel] Available request IDs in cache:', Array.from(rawCache.keys()));

    // Try multiple lookup strategies:
    // 1. Try requestId (if available)
    // 2. Try entryId
    // 3. Try URL-based matching (for DebuggerCapture)
    let rawRequest = null;
    let lookupId = null;

    // Strategy 1: Use requestId from entry
    if (requestId !== undefined) {
      rawRequest = rawCache.get(requestId);
      if (rawRequest) {
        lookupId = requestId;
        console.log('[Panel] ✓ Found by requestId:', requestId);
      }
    }

    // Strategy 2: Use entryId
    if (!rawRequest && entry.entryId !== undefined) {
      rawRequest = rawCache.get(entry.entryId);
      if (rawRequest) {
        lookupId = entry.entryId;
        console.log('[Panel] ✓ Found by entryId:', entry.entryId);
      }
    }

    // Strategy 3: Composite key (URL@timestamp) - precise matching
    if (!rawRequest && method && entryToRender.timestamp) {
      const compositeKey = `${method}@${entryToRender.timestamp}`;
      rawRequest = rawCache.get(compositeKey);
      if (rawRequest) {
        lookupId = compositeKey;
        console.log('[Panel] ✓ Found by composite key:', compositeKey);
      }
    }

    // Strategy 4: URL-based matching with timestamp proximity
    if (!rawRequest && method) {
      console.log('[Panel] Attempting URL-based lookup for:', method);

      let bestMatch = null;
      let bestMatchKey = null;
      let bestMatchScore = Infinity;
      const entryTimestamp = entryToRender.timestamp || Date.now();

      // Iterate through cache to find matching URL with closest timestamp
      for (const [cacheKey, cacheValue] of rawCache.entries()) {
        if (cacheValue.url === method || cacheValue.url.includes(method) || method.includes(cacheValue.url)) {
          // Calculate time difference (prefer closest timestamp)
          const cacheTimestamp = cacheValue.timestamp || 0;
          const timeDiff = Math.abs(entryTimestamp - cacheTimestamp);

          if (timeDiff < bestMatchScore) {
            bestMatchScore = timeDiff;
            bestMatch = cacheValue;
            bestMatchKey = cacheKey;
          }
        }
      }

      if (bestMatch) {
        rawRequest = bestMatch;
        lookupId = bestMatchKey;
        console.log('[Panel] ✓ Found by URL match with timestamp proximity:', {
          cacheKey: bestMatchKey,
          cacheUrl: bestMatch.url,
          entryMethod: method,
          timestampDiff: bestMatchScore + ' ms'
        });
      }
    }

    if (!rawRequest) {
      console.error('[Panel] Raw request not found after all strategies');
      console.warn('[Panel] Cache contents:', Array.from(rawCache.entries()).map(([k, v]) => ({
        id: k,
        type: typeof k,
        url: v.url
      })));

      alert(
        'Cannot send edited request: Original request body is not available.\n\n' +
        'This can happen if:\n' +
        '• The request was captured before DevTools was opened\n' +
        '• The request is too old (cache limit reached)\n' +
        '• The page was refreshed\n\n' +
        'Please trigger a new request to capture the body.'
      );
      return;
    }

    console.log('[Panel] ✓ Using lookup ID:', lookupId, 'Type:', typeof lookupId);
    console.log('[Panel] Found raw request:', rawRequest.url);
    console.log('[Panel] Body length (base64):', rawRequest.body?.length || 0);
    console.log('[Panel] Body (first 100 chars):', rawRequest.body?.substring(0, 100) || 'EMPTY');
    console.log('[Panel] Edited request data:', editedData.request);

    if (!rawRequest.body || rawRequest.body.length === 0) {
      console.error('[Panel] ✗ Raw request body is empty! Cannot send edited request.');
      return;
    }

    // Prepare headers - same as repeat request
    const allowedHeaders = [
      'content-type',
      'grpc-timeout',
      'grpc-encoding',
      'grpc-accept-encoding',
      'x-grpc-web',
      'x-user-agent',
      'authorization',
      'app-version',
      'instance-id'
    ];

    const forbiddenHeaders = [
      'cookie',
      'cookie2',
      'host',
      'connection',
      'content-length',
      'expect',
      'origin',
      'referer',
      'user-agent',
      'accept',
      'accept-encoding',
      'accept-language',
      'priority',
      'sec-fetch-site',
      'sec-fetch-mode',
      'sec-fetch-dest',
      'sec-ch-ua',
      'sec-ch-ua-mobile',
      'sec-ch-ua-platform'
    ];

    const headers = {};
    rawRequest.headers.forEach(h => {
      const headerName = h.name.toLowerCase();

      if (headerName.startsWith(':')) {
        return;
      }

      if (forbiddenHeaders.includes(headerName)) {
        return;
      }

      if (headerName.startsWith('sec-')) {
        return;
      }

      if (allowedHeaders.includes(headerName) || headerName.startsWith('x-')) {
        headers[h.name] = h.value;
      }
    });

    console.log('[Panel] Filtered headers:', headers);

    // Check if compression is needed
    const grpcEncoding = headers['grpc-encoding'] || headers['Grpc-Encoding'];
    const needsCompression = grpcEncoding && grpcEncoding.toLowerCase() === 'gzip';
    console.log('[Panel] gRPC encoding:', grpcEncoding, 'needs compression:', needsCompression);

    // Try to encode edited request data to protobuf
    let body;

    // Helper function to convert base64 to ArrayBuffer
    function base64ToArrayBuffer(base64) {
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes.buffer;
    }

    // If no changes, use original body directly
    if (!hasChanges) {
      console.log('[Panel] No changes detected, using original request body');
      body = rawRequest.encoding === 'base64'
        ? base64ToArrayBuffer(rawRequest.body)
        : rawRequest.body;
    } else if (protoManager.isReady()) {
      console.log('[Panel] Changes detected, ProtoManager is ready, encoding edited request');
      console.log('[Panel] Using method for encoding:', method);

      try {
        // Encode the edited request data using the original method name
        const messageBytes = protoManager.encodeMessage(method, editedData.request);

        if (messageBytes) {
          // Build gRPC-web frame with compression if needed
          const frame = protoManager.buildGrpcWebFrame(messageBytes, needsCompression);
          body = frame.buffer;
          console.log('[Panel] ✓ Encoded and framed message, size:', body.byteLength, 'compressed:', needsCompression);
        } else {
          throw new Error('Failed to encode message');
        }
      } catch (error) {
        console.error('[Panel] Failed to encode with ProtoManager:', error);
        console.warn('[Panel] Falling back to original request body');

        // Fallback to original body
        body = rawRequest.encoding === 'base64'
          ? base64ToArrayBuffer(rawRequest.body)
          : rawRequest.body;
      }
    } else {
      console.warn('[Panel] Changes detected but ProtoManager not ready.');
      console.warn('[Panel] Upload proto files in Settings to encode edited requests.');
      console.warn('[Panel] Using original request body for now.');

      // Use original body
      body = rawRequest.encoding === 'base64'
        ? base64ToArrayBuffer(rawRequest.body)
        : rawRequest.body;
    }

    console.log('[Panel] ✓ Body prepared, length:', body.byteLength || body.length);
    console.log('[Panel] Sending fetch to:', rawRequest.url);
    console.log('[Panel] Headers:', headers);

    // Convert body to base64 for passing to page context
    function arrayBufferToBase64(buffer) {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    }

    const bodyBase64 = arrayBufferToBase64(body);
    console.log('[Panel] Body as base64, length:', bodyBase64.length);

    // Execute fetch in PAGE CONTEXT using inspectedWindow.eval
    // This is critical - fetch must run in page context, not panel context
    const code = `
(function() {
  const url = ${JSON.stringify(rawRequest.url)};
  const bodyBase64 = ${JSON.stringify(bodyBase64)};
  const headers = ${JSON.stringify(headers)};
  const grpcMethod = ${JSON.stringify(method)};
  const requestData = ${JSON.stringify(editedData.request)};
  const requestHeaders = ${JSON.stringify(rawRequest.headers)};

  console.log('[Page] Edit & Repeat - Converting base64 to bytes');
  // Convert base64 to Uint8Array
  const binaryString = atob(bodyBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  console.log('[Page] Edit & Repeat - Sending fetch, body length:', bytes.length);

  // Generate request ID
  const requestId = Math.floor(Math.random() * 1000000);

  // Send raw request data for caching
  window.postMessage({
    type: '__GRPCWEB_DEVTOOLS_RAW_REQUEST__',
    requestId: requestId,
    grpcMethod: grpcMethod,
    rawRequest: {
      url: url,
      method: 'POST',
      headers: requestHeaders,
      body: bodyBase64,
      encoding: 'base64'
    }
  }, '*');

  // Send the request
  const __start = Date.now();
  fetch(url, {
    method: 'POST',
    headers: headers,
    body: bytes,
    credentials: 'omit',
    mode: 'cors'
  })
  .then(response => {
    const responseStatus = response.status;
    const responseOk = response.ok;

    return response.arrayBuffer().then(responseBody => {
      const __duration = Date.now() - __start;
      const responseBytes = new Uint8Array(responseBody);
      let binary = '';
      for (let i = 0; i < responseBytes.byteLength; i++) {
        binary += String.fromCharCode(responseBytes[i]);
      }
      const responseBodyBase64 = btoa(binary);

      window.postMessage({
        type: "__GRPCWEB_DEVTOOLS__",
        method: grpcMethod,
        methodType: "unary",
        requestId: requestId,
        request: requestData,
        responseBodyBase64: responseBodyBase64,
        responseStatus: responseStatus,
        responseOk: responseOk,
        duration: __duration,
        isRepeat: true,
        isEditRepeat: true,
      }, "*");
    });
  })
  .catch(err => {
    console.error('[Page] Edit & Repeat - Fetch failed:', err);
    const __duration = Date.now() - __start;
    window.postMessage({
      type: "__GRPCWEB_DEVTOOLS__",
      method: grpcMethod,
      methodType: "unary",
      requestId: requestId,
      request: requestData,
      error: { code: 0, message: err.message },
      duration: __duration,
      isRepeat: true,
      isEditRepeat: true,
    }, "*");
  });
})();
`;

    chrome.devtools.inspectedWindow.eval(code, (result, exceptionInfo) => {
      if (exceptionInfo) {
        console.error('[Panel] Failed to execute fetch in page:', exceptionInfo);
      } else {
        console.log('[Panel] ✓ Fetch triggered in page context');
        console.log('[Panel] Request will appear in gRPC list via window.postMessage');

        // Show "Sent!" feedback on Edit & Repeat button and exit edit mode
        this.setState({ editSent: true, editMode: false, editedData: null });
        setTimeout(() => this.setState({ editSent: false }), 2000);
      }
    });
  };

  _repeatRequest = () => {
    console.log('[Panel] ========== REPEAT REQUEST ==========');
    const { entry, openSettings } = this.props;
    if (!entry) {
      console.warn('[Panel] No entry');
      return;
    }
    if (!protoManager.isReady()) {
      openSettings();
      return;
    }

    const cachedEntry = entry.entryId ? getNetworkEntry(entry.entryId) : null;
    const entryToRender = cachedEntry || entry;
    const { requestId, method, request } = entryToRender;

    console.log('[Panel] Entry ID:', entry.entryId);
    console.log('[Panel] Request ID from entry:', requestId);
    console.log('[Panel] Method:', method);

    // Get raw request from cache
    const rawCache = window.__GRPCWEB_DEVTOOLS_RAW_CACHE__;
    if (!rawCache) {
      console.error('[Panel] Raw cache not available');
      return;
    }

    console.log('[Panel] Raw cache size:', rawCache.size);
    console.log('[Panel] Available request IDs in cache:', Array.from(rawCache.keys()));

    // Try multiple lookup strategies:
    // 1. Try requestId (if available)
    // 2. Try entryId
    // 3. Try URL-based matching (for DebuggerCapture)
    let rawRequest = null;
    let lookupId = null;

    // Strategy 1: Use requestId from entry
    if (requestId !== undefined) {
      rawRequest = rawCache.get(requestId);
      if (rawRequest) {
        lookupId = requestId;
        console.log('[Panel] ✓ Found by requestId:', requestId);
      }
    }

    // Strategy 2: Use entryId
    if (!rawRequest && entry.entryId !== undefined) {
      rawRequest = rawCache.get(entry.entryId);
      if (rawRequest) {
        lookupId = entry.entryId;
        console.log('[Panel] ✓ Found by entryId:', entry.entryId);
      }
    }

    // Strategy 3: Composite key (URL@timestamp) - precise matching
    if (!rawRequest && method && entryToRender.timestamp) {
      const compositeKey = `${method}@${entryToRender.timestamp}`;
      rawRequest = rawCache.get(compositeKey);
      if (rawRequest) {
        lookupId = compositeKey;
        console.log('[Panel] ✓ Found by composite key:', compositeKey);
      }
    }

    // Strategy 4: URL-based matching with timestamp proximity
    // For same URL, select the one closest to entry's timestamp
    if (!rawRequest && method) {
      console.log('[Panel] Attempting URL-based lookup for:', method);

      let bestMatch = null;
      let bestMatchKey = null;
      let bestMatchScore = Infinity;
      const entryTimestamp = entryToRender.timestamp || Date.now();

      // Iterate through cache to find matching URL with closest timestamp
      for (const [cacheKey, cacheValue] of rawCache.entries()) {
        if (cacheValue.url === method || cacheValue.url.includes(method) || method.includes(cacheValue.url)) {
          // Calculate time difference (prefer closest timestamp)
          const cacheTimestamp = cacheValue.timestamp || 0;
          const timeDiff = Math.abs(entryTimestamp - cacheTimestamp);

          if (timeDiff < bestMatchScore) {
            bestMatchScore = timeDiff;
            bestMatch = cacheValue;
            bestMatchKey = cacheKey;
          }
        }
      }

      if (bestMatch) {
        rawRequest = bestMatch;
        lookupId = bestMatchKey;
        console.log('[Panel] ✓ Found by URL match with timestamp proximity:', {
          cacheKey: bestMatchKey,
          cacheUrl: bestMatch.url,
          entryMethod: method,
          timestampDiff: bestMatchScore + ' ms'
        });
      }
    }

    if (!rawRequest) {
      console.error('[Panel] Raw request not found after all strategies');
      console.warn('[Panel] Cache contents:', Array.from(rawCache.entries()).map(([k, v]) => ({
        id: k,
        type: typeof k,
        url: v.url
      })));

      // NO FALLBACK: Repeat requires raw request body
      console.error('[Panel] Cannot repeat: Raw request body not available');
      alert(
        'Cannot repeat this request: Original request body is not available.\n\n' +
        'This can happen if:\n' +
        '• The request was captured before DevTools was opened\n' +
        '• The request is too old (cache limit reached)\n' +
        '• The page was refreshed\n\n' +
        'Please trigger a new request to capture the body.'
      );
      return;
    }

    console.log('[Panel] ✓ Using lookup ID:', lookupId, 'Type:', typeof lookupId);

    console.log('[Panel] Found raw request, URL:', rawRequest.url);
    console.log('[Panel] Body length (base64):', rawRequest.body?.length || 0);
    console.log('[Panel] Body (first 100 chars):', rawRequest.body?.substring(0, 100) || 'EMPTY');
    console.log('[Panel] Raw request object:', rawRequest);

    if (!rawRequest.body || rawRequest.body.length === 0) {
      console.error('[Panel] ✗ Raw request body is empty! Cannot repeat.');
      return;
    }

    // Prepare headers - only gRPC-specific and custom headers
    // Use WHITELIST approach to avoid CORS issues
    const allowedHeaders = [
      'content-type',
      'grpc-timeout',
      'grpc-encoding',
      'grpc-accept-encoding',
      'x-grpc-web',
      'authorization',
      'app-version',
      'instance-id',
      'service-name'
    ];

    const headers = {};
    if (Array.isArray(rawRequest.headers)) {
      rawRequest.headers.forEach(h => {
        const name = h.name.toLowerCase();
        // Only include explicitly allowed headers and x- headers
        if (allowedHeaders.includes(name) || (name.startsWith('x-') && !name.startsWith('x-forwarded'))) {
          headers[h.name] = h.value;
        }
      });
    }

    console.log('[Panel] Prepared', Object.keys(headers).length, 'headers (from', rawRequest.headers?.length || 0, 'original)');
    console.log('[Panel] Original headers:', rawRequest.headers?.map(h => h.name).join(', '));
    console.log('[Panel] Repeat headers:', Object.keys(headers).join(', '));
    console.log('[Panel] Body encoding:', rawRequest.encoding);

    // Decode and log first 20 bytes for comparison
    if (rawRequest.body && rawRequest.encoding === 'base64') {
      try {
        const binaryString = atob(rawRequest.body.substring(0, 100));
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < Math.min(20, binaryString.length); i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        console.log('[Panel] Repeat request first 20 bytes:', Array.from(bytes.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' '));
      } catch (e) {
        console.warn('[Panel] Could not decode body:', e);
      }
    }

    // Execute fetch in PAGE CONTEXT using inspectedWindow.eval
    // This is critical - fetch must run in page context, not panel context
    const code = `
(function() {
  const url = ${JSON.stringify(rawRequest.url)};
  const bodyBase64 = ${JSON.stringify(rawRequest.body)};
  const headers = ${JSON.stringify(headers)};
  const grpcMethod = ${JSON.stringify(method)};
  const requestData = ${JSON.stringify(request)};
  const requestHeaders = ${JSON.stringify(rawRequest.headers)};

  // Convert base64 to Uint8Array
  const binaryString = atob(bodyBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Generate request ID
  const requestId = Math.floor(Math.random() * 1000000);

  // Send raw request data for caching
  window.postMessage({
    type: '__GRPCWEB_DEVTOOLS_RAW_REQUEST__',
    requestId: requestId,
    grpcMethod: grpcMethod,
    rawRequest: {
      url: url,
      method: 'POST',
      headers: requestHeaders,
      body: bodyBase64,
      encoding: 'base64'
    }
  }, '*');

  // Send the request
  const __start = Date.now();
  fetch(url, {
    method: 'POST',
    headers: headers,
    body: bytes,
    credentials: 'omit',
    mode: 'cors'
  })
  .then(response => response.arrayBuffer().then(responseBody => {
    const __duration = Date.now() - __start;
    const bytes = new Uint8Array(responseBody);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const responseBodyBase64 = btoa(binary);

    window.postMessage({
      type: "__GRPCWEB_DEVTOOLS__",
      method: grpcMethod,
      methodType: "unary",
      requestId: requestId,
      request: requestData,
      responseBodyBase64: responseBodyBase64,
      duration: __duration,
      isRepeat: true,
    }, "*");
  }))
  .catch(err => {
    const __duration = Date.now() - __start;
    window.postMessage({
      type: "__GRPCWEB_DEVTOOLS__",
      method: grpcMethod,
      methodType: "unary",
      requestId: requestId,
      request: requestData,
      error: { code: 0, message: err.message },
      duration: __duration,
      isRepeat: true,
    }, "*");
  });
})();
`;

    chrome.devtools.inspectedWindow.eval(code, (result, exceptionInfo) => {
      if (exceptionInfo) {
        console.error('[Panel] Failed to execute fetch in page:', exceptionInfo);
      } else {
        console.log('[Panel] ✓ Fetch triggered in page context');
        console.log('[Panel] Request will appear in gRPC list via window.postMessage');

        // Show "Sent!" feedback
        this.setState({ repeated: true });
        setTimeout(() => this.setState({ repeated: false }), 2000);
      }
    });
  };

  _copyRequestToClipboard = () => {
    const { entry } = this.props;
    if (!entry) return;

    const cachedEntry = entry.entryId ? getNetworkEntry(entry.entryId) : null;
    const entryToRender = cachedEntry || entry;
    const { request } = entryToRender;

    if (!request) return;

    try {
      const jsonString = JSON.stringify(request, null, 2);

      const textarea = document.createElement('textarea');
      textarea.value = jsonString;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '0';
      document.body.appendChild(textarea);

      textarea.select();
      textarea.setSelectionRange(0, jsonString.length);

      try {
        const successful = document.execCommand('copy');
        if (successful) {
          this.setState({ requestCopied: true });
          setTimeout(() => {
            this.setState({ requestCopied: false });
          }, 2000);
        }
      } catch (err) {
        console.error('Failed to copy request:', err);
      }

      document.body.removeChild(textarea);
    } catch (e) {
      console.error('Failed to stringify request:', e);
    }
  };

  _copyResponseToClipboard = () => {
    const { entry } = this.props;
    if (!entry) return;

    const cachedEntry = entry.entryId ? getNetworkEntry(entry.entryId) : null;
    const entryToRender = cachedEntry || entry;
    const { response, error } = entryToRender;

    const data = error || response;
    if (!data) return;

    try {
      const jsonString = JSON.stringify(data, null, 2);

      const textarea = document.createElement('textarea');
      textarea.value = jsonString;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '0';
      document.body.appendChild(textarea);

      textarea.select();
      textarea.setSelectionRange(0, jsonString.length);

      try {
        const successful = document.execCommand('copy');
        if (successful) {
          this.setState({ responseCopied: true });
          setTimeout(() => {
            this.setState({ responseCopied: false });
          }, 2000);
        }
      } catch (err) {
        console.error('Failed to copy response:', err);
      }

      document.body.removeChild(textarea);
    } catch (e) {
      console.error('Failed to stringify response:', e);
    }
  };

  _copyToClipboard = () => {
    const { entry } = this.props;
    if (!entry) return;

    const cachedEntry = entry.entryId ? getNetworkEntry(entry.entryId) : null;
    const entryToRender = cachedEntry || entry;
    const { method, request, response, error } = entryToRender;

    const src = { method };
    if (request) src.request = request;
    if (response) src.response = response;
    if (error) src.error = error;

    try {
      const jsonString = JSON.stringify(src, null, 2);

      const textarea = document.createElement('textarea');
      textarea.value = jsonString;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '0';
      document.body.appendChild(textarea);

      textarea.select();
      textarea.setSelectionRange(0, jsonString.length);

      try {
        const successful = document.execCommand('copy');
        if (successful) {
          this.setState({ copied: true });
          setTimeout(() => {
            this.setState({ copied: false });
          }, 2000);
        }
      } catch (err) {
        console.error('Failed to copy JSON:', err);
      }

      document.body.removeChild(textarea);
    } catch (e) {
      console.error('Failed to stringify JSON:', e);
    }
  };

  _onSearchChange = (e) => {
    const searchText = e.target.value;
    this.setState({ searchText });
  };

  _clearHighlights = () => {
    const container = this.jsonContainerRef.current || this.containerRef.current;
    if (!container) return;
    const marks = container.querySelectorAll('mark.search-highlight');
    marks.forEach(mark => {
      const parent = mark.parentNode;
      if (parent) {
        const textNode = document.createTextNode(mark.textContent);
        parent.replaceChild(textNode, mark);
      }
    });

    // 인접한 텍스트 노드들을 병합
    if (container.normalize) {
      container.normalize();
    }
  };

  _applyHighlights = () => {
    // Clear any pending highlight timeout
    if (this.highlightTimeout) {
      clearTimeout(this.highlightTimeout);
    }

    // 먼저 기존 하이라이트 제거
    this._clearHighlights();

    const localSearchText = this.state.searchText;
    const globalSearchText = this.props.globalSearchValue || '';

    // 로컬 검색어와 전역 검색어 중 하나라도 있으면 하이라이트
    const searchText = localSearchText || globalSearchText;
    if (!searchText || searchText.length < 1) {
      return;
    }

    // react-json-view가 렌더링될 때까지 대기 (debounced)
    this.highlightTimeout = setTimeout(() => {
      const container = this.jsonContainerRef.current || this.containerRef.current;
      if (!container) return;
      const escapedSearch = searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escapedSearch, 'gi');

      // Use requestIdleCallback if available for better performance
      if (window.requestIdleCallback) {
        window.requestIdleCallback(() => {
          this._highlightTextNodes(container, regex);
        }, { timeout: 1000 });
      } else {
        this._highlightTextNodes(container, regex);
      }
    }, 300);
  };

  _highlightTextNodes = (node, regex) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      if (!text || text.trim().length === 0) return;

      const matches = [];
      let match;

      // regex.lastIndex를 0으로 리셋
      regex.lastIndex = 0;

      while ((match = regex.exec(text)) !== null) {
        matches.push({
          index: match.index,
          text: match[0]
        });
        // 무한 루프 방지
        if (match.index === regex.lastIndex) {
          regex.lastIndex++;
        }
      }

      if (matches.length > 0) {
        const fragment = document.createDocumentFragment();
        let lastIndex = 0;

        matches.forEach(match => {
          // 매칭 전 텍스트
          if (match.index > lastIndex) {
            fragment.appendChild(
              document.createTextNode(text.substring(lastIndex, match.index))
            );
          }

          // 하이라이트된 텍스트
          const mark = document.createElement('mark');
          mark.className = 'search-highlight';
          mark.textContent = match.text;
          fragment.appendChild(mark);

          lastIndex = match.index + match.text.length;
        });

        // 매칭 후 남은 텍스트
        if (lastIndex < text.length) {
          fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
        }

        if (node.parentNode) {
          node.parentNode.replaceChild(fragment, node);
        }
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      // script, style 태그는 건너뛰기
      if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE' || node.tagName === 'MARK') {
        return;
      }

      // 자식 노드들을 배열로 복사 (DOM 변경 중에도 안전하게 순회)
      const children = Array.from(node.childNodes);
      children.forEach(child => this._highlightTextNodes(child, regex));
    }
  };

  // ── Field Inspector ────────────────────────────────────────────────────────

  _getMethodFromEntry = () => {
    const { entry } = this.props;
    const cachedEntry = entry?.entryId ? getNetworkEntry(entry.entryId) : null;
    return cachedEntry?.method || entry?.method || null;
  };

  _findObjectKeyEl(target, containerEl) {
    let el = target;
    while (el && el !== containerEl) {
      const cls = el.className;
      if (typeof cls === 'string' && cls.includes('object-key') && !cls.includes('-val')) return el;
      el = el.parentElement;
    }
    return null;
  }

  _onSectionMouseMove = (e, kind) => {
    if (!this.props.fieldInspector) return;
    if (this.state.fieldTooltip?.pinned) return;

    const keyEl = this._findObjectKeyEl(e.target, e.currentTarget);
    if (!keyEl) {
      if (this.state.fieldTooltip) this.setState({ fieldTooltip: null });
      return;
    }

    const fieldName = keyEl.textContent.replace(/"/g, '').trim();
    if (!fieldName || /^\d+$/.test(fieldName)) {
      if (this.state.fieldTooltip) this.setState({ fieldTooltip: null });
      return;
    }

    if (this.state.fieldTooltip?.name === fieldName) return; // no change

    const method = this._getMethodFromEntry();
    const info = method ? protoManager.findFieldByName(method, fieldName, kind) : null;

    this.setState({
      fieldTooltip: { x: e.clientX + 14, y: e.clientY + 14, name: fieldName, info, pinned: false, kind },
    });
  };

  _onSectionMouseLeave = () => {
    if (!this.state.fieldTooltip?.pinned) {
      this.setState({ fieldTooltip: null });
    }
  };

  _onFieldSelect = (select, kind) => {
    if (!this.props.fieldInspector) return;
    const { name, namespace } = select;
    const path = (namespace || []).filter(n => n !== 'root' && typeof n === 'string' && isNaN(n));
    const method = this._getMethodFromEntry();
    const info = method ? protoManager.getFieldInfo(method, path, kind) : null;
    this.setState({ fieldTooltip: { x: 0, y: 0, name, info, pinned: true, kind } });
  };

  _renderFieldTooltip = () => {
    const { fieldTooltip } = this.state;
    const fieldInspectorEnabled = this.props.fieldInspector;
    if (!fieldInspectorEnabled || !fieldTooltip) return null;

    const { x, y, name, info, pinned } = fieldTooltip;
    const style = pinned
      ? { position: 'absolute', bottom: 8, right: 8, left: 'auto', top: 'auto' }
      : { position: 'fixed', left: x, top: y, pointerEvents: 'none' };

    return (
      <div className={`field-inspector-tooltip${pinned ? ' pinned' : ''}`} style={style}>
        {pinned && (
          <button className="fit-close" onClick={() => this.setState({ fieldTooltip: null })}>✕</button>
        )}
        <div className="fit-name">{name}</div>
        {info ? (
          <>
            <table className="fit-table">
              <tbody>
                <tr><td>Field #</td><td>{info.number}</td></tr>
                <tr><td>Type</td><td className="fit-type">{info.protoType}</td></tr>
                <tr><td>Wire</td><td>{info.wireType.code} <span className="fit-label">({info.wireType.label})</span></td></tr>
                <tr><td>Rule</td><td>{info.rule}</td></tr>
              </tbody>
            </table>
            {info.enumValues && (
              <div className="fit-enum-values">
                <div className="fit-enum-label">Values</div>
                <table className="fit-table fit-enum-table">
                  <tbody>
                    {Object.entries(info.enumValues).map(([name, num]) => (
                      <tr key={name}>
                        <td className="fit-enum-num">{num}</td>
                        <td className="fit-enum-name">{name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <div className="fit-not-found">Not found in schema</div>
        )}
      </div>
    );
  };

  _findOriginalEntry = (entry) => {
    const { log } = this.props;
    if (!entry || !log) return null;
    const repeatSummary = log.find(en => en.entryId === entry.entryId);
    if (!repeatSummary) return null;
    const originalSummary = log
      .filter(en => en.method === repeatSummary.method && !en.isRepeat && en.timestamp < repeatSummary.timestamp)
      .reduce((best, en) => (!best || en.timestamp > best.timestamp) ? en : best, null);
    return originalSummary ? getNetworkEntry(originalSummary.entryId) : null;
  };

  _renderInlineDiff = (entry, field) => {
    const currentFull = entry?.entryId ? getNetworkEntry(entry.entryId) : null;
    const originalFull = this._findOriginalEntry(entry);

    if (!originalFull) {
      return <div className="no-data">Original entry not found</div>;
    }

    let currentData, originalData;
    if (field === 'request') {
      currentData = currentFull?.request ?? {};
      originalData = originalFull?.request ?? {};
    } else {
      if (currentFull?.responses) {
        currentData = currentFull.responses.map(r => r.data ?? r);
      } else {
        currentData = currentFull?.response ?? currentFull?.error ?? {};
      }
      if (originalFull?.responses) {
        originalData = originalFull.responses.map(r => r.data ?? r);
      } else {
        originalData = originalFull?.response ?? originalFull?.error ?? {};
      }
    }

    const originalStr = JSON.stringify(originalData, null, 2);
    const currentStr = JSON.stringify(currentData, null, 2);
    const diff = diffLines(originalStr, currentStr);
    const hasChanges = diff.some(l => l.type !== 'same');

    return (
      <div className="diff-inline-view">
        <div className="diff-legend">
          <span className="diff-legend-remove">― Original</span>
          <span className="diff-legend-add">― Repeat</span>
          {!hasChanges && <span className="diff-legend-equal">No differences</span>}
        </div>
        <div className="diff-view">
          {diff.map((line, i) => (
            <div key={i} className={`diff-line diff-line-${line.type}`}>
              <span className="diff-line-prefix">
                {line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' '}
              </span>
              <span className="diff-line-content">{line.value}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

}

const mapStateToProps = (state) => ({
  entry: state.network.selectedEntry,
  globalSearchValue: state.toolbar.globalSearchValue,
  splitPanel: state.toolbar.splitPanel,
  fieldInspector: state.toolbar.fieldInspector,
  log: state.network.log,
  pendingAction: state.network.pendingAction,
});
const mapDispatchToProps = {
  openSettings: () => setSettingsOpen(true),
  clearPendingAction,
};
export default connect(mapStateToProps, mapDispatchToProps)(NetworkDetails);
