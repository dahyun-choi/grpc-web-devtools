/* global chrome */

import React, { Component } from 'react';
import { getNetworkEntry } from '../state/networkCache';
import './LoadTestModal.css';

const ALLOWED_HEADERS = [
  'content-type', 'grpc-timeout', 'grpc-encoding', 'grpc-accept-encoding',
  'x-grpc-web', 'authorization', 'app-version', 'instance-id', 'service-name',
];


function pct(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function fmt(ms) {
  if (ms == null) return '–';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

class LoadTestModal extends Component {
  state = {
    count: 10,
    interval: 1.0,
    running: false,
    stopped: false,
    fired: 0,
    total: 0,
    succeeded: 0,
    failed: 0,
    stats: null,
    statsCopied: false,
  };

  _timerId = null;
  _statsTimerId = null;
  _firedCount = 0;
  _succeededCount = 0;
  _failedCount = 0;
  _totalCount = 0;
  _firedTimes = new Map(); // requestId → true (pending)
  _latencies = [];
  _testStartTime = null;
  _testEndTime = null;

  componentDidUpdate(prevProps) {
    // Collect latencies from newly added log entries matching our fired requestIds
    if (this._firedTimes.size > 0 && this.props.log !== prevProps.log) {
      this.props.log.forEach(entry => {
        if (entry.requestId != null && this._firedTimes.has(entry.requestId) && entry.duration != null) {
          this._latencies.push(entry.duration);
          this._firedTimes.delete(entry.requestId);
        }
      });
    }
  }

  componentWillUnmount() {
    this._clearTimer();
    if (this._statsTimerId) clearTimeout(this._statsTimerId);
  }

  _clearTimer() {
    if (this._timerId) { clearTimeout(this._timerId); this._timerId = null; }
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

    let raw = rawCache.get(requestId);
    if (!raw) raw = rawCache.get(entryId);
    if (!raw && method && fullEntry.timestamp) raw = rawCache.get(`${method}@${fullEntry.timestamp}`);
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

  const __start = Date.now();
  fetch(url, { method: 'POST', headers, body: bytes, credentials: 'omit', mode: 'cors' })
    .then(res => res.arrayBuffer().then(buf => {
      const __duration = Date.now() - __start;
      const rb = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < rb.byteLength; i++) bin += String.fromCharCode(rb[i]);
      window.postMessage({ type: '__GRPCWEB_DEVTOOLS__', method: grpcMethod, methodType: 'unary',
        requestId, request: requestData, responseBodyBase64: btoa(bin), duration: __duration, isRepeat: true }, '*');
    }))
    .catch(err => {
      const __duration = Date.now() - __start;
      window.postMessage({ type: '__GRPCWEB_DEVTOOLS__', method: grpcMethod, methodType: 'unary',
        requestId, request: requestData, error: { code: 0, message: err.message }, duration: __duration, isRepeat: true }, '*');
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
    const { code, requestId } = this._buildFetchCode(raw, fullEntry);

    this._firedTimes.set(requestId, true);

    chrome.devtools.inspectedWindow.eval(code, (_r, exception) => {
      if (exception) {
        this._failedCount++;
        this._firedTimes.delete(requestId); // won't appear in log
        this.setState({ failed: this._failedCount });
      } else {
        this._succeededCount++;
        this.setState({ succeeded: this._succeededCount });
      }
    });
  };

  _scheduleNext = () => {
    if (this._firedCount >= this._totalCount) {
      this._testEndTime = Date.now();
      this.setState({ running: false });
      // Wait for remaining responses then compute stats
      this._statsTimerId = setTimeout(this._computeStats, 3000);
      return;
    }
    const delay = this._firedCount === 0 ? 0 : this.state.interval * 1000;
    this._timerId = setTimeout(() => {
      if (!this.state.running) return;
      this._sendOne();
      this._firedCount++;
      this.setState({ fired: this._firedCount });
      this._scheduleNext();
    }, delay);
  };

  _computeStats = () => {
    const sorted = [...this._latencies].sort((a, b) => a - b);
    if (sorted.length === 0) return;

    const n = sorted.length;
    const avg = sorted.reduce((a, b) => a + b, 0) / n;
    const duration = this._testEndTime && this._testStartTime
      ? (this._testEndTime - this._testStartTime) / 1000
      : null;
    const rps = duration && duration > 0 ? this._totalCount / duration : null;
    const errorRate = this._totalCount > 0 ? (this._failedCount / this._totalCount) * 100 : 0;

    const BUCKETS = [
      { label: '0 – 50 ms',    max: 50 },
      { label: '50 – 100 ms',  max: 100 },
      { label: '100 – 200 ms', max: 200 },
      { label: '200 – 500 ms', max: 500 },
      { label: '500 ms+',      max: Infinity },
    ];
    const counts = BUCKETS.map(() => 0);
    sorted.forEach(ms => {
      const i = BUCKETS.findIndex(b => ms < b.max);
      if (i >= 0) counts[i]++;
    });
    const maxCount = Math.max(...counts, 1);
    const histogram = BUCKETS.map((b, i) => ({
      label: b.label,
      count: counts[i],
      pct: counts[i] / n * 100,
      barWidth: counts[i] / maxCount,
    }));

    this.setState({
      stats: {
        avg, min: sorted[0], max: sorted[n - 1],
        p50: pct(sorted, 50), p90: pct(sorted, 90),
        p95: pct(sorted, 95), p99: pct(sorted, 99),
        rps, errorRate, sampleCount: n, histogram,
      },
    });
  };

  _copyStats = () => {
    const { stats } = this.state;
    if (!stats) return;
    const { entryId, log } = this.props;
    const summaryEntry = log.find(e => e.entryId === entryId);
    const methodLabel = summaryEntry?.method
      ? (summaryEntry.method.startsWith('http')
          ? new URL(summaryEntry.method).pathname.substring(1)
          : summaryEntry.method)
      : '–';

    const lines = [
      `Load Test Results — ${methodLabel}`,
      `Samples: ${stats.sampleCount}`,
      '',
      `Avg: ${fmt(stats.avg)}  Min: ${fmt(stats.min)}  Max: ${fmt(stats.max)}`,
      `RPS: ${stats.rps != null ? stats.rps.toFixed(1) : '–'}  Error rate: ${stats.errorRate.toFixed(1)}%`,
      '',
      `p50: ${fmt(stats.p50)}  p90: ${fmt(stats.p90)}  p95: ${fmt(stats.p95)}  p99: ${fmt(stats.p99)}`,
      '',
      'Latency Distribution:',
      ...stats.histogram.map(b => {
        const BAR_MAX = 20;
        const bars = Math.round(b.barWidth * BAR_MAX);
        const bar = '█'.repeat(bars) || '░';
        return `  ${b.label.padStart(12)}  ${bar.padEnd(BAR_MAX)}  ${b.count} (${b.pct.toFixed(0)}%)`;
      }),
    ];
    navigator.clipboard.writeText(lines.join('\n'));
    this.setState({ statsCopied: true });
    setTimeout(() => this.setState({ statsCopied: false }), 1500);
  };

  _start = () => {
    const count = Math.max(1, Math.min(1000, Number(this.state.count) || 1));
    if (this._statsTimerId) { clearTimeout(this._statsTimerId); this._statsTimerId = null; }
    this._firedCount = 0;
    this._succeededCount = 0;
    this._failedCount = 0;
    this._totalCount = count;
    this._firedTimes.clear();
    this._latencies = [];
    this._testStartTime = Date.now();
    this._testEndTime = null;
    this.setState({ running: true, stopped: false, fired: 0, total: count, succeeded: 0, failed: 0, stats: null }, this._scheduleNext);
  };

  _stop = () => {
    this._clearTimer();
    this._testEndTime = Date.now();
    this.setState({ running: false, stopped: true });
    this._statsTimerId = setTimeout(this._computeStats, 3000);
  };

  render() {
    const { onClose, log, entryId } = this.props;
    const { count, interval, running, stopped, fired, total, succeeded, failed, stats, statsCopied } = this.state;

    const summaryEntry = log.find(e => e.entryId === entryId);
    const methodLabel = summaryEntry?.method
      ? (summaryEntry.method.startsWith('http')
          ? new URL(summaryEntry.method).pathname.substring(1)
          : summaryEntry.method)
      : '–';

    const progress = total > 0 ? (fired / total) * 100 : 0;
    const done = !running && !stopped && total > 0 && fired >= total;
    const showResult = done || stopped;

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
                type="number" min="1" max="1000"
                value={count}
                disabled={running}
                onChange={e => this.setState({ count: e.target.value })}
              />
            </div>
            <div className="lt-row">
              <label className="lt-label">Interval (sec)</label>
              <input
                className="lt-input"
                type="number" min="0" max="60" step="0.1"
                value={interval}
                disabled={running}
                onChange={e => this.setState({ interval: e.target.value })}
              />
            </div>

            {/* Progress */}
            {(running || showResult) && (
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
                {showResult && !stats && <div className="lt-done-msg">{stopped ? 'Stopped' : 'Complete'} — collecting stats…</div>}
                {showResult && stats && <div className="lt-done-msg">{stopped ? 'Stopped' : 'Complete'}</div>}
              </div>
            )}

            {/* Latency Stats */}
            {stats && (
              <div className="lt-stats-section">
                <div className="lt-stats-title">
                  <span>Results <span className="lt-stats-sample">({stats.sampleCount} samples)</span></span>
                  <button
                    className={`lt-copy-btn${statsCopied ? ' copied' : ''}`}
                    onClick={this._copyStats}
                  >
                    {statsCopied ? '✓ Copied' : '⎘ Copy'}
                  </button>
                </div>

                {/* Summary row */}
                <div className="lt-stats-summary">
                  <span>Avg <strong>{fmt(stats.avg)}</strong></span>
                  <span>Min <strong>{fmt(stats.min)}</strong></span>
                  <span>Max <strong>{fmt(stats.max)}</strong></span>
                  <span>RPS <strong>{stats.rps != null ? stats.rps.toFixed(1) : '–'}</strong></span>
                  <span className={stats.errorRate > 0 ? 'lt-stats-error' : ''}>
                    Err <strong>{stats.errorRate.toFixed(1)}%</strong>
                  </span>
                </div>

                {/* Percentiles */}
                <div className="lt-stats-summary">
                  <span>p50 <strong>{fmt(stats.p50)}</strong></span>
                  <span>p90 <strong>{fmt(stats.p90)}</strong></span>
                  <span className={stats.p95 > 1000 ? 'lt-stats-warn' : ''}>p95 <strong>{fmt(stats.p95)}</strong></span>
                  <span className={stats.p99 > 2000 ? 'lt-stats-warn' : ''}>p99 <strong>{fmt(stats.p99)}</strong></span>
                </div>

                {/* Histogram */}
                <div className="lt-histogram">
                  {stats.histogram.map(b => (
                    <div key={b.label} className="lt-hist-row">
                      <span className="lt-hist-label">{b.label}</span>
                      <div className="lt-hist-bar-wrap">
                        <div
                          className="lt-hist-bar"
                          style={{ width: `${b.barWidth * 100}%` }}
                        />
                      </div>
                      <span className="lt-hist-count">{b.count} <span className="lt-hist-pct">({b.pct.toFixed(0)}%)</span></span>
                    </div>
                  ))}
                </div>
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
