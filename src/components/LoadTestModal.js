/* global chrome */

import React, { Component } from 'react';
import { getNetworkEntry } from '../state/networkCache';
import './LoadTestModal.css';

const ALLOWED_HEADERS = [
  'content-type', 'grpc-timeout', 'grpc-encoding', 'grpc-accept-encoding',
  'x-grpc-web', 'authorization', 'app-version', 'instance-id', 'service-name',
];

class LoadTestModal extends Component {
  state = {
    count: 10,
    interval: 1.0,
    running: false,
    fired: 0,
    total: 0,
    succeeded: 0,
    failed: 0,
  };

  _timerId = null;
  _firedCount = 0;
  _succeededCount = 0;
  _failedCount = 0;
  _totalCount = 0;

  componentWillUnmount() {
    this._clearTimer();
  }

  _clearTimer() {
    if (this._timerId) {
      clearTimeout(this._timerId);
      this._timerId = null;
    }
  }

  _getRawRequest() {
    const { entryId, log } = this.props;
    const summaryEntry = log.find(e => e.entryId === entryId);
    if (!summaryEntry) return null;

    const fullEntry = getNetworkEntry(entryId);
    if (!fullEntry) return null;

    const rawCache = window.__GRPCWEB_DEVTOOLS_RAW_CACHE__;
    if (!rawCache) return null;

    const { requestId, method } = fullEntry;

    // Strategy 1: by requestId
    let raw = rawCache.get(requestId);
    // Strategy 2: by entryId
    if (!raw) raw = rawCache.get(entryId);
    // Strategy 3: composite key
    if (!raw && method && fullEntry.timestamp) {
      raw = rawCache.get(`${method}@${fullEntry.timestamp}`);
    }
    // Strategy 4: URL-based proximity
    if (!raw && method) {
      let best = null, bestScore = Infinity;
      const ts = fullEntry.timestamp || Date.now();
      for (const [, v] of rawCache.entries()) {
        if (v.url === method || v.url?.includes(method) || method?.includes(v.url)) {
          const diff = Math.abs(ts - (v.timestamp || 0));
          if (diff < bestScore) { bestScore = diff; best = v; }
        }
      }
      raw = best;
    }

    return raw ? { raw, fullEntry } : null;
  }

  _buildFetchCode(raw, fullEntry) {
    const { method, request } = fullEntry;
    const headers = {};
    if (Array.isArray(raw.headers)) {
      raw.headers.forEach(h => {
        const n = h.name.toLowerCase();
        if (ALLOWED_HEADERS.includes(n) || (n.startsWith('x-') && !n.startsWith('x-forwarded'))) {
          headers[h.name] = h.value;
        }
      });
    }

    const requestId = Math.floor(Math.random() * 1000000);
    const code = `
(function() {
  const url = ${JSON.stringify(raw.url)};
  const bodyBase64 = ${JSON.stringify(raw.body)};
  const headers = ${JSON.stringify(headers)};
  const grpcMethod = ${JSON.stringify(method)};
  const requestData = ${JSON.stringify(request)};
  const requestId = ${requestId};

  const binaryString = atob(bodyBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);

  fetch(url, { method: 'POST', headers, body: bytes, credentials: 'omit', mode: 'cors' })
    .then(res => res.arrayBuffer().then(buf => {
      const rb = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < rb.byteLength; i++) bin += String.fromCharCode(rb[i]);
      window.postMessage({ type: '__GRPCWEB_DEVTOOLS__', method: grpcMethod, methodType: 'unary',
        requestId, request: requestData, responseBodyBase64: btoa(bin), isRepeat: true }, '*');
    }))
    .catch(err => {
      window.postMessage({ type: '__GRPCWEB_DEVTOOLS__', method: grpcMethod, methodType: 'unary',
        requestId, request: requestData, error: { code: 0, message: err.message }, isRepeat: true }, '*');
    });
})();`;
    return { code, requestId };
  }

  _sendOne = () => {
    const result = this._getRawRequest();
    if (!result) {
      this._failedCount++;
      this.setState({ failed: this._failedCount });
      return;
    }
    const { raw, fullEntry } = result;
    const { code } = this._buildFetchCode(raw, fullEntry);

    chrome.devtools.inspectedWindow.eval(code, (_r, exception) => {
      if (exception) {
        this._failedCount++;
        this.setState({ failed: this._failedCount });
      } else {
        this._succeededCount++;
        this.setState({ succeeded: this._succeededCount });
      }
    });
  };

  _scheduleNext = () => {
    if (this._firedCount >= this._totalCount) {
      this.setState({ running: false });
      return;
    }

    const delay = this._firedCount === 0 ? 0 : this.state.interval * 1000;
    this._timerId = setTimeout(() => {
      if (!this.state.running) return; // stopped
      this._sendOne();
      this._firedCount++;
      this.setState({ fired: this._firedCount });
      this._scheduleNext();
    }, delay);
  };

  _start = () => {
    const count = Math.max(1, Math.min(1000, Number(this.state.count) || 1));
    this._firedCount = 0;
    this._succeededCount = 0;
    this._failedCount = 0;
    this._totalCount = count;
    this.setState({ running: true, fired: 0, total: count, succeeded: 0, failed: 0 }, this._scheduleNext);
  };

  _stop = () => {
    this._clearTimer();
    this.setState({ running: false });
  };

  render() {
    const { onClose, log, entryId } = this.props;
    const { count, interval, running, fired, total, succeeded, failed } = this.state;

    const summaryEntry = log.find(e => e.entryId === entryId);
    const methodLabel = summaryEntry?.method
      ? (summaryEntry.method.startsWith('http')
          ? new URL(summaryEntry.method).pathname.substring(1)
          : summaryEntry.method)
      : '–';

    const progress = total > 0 ? (fired / total) * 100 : 0;
    const done = !running && total > 0 && fired >= total;

    return (
      <div className="lt-overlay" onClick={onClose}>
        <div className="lt-modal" onClick={e => e.stopPropagation()}>

          {/* Header */}
          <div className="lt-header">
            <span className="lt-title">Load Test</span>
            <button className="lt-close" onClick={onClose}>✕</button>
          </div>

          {/* Method */}
          <div className="lt-method" title={methodLabel}>{methodLabel}</div>

          {/* Config */}
          <div className="lt-body">
            <div className="lt-row">
              <label className="lt-label">Requests</label>
              <input
                className="lt-input"
                type="number"
                min="1"
                max="1000"
                value={count}
                disabled={running}
                onChange={e => this.setState({ count: e.target.value })}
              />
            </div>
            <div className="lt-row">
              <label className="lt-label">Interval (sec)</label>
              <input
                className="lt-input"
                type="number"
                min="0"
                max="60"
                step="0.1"
                value={interval}
                disabled={running}
                onChange={e => this.setState({ interval: e.target.value })}
              />
            </div>

            {/* Progress */}
            {(running || done) && (
              <div className="lt-progress-section">
                <div className="lt-progress-label">
                  <span>{fired} / {total}</span>
                  <span className="lt-progress-stats">
                    <span className="lt-ok">{succeeded} ok</span>
                    {failed > 0 && <span className="lt-fail"> · {failed} fail</span>}
                  </span>
                </div>
                <div className="lt-progress-bar">
                  <div className="lt-progress-fill" style={{ width: `${progress}%` }} />
                </div>
                {done && <div className="lt-done-msg">Complete</div>}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="lt-footer">
            {!running
              ? <button className="lt-start-btn" onClick={this._start}>Start</button>
              : <button className="lt-stop-btn" onClick={this._stop}>■ Stop</button>
            }
          </div>

        </div>
      </div>
    );
  }
}

export default LoadTestModal;
