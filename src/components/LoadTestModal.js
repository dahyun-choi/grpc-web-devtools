/* global chrome */

import React, { Component } from 'react';
import { getNetworkEntry } from '../state/networkCache';
import protoManager from '../utils/ProtoManager';
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
    mutations: [],       // [{ id, path, type, step }]
    mutationsOpen: true, // show/hide mutations section
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
  _incrementBases = {}; // ruleId → base value (reset on start)

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

  _getEnumValues(method, fieldPath) {
    try {
      const typeInfo = protoManager.getMessageType(method);
      if (!typeInfo?.requestType) return null;
      const parts = fieldPath.split('.');
      let msgType = typeInfo.requestType;
      for (let i = 0; i < parts.length; i++) {
        const fn = parts[i];
        const snakeFn = fn.replace(/([A-Z])/g, '_$1').toLowerCase();
        const field = msgType.fields[fn] || msgType.fields[snakeFn] ||
          Object.values(msgType.fields).find(f => f.name === fn || f.name === snakeFn);
        if (!field) return null;
        try { field.resolve(); } catch (_) {}
        if (i === parts.length - 1) {
          return field.resolvedType?.values ? Object.values(field.resolvedType.values) : null;
        }
        if (field.resolvedType?.fields) msgType = field.resolvedType;
        else return null;
      }
    } catch (_) {}
    return null;
  }

  _applyMutations(body, method) {
    const { mutations } = this.state;
    if (!mutations.length) return body;
    const mutated = JSON.parse(JSON.stringify(body || {}));
    const idx = this._firedCount; // 0-based request index
    for (const rule of mutations) {
      if (!rule.path || !rule.type) continue;
      // Support array index notation: "appTypes[0]" or "appTypes[*]"
      const rawParts = rule.path.split('.');
      const parts = rawParts.flatMap(p => {
        const m = p.match(/^(.+?)\[(\d+|\*)\]$/);
        return m ? [m[1], m[2]] : [p];
      });
      let obj = mutated;
      for (let i = 0; i < parts.length - 1; i++) {
        if (obj == null) break;
        const p = parts[i];
        if (Array.isArray(obj) && (p === '*' || !isNaN(p))) {
          obj = obj[p === '*' ? 0 : Number(p)];
        } else if (typeof obj === 'object') {
          obj = obj[p];
        } else {
          obj = null; break;
        }
      }
      if (!obj || typeof obj !== 'object') continue;
      const key = parts[parts.length - 1];
      switch (rule.type) {
        case 'increment': {
          if (!(rule.id in this._incrementBases)) {
            this._incrementBases[rule.id] = typeof obj[key] === 'number' ? obj[key] : 0;
          }
          obj[key] = this._incrementBases[rule.id] + (Number(rule.step) || 1) * idx;
          break;
        }
        case 'now_ms':
          obj[key] = Date.now();
          break;
        case 'now_s':
          obj[key] = Math.floor(Date.now() / 1000);
          break;
        case 'enum_random': {
          const vals = this._getEnumValues(method, rule.path);
          if (vals?.length) {
            if (Array.isArray(obj[key])) {
              // Repeated enum field: randomize each element independently
              obj[key] = obj[key].map(() => vals[Math.floor(Math.random() * vals.length)]);
            } else {
              obj[key] = vals[Math.floor(Math.random() * vals.length)];
            }
          }
          break;
        }
        case 'uuid':
          obj[key] = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
          });
          break;
        case 'str_increment':
        case 'str_decrement': {
          const val = String(obj[key] ?? '');
          const m = val.match(/(\d+)(?=\D*$)/); // last number in string
          if (m) {
            if (!(rule.id in this._incrementBases)) this._incrementBases[rule.id] = Number(m[1]);
            const step = (Number(rule.step) || 1) * idx;
            const newNum = rule.type === 'str_increment'
              ? this._incrementBases[rule.id] + step
              : this._incrementBases[rule.id] - step;
            obj[key] = val.slice(0, m.index) + newNum + val.slice(m.index + m[0].length);
          }
          break;
        }
        case 'str_random': {
          const val = String(obj[key] ?? '');
          const m = val.match(/(\d+)(?=\D*$)/);
          if (m) {
            const min = Number(rule.min) || 1;
            const max = Number(rule.max) || 100;
            const newNum = Math.floor(Math.random() * (max - min + 1)) + min;
            obj[key] = val.slice(0, m.index) + newNum + val.slice(m.index + m[0].length);
          }
          break;
        }
        default: break;
      }
    }
    return mutated;
  }

  _buildFetchCode(raw, fullEntry, mutatedBodyBase64 = null, mutatedRequest = null) {
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
    const bodyBase64 = mutatedBodyBase64 || raw.body;
    const requestData = mutatedRequest || request;
    const requestId = Math.floor(Math.random() * 1000000);
    const code = `
(function() {
  const url = ${JSON.stringify(raw.url)};
  const bodyBase64 = ${JSON.stringify(bodyBase64)};
  const headers = ${JSON.stringify(headers)};
  const grpcMethod = ${JSON.stringify(method)};
  const requestData = ${JSON.stringify(requestData)};
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
    // Apply mutation rules if any
    let mutatedBodyBase64 = null;
    let mutatedRequest = null;
    if (this.state.mutations.length > 0 && protoManager.isReady()) {
      const mutatedBody = this._applyMutations(fullEntry.request, fullEntry.method);
      try {
        let methodPath = fullEntry.method;
        try { methodPath = new URL(fullEntry.method).pathname.replace(/^\//, ''); } catch (_) {}
        const encoded = protoManager.encodeMessage(methodPath, mutatedBody);
        if (encoded) {
          const framed = protoManager.buildGrpcWebFrame(encoded);
          let bin = '';
          for (let i = 0; i < framed.length; i++) bin += String.fromCharCode(framed[i]);
          mutatedBodyBase64 = btoa(bin);
          mutatedRequest = mutatedBody;
        }
      } catch (_) {}
    }
    const { code, requestId } = this._buildFetchCode(raw, fullEntry, mutatedBodyBase64, mutatedRequest);

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
    this._incrementBases = {};
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
    const { count, interval, running, stopped, fired, total, succeeded, failed, stats, statsCopied, mutations, mutationsOpen } = this.state;

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

            {/* Mutation Rules */}
            <div className="lt-section">
              <div className="lt-section-header" onClick={() => this.setState(s => ({ mutationsOpen: !s.mutationsOpen }))}>
                <span className="lt-section-chevron">{mutationsOpen ? '▼' : '▶'}</span>
                <span className="lt-section-title">Mutation Rules</span>
                <span className="lt-section-count">({mutations.length})</span>
                {!running && (
                  <button className="lt-add-rule" onClick={e => {
                    e.stopPropagation();
                    this.setState(s => ({ mutationsOpen: true, mutations: [...s.mutations, { id: Date.now(), path: '', type: 'increment', step: 1 }] }));
                  }}>+ Add</button>
                )}
              </div>
              {mutationsOpen && mutations.map((rule, i) => (
                <div key={rule.id} className="lt-rule-row">
                  <input
                    className="lt-rule-path"
                    placeholder="field.path"
                    value={rule.path}
                    disabled={running}
                    onChange={e => {
                      const m = [...mutations]; m[i] = { ...m[i], path: e.target.value };
                      this.setState({ mutations: m });
                    }}
                  />
                  <select
                    className="lt-rule-type"
                    value={rule.type}
                    disabled={running}
                    onChange={e => {
                      const m = [...mutations]; m[i] = { ...m[i], type: e.target.value };
                      this.setState({ mutations: m });
                    }}
                  >
                    <optgroup label="Integer">
                      <option value="increment">++ Increment</option>
                    </optgroup>
                    <optgroup label="String (last number)">
                      <option value="str_increment">str ++</option>
                      <option value="str_decrement">str --</option>
                      <option value="str_random">str random</option>
                    </optgroup>
                    <optgroup label="Time">
                      <option value="now_ms">now() ms</option>
                      <option value="now_s">now() s</option>
                    </optgroup>
                    <optgroup label="Other">
                      <option value="enum_random">Enum Random</option>
                      <option value="uuid">UUID</option>
                    </optgroup>
                  </select>
                  {['increment', 'str_increment', 'str_decrement'].includes(rule.type) && (
                    <input
                      className="lt-rule-step"
                      type="number"
                      placeholder="step"
                      value={rule.step ?? 1}
                      disabled={running}
                      onChange={e => {
                        const m = [...mutations]; m[i] = { ...m[i], step: e.target.value };
                        this.setState({ mutations: m });
                      }}
                    />
                  )}
                  {rule.type === 'str_random' && (
                    <>
                      <input
                        className="lt-rule-step"
                        type="number"
                        placeholder="min"
                        value={rule.min ?? 1}
                        disabled={running}
                        onChange={e => {
                          const m = [...mutations]; m[i] = { ...m[i], min: e.target.value };
                          this.setState({ mutations: m });
                        }}
                      />
                      <input
                        className="lt-rule-step"
                        type="number"
                        placeholder="max"
                        value={rule.max ?? 100}
                        disabled={running}
                        onChange={e => {
                          const m = [...mutations]; m[i] = { ...m[i], max: e.target.value };
                          this.setState({ mutations: m });
                        }}
                      />
                    </>
                  )}
                  {!running && (
                    <button className="lt-rule-del" onClick={() => {
                      this.setState(s => ({ mutations: s.mutations.filter((_, j) => j !== i) }));
                    }}>×</button>
                  )}
                </div>
              ))}
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
