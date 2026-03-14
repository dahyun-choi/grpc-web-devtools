import React, { Component } from 'react';
import { getNetworkEntry } from '../state/networkCache';
import './DiffModal.css';

function diffLines(oldStr, newStr) {
  const a = oldStr.split('\n');
  const b = newStr.split('\n');
  const m = a.length, n = b.length;
  if (m > 800 || n > 800) return [{ type: 'same', value: '(payload too large to diff)' }];
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1]+1 : Math.max(dp[i-1][j], dp[i][j-1]);
  const result = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i-1] === b[j-1]) { result.unshift({ type: 'same', value: a[i-1] }); i--; j--; }
    else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) { result.unshift({ type: 'add', value: b[j-1] }); j--; }
    else { result.unshift({ type: 'remove', value: a[i-1] }); i--; }
  }
  return result;
}

function shortMethod(method) {
  if (!method) return '–';
  try { return new URL(method).pathname.replace(/^\//, ''); } catch (_) { return method; }
}

class DiffModal extends Component {
  state = { tab: 'request', position: null, size: null };

  _modalRef = React.createRef();
  _dragOffset = { x: 0, y: 0 };
  _isDragging = false;
  _isResizing = false;
  _resizeStart = { x: 0, y: 0, w: 0, h: 0 };

  componentDidMount() {
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mouseup', this._onMouseUp);
  }
  componentWillUnmount() {
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mouseup', this._onMouseUp);
  }

  _onDragStart = (e) => {
    if (e.target.closest('button') || e.target.closest('input')) return;
    e.preventDefault();
    const modal = this._modalRef.current;
    if (!modal) return;
    const rect = modal.getBoundingClientRect();
    this._dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    this._isDragging = true;
    modal.style.userSelect = 'none';
  };

  _onMouseMove = (e) => {
    if (this._isResizing) {
      const modal = this._modalRef.current;
      if (!modal) return;
      const w = Math.max(540, this._resizeStart.w + e.clientX - this._resizeStart.x);
      const h = Math.max(340, this._resizeStart.h + e.clientY - this._resizeStart.y);
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
    if (this._isResizing) { this._isResizing = false; const m = this._modalRef.current; if (m) m.style.userSelect = ''; return; }
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

  _renderDiff(strA, strB) {
    if (!strA && !strB) return <div className="diff-empty">No data</div>;
    const a = strA || '';
    const b = strB || '';
    if (a === b) return <div className="diff-empty">No differences</div>;
    const lines = diffLines(a, b);
    return (
      <pre className="diff-view">
        {lines.map((l, i) => (
          <div key={i} className={`diff-line diff-${l.type}`}>
            <span className="diff-sign">{l.type === 'add' ? '+' : l.type === 'remove' ? '−' : ' '}</span>
            <span>{l.value}</span>
          </div>
        ))}
      </pre>
    );
  }

  render() {
    const { entryIds, log, onClose } = this.props;
    const { tab, position, size } = this.state;
    const [idA, idB] = entryIds;
    const entA = getNetworkEntry(idA);
    const entB = getNetworkEntry(idB);
    const sumA = log.find(e => e.entryId === idA);
    const sumB = log.find(e => e.entryId === idB);
    const labelA = shortMethod(sumA?.method || entA?.method);
    const labelB = shortMethod(sumB?.method || entB?.method);

    const toStr = (obj) => obj ? JSON.stringify(obj, null, 2) : '';
    const reqA = toStr(entA?.request);
    const reqB = toStr(entB?.request);
    const resA = toStr(entA?.response);
    const resB = toStr(entB?.response);

    const modalStyle = {};
    if (position) { modalStyle.position = 'fixed'; modalStyle.left = position.x; modalStyle.top = position.y; modalStyle.margin = 0; }
    if (size) { modalStyle.width = size.width; if (position) modalStyle.height = size.height; }

    return (
      <div className="diff-overlay">
        <div className="diff-modal" ref={this._modalRef} style={modalStyle} onClick={e => e.stopPropagation()}>
          <div className="diff-header" onMouseDown={this._onDragStart}>
            <span className="diff-title">Diff</span>
            <div className="diff-labels">
              <span className="diff-label diff-label-a">A: {labelA}</span>
              <span className="diff-label diff-label-b">B: {labelB}</span>
            </div>
            <div className="diff-tabs">
              <button className={`diff-tab${tab === 'request' ? ' active' : ''}`} onClick={() => this.setState({ tab: 'request' })}>Request</button>
              <button className={`diff-tab${tab === 'response' ? ' active' : ''}`} onClick={() => this.setState({ tab: 'response' })}>Response</button>
            </div>
            <button className="diff-close" onClick={onClose}>✕</button>
          </div>
          <div className="diff-body">
            <div className="diff-legend">
              <span className="diff-legend-remove">− A</span>
              <span className="diff-legend-add">+ B</span>
            </div>
            {tab === 'request' ? this._renderDiff(reqA, reqB) : this._renderDiff(resA, resB)}
          </div>
          <div className="diff-resize-handle" onMouseDown={this._onResizeStart} />
        </div>
      </div>
    );
  }
}

export default DiffModal;
