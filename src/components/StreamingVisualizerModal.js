import React, { Component } from 'react';
import { getNetworkEntry } from '../state/networkCache';
import './StreamingVisualizerModal.css';

function shortMethod(method) {
  if (!method) return '–';
  try {
    const path = new URL(method).pathname.replace(/^\//, '');
    const parts = path.split('/');
    if (parts.length >= 2) return `${parts[parts.length - 2].split('.').pop()} / ${parts[parts.length - 1]}`;
    return path;
  } catch (_) { return method; }
}

function fmtRelTime(ms) {
  if (ms == null) return '–';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtAbsTime(epochMs) {
  if (!epochMs) return '–';
  const d = new Date(epochMs);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

function fmtSize(obj) {
  if (obj == null) return '–';
  try { return `${new TextEncoder().encode(JSON.stringify(obj)).length} B`; } catch (_) { return '–'; }
}

function diffLines(a, b) {
  const al = a.split('\n'), bl = b.split('\n');
  const m = al.length, n = bl.length;
  if (m > 400 || n > 400) return [{ type: 'same', value: '(too large)' }];
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = al[i-1] === bl[j-1] ? dp[i-1][j-1]+1 : Math.max(dp[i-1][j], dp[i][j-1]);
  const res = []; let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && al[i-1] === bl[j-1]) { res.unshift({ type: 'same', value: al[i-1] }); i--; j--; }
    else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) { res.unshift({ type: 'add', value: bl[j-1] }); j--; }
    else { res.unshift({ type: 'remove', value: al[i-1] }); i--; }
  }
  return res;
}

class StreamingVisualizerModal extends Component {
  state = {
    selectedIdx: null, // index into messages array
    showDiff: false,
    paused: false,
    showAbsolute: false, // relative vs absolute timestamps
    position: null,
    size: null,
    detailHeight: 180, // px height of detail panel
  };

  _modalRef = React.createRef();
  _dragOffset = { x: 0, y: 0 };
  _isDragging = false;
  _isResizing = false;
  _resizeStart = { x: 0, y: 0, w: 0, h: 0 };
  _isDraggingDetail = false;
  _detailDragStart = { y: 0, h: 0 };

  componentDidMount() {
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mouseup', this._onMouseUp);
  }
  componentWillUnmount() {
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mouseup', this._onMouseUp);
  }

  _onDragStart = (e) => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    const modal = this._modalRef.current;
    if (!modal) return;
    const rect = modal.getBoundingClientRect();
    this._dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    this._isDragging = true;
    modal.style.userSelect = 'none';
  };

  _onDetailDividerStart = (e) => {
    e.preventDefault();
    this._isDraggingDetail = true;
    this._detailDragStart = { y: e.clientY, h: this.state.detailHeight };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  _onMouseMove = (e) => {
    if (this._isDraggingDetail) {
      const delta = this._detailDragStart.y - e.clientY;
      const newH = Math.max(80, Math.min(400, this._detailDragStart.h + delta));
      this.setState({ detailHeight: newH });
      return;
    }
    if (this._isResizing) {
      const modal = this._modalRef.current;
      if (!modal) return;
      const w = Math.max(480, this._resizeStart.w + e.clientX - this._resizeStart.x);
      const h = Math.max(360, this._resizeStart.h + e.clientY - this._resizeStart.y);
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

  _onMouseUp = () => {
    if (this._isDraggingDetail) {
      this._isDraggingDetail = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      return;
    }
    if (this._isResizing) {
      this._isResizing = false;
      const m = this._modalRef.current; if (m) m.style.userSelect = '';
      return;
    }
    if (!this._isDragging) return;
    this._isDragging = false;
    const m = this._modalRef.current; if (m) m.style.userSelect = '';
  };

  _onResizeStart = (e) => {
    e.preventDefault(); e.stopPropagation();
    const modal = this._modalRef.current;
    if (!modal) return;
    const rect = modal.getBoundingClientRect();
    this._resizeStart = { x: e.clientX, y: e.clientY, w: rect.width, h: rect.height };
    this._isResizing = true;
    modal.style.userSelect = 'none';
    if (!this.state.position) this.setState({ position: { x: rect.left, y: rect.top } });
  };

  render() {
    const { entryId, log, onClose } = this.props;
    const { selectedIdx, showDiff, paused, showAbsolute, position, size, detailHeight } = this.state;

    const summary = log.find(e => e.entryId === entryId);
    const fullEntry = getNetworkEntry(entryId);
    if (!fullEntry) return null;

    const method = fullEntry.method || summary?.method || '';
    const request = fullEntry.request;
    const responses = (fullEntry.responses || []).filter(r => r != null);
    const firstResponseTs = responses.length > 0 ? (responses[0].timestamp || 0) : 0;
    const streamStart = fullEntry.startTime || firstResponseTs || fullEntry.timestamp || 0;

    // Build unified message list: [{side, label, data, relMs, idx}]
    const clientMessages = request
      ? [{ side: 'client', label: 'Request', data: request, relMs: 0 }]
      : [];
    const serverMessages = responses.map((r, i) => {
      const data = r && r.data !== undefined ? r.data : r;
      const ts = r && r.timestamp ? r.timestamp : null;
      return {
        side: 'server',
        label: `Message ${i + 1}`,
        data,
        relMs: streamStart && ts ? Math.max(0, ts - streamStart) : null,
        idx: i,
      };
    });

    // Latency spike detection
    const gaps = serverMessages.slice(1).map((msg, i) => {
      const prev = serverMessages[i];
      return (msg.relMs != null && prev.relMs != null) ? msg.relMs - prev.relMs : null;
    });
    const validGaps = gaps.filter(g => g != null && g >= 0);
    const avgGap = validGaps.length ? validGaps.reduce((a, b) => a + b, 0) / validGaps.length : 0;
    const SPIKE_MULTIPLIER = 3;
    const SPIKE_MIN_MS = 200;
    const spikeAt = new Set(
      gaps.map((g, i) => (g != null && g > Math.max(SPIKE_MIN_MS, avgGap * SPIKE_MULTIPLIER)) ? i + 1 : -1)
        .filter(i => i >= 0)
    );

    // Time display helper
    const displayTime = (msg) => {
      if (showAbsolute) {
        const absTs = responses[msg.idx]?.timestamp;
        return fmtAbsTime(absTs);
      }
      return fmtRelTime(msg.relMs);
    };

    // All server messages for navigation
    const allServer = serverMessages;
    const selectedMsg = selectedIdx != null ? allServer[selectedIdx] : null;
    const prevMsg = selectedIdx != null && selectedIdx > 0 ? allServer[selectedIdx - 1] : null;

    const modalStyle = {};
    if (position) { modalStyle.position = 'fixed'; modalStyle.left = position.x; modalStyle.top = position.y; modalStyle.margin = 0; }
    if (size) { modalStyle.width = size.width; if (position) modalStyle.height = size.height; modalStyle.maxHeight = 'none'; }

    return (
      <div className="sv-overlay">
        <div className="sv-modal" ref={this._modalRef} style={modalStyle} onClick={e => e.stopPropagation()}>

          {/* Header */}
          <div className="sv-header" onMouseDown={this._onDragStart}>
            <span className="sv-title">gRPC Streaming Visualizer</span>
            <div className="sv-header-actions">
              <button className="sv-btn sv-btn-toggle" onClick={() => this.setState(s => ({ showAbsolute: !s.showAbsolute }))}>
                {showAbsolute ? 'Abs' : 'Rel'}
              </button>
              <button className={`sv-btn${paused ? ' sv-btn-active' : ''}`} onClick={() => this.setState(s => ({ paused: !s.paused }))}>
                {paused ? '▶ Resume' : '⏸ Pause'}
              </button>
              <button className="sv-btn" onClick={() => this.setState({ selectedIdx: null, showDiff: false })}>✕ Clear</button>
              <button className="sv-close" onClick={onClose}>✕</button>
            </div>
          </div>

          {/* Method */}
          <div className="sv-method">{shortMethod(method)}</div>

          {/* Timeline */}
          <div className="sv-timeline-wrap">
            <div className="sv-col-header">
              <span>Client</span>
              <span>Server</span>
            </div>
            <div className="sv-timeline">
              {/* Client request */}
              {clientMessages.map((msg, i) => (
                <div key={`c-${i}`} className="sv-row sv-row-client">
                  <div className="sv-cell sv-cell-client">
                    <span className="sv-time">{showAbsolute ? fmtAbsTime(streamStart) : '0ms'}</span>
                    <span className="sv-arrow">▶</span>
                    <span className="sv-msg-name">{msg.label}</span>
                  </div>
                  <div className="sv-cell sv-cell-server" />
                </div>
              ))}
              {/* Server messages */}
              {serverMessages.map((msg, i) => {
                const isSelected = selectedIdx === i;
                const gap = i > 0 ? gaps[i - 1] : null;
                const isSpike = spikeAt.has(i);
                return (
                  <React.Fragment key={`s-${i}`}>
                    {isSpike && (
                      <div className="sv-spike-row">
                        <span className="sv-spike-badge">⚠ latency spike detected ({fmtRelTime(gap)})</span>
                      </div>
                    )}
                    <div
                      className={`sv-row sv-row-server${isSelected ? ' sv-row-selected' : ''}`}
                      onClick={() => this.setState({ selectedIdx: i, showDiff: false })}
                    >
                      <div className="sv-cell sv-cell-client" />
                      <div className="sv-cell sv-cell-server">
                        <span className="sv-time">{displayTime(msg)}</span>
                        <span className="sv-arrow">◀</span>
                        <span className="sv-msg-name">{msg.label}</span>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
              {responses.length === 0 && (
                <div className="sv-empty">No streaming messages yet.</div>
              )}
            </div>
          </div>

          {/* Detail panel divider */}
          <div className="sv-divider" onMouseDown={this._onDetailDividerStart} />

          {/* Detail panel */}
          <div className="sv-detail" style={{ height: detailHeight, flex: 'none' }}>
            {selectedMsg ? (
              <>
                <div className="sv-detail-header">
                  Message Details: <strong>{selectedMsg.label}</strong>
                </div>
                {!showDiff ? (
                  <>
                    <div className="sv-detail-meta">
                      <span>+<strong>{fmtRelTime(selectedMsg.relMs)}</strong></span>
                      <span>{fmtAbsTime(responses[selectedMsg.idx]?.timestamp)}</span>
                      <span>Size: <strong>{fmtSize(selectedMsg.data)}</strong></span>
                      {spikeAt.has(selectedMsg.idx) && (
                        <span className="sv-spike-inline">⚠ spike ({fmtRelTime(gaps[selectedMsg.idx - 1])})</span>
                      )}
                    </div>
                    <pre className="sv-detail-body">{(() => { try { return JSON.stringify(selectedMsg.data, null, 2); } catch(_) { return String(selectedMsg.data); } })()}</pre>
                  </>
                ) : (
                  <>
                    <div className="sv-detail-meta">
                      <span>Diff: <strong>{prevMsg?.label}</strong> → <strong>{selectedMsg.label}</strong></span>
                    </div>
                    <pre className="sv-detail-body sv-diff-view">
                      {diffLines(
                        (() => { try { return JSON.stringify(prevMsg?.data, null, 2) || ''; } catch(_) { return ''; } })(),
                        (() => { try { return JSON.stringify(selectedMsg.data, null, 2) || ''; } catch(_) { return ''; } })()
                      ).map((l, i) => (
                        <div key={i} className={`sv-diff-line sv-diff-${l.type}`}>
                          <span className="sv-diff-sign">{l.type === 'add' ? '+' : l.type === 'remove' ? '−' : ' '}</span>
                          <span>{l.value}</span>
                        </div>
                      ))}
                    </pre>
                  </>
                )}
              </>
            ) : (
              <div className="sv-detail-empty">Click a server message to inspect it</div>
            )}
          </div>

          {/* Navigation */}
          <div className="sv-nav">
            <button
              className="sv-nav-btn"
              disabled={selectedIdx == null || selectedIdx === 0}
              onClick={() => this.setState(s => ({ selectedIdx: s.selectedIdx - 1, showDiff: false }))}
            >
              ← Back
            </button>
            <button
              className={`sv-nav-btn sv-nav-diff${showDiff ? ' active' : ''}`}
              disabled={selectedIdx == null || selectedIdx === 0}
              onClick={() => this.setState(s => ({ showDiff: !s.showDiff }))}
            >
              {showDiff ? 'Body' : 'Diff with Previous'} →
            </button>
          </div>

          <div className="sv-resize-handle" onMouseDown={this._onResizeStart} />
        </div>
      </div>
    );
  }
}

export default StreamingVisualizerModal;
