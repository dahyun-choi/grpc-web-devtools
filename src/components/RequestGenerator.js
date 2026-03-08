/* global chrome */

import React, { Component } from 'react';
import ReactJson from 'react-json-view';
import { connect } from 'react-redux';
import { getNetworkEntry } from '../state/networkCache';
import { setRequestGeneratorOpen } from '../state/toolbar';
import protoManager from '../utils/ProtoManager';
import './RequestGenerator.css';

const GRPC_STATUS = {
  0: 'OK', 1: 'CANCELLED', 2: 'UNKNOWN', 3: 'INVALID_ARGUMENT',
  4: 'DEADLINE_EXCEEDED', 5: 'NOT_FOUND', 6: 'ALREADY_EXISTS',
  7: 'PERMISSION_DENIED', 8: 'RESOURCE_EXHAUSTED', 9: 'FAILED_PRECONDITION',
  10: 'ABORTED', 11: 'OUT_OF_RANGE', 12: 'UNIMPLEMENTED',
  13: 'INTERNAL', 14: 'UNAVAILABLE', 15: 'DATA_LOSS', 16: 'UNAUTHENTICATED',
};

const ALLOWED_HEADERS = [
  'content-type', 'grpc-timeout', 'grpc-encoding', 'grpc-accept-encoding',
  'x-grpc-web', 'authorization', 'app-version', 'instance-id', 'service-name',
];

class RequestGenerator extends Component {
  state = {
    methods: [],
    selectedMethod: null,
    searchQuery: '',
    dropdownOpen: false,
    highlightedIndex: -1,
    url: '',
    headers: [],
    body: {},
    sending: false,
    sentRequestId: null,
    response: null,
    responseCollapsed: 2,
    responseKey: 0,
    responseCopied: false,
    position: null, // { x, y } — null means centered (default)
    size: null,     // { width, height } — null means default CSS size
  };

  _dropdownRef = React.createRef();
  _dropdownListRef = React.createRef();
  _modalRef = React.createRef();
  _responseRef = React.createRef();
  _dragOffset = { x: 0, y: 0 };
  _isDragging = false;
  _isResizing = false;
  _resizeStart = { x: 0, y: 0, w: 0, h: 0 };

  componentDidMount() {
    document.addEventListener('mousedown', this._handleOutsideClick);
    document.addEventListener('mousemove', this._onDragMove);
    document.addEventListener('mouseup', this._onDragEnd);
  }

  componentWillUnmount() {
    document.removeEventListener('mousedown', this._handleOutsideClick);
    document.removeEventListener('mousemove', this._onDragMove);
    document.removeEventListener('mouseup', this._onDragEnd);
  }

  componentDidUpdate(prevProps) {
    // Modal opened — refresh method list only, preserve user's input
    if (this.props.open && !prevProps.open) {
      const allMethods = protoManager.getAllMethods();
      this.setState({ methods: this._filterToUsedMethods(allMethods) });
    }

    // Watch for response matching sentRequestId
    if (this.state.sentRequestId && this.props.log !== prevProps.log) {
      const entry = this.props.log.find(e => e.requestId === this.state.sentRequestId);
      if (entry) {
        const cached = entry.entryId ? getNetworkEntry(entry.entryId) : null;
        this.setState({
          sending: false,
          sentRequestId: null,
          response: {
            data: cached?.response ?? null,
            error: entry.error ?? cached?.error ?? null,
            statusCode: entry.statusCode,
          },
        }, () => {
          this._responseRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        });
      }
    }
  }

  _handleOutsideClick = (e) => {
    if (this._dropdownRef.current && !this._dropdownRef.current.contains(e.target)) {
      this.setState({ dropdownOpen: false, highlightedIndex: -1 });
    }
  };

  _onDragStart = (e) => {
    // Only drag on header itself, not on buttons inside it
    if (e.target.closest('button')) return;
    e.preventDefault();
    const modal = this._modalRef.current;
    if (!modal) return;
    const rect = modal.getBoundingClientRect();
    this._dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    this._isDragging = true;
    modal.style.userSelect = 'none';
  };

  _onDragMove = (e) => {
    if (this._isResizing) {
      const modal = this._modalRef.current;
      if (!modal) return;
      const dx = e.clientX - this._resizeStart.x;
      const dy = e.clientY - this._resizeStart.y;
      const w = Math.max(400, this._resizeStart.w + dx);
      const h = Math.max(280, this._resizeStart.h + dy);
      this.setState({ size: { width: w, height: h } });
      return;
    }
    if (!this._isDragging) return;
    const modal = this._modalRef.current;
    if (!modal) return;
    const x = Math.max(0, Math.min(e.clientX - this._dragOffset.x, window.innerWidth - modal.offsetWidth));
    const y = Math.max(0, Math.min(e.clientY - this._dragOffset.y, window.innerHeight - modal.offsetHeight));
    this.setState({ position: { x, y } });
  };

  _onDragEnd = () => {
    if (this._isResizing) {
      this._isResizing = false;
      const modal = this._modalRef.current;
      if (modal) modal.style.userSelect = '';
      return;
    }
    if (!this._isDragging) return;
    this._isDragging = false;
    const modal = this._modalRef.current;
    if (modal) modal.style.userSelect = '';
  };

  _onResizeStart = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const modal = this._modalRef.current;
    if (!modal) return;
    const rect = modal.getBoundingClientRect();
    this._resizeStart = { x: e.clientX, y: e.clientY, w: rect.width, h: rect.height };
    this._isResizing = true;
    modal.style.userSelect = 'none';
    // Lock position so modal stays in place during resize
    if (!this.state.position) {
      this.setState({ position: { x: rect.left, y: rect.top } });
    }
  };

  _onKeyDown = (e) => {
    const { dropdownOpen, highlightedIndex } = this.state;
    const filtered = this._filteredMethods();

    if (!dropdownOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        this.setState({ dropdownOpen: true, searchQuery: '', highlightedIndex: 0 });
        e.preventDefault();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.min(highlightedIndex + 1, filtered.length - 1);
      this.setState({ highlightedIndex: next }, () => this._scrollHighlightedIntoView(next));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = Math.max(highlightedIndex - 1, 0);
      this.setState({ highlightedIndex: prev }, () => this._scrollHighlightedIntoView(prev));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < filtered.length) {
        this._selectMethod(filtered[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      this.setState({ dropdownOpen: false, highlightedIndex: -1 });
    }
  };

  _scrollHighlightedIntoView(index) {
    const list = this._dropdownListRef.current;
    if (!list) return;
    const item = list.children[index];
    if (item) item.scrollIntoView({ block: 'nearest' });
  };

  _close = () => this.props.setRequestGeneratorOpen(false);

  _clear = () => {
    const allMethods = protoManager.getAllMethods();
    this.setState({
      methods: this._filterToUsedMethods(allMethods),
      selectedMethod: null,
      searchQuery: '',
      dropdownOpen: false,
      highlightedIndex: -1,
      url: '',
      headers: [],
      body: {},
      response: null,
    });
  };

  // ── Method selection ──────────────────────────────────────────────────────

  /** Keep only methods whose package is used on the current page.
   *  e.g. if log has "opgwv1.OpGw/Foo", show all methods under "opgwv1.*" */
  _filterToUsedMethods(allMethods) {
    const { log } = this.props;
    if (!log || log.length === 0) return allMethods;

    const usedPackages = new Set();
    log.forEach(entry => {
      if (!entry.method) return;
      try {
        const methodPath = entry.method.startsWith('http')
          ? new URL(entry.method).pathname.substring(1)
          : entry.method;
        // methodPath: "ridergwv1.RiderGw/CreateDemand" → package "ridergwv1"
        const pkg = methodPath.split('.')[0];
        if (pkg) usedPackages.add(pkg);
      } catch (e) { /* ignore */ }
    });

    if (usedPackages.size === 0) return allMethods;
    const filtered = allMethods.filter(m => usedPackages.has(m.servicePath.split('.')[0]));
    return filtered.length > 0 ? filtered : allMethods;
  }

  _filteredMethods() {
    const q = this.state.searchQuery.toLowerCase();
    if (!q) return this.state.methods;
    return this.state.methods.filter(m =>
      m.fullPath.toLowerCase().includes(q) ||
      m.methodName.toLowerCase().includes(q) ||
      m.serviceName.toLowerCase().includes(q)
    );
  }

  _selectMethod = (m) => {
    const body = protoManager.generateExampleForMethod(m.fullPath);
    const headers = this._getHeadersForMethod(m.fullPath);
    const url = this._getUrlForMethod(m.fullPath);
    this.setState({
      selectedMethod: m,
      searchQuery: '',
      dropdownOpen: false,
      highlightedIndex: -1,
      body,
      headers,
      url,
      response: null,
    });
  };

  // ── Auto-populate from raw cache ─────────────────────────────────────────

  _getHeadersForMethod(methodFullPath) {
    const rawCache = window.__GRPCWEB_DEVTOOLS_RAW_CACHE__;
    const entry = this._findBestCacheEntry(rawCache, methodFullPath);
    if (!entry?.headers) {
      return [{ id: Date.now(), key: 'content-type', value: 'application/grpc-web+proto' }];
    }
    return entry.headers
      .filter(h => {
        const n = h.name.toLowerCase();
        return ALLOWED_HEADERS.includes(n) || (n.startsWith('x-') && !n.startsWith('x-forwarded'));
      })
      .map((h, i) => ({ id: i, key: h.name, value: h.value }));
  }

  _getUrlForMethod(methodFullPath) {
    const rawCache = window.__GRPCWEB_DEVTOOLS_RAW_CACHE__;
    const entry = this._findBestCacheEntry(rawCache, methodFullPath);
    if (!entry?.url) return '';
    try {
      const u = new URL(entry.url);
      return `${u.origin}/${methodFullPath}`;
    } catch (e) {
      return '';
    }
  }

  _findBestCacheEntry(rawCache, methodFullPath) {
    if (!rawCache) return null;
    const pkg = methodFullPath.split('.')[0];
    let best = null;
    for (const entry of rawCache.values()) {
      if (!entry?.url) continue;
      const matches = entry.url.includes(`/${pkg}.`);
      if (matches && (!best || (entry.timestamp || 0) > (best.timestamp || 0))) best = entry;
    }
    if (!best) {
      for (const entry of rawCache.values()) {
        if (entry?.url && (!best || (entry.timestamp || 0) > (best.timestamp || 0))) best = entry;
      }
    }
    return best;
  }

  // ── Headers editing ───────────────────────────────────────────────────────

  _addHeader = () => {
    this.setState(s => ({
      headers: [...s.headers, { id: Date.now(), key: '', value: '' }],
    }));
  };

  _removeHeader = (id) => {
    this.setState(s => ({ headers: s.headers.filter(h => h.id !== id) }));
  };

  _updateHeader = (id, field, value) => {
    this.setState(s => ({
      headers: s.headers.map(h => h.id === id ? { ...h, [field]: value } : h),
    }));
  };

  // ── Body editing ──────────────────────────────────────────────────────────

  _onBodyEdit = (e) => this.setState({ body: e.updated_src });
  _onBodyAdd  = (e) => this.setState({ body: e.updated_src });
  _onBodyDelete = (e) => this.setState({ body: e.updated_src });

  _copyResponse = () => {
    const { response } = this.state;
    if (!response?.data) return;
    navigator.clipboard.writeText(JSON.stringify(response.data, null, 2));
    this.setState({ responseCopied: true });
    setTimeout(() => this.setState({ responseCopied: false }), 1500);
  };

  _toggleResponseCollapse = () => {
    this.setState(s => ({
      responseCollapsed: s.responseCollapsed === false ? 2 : false,
      responseKey: s.responseKey + 1,
    }));
  };

  _resetBody = () => {
    const { selectedMethod } = this.state;
    if (!selectedMethod) return;
    this.setState({ body: protoManager.generateExampleForMethod(selectedMethod.fullPath) });
  };

  // ── Send ──────────────────────────────────────────────────────────────────

  _sendRequest = () => {
    const { selectedMethod, url, headers, body } = this.state;
    if (!selectedMethod || !url) return;

    // Encode body to protobuf binary
    const encoded = protoManager.encodeMessage(selectedMethod.fullPath, body);
    if (!encoded) {
      this.setState({ response: { data: null, error: { message: 'Failed to encode request body. Check proto schema.' }, statusCode: null } });
      return;
    }

    const framed = protoManager.buildGrpcWebFrame(encoded);
    let binary = '';
    for (let i = 0; i < framed.length; i++) binary += String.fromCharCode(framed[i]);
    const bodyBase64 = btoa(binary);

    const headersObj = {};
    headers.forEach(h => { if (h.key) headersObj[h.key] = h.value; });

    const requestId = Math.floor(Math.random() * 1000000);
    this.setState({ sending: true, sentRequestId: requestId, response: null });

    const code = `
(function() {
  const url = ${JSON.stringify(url)};
  const bodyBase64 = ${JSON.stringify(bodyBase64)};
  const headers = ${JSON.stringify(headersObj)};
  const grpcMethod = ${JSON.stringify(url)};
  const requestBody = ${JSON.stringify(body)};
  const requestId = ${requestId};

  const binaryString = atob(bodyBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);

  fetch(url, { method: 'POST', headers: headers, body: bytes, credentials: 'omit', mode: 'cors' })
    .then(response => response.arrayBuffer().then(buf => {
      const rb = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < rb.byteLength; i++) bin += String.fromCharCode(rb[i]);
      window.postMessage({
        type: '__GRPCWEB_DEVTOOLS__',
        method: grpcMethod,
        methodType: 'unary',
        requestId: requestId,
        request: requestBody,
        responseBodyBase64: btoa(bin),
        isGenerated: true,
      }, '*');
    }))
    .catch(err => {
      window.postMessage({
        type: '__GRPCWEB_DEVTOOLS__',
        method: grpcMethod,
        methodType: 'unary',
        requestId: requestId,
        request: requestBody,
        error: { code: -1, message: err.message },
        isGenerated: true,
      }, '*');
    });
})();
`;

    chrome.devtools.inspectedWindow.eval(code, (_result, exception) => {
      if (exception) {
        this.setState({
          sending: false,
          sentRequestId: null,
          response: { data: null, error: { message: exception.value || 'Eval error' }, statusCode: null },
        });
      }
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────

  render() {
    if (!this.props.open) return null;
    const { methods, selectedMethod, searchQuery, dropdownOpen, url, headers, body, sending, response, responseCollapsed, responseKey, responseCopied, position, size } = this.state;
    const filtered = this._filteredMethods();
    const ready = protoManager.isReady();
    const theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'twilight' : 'rjv-default';

    const modalStyle = {};
    if (position) {
      modalStyle.position = 'fixed';
      modalStyle.left = position.x;
      modalStyle.top = position.y;
      modalStyle.margin = 0;
      modalStyle.maxHeight = 'none';
    }
    if (size) {
      modalStyle.width = size.width;
      if (position) modalStyle.height = size.height;
    }

    return (
      <div className="rg-overlay">
        <div className="rg-modal" ref={this._modalRef} style={modalStyle} onClick={e => e.stopPropagation()}>

          {/* Header — drag handle */}
          <div className="rg-header" onMouseDown={this._onDragStart}>
            <span className="rg-title">Request Generator</span>
            <div className="rg-header-actions">
              <button className="rg-clear-btn" onClick={this._clear} title="Clear all fields">Clear</button>
              <button className="rg-close" onClick={this._close}>✕</button>
            </div>
          </div>

          {/* Body */}
          <div className="rg-content">
            {!ready && (
              <div className="rg-no-proto">
                Upload proto files in Settings to use Request Generator.
              </div>
            )}

            {ready && (
              <>
                {/* Method selector */}
                <div className="rg-row">
                  <label className="rg-label">Method</label>
                  <div className="rg-method-wrap" ref={this._dropdownRef}>
                    <input
                      className="rg-method-input"
                      type="text"
                      placeholder="Search methods..."
                      value={dropdownOpen ? searchQuery : (selectedMethod?.fullPath ?? '')}
                      onFocus={() => this.setState({ dropdownOpen: true, searchQuery: '', highlightedIndex: -1 })}
                      onChange={e => this.setState({ searchQuery: e.target.value, dropdownOpen: true, highlightedIndex: 0 })}
                      onKeyDown={this._onKeyDown}
                      readOnly={!dropdownOpen}
                    />
                    {dropdownOpen && (
                      <div className="rg-dropdown" ref={this._dropdownListRef}>
                        {filtered.length === 0
                          ? <div className="rg-dropdown-empty">No methods found</div>
                          : filtered.map((m, i) => (
                            <div
                              key={m.fullPath}
                              className={`rg-dropdown-item${selectedMethod?.fullPath === m.fullPath ? ' selected' : ''}${this.state.highlightedIndex === i ? ' highlighted' : ''}`}
                              onMouseDown={() => this._selectMethod(m)}
                              onMouseEnter={() => this.setState({ highlightedIndex: i })}
                            >
                              <span className="rg-dp-service">{m.serviceName}</span>
                              <span className="rg-dp-sep"> / </span>
                              <span className="rg-dp-method">{m.methodName}</span>
                            </div>
                          ))
                        }
                      </div>
                    )}
                  </div>
                </div>

                {/* URL */}
                <div className="rg-row">
                  <label className="rg-label">URL</label>
                  <input
                    className="rg-url-input"
                    type="text"
                    value={url}
                    onChange={e => this.setState({ url: e.target.value })}
                    placeholder="https://your-api.example.com:443/package.Service/Method"
                  />
                </div>

                {/* Headers */}
                <div className="rg-row rg-headers-section">
                  <div className="rg-headers-title">
                    <label className="rg-label">Headers</label>
                    <button className="rg-add-btn" onClick={this._addHeader}>+ Add</button>
                  </div>
                  <div className="rg-headers-list">
                    {headers.map(h => (
                      <div key={h.id} className="rg-header-row">
                        <input
                          className="rg-hkey"
                          value={h.key}
                          onChange={e => this._updateHeader(h.id, 'key', e.target.value)}
                          placeholder="Header name"
                        />
                        <input
                          className="rg-hval"
                          value={h.value}
                          onChange={e => this._updateHeader(h.id, 'value', e.target.value)}
                          placeholder="Value"
                        />
                        <button className="rg-hdel" onClick={() => this._removeHeader(h.id)}>×</button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Body */}
                <div className="rg-row rg-body-section">
                  <div className="rg-headers-title">
                    <label className="rg-label">Request Body</label>
                    <button className="rg-add-btn" onClick={this._resetBody} disabled={!selectedMethod}>Reset</button>
                  </div>
                  <div className="rg-body-editor">
                    <ReactJson
                      src={body}
                      name={null}
                      theme={theme}
                      iconStyle="square"
                      displayDataTypes={false}
                      displayObjectSize={false}
                      enableClipboard={false}
                      collapsed={false}
                      onEdit={this._onBodyEdit}
                      onAdd={this._onBodyAdd}
                      onDelete={this._onBodyDelete}
                    />
                  </div>
                </div>

                {/* Send button */}
                <div className="rg-actions">
                  <button
                    className="rg-send-btn"
                    onClick={this._sendRequest}
                    disabled={sending || !selectedMethod || !url}
                  >
                    {sending ? 'Sending…' : 'Send →'}
                  </button>
                </div>

                {/* Response */}
                {response && (
                  <div className="rg-response-section" ref={this._responseRef}>
                    <div className="rg-response-header">
                      <div className={`rg-status ${response.error ? 'error' : 'ok'}`}>
                        {response.statusCode !== null && response.statusCode !== undefined
                          ? `${GRPC_STATUS[response.statusCode] ?? response.statusCode} (${response.statusCode})`
                          : response.error ? 'Error' : 'OK'
                        }
                        {response.error?.message && (
                          <span className="rg-err-msg"> — {response.error.message}</span>
                        )}
                      </div>
                      {response.data && (
                        <div className="rg-response-actions">
                          <button
                            className="rg-resp-btn"
                            onClick={this._toggleResponseCollapse}
                            data-tooltip={responseCollapsed === false ? 'Collapse all' : 'Expand all'}
                          >
                            {responseCollapsed === false ? '⊟' : '⊞'}
                          </button>
                          <button
                            className={`rg-resp-btn${responseCopied ? ' copied' : ''}`}
                            onClick={this._copyResponse}
                            data-tooltip={responseCopied ? 'Copied!' : 'Copy JSON'}
                          >
                            {responseCopied ? '✓' : '⎘'}
                          </button>
                        </div>
                      )}
                    </div>
                    {response.data && (
                      <div className="rg-response-body">
                        <ReactJson
                          key={responseKey}
                          src={response.data}
                          name={null}
                          theme={theme}
                          iconStyle="square"
                          displayDataTypes={false}
                          displayObjectSize={false}
                          enableClipboard={false}
                          collapsed={responseCollapsed}
                        />
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Resize handle */}
          <div className="rg-resize-handle" onMouseDown={this._onResizeStart} />
        </div>
      </div>
    );
  }
}

const mapStateToProps = state => ({
  open: state.toolbar.requestGeneratorOpen,
  log: state.network.log,
});
const mapDispatchToProps = { setRequestGeneratorOpen };
export default connect(mapStateToProps, mapDispatchToProps)(RequestGenerator);
