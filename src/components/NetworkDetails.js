// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

/* global chrome */

import React, { Component } from "react";
import ReactJson from "react-json-view";
import { connect } from "react-redux";
import { getNetworkEntry } from "../state/networkCache";
import MinusIcon from "../icons/Minus";
import PlusIcon from "../icons/Plus";
import CopyIcon from "../icons/Copy";
import RepeatIcon from "../icons/Repeat";
import protoManager from "../utils/ProtoManager";
import "./NetworkDetails.css";

const LARGE_PAYLOAD_BYTES = 1024 * 1024;
const VERY_LARGE_PAYLOAD_BYTES = 5 * 1024 * 1024;

function formatBytes(value) {
  if (!Number.isFinite(value)) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

class NetworkDetails extends Component {
  state = {
    jsonCollapsed: 1,
    lastEntryId: null,
    searchText: '',
    copied: false,
    repeated: false,
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
  };

  jsonContainerRef = React.createRef();
  containerRef = React.createRef();
  highlightTimeout = null;

  componentDidUpdate(prevProps, prevState) {
    const prevEntryId = prevProps.entry?.entryId ?? null;
    const nextEntryId = this.props.entry?.entryId ?? null;
    const entryChanged = prevEntryId !== nextEntryId && this.state.lastEntryId !== nextEntryId;

    if (entryChanged) {
      this.setState({
        jsonCollapsed: 1,
        lastEntryId: nextEntryId,
        searchText: '',
        copied: false,
        repeated: false,
        editMode: false,
        editedData: null,
        requestTab: 'body',
        responseTab: 'body',
        requestCollapsed: false,
        responseCollapsed: false,
        requestCopied: false,
        responseCopied: false,
      });
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
    const { entry } = this.props;
    const { splitPosition, isDragging } = this.state;

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
      </div>
    );
  }

  _renderRequestSection = (entry, heightPercent) => {
    if (!entry) return null;

    const cachedEntry = entry.entryId ? getNetworkEntry(entry.entryId) : null;
    const entryToRender = cachedEntry || entry;
    const { method, request } = entryToRender;
    const { requestTab, requestCollapsed, editMode, editedData, repeated, requestCopied } = this.state;

    const rawCache = window.__GRPCWEB_DEVTOOLS_RAW_CACHE__;
    const rawRequest = rawCache?.get(entry.requestId);

    return (
      <div className="request-section" style={{ height: `${heightPercent}%` }}>
        <div className="section-header">
          <span className="section-title">Request</span>
          <div className="section-tabs">
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
                <button className="action-button" onClick={this._sendEditedRequest}>
                  <span>Send</span>
                  <RepeatIcon />
                </button>
                <button className="action-button" onClick={this._cancelEdit}>
                  <span>Cancel</span>
                </button>
              </>
            ) : (
              <>
                <button className="action-button" onClick={this._startEdit}>
                  <span>Edit & Repeat</span>
                </button>
                <button
                  className={`action-button ${repeated ? 'repeated' : ''}`}
                  onClick={() => {
                    console.log('[UI] Repeat button clicked');
                    this._repeatRequest();
                  }}
                >
                  <span>{repeated ? 'Sent!' : 'Repeat'}</span>
                  <RepeatIcon />
                </button>
                <button className={`action-button ${requestCopied ? 'copied' : ''}`} onClick={this._copyRequestToClipboard}>
                  <span>{requestCopied ? 'Copied!' : 'Copy'}</span>
                  <CopyIcon />
                </button>
                <button className="action-button" onClick={this._toggleRequestExpand}>
                  <span>{requestCollapsed === false ? 'Collapse' : 'Expand'}</span>
                  {requestCollapsed === false ? <MinusIcon /> : <PlusIcon />}
                </button>
              </>
            )}
          </div>
        </div>
        <div className="section-content">
          {requestTab === 'headers' && this._renderRequestHeaders(rawRequest)}
          {requestTab === 'body' && this._renderRequestBody(method, request, editMode, editedData, requestCollapsed)}
        </div>
      </div>
    );
  };

  _renderResponseSection = (entry, heightPercent) => {
    if (!entry) return null;

    const cachedEntry = entry.entryId ? getNetworkEntry(entry.entryId) : null;
    const entryToRender = cachedEntry || entry;
    const { response, error } = entryToRender;
    const { responseTab, responseCollapsed, responseCopied } = this.state;

    const rawCache = window.__GRPCWEB_DEVTOOLS_RAW_CACHE__;
    const rawRequest = rawCache?.get(entry.requestId);

    return (
      <div className="response-section" style={{ height: `${heightPercent}%` }}>
        <div className="section-header">
          <span className="section-title">Response</span>
          <div className="section-tabs">
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
        <div className="section-content">
          {responseTab === 'headers' && this._renderResponseHeaders(rawRequest)}
          {responseTab === 'body' && this._renderResponseBody(response, error, responseCollapsed)}
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
              <span>{repeated ? 'Sent!' : 'Repeat'}</span>
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

  _renderRequestBody = (method, request, editMode, editedData, collapsed) => {
    if (!request) {
      return <div className="no-data">No request body</div>;
    }

    const theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "twilight" : "rjv-default";
    const src = editMode && editedData ? editedData.request : request;

    return (
      <ReactJson
        name={false}
        theme={theme}
        style={{ backgroundColor: "transparent" }}
        enableClipboard={false}
        collapsed={editMode ? false : collapsed}
        displayDataTypes={false}
        displayObjectSize={false}
        src={src}
        onEdit={editMode ? this._onJsonEdit : false}
        onAdd={editMode ? this._onJsonEdit : false}
        onDelete={editMode ? this._onJsonEdit : false}
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

  _renderResponseBody = (response, error, collapsed) => {
    if (error) {
      const theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "twilight" : "rjv-default";
      return (
        <ReactJson
          name={false}
          theme={theme}
          style={{ backgroundColor: "transparent" }}
          enableClipboard={false}
          collapsed={collapsed}
          displayDataTypes={false}
          displayObjectSize={false}
          src={error}
        />
      );
    }

    if (!response) {
      return <div className="no-data">No response body</div>;
    }

    const theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "twilight" : "rjv-default";

    return (
      <ReactJson
        name={false}
        theme={theme}
        style={{ backgroundColor: "transparent" }}
        enableClipboard={false}
        collapsed={collapsed}
        displayDataTypes={false}
        displayObjectSize={false}
        src={response}
      />
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
    const { entry } = this.props;
    if (!entry) return;

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

    // Show differences
    if (originalRequest && editedData.request) {
      console.log('[Panel] Changes:');
      Object.keys(editedData.request).forEach(key => {
        if (JSON.stringify(originalRequest[key]) !== JSON.stringify(editedData.request[key])) {
          console.log(`  - ${key}: ${JSON.stringify(originalRequest[key])} -> ${JSON.stringify(editedData.request[key])}`);
        }
      });
    }
    console.log('[Panel] ===============================================');

    if (!requestId) {
      console.warn('[Panel] No request ID');
      return;
    }

    // Get raw request from cache
    const rawCache = window.__GRPCWEB_DEVTOOLS_RAW_CACHE__;
    if (!rawCache) {
      console.error('[Panel] Raw cache not available');
      return;
    }

    const rawRequest = rawCache.get(requestId);
    if (!rawRequest) {
      console.error('[Panel] Raw request not found for ID:', requestId);
      console.log('[Panel] Available IDs:', Array.from(rawCache.keys()));
      return;
    }

    console.log('[Panel] Found raw request:', rawRequest.url);
    console.log('[Panel] Edited request data:', editedData.request);

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

    if (protoManager.isReady()) {
      console.log('[Panel] ProtoManager is ready, encoding edited request');
      console.log('[Panel] Using method for encoding:', method);

      try {
        // Encode the edited request data using the original method name
        const messageBytes = protoManager.encodeMessage(method, editedData.request);

        if (messageBytes) {
          // Build gRPC-web frame with compression if needed
          const frame = protoManager.buildGrpcWebFrame(messageBytes, needsCompression);
          body = frame.buffer;
          console.log('[Panel] Encoded and framed message, size:', body.byteLength, 'compressed:', needsCompression);
        } else {
          throw new Error('Failed to encode message');
        }
      } catch (error) {
        console.error('[Panel] Failed to encode with ProtoManager:', error);
        console.warn('[Panel] Falling back to original request body');

        // Fallback to original body
        function base64ToArrayBuffer(base64) {
          const binaryString = atob(base64);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          return bytes.buffer;
        }

        body = rawRequest.encoding === 'base64'
          ? base64ToArrayBuffer(rawRequest.body)
          : rawRequest.body;
      }
    } else {
      console.warn('[Panel] ProtoManager not ready. Upload proto files in Settings first.');
      console.warn('[Panel] Using original request body.');

      // Use original body
      function base64ToArrayBuffer(base64) {
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
      }

      body = rawRequest.encoding === 'base64'
        ? base64ToArrayBuffer(rawRequest.body)
        : rawRequest.body;
    }

    console.log('[Panel] ✓ Body prepared, length:', body.byteLength || body.length);
    console.log('[Panel] Sending fetch to:', rawRequest.url);
    console.log('[Panel] Headers:', headers);

    // Generate new request ID for the repeated request
    const newRequestId = Math.floor(Math.random() * 1000000);
    console.log('[Panel] Generated new request ID:', newRequestId);

    // IMPORTANT: Save the request body before fetch, because we'll need it later
    const requestBodyToCache = body;

    // Send the request
    fetch(rawRequest.url, {
      method: rawRequest.method,
      headers: headers,
      body: body,
      credentials: 'omit'
    })
    .then(response => {
      console.log('[Panel] ✓ Fetch completed with status:', response.status, response.statusText);

      if (!response.ok) {
        // Read response body for error details
        return response.text().then(text => {
          console.error('[Panel] Response error body:', text);
          throw new Error(`HTTP ${response.status}: ${response.statusText}\n${text}`);
        });
      }

      // Read and decode response body
      return response.arrayBuffer().then(responseBody => {
        console.log('[Panel] ========== DECODING RESPONSE ==========');
        console.log('[Panel] Response body received, size:', responseBody.byteLength);

        let decodedResponse = null;

        // Try to decode response if ProtoManager is ready (optional)
        if (protoManager.isReady()) {
          console.log('[Panel] ProtoManager is ready, attempting to decode response');
          try {
            // Parse gRPC-web frame
            const responseBytes = new Uint8Array(responseBody);
            if (responseBytes.length > 5) {
              const compressionFlag = responseBytes[0];
              const messageLength = (responseBytes[1] << 24) | (responseBytes[2] << 16) | (responseBytes[3] << 8) | responseBytes[4];
              const messageBytes = responseBytes.slice(5, 5 + messageLength);

              // Get message type info
              const typeInfo = protoManager.getMessageType(method);

              if (typeInfo && typeInfo.responseType) {
                // Use manual decode to avoid CSP eval() violation
                decodedResponse = protoManager.manualDecode(typeInfo.responseType, messageBytes);
                console.log('[Panel] ✓ Decoded response:', decodedResponse);
              }
            }
          } catch (decodeError) {
            console.warn('[Panel] Response decode failed (non-critical):', decodeError.message);
          }
        }
        // Response decoding is optional - repeat works without it

        // Add to rawRequestsCache so it can be repeated again
        const rawCache = window.__GRPCWEB_DEVTOOLS_RAW_CACHE__;
        if (rawCache) {
          console.log('[Panel] Adding new request to rawCache with ID:', newRequestId);

          // Convert ArrayBuffer to base64 for storage
          function arrayBufferToBase64(buffer) {
            const bytes = new Uint8Array(buffer);
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            return btoa(binary);
          }

          // IMPORTANT: Use the saved REQUEST body, not the response body!
          const bodyBase64 = arrayBufferToBase64(requestBodyToCache);

          rawCache.set(newRequestId, {
            url: rawRequest.url,
            method: rawRequest.method,
            headers: rawRequest.headers,
            body: bodyBase64,
            encoding: 'base64'
          });
          console.log('[Panel] ✓ Added to cache with base64 REQUEST body, size:', rawCache.size);
        }

        // Notify content script to post message
        const port = window.__GRPCWEB_DEVTOOLS_PORT__;
        if (port) {
          console.log('[Panel] ========== SENDING TO CONTENT SCRIPT ==========');
          console.log('[Panel] Request ID:', newRequestId);
          console.log('[Panel] Method:', method);
          console.log('[Panel] Request data:', editedData.request);
          console.log('[Panel] Response data:', decodedResponse);
          console.log('[Panel] ================================================');

          const messageData = {
            requestId: newRequestId,
            grpcMethod: method,
            request: editedData.request,
            response: decodedResponse || {},
            status: response.status
          };

          port.postMessage({
            action: "notifyRepeat",
            target: "content",
            tabId: window.__GRPCWEB_DEVTOOLS_TAB_ID__,
            data: messageData
          });
        } else {
          console.warn('[Panel] Port not available for notification');
        }

        // Show "Sent!" feedback and exit edit mode
        console.log('[Panel] ✓ Request sent successfully!');
        this.setState({ repeated: true, editMode: false, editedData: null });
        setTimeout(() => {
          this.setState({ repeated: false });
        }, 2000);
      });
    })
    .catch(err => {
      console.error('[Panel] ✗ Edit & Repeat request FAILED:', err);
      console.error('[Panel] Error stack:', err.stack);
    });
  };

  _repeatRequest = () => {
    console.log('[Panel] ========== REPEAT REQUEST ==========');
    const { entry } = this.props;
    if (!entry) {
      console.warn('[Panel] No entry');
      return;
    }

    const cachedEntry = entry.entryId ? getNetworkEntry(entry.entryId) : null;
    const entryToRender = cachedEntry || entry;
    const { requestId, method, request } = entryToRender;

    console.log('[Panel] Request ID:', requestId);
    console.log('[Panel] Method:', method);

    if (!requestId) {
      console.warn('[Panel] No request ID');
      return;
    }

    // Get raw request from cache
    const rawCache = window.__GRPCWEB_DEVTOOLS_RAW_CACHE__;
    if (!rawCache) {
      console.error('[Panel] Raw cache not available');
      return;
    }

    const rawRequest = rawCache.get(requestId);
    if (!rawRequest) {
      console.error('[Panel] Raw request not found for ID:', requestId);
      return;
    }

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

    console.log('[Panel] Prepared', Object.keys(headers).length, 'headers');

    // Generate new request ID
    const newRequestId = Math.floor(Math.random() * 1000000);

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
  console.log('[Page] Starting base64 decode, input length:', bodyBase64.length);
  const binaryString = atob(bodyBase64);
  console.log('[Page] Binary string length:', binaryString.length);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  console.log('[Page] ========== REPEAT REQUEST (Page Context) ==========');
  console.log('[Page] URL:', url);
  console.log('[Page] Body base64 length:', bodyBase64.length);
  console.log('[Page] Body bytes length:', bytes.length);
  console.log('[Page] Body first 20 bytes:', Array.from(bytes.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' '));
  console.log('[Page] Headers:', headers);
  console.log('[Page] =======================================================');

  // Generate request ID
  const requestId = Math.floor(Math.random() * 1000000);

  // Send the request
  fetch(url, {
    method: 'POST',
    headers: headers,
    body: bytes,
    credentials: 'include',
    mode: 'cors'
  })
  .then(response => {
    console.log('[Page] Response status:', response.status);

    // Store in window for panel to access
    if (!window.__grpcWebDevtoolsRepeatCache) {
      window.__grpcWebDevtoolsRepeatCache = new Map();
    }
    window.__grpcWebDevtoolsRepeatCache.set(requestId, {
      url: url,
      method: 'POST',
      headers: requestHeaders,
      body: bodyBase64,
      encoding: 'base64'
    });

    console.log('[Page] Stored repeat request in cache, ID:', requestId);

    // Post message to notify gRPC devtools
    window.postMessage({
      type: "__GRPCWEB_DEVTOOLS__",
      method: grpcMethod,
      methodType: "unary",
      requestId: requestId,
      request: requestData,
      response: {}, // Response will be decoded by devtools if needed
    }, "*");

    console.log('[Page] Posted message to devtools, requestId:', requestId);

    return response.arrayBuffer();
  })
  .then(responseBody => {
    console.log('[Page] Response body length:', responseBody.byteLength);
  })
  .catch(err => {
    console.error('[Page] Fetch failed:', err);

    // Post error message
    window.postMessage({
      type: "__GRPCWEB_DEVTOOLS__",
      method: grpcMethod,
      methodType: "unary",
      requestId: requestId,
      request: requestData,
      error: {
        code: 0,
        message: err.message
      }
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
    if (!this.jsonContainerRef.current) return;

    const container = this.jsonContainerRef.current;
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
      if (!this.jsonContainerRef.current) return;

      const container = this.jsonContainerRef.current;
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

}

const mapStateToProps = (state) => ({
  entry: state.network.selectedEntry,
  globalSearchValue: state.toolbar.globalSearchValue
});
export default connect(mapStateToProps)(NetworkDetails);
