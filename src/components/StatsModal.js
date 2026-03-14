import React, { Component } from 'react';
import { connect } from 'react-redux';
import { setStatsOpen } from '../state/toolbar';
import './StatsModal.css';

function shortMethod(method) {
  if (!method) return 'Unknown';
  try { return new URL(method).pathname.replace(/^\//, ''); } catch (_) { return method; }
}

function fmt(ms) {
  if (ms == null || isNaN(ms)) return '–';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function computeStats(log) {
  const map = {};
  log.forEach(entry => {
    const key = entry.endpoint || shortMethod(entry.method) || 'Unknown';
    if (!map[key]) map[key] = { name: key, count: 0, latencies: [], errors: 0 };
    const s = map[key];
    s.count++;
    if (entry.duration != null) s.latencies.push(entry.duration);
    if (entry.error || (entry.statusCode != null && entry.statusCode !== 0)) s.errors++;
  });
  return Object.values(map).map(s => {
    const sorted = [...s.latencies].sort((a, b) => a - b);
    const avg = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null;
    const p50 = sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : null;
    const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : null;
    return {
      name: s.name,
      count: s.count,
      avg,
      p50,
      p95,
      min: sorted[0] ?? null,
      max: sorted[sorted.length - 1] ?? null,
      errorRate: s.count > 0 ? (s.errors / s.count) * 100 : 0,
      errors: s.errors,
    };
  });
}

const SORT_KEYS = ['name', 'count', 'avg', 'p95', 'errorRate'];

class StatsModal extends Component {
  state = {
    sortKey: 'count',
    sortAsc: false,
    copied: false,
    position: null,
    size: null,
  };

  _modalRef = React.createRef();
  _dragOffset = { x: 0, y: 0 };
  _isDragging = false;
  _isResizing = false;
  _resizeStart = { x: 0, y: 0, w: 0, h: 0 };

  componentDidMount() {
    document.addEventListener('mousemove', this._onDragMove);
    document.addEventListener('mouseup', this._onDragEnd);
  }
  componentWillUnmount() {
    document.removeEventListener('mousemove', this._onDragMove);
    document.removeEventListener('mouseup', this._onDragEnd);
  }

  _onDragStart = (e) => {
    if (e.target.closest('button') || e.target.closest('th')) return;
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
      const w = Math.max(400, this._resizeStart.w + e.clientX - this._resizeStart.x);
      const h = Math.max(240, this._resizeStart.h + e.clientY - this._resizeStart.y);
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
    if (!this.state.position) this.setState({ position: { x: rect.left, y: rect.top } });
  };

  _setSort = (key) => {
    this.setState(s => ({
      sortKey: key,
      sortAsc: s.sortKey === key ? !s.sortAsc : false,
    }));
  };

  _copy = (rows) => {
    const lines = [
      'RPC Stats',
      '-'.repeat(40),
      ...rows.map(r => [
        r.name,
        `count: ${r.count}`,
        `avg latency: ${fmt(r.avg)}`,
        `p95: ${fmt(r.p95)}`,
        `error rate: ${r.errorRate.toFixed(1)}%`,
      ].join('  |  ')),
      '-'.repeat(40),
      `Total: ${rows.reduce((a, r) => a + r.count, 0)} requests`,
    ];
    navigator.clipboard.writeText(lines.join('\n'));
    this.setState({ copied: true });
    setTimeout(() => this.setState({ copied: false }), 1500);
  };

  render() {
    if (!this.props.open) return null;
    const { log } = this.props;
    const { sortKey, sortAsc, copied, position, size } = this.state;

    const rows = computeStats(log).sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
      return sortAsc ? cmp : -cmp;
    });

    const totalCount = rows.reduce((s, r) => s + r.count, 0);
    const modalStyle = {};
    if (position) { modalStyle.position = 'fixed'; modalStyle.left = position.x; modalStyle.top = position.y; modalStyle.margin = 0; }
    if (size) { modalStyle.width = size.width; if (position) modalStyle.height = size.height; modalStyle.maxHeight = 'none'; }

    const SortTh = ({ k, label }) => (
      <th className={`stats-th${sortKey === k ? ' stats-th-active' : ''}`} onClick={() => this._setSort(k)}>
        {label}{sortKey === k ? (sortAsc ? ' ↑' : ' ↓') : ''}
      </th>
    );

    return (
      <div className="stats-overlay">
        <div className="stats-modal" ref={this._modalRef} style={modalStyle} onClick={e => e.stopPropagation()}>

          <div className="stats-header" onMouseDown={this._onDragStart}>
            <span className="stats-title">RPC Stats</span>
            <span className="stats-total">{totalCount} requests · {rows.length} methods</span>
            <div className="stats-header-actions">
              <button
                className={`stats-copy-btn${copied ? ' copied' : ''}`}
                onClick={() => this._copy(rows)}
              >
                {copied ? '✓ Copied' : '⎘ Copy'}
              </button>
              <button className="stats-close" onClick={() => this.props.setStatsOpen(false)}>✕</button>
            </div>
          </div>

          <div className="stats-body">
            {rows.length === 0 ? (
              <div className="stats-empty">No requests captured yet.</div>
            ) : (
              <table className="stats-table">
                <thead>
                  <tr>
                    <SortTh k="name" label="Method" />
                    <SortTh k="count" label="Count" />
                    <SortTh k="avg" label="Avg" />
                    <SortTh k="p95" label="p95" />
                    <th className="stats-th">Min / Max</th>
                    <SortTh k="errorRate" label="Error %" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.name} className="stats-row">
                      <td className="stats-method" title={r.name}>{r.name}</td>
                      <td className="stats-num">{r.count}</td>
                      <td className="stats-num">{fmt(r.avg)}</td>
                      <td className={`stats-num${r.p95 != null && r.p95 > 1000 ? ' stats-warn' : ''}`}>{fmt(r.p95)}</td>
                      <td className="stats-num stats-minmax">{fmt(r.min)} / {fmt(r.max)}</td>
                      <td className={`stats-num${r.errorRate > 0 ? ' stats-error' : ''}`}>
                        {r.errorRate.toFixed(1)}%{r.errors > 0 ? ` (${r.errors})` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="stats-footer">
                    <td className="stats-method"><strong>Total</strong></td>
                    <td className="stats-num"><strong>{totalCount}</strong></td>
                    <td colSpan={4} />
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
          <div className="stats-resize-handle" onMouseDown={this._onResizeStart} />
        </div>
      </div>
    );
  }
}

const mapStateToProps = state => ({
  open: state.toolbar.statsOpen,
  log: state.network.log,
});
export default connect(mapStateToProps, { setStatsOpen })(StatsModal);
