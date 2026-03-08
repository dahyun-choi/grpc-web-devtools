/* global chrome */

import React, { Component } from 'react';
import { getNetworkEntry } from '../state/networkCache';
import './ScenarioModal.css';

const ALLOWED_HEADERS = [
  'content-type', 'grpc-timeout', 'grpc-encoding', 'grpc-accept-encoding',
  'x-grpc-web', 'authorization', 'app-version', 'instance-id', 'service-name',
];

function getRawRequest(entryId, log) {
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

function buildFetchCode(raw, fullEntry) {
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

function shortMethod(method) {
  if (!method) return '–';
  try { return new URL(method).pathname.replace(/^\//, ''); } catch (_) { return method; }
}

class ScenarioModal extends Component {
  state = {
    delay: 0.5,
    loops: 1,
    running: false,
    stopped: false,
    loopDone: false,
    currentLoop: 0,
    stepStatuses: [], // per step: null | 'running' | 'ok' | 'fail'
    okCount: 0,
    failCount: 0,
  };

  _timerId = null;
  _running = false;
  _currentLoopIdx = 0;

  componentWillUnmount() {
    this._clearTimer();
  }

  _clearTimer() {
    if (this._timerId) { clearTimeout(this._timerId); this._timerId = null; }
  }

  _start = () => {
    const { scenarioEntryIds } = this.props;
    if (!scenarioEntryIds.length) return;
    const loops = Math.max(1, Math.min(100, Number(this.state.loops) || 1));
    this._clearTimer();
    this._running = true;
    this._currentLoopIdx = 0;
    this.setState({
      running: true,
      stopped: false,
      loopDone: false,
      currentLoop: 0,
      loops,
      stepStatuses: scenarioEntryIds.map(() => null),
      okCount: 0,
      failCount: 0,
    }, () => this._runStep(0));
  };

  _stop = () => {
    this._running = false;
    this._clearTimer();
    this.setState({ running: false, stopped: true });
  };

  _runStep = (stepIdx) => {
    if (!this._running) return;
    const { scenarioEntryIds, log } = this.props;
    const entryId = scenarioEntryIds[stepIdx];

    this.setState(s => {
      const stepStatuses = [...s.stepStatuses];
      stepStatuses[stepIdx] = 'running';
      return { stepStatuses };
    });

    const result = getRawRequest(entryId, log);
    if (!result) {
      this._onStepDone(stepIdx, 'fail');
      return;
    }
    const { raw, fullEntry } = result;
    const { code } = buildFetchCode(raw, fullEntry);

    chrome.devtools.inspectedWindow.eval(code, (_r, exception) => {
      this._onStepDone(stepIdx, exception ? 'fail' : 'ok');
    });
  };

  _onStepDone = (stepIdx, status) => {
    this.setState(s => {
      const stepStatuses = [...s.stepStatuses];
      stepStatuses[stepIdx] = status;
      return {
        stepStatuses,
        okCount: s.okCount + (status === 'ok' ? 1 : 0),
        failCount: s.failCount + (status === 'fail' ? 1 : 0),
      };
    });

    if (!this._running) return;

    const { scenarioEntryIds } = this.props;
    const delay = (Number(this.state.delay) || 0) * 1000;
    const nextStep = stepIdx + 1;

    if (nextStep < scenarioEntryIds.length) {
      this._timerId = setTimeout(() => this._runStep(nextStep), delay);
    } else {
      this._currentLoopIdx++;
      const loops = Number(this.state.loops) || 1;
      if (this._currentLoopIdx < loops) {
        this._timerId = setTimeout(() => {
          this.setState({
            currentLoop: this._currentLoopIdx,
            stepStatuses: scenarioEntryIds.map(() => null),
          }, () => this._runStep(0));
        }, delay);
      } else {
        this._running = false;
        this.setState({ running: false, loopDone: true });
      }
    }
  };

  render() {
    const { onClose, onRemoveStep, onClearScenario, scenarioEntryIds, log } = this.props;
    const { delay, loops, running, stopped, loopDone, currentLoop, stepStatuses, okCount, failCount } = this.state;
    const totalLoops = Number(loops) || 1;
    const showProgress = running || stopped || loopDone;

    return (
      <div className="sc-overlay" onClick={onClose}>
        <div className="sc-modal" onClick={e => e.stopPropagation()}>

          {/* Header */}
          <div className="sc-header">
            <span className="sc-title">Replay Scenario</span>
            <button className="sc-close" onClick={onClose}>✕</button>
          </div>

          {/* Steps list */}
          <div className="sc-body">
            <div className="sc-steps-header">
              Steps <span className="sc-steps-count">({scenarioEntryIds.length})</span>
            </div>
            <div className="sc-steps">
              {scenarioEntryIds.map((entryId, idx) => {
                const entry = log.find(e => e.entryId === entryId);
                const status = stepStatuses[idx];
                return (
                  <div key={entryId} className={`sc-step${status === 'running' ? ' sc-step-active' : ''}`}>
                    <span className="sc-step-num">{idx + 1}</span>
                    <span className="sc-step-status">
                      {status === 'running' && <span className="sc-icon-running">⟳</span>}
                      {status === 'ok' && <span className="sc-icon-ok">✓</span>}
                      {status === 'fail' && <span className="sc-icon-fail">✗</span>}
                      {!status && <span className="sc-icon-pending">·</span>}
                    </span>
                    <span className="sc-step-method" title={entry?.method || ''}>
                      {shortMethod(entry?.method)}
                    </span>
                    {!running && (
                      <button
                        className="sc-remove-btn"
                        onClick={() => onRemoveStep(entryId)}
                        title="Remove from scenario"
                      >✕</button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Config */}
            <div className="sc-config">
              <div className="sc-row">
                <label className="sc-label">Delay (sec)</label>
                <input
                  className="sc-input"
                  type="number" min="0" max="60" step="0.1"
                  value={delay}
                  disabled={running}
                  onChange={e => this.setState({ delay: e.target.value })}
                />
              </div>
              <div className="sc-row">
                <label className="sc-label">Loops</label>
                <input
                  className="sc-input"
                  type="number" min="1" max="100"
                  value={loops}
                  disabled={running}
                  onChange={e => this.setState({ loops: e.target.value })}
                />
              </div>
            </div>

            {/* Progress */}
            {showProgress && (
              <div className="sc-progress">
                {totalLoops > 1 && (
                  <span className="sc-progress-loop">
                    Loop {Math.min(currentLoop + 1, totalLoops)} / {totalLoops}
                  </span>
                )}
                <span>
                  <span className="sc-ok">{okCount} ok</span>
                  {failCount > 0 && <span className="sc-fail"> · {failCount} fail</span>}
                </span>
              </div>
            )}

            {/* Done / Stopped */}
            {(loopDone || stopped) && (
              <div className={`sc-done-msg${stopped ? ' sc-done-stopped' : ''}`}>
                {stopped ? 'Stopped' : `Complete${totalLoops > 1 ? ` (${totalLoops} loops)` : ''}`}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="sc-footer">
            {!running && (
              <button className="sc-clear-btn" onClick={onClearScenario}>
                Clear
              </button>
            )}
            {!running
              ? <button className="sc-start-btn" onClick={this._start} disabled={!scenarioEntryIds.length}>
                  ▶ Start
                </button>
              : <button className="sc-stop-btn" onClick={this._stop}>■ Stop</button>
            }
          </div>

        </div>
      </div>
    );
  }
}

export default ScenarioModal;
