/* global chrome */

import React, { Component } from 'react';
import ReactJson from 'react-json-view';
import { connect } from 'react-redux';
import { setTemplateManagerOpen } from '../state/toolbar';
import './TemplateManager.css';

const STORAGE_KEY = 'grpc_devtools_templates_v1';
const COLLECTIONS_KEY = 'grpc_devtools_collections_v1';

class TemplateManager extends Component {
  state = {
    templates: [],
    collections: [],
    selectedId: null,
    collapsedIds: new Set(),

    editCollectionId: null,
    editCollectionName: '',
    editTemplateNameId: null,
    editTemplateNameValue: '',
    editTemplateCollectionId: null,
    headersCollapsed: false,
    editName: '',
    editUrl: '',
    editHeaders: [],
    editBody: {},
    saved: false,
    position: null,
    size: null,
  };

  _dragTemplateId = null; // instance variable — always in sync unlike setState
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
    if (!chrome?.storage?.local) return;
    chrome.storage.local.get([STORAGE_KEY, COLLECTIONS_KEY], (result) => {
      const templates = result[STORAGE_KEY] || [];
      const collections = result[COLLECTIONS_KEY] || [];
      this.setState({ templates, collections }, () => {
        if (!this.state.selectedId) {
          const first = templates[0];
          if (first) this._select(first);
        }
      });
    });
  };

  _select = (t) => {
    this.setState({
      selectedId: t.id,
      editName: t.name || '',
      editUrl: t.url || '',
      editHeaders: (t.headers || []).map((h, i) => ({ ...h, _key: i })),
      editBody: t.request || {},
      editTemplateCollectionId: t.collectionId ?? null,
      saved: false,
    });
  };

  _save = () => {
    const { selectedId, editName, editUrl, editHeaders, editBody, editTemplateCollectionId, templates } = this.state;
    const updated = templates.map(t => t.id !== selectedId ? t : {
      ...t,
      name: editName,
      url: editUrl,
      headers: editHeaders.map(({ key, value }) => ({ key, value })),
      request: editBody,
      collectionId: editTemplateCollectionId ?? undefined,
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
      else this.setState({ editName: '', editUrl: '', editHeaders: [], editBody: {}, editTemplateCollectionId: null });
    });
    if (chrome?.storage?.local) {
      chrome.storage.local.set({ [STORAGE_KEY]: updated });
    }
  };

  // ── Collection management ─────────────────────────────────────────

  _createCollection = () => {
    const col = {
      id: `col_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: 'New Collection',
      createdAt: Date.now(),
    };
    const collections = [...this.state.collections, col];
    this.setState({ collections, editCollectionId: col.id, editCollectionName: col.name });
    if (chrome?.storage?.local) {
      chrome.storage.local.set({ [COLLECTIONS_KEY]: collections });
    }
  };

  _deleteCollection = (colId) => {
    const templates = this.state.templates.map(t =>
      t.collectionId === colId ? { ...t, collectionId: undefined } : t
    );
    const collections = this.state.collections.filter(c => c.id !== colId);
    this.setState({ templates, collections });
    if (chrome?.storage?.local) {
      chrome.storage.local.set({ [STORAGE_KEY]: templates, [COLLECTIONS_KEY]: collections });
    }
  };

  _startRenameCollection = (col) => {
    this.setState({ editCollectionId: col.id, editCollectionName: col.name });
  };

  _commitRenameCollection = () => {
    const { editCollectionId, editCollectionName, collections } = this.state;
    if (!editCollectionId) return;
    const updated = collections.map(c =>
      c.id === editCollectionId ? { ...c, name: editCollectionName.trim() || c.name } : c
    );
    this.setState({ collections: updated, editCollectionId: null, editCollectionName: '' });
    if (chrome?.storage?.local) {
      chrome.storage.local.set({ [COLLECTIONS_KEY]: updated });
    }
  };

  _startRenameTemplate = (t, e) => {
    e.stopPropagation();
    this.setState({ editTemplateNameId: t.id, editTemplateNameValue: t.name });
  };

  _commitRenameTemplate = () => {
    const { editTemplateNameId, editTemplateNameValue, templates } = this.state;
    if (!editTemplateNameId) return;
    const trimmed = editTemplateNameValue.trim();
    const updated = templates.map(t =>
      t.id !== editTemplateNameId ? t : { ...t, name: trimmed || t.name }
    );
    this.setState({ templates: updated, editTemplateNameId: null, editTemplateNameValue: '' });
    // Sync right panel name if this is the selected template
    if (this.state.selectedId === editTemplateNameId) {
      this.setState({ editName: trimmed || this.state.editName });
    }
    if (chrome?.storage?.local) {
      chrome.storage.local.set({ [STORAGE_KEY]: updated });
    }
  };

  _toggleCollapse = (id) => {
    const collapsedIds = new Set(this.state.collapsedIds);
    if (collapsedIds.has(id)) collapsedIds.delete(id);
    else collapsedIds.add(id);
    this.setState({ collapsedIds });
  };

  // ── Template drag & drop ─────────────────────────────────────────
  // Use instance variable for drag source ID (avoids setState async timing issue)

  _onTemplateDragStart = (templateId, e) => {
    e.dataTransfer.effectAllowed = 'move';
    this._dragTemplateId = templateId;
  };

  _onCollectionDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  _onCollectionDrop = (colId, e) => {
    e.preventDefault();
    const templateId = this._dragTemplateId;
    this._dragTemplateId = null;
    if (!templateId) return;
    const newCollectionId = colId === '__uncategorized__' ? undefined : colId;
    const templates = this.state.templates.map(t =>
      t.id !== templateId ? t : { ...t, collectionId: newCollectionId }
    );
    this.setState({ templates });
    if (this.state.selectedId === templateId) {
      this.setState({ editTemplateCollectionId: newCollectionId ?? null });
    }
    if (chrome?.storage?.local) {
      chrome.storage.local.set({ [STORAGE_KEY]: templates });
    }
  };

  _onTemplateDragEnd = () => {
    this._dragTemplateId = null;
  };

  // ── Header / Body editing ─────────────────────────────────────────

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

  // ── Export / Import ───────────────────────────────────────────────

  _export = () => {
    const { templates, collections } = this.state;
    if (!templates.length) return;
    const json = JSON.stringify({ version: 2, collections, templates }, null, 2);
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
        const importedCollections = Array.isArray(parsed.collections) ? parsed.collections : [];
        const { templates, collections } = this.state;

        const existingIds = new Set(templates.map(t => t.id));
        const newTemplates = imported.filter(t => t.id && !existingIds.has(t.id));

        const existingColIds = new Set(collections.map(c => c.id));
        const newCollections = importedCollections.filter(c => c.id && !existingColIds.has(c.id));

        const mergedTemplates = [...templates, ...newTemplates];
        const mergedCollections = [...collections, ...newCollections];

        this.setState({ templates: mergedTemplates, collections: mergedCollections }, () => {
          if (!this.state.selectedId && mergedTemplates[0]) this._select(mergedTemplates[0]);
        });
        if (chrome?.storage?.local) {
          chrome.storage.local.set({ [STORAGE_KEY]: mergedTemplates, [COLLECTIONS_KEY]: mergedCollections });
        }
      } catch (_) {}
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // ── Drag / Resize ─────────────────────────────────────────────────

  _onDragStart = (e) => {
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select')) return;
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

  // ── Render ────────────────────────────────────────────────────────

  render() {
    if (!this.props.open) return null;
    const {
      templates, collections, selectedId, collapsedIds,
      editCollectionId, editCollectionName, editTemplateCollectionId,
      editTemplateNameId, editTemplateNameValue,
      editName, editUrl, editHeaders, editBody, headersCollapsed, saved, position, size,
    } = this.state;

    const selected = templates.find(t => t.id === selectedId);
    const uncategorized = templates.filter(t => !t.collectionId);
    const theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'twilight' : 'rjv-default';

    const modalStyle = {};
    if (position) { modalStyle.position = 'fixed'; modalStyle.left = position.x; modalStyle.top = position.y; modalStyle.margin = 0; }
    if (size) { modalStyle.width = size.width; if (position) modalStyle.height = size.height; }

    return (
      <div className="tm-overlay">
        <div className="tm-modal" ref={this._modalRef} style={modalStyle} onClick={e => e.stopPropagation()}>

          {/* Header */}
          <div className="tm-header" onMouseDown={this._onDragStart}>
            <span className="tm-title">Template Manager</span>
            <div className="tm-header-actions">
              <button className="tm-io-btn" onClick={this._export} disabled={!templates.length} title="Export">Export</button>
              <label className="tm-io-btn" title="Import">
                Import
                <input type="file" accept=".json" style={{ display: 'none' }} onChange={this._import} />
              </label>
              <button className="tm-close" onClick={() => this.props.setTemplateManagerOpen(false)}>✕</button>
            </div>
          </div>

          <div className="tm-body">
            {/* Left: collection + template list */}
            <div className="tm-list-panel">
              <div className="tm-list-header">
                <button className="tm-new-collection-btn" onClick={this._createCollection} title="New Collection">
                  + Collection
                </button>
              </div>

              {/* Uncategorized */}
              {uncategorized.length > 0 && (
                <div
                  className="tm-collection-group"
                  onDragOver={this._onCollectionDragOver}
                  onDrop={e => this._onCollectionDrop('__uncategorized__', e)}
                >
                  <div
                    className="tm-collection-header tm-uncategorized"
                    onClick={() => this._toggleCollapse('__uncategorized__')}
                  >
                    <span className="tm-collection-chevron">{collapsedIds.has('__uncategorized__') ? '▶' : '▼'}</span>
                    <span className="tm-collection-name">Uncategorized</span>
                    <span className="tm-collection-count">({uncategorized.length})</span>
                  </div>
                  {!collapsedIds.has('__uncategorized__') && (
                    <div className="tm-collection-items">
                      {uncategorized.map(t => (
                        <div key={t.id}
                          className={`tm-list-item${t.id === selectedId ? ' tm-list-item-selected' : ''}`}
                          draggable={editTemplateNameId !== t.id}
                          onDragStart={e => this._onTemplateDragStart(t.id, e)}
                          onDragEnd={this._onTemplateDragEnd}
                          onDragOver={e => e.preventDefault()}
                          onClick={() => this._select(t)}>
                          {editTemplateNameId === t.id ? (
                            <input
                              className="tm-collection-rename-input"
                              value={editTemplateNameValue}
                              autoFocus
                              onChange={e => this.setState({ editTemplateNameValue: e.target.value })}
                              onKeyDown={e => {
                                if (e.key === 'Enter') this._commitRenameTemplate();
                                if (e.key === 'Escape') this.setState({ editTemplateNameId: null });
                              }}
                              onBlur={this._commitRenameTemplate}
                              onClick={e => e.stopPropagation()}
                            />
                          ) : (
                            <div className="tm-list-name" onDoubleClick={e => this._startRenameTemplate(t, e)}>{t.name}</div>
                          )}
                          <div className="tm-list-method">{t.method}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Collections */}
              {collections.map(col => {
                const colTemplates = templates.filter(t => t.collectionId === col.id);
                const isCollapsed = collapsedIds.has(col.id);
                const isRenaming = editCollectionId === col.id;
                return (
                  <div
                    key={col.id}
                    className="tm-collection-group"
                    onDragOver={this._onCollectionDragOver}
                    onDrop={e => this._onCollectionDrop(col.id, e)}
                  >
                    <div className="tm-collection-header">
                      <span className="tm-collection-chevron" onClick={() => this._toggleCollapse(col.id)}>
                        {isCollapsed ? '▶' : '▼'}
                      </span>
                      {isRenaming ? (
                        <input
                          className="tm-collection-rename-input"
                          value={editCollectionName}
                          autoFocus
                          onChange={e => this.setState({ editCollectionName: e.target.value })}
                          onKeyDown={e => {
                            if (e.key === 'Enter') this._commitRenameCollection();
                            if (e.key === 'Escape') this.setState({ editCollectionId: null });
                          }}
                          onBlur={this._commitRenameCollection}
                          onClick={e => e.stopPropagation()}
                        />
                      ) : (
                        <>
                          <span className="tm-collection-name" onDoubleClick={() => this._startRenameCollection(col)}>
                            {col.name}
                          </span>
                          <span className="tm-collection-count">({colTemplates.length})</span>
                          <button className="tm-collection-delete"
                            onClick={e => { e.stopPropagation(); this._deleteCollection(col.id); }}
                            title="Delete collection">×</button>
                        </>
                      )}
                    </div>
                    {!isCollapsed && (
                      <div className="tm-collection-items">
                        {colTemplates.length === 0 ? (
                          <div className="tm-collection-empty">Empty</div>
                        ) : (
                          colTemplates.map(t => (
                            <div key={t.id}
                              className={`tm-list-item tm-list-item-indented${t.id === selectedId ? ' tm-list-item-selected' : ''}`}
                              draggable={editTemplateNameId !== t.id}
                              onDragStart={e => this._onTemplateDragStart(t.id, e)}
                              onDragEnd={this._onTemplateDragEnd}
                              onDragOver={e => e.preventDefault()}
                              onClick={() => this._select(t)}>
                              {editTemplateNameId === t.id ? (
                                <input
                                  className="tm-collection-rename-input"
                                  value={editTemplateNameValue}
                                  autoFocus
                                  onChange={e => this.setState({ editTemplateNameValue: e.target.value })}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') this._commitRenameTemplate();
                                    if (e.key === 'Escape') this.setState({ editTemplateNameId: null });
                                  }}
                                  onBlur={this._commitRenameTemplate}
                                  onClick={e => e.stopPropagation()}
                                />
                              ) : (
                                <div className="tm-list-name" onDoubleClick={e => this._startRenameTemplate(t, e)}>{t.name}</div>
                              )}
                              <div className="tm-list-method">{t.method}</div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {templates.length === 0 && collections.length === 0 && (
                <div className="tm-empty">No templates saved.<br />Right-click any request → 💾 Save as Template</div>
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
                      <label className="tm-label">Collection</label>
                      <select
                        className="tm-input tm-collection-select"
                        value={editTemplateCollectionId || ''}
                        onChange={e => this.setState({ editTemplateCollectionId: e.target.value || null })}
                      >
                        <option value="">Uncategorized</option>
                        {collections.map(col => (
                          <option key={col.id} value={col.id}>{col.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="tm-field-row">
                      <label className="tm-label">URL</label>
                      <input className="tm-input" value={editUrl} onChange={e => this.setState({ editUrl: e.target.value })} />
                    </div>
                    <div className="tm-field-row">
                      <div className="tm-collapsible-label" onClick={() => this.setState(s => ({ headersCollapsed: !s.headersCollapsed }))}>
                        <span className="tm-collection-chevron">{headersCollapsed ? '▶' : '▼'}</span>
                        <label className="tm-label" style={{ cursor: 'pointer' }}>Headers</label>
                        <span className="tm-collection-count">({editHeaders.length})</span>
                      </div>
                      {!headersCollapsed && (
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
                      )}
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

          <div className="tm-resize-handle" onMouseDown={this._onResizeStart} />
        </div>
      </div>
    );
  }
}

const mapStateToProps = state => ({ open: state.toolbar.templateManagerOpen });
const mapDispatchToProps = { setTemplateManagerOpen };
export default connect(mapStateToProps, mapDispatchToProps)(TemplateManager);
