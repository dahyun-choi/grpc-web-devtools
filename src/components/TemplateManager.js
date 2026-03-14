/* global chrome */

import React, { Component } from 'react';
import ReactJson from 'react-json-view';
import { connect } from 'react-redux';
import { setTemplateManagerOpen } from '../state/toolbar';
import './TemplateManager.css';

const STORAGE_KEY = 'grpc_devtools_templates_v1';

class TemplateManager extends Component {
  state = {
    templates: [],
    selectedId: null,
    editName: '',
    editUrl: '',
    editHeaders: [],
    editBody: {},
    saved: false,
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

  componentDidUpdate(prevProps) {
    if (this.props.open && !prevProps.open) {
      this._load();
    }
  }

  _load = () => {
    if (chrome?.storage?.local) {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        const templates = result[STORAGE_KEY] || [];
        this.setState({ templates }, () => {
          if (templates[0] && !this.state.selectedId) this._select(templates[0]);
        });
      });
    }
  };

  _select = (t) => {
    this.setState({
      selectedId: t.id,
      editName: t.name || '',
      editUrl: t.url || '',
      editHeaders: (t.headers || []).map((h, i) => ({ ...h, _key: i })),
      editBody: t.request || {},
      saved: false,
    });
  };

  _save = () => {
    const { selectedId, editName, editUrl, editHeaders, editBody, templates } = this.state;
    const updated = templates.map(t => t.id !== selectedId ? t : {
      ...t,
      name: editName,
      url: editUrl,
      headers: editHeaders.map(({ key, value }) => ({ key, value })),
      request: editBody,
    });
    this.setState({ templates: updated, saved: true });
    setTimeout(() => this.setState({ saved: false }), 1800);
    if (chrome?.storage?.local) {
      chrome.storage.local.set({ [STORAGE_KEY]: updated });
    }
  };

  _delete = () => {
    const { selectedId, templates } = this.state;
    const updated = templates.filter(t => t.id !== selectedId);
    const next = updated[0] ?? null;
    this.setState({ templates: updated, selectedId: null }, () => {
      if (next) this._select(next);
      else this.setState({ editName: '', editUrl: '', editHeaders: [], editBody: {} });
    });
    if (chrome?.storage?.local) {
      chrome.storage.local.set({ [STORAGE_KEY]: updated });
    }
  };

  _export = () => {
    const { templates } = this.state;
    if (!templates.length) return;
    const json = JSON.stringify({ version: 1, templates }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'grpc-templates.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  _import = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        const imported = Array.isArray(parsed) ? parsed : (parsed.templates || []);
        if (!imported.length) return;
        const existing = this.state.templates;
        const existingIds = new Set(existing.map(t => t.id));
        const newOnes = imported.filter(t => t.id && !existingIds.has(t.id));
        const merged = [...existing, ...newOnes];
        this.setState({ templates: merged }, () => {
          if (!this.state.selectedId && merged[0]) this._select(merged[0]);
        });
        if (chrome?.storage?.local) {
          chrome.storage.local.set({ [STORAGE_KEY]: merged });
        }
      } catch (_) {}
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  _addHeader = () => {
    this.setState(s => ({ editHeaders: [...s.editHeaders, { key: '', value: '', _key: Date.now() }] }));
  };

  _updateHeader = (idx, field, val) => {
    this.setState(s => {
      const editHeaders = [...s.editHeaders];
      editHeaders[idx] = { ...editHeaders[idx], [field]: val };
      return { editHeaders };
    });
  };

  _removeHeader = (idx) => {
    this.setState(s => ({ editHeaders: s.editHeaders.filter((_, i) => i !== idx) }));
  };

  _onBodyEdit = ({ updated_src }) => {
    this.setState({ editBody: updated_src });
  };

  // ── Drag / Resize (same pattern as RequestGenerator) ─────────────────────

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

  _onDragMove = (e) => {
    if (this._isResizing) {
      const modal = this._modalRef.current;
      if (!modal) return;
      const dx = e.clientX - this._resizeStart.x;
      const dy = e.clientY - this._resizeStart.y;
      const w = Math.max(520, this._resizeStart.w + dx);
      const h = Math.max(340, this._resizeStart.h + dy);
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
    if (!this.state.position) {
      this.setState({ position: { x: rect.left, y: rect.top } });
    }
  };

  render() {
    if (!this.props.open) return null;
    const { templates, selectedId, editName, editUrl, editHeaders, editBody, saved, position, size } = this.state;
    const selected = templates.find(t => t.id === selectedId);
    const theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'twilight' : 'rjv-default';

    const modalStyle = {};
    if (position) { modalStyle.position = 'fixed'; modalStyle.left = position.x; modalStyle.top = position.y; modalStyle.margin = 0; }
    if (size) { modalStyle.width = size.width; if (position) modalStyle.height = size.height; }

    return (
      <div className="tm-overlay">
        <div className="tm-modal" ref={this._modalRef} style={modalStyle} onClick={e => e.stopPropagation()}>

          {/* Header — drag handle */}
          <div className="tm-header" onMouseDown={this._onDragStart}>
            <span className="tm-title">Template Manager</span>
            <div className="tm-header-actions">
              <button className="tm-io-btn" onClick={this._export} disabled={!templates.length} title="Export templates as JSON">Export</button>
              <label className="tm-io-btn" title="Import templates from JSON">
                Import
                <input type="file" accept=".json" style={{ display: 'none' }} onChange={this._import} />
              </label>
              <button className="tm-close" onClick={() => this.props.setTemplateManagerOpen(false)}>✕</button>
            </div>
          </div>

          <div className="tm-body">
            {/* Left: template list */}
            <div className="tm-list-panel">
              {templates.length === 0 ? (
                <div className="tm-empty">No templates saved.<br />Right-click any request → 💾 Save as Template</div>
              ) : (
                templates.map(t => (
                  <div
                    key={t.id}
                    className={`tm-list-item${t.id === selectedId ? ' tm-list-item-selected' : ''}`}
                    onClick={() => this._select(t)}
                  >
                    <div className="tm-list-name">{t.name}</div>
                    <div className="tm-list-method">{t.method}</div>
                  </div>
                ))
              )}
            </div>

            {/* Right: editor + actions */}
            <div className="tm-right-panel">
              <div className="tm-editor-panel">
                {!selected ? (
                  <div className="tm-empty" style={{ margin: 'auto' }}>Select a template to edit.</div>
                ) : (
                  <>
                    <div className="tm-field-row">
                      <label className="tm-label">Name</label>
                      <input className="tm-input" value={editName} onChange={e => this.setState({ editName: e.target.value })} />
                    </div>
                    <div className="tm-field-row">
                      <label className="tm-label">URL</label>
                      <input className="tm-input" value={editUrl} onChange={e => this.setState({ editUrl: e.target.value })} />
                    </div>
                    <div className="tm-field-row">
                      <label className="tm-label">Headers</label>
                      <div className="tm-headers">
                        {editHeaders.map((h, i) => (
                          <div key={h._key} className="tm-header-item">
                            <input className="tm-input tm-header-key" placeholder="key" value={h.key} onChange={e => this._updateHeader(i, 'key', e.target.value)} />
                            <input className="tm-input tm-header-val" placeholder="value" value={h.value} onChange={e => this._updateHeader(i, 'value', e.target.value)} />
                            <button className="tm-header-del" onClick={() => this._removeHeader(i)}>×</button>
                          </div>
                        ))}
                        <button className="tm-add-header" onClick={this._addHeader}>+ Add header</button>
                      </div>
                    </div>
                    <div className="tm-field-row tm-body-row">
                      <label className="tm-label">Request body</label>
                      <div className="tm-body-viewer">
                        <ReactJson
                          key={selectedId}
                          name={false}
                          theme={theme}
                          style={{ backgroundColor: 'transparent', fontSize: '12px' }}
                          enableClipboard={false}
                          displayDataTypes={false}
                          displayObjectSize={false}
                          collapsed={false}
                          src={editBody}
                          onEdit={this._onBodyEdit}
                          onAdd={this._onBodyEdit}
                          onDelete={this._onBodyEdit}
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Actions — always visible at bottom */}
              {selected && (
                <div className="tm-actions">
                  <button className="tm-delete-btn" onClick={this._delete}>🗑 Delete</button>
                  <button className={`tm-save-btn${saved ? ' tm-save-btn-ok' : ''}`} onClick={this._save}>
                    {saved ? '✓ Saved' : '💾 Save'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Resize handle */}
          <div className="tm-resize-handle" onMouseDown={this._onResizeStart} />
        </div>
      </div>
    );
  }
}

const mapStateToProps = state => ({ open: state.toolbar.templateManagerOpen });
const mapDispatchToProps = { setTemplateManagerOpen };
export default connect(mapStateToProps, mapDispatchToProps)(TemplateManager);
