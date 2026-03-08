import React, { Component } from 'react';
import { connect } from 'react-redux';
import { setLatencyStatsOpen } from '../state/toolbar';
import './LatencyStats.css';

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function computeStats(durations) {
  const valid = durations.filter(d => d != null).sort((a, b) => a - b);
  if (valid.length === 0) return null;
  const sum = valid.reduce((a, b) => a + b, 0);
  return {
    count: valid.length,
    min: valid[0],
    max: valid[valid.length - 1],
    avg: sum / valid.length,
    p50: percentile(valid, 50),
    p95: percentile(valid, 95),
    p99: percentile(valid, 99),
  };
}

function fmt(ms) {
  if (ms == null) return '–';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtAvg(ms) {
  if (ms == null) return '–';
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

class LatencyStats extends Component {
  state = { sortBy: 'count', sortDir: 'desc', filter: '' };

  _close = () => this.props.setLatencyStatsOpen(false);

  _sort(col) {
    this.setState(s => ({
      sortBy: col,
      sortDir: s.sortBy === col && s.sortDir === 'desc' ? 'asc' : 'desc',
    }));
  }

  _buildRows() {
    const { log } = this.props;
    const map = new Map(); // endpoint → { durations, errors, total }

    log.forEach(entry => {
      if (!entry.endpoint && !entry.method) return;
      const key = entry.endpoint || entry.method;
      if (!map.has(key)) map.set(key, { durations: [], errors: 0, total: 0 });
      const rec = map.get(key);
      rec.total++;
      if (entry.statusCode != null && entry.statusCode !== 0) rec.errors++;
      if (entry.duration != null) rec.durations.push(entry.duration);
    });

    return Array.from(map.entries()).map(([endpoint, rec]) => {
      const stats = computeStats(rec.durations);
      return { endpoint, total: rec.total, errors: rec.errors, stats };
    });
  }

  render() {
    if (!this.props.open) return null;
    const { sortBy, sortDir, filter } = this.state;

    let rows = this._buildRows();

    if (filter) {
      const q = filter.toLowerCase();
      rows = rows.filter(r => r.endpoint.toLowerCase().includes(q));
    }

    rows.sort((a, b) => {
      let va, vb;
      if (sortBy === 'count')    { va = a.total;           vb = b.total; }
      else if (sortBy === 'avg') { va = a.stats?.avg ?? -1; vb = b.stats?.avg ?? -1; }
      else if (sortBy === 'p95') { va = a.stats?.p95 ?? -1; vb = b.stats?.p95 ?? -1; }
      else if (sortBy === 'p99') { va = a.stats?.p99 ?? -1; vb = b.stats?.p99 ?? -1; }
      else if (sortBy === 'max') { va = a.stats?.max ?? -1; vb = b.stats?.max ?? -1; }
      else if (sortBy === 'err') { va = a.errors;           vb = b.errors; }
      else                       { va = a.endpoint;         vb = b.endpoint; }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    const arrow = col => sortBy === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

    return (
      <div className="ls-overlay" onClick={this._close}>
        <div className="ls-modal" onClick={e => e.stopPropagation()}>

          {/* Header */}
          <div className="ls-header">
            <span className="ls-title">Latency Stats</span>
            <div className="ls-header-right">
              <input
                className="ls-filter"
                placeholder="Filter methods…"
                value={filter}
                onChange={e => this.setState({ filter: e.target.value })}
              />
              <button className="ls-close" onClick={this._close}>✕</button>
            </div>
          </div>

          {/* Table */}
          <div className="ls-table-wrap">
            {rows.length === 0
              ? <div className="ls-empty">No data yet.</div>
              : (
                <table className="ls-table">
                  <thead>
                    <tr>
                      <th className="ls-th-method" onClick={() => this._sort('method')}>Method{arrow('method')}</th>
                      <th onClick={() => this._sort('count')}>Count{arrow('count')}</th>
                      <th onClick={() => this._sort('err')}>Err{arrow('err')}</th>
                      <th onClick={() => this._sort('avg')}>Avg{arrow('avg')}</th>
                      <th>Min</th>
                      <th>Max{arrow('max')}</th>
                      <th onClick={() => this._sort('p95')}>p95{arrow('p95')}</th>
                      <th onClick={() => this._sort('p99')}>p99{arrow('p99')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => {
                      const s = r.stats;
                      const errRate = r.total > 0 ? (r.errors / r.total) * 100 : 0;
                      return (
                        <tr key={r.endpoint}>
                          <td className="ls-td-method" title={r.endpoint}>{r.endpoint}</td>
                          <td>{r.total}</td>
                          <td className={r.errors > 0 ? 'ls-err' : 'ls-ok'}>
                            {r.errors > 0 ? `${r.errors} (${errRate.toFixed(0)}%)` : '0'}
                          </td>
                          <td>{fmtAvg(s?.avg)}</td>
                          <td>{fmt(s?.min)}</td>
                          <td>{fmt(s?.max)}</td>
                          <td className={s?.p95 > 1000 ? 'ls-warn' : ''}>{fmt(s?.p95)}</td>
                          <td className={s?.p99 > 2000 ? 'ls-warn' : ''}>{fmt(s?.p99)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )
            }
          </div>

        </div>
      </div>
    );
  }
}

const mapStateToProps = state => ({
  open: state.toolbar.latencyStatsOpen,
  log: state.network.log,
});
const mapDispatchToProps = { setLatencyStatsOpen };
export default connect(mapStateToProps, mapDispatchToProps)(LatencyStats);
