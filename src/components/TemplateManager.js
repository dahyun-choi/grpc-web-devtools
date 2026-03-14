/* global chrome */

import React, { Component } from 'react';
import ReactDOM from 'react-dom';
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

    selectedCollectionId: null,  // when set, show variables panel
    editVariables: [],           // local edit state for collection variables
    variablesSaved: false,

    editCollectionId: null,
    editCollectionName: '',
    editTemplateNameId: null,
    editTemplateNameValue: '',
    editTemplateCollectionId: null,
    headersCollapsed: false,
    varSuggest: null,          // { field, idx, filter, rect, bodyEl? }
    varSuggestHighlight: -1,   // highlighted index in dropdown
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
    document.addEventListener('dragend', this._onTemplateDragEnd);
    // capture=true: intercept keydown before react-json-view's textarea handles it
    document.addEventListener('keydown', this._onDocKeyDown, true);
  }

  componentWillUnmount() {
    document.removeEventListener('mousemove', this._onDragMove);
    document.removeEventListener('mouseup', this._onDragEnd);
    document.removeEventListener('dragend', this._onTemplateDragEnd);
    document.removeEventListener('keydown', this._onDocKeyDown, true);
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
      selectedCollectionId: null,
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

  // ── Collection variables ──────────────────────────────────────────

  _selectCollection = (col) => {
    if (this._dragTemplateId) return; // ignore click during drag
    this.setState({
      selectedCollectionId: col.id,
      selectedId: null,
      editVariables: (col.variables || []).map((v, i) => ({ ...v, _key: i })),
      variablesSaved: false,
    });
  };

  _addVariable = () => {
    this.setState(s => ({
      editVariables: [...s.editVariables, { key: '', value: '', _key: Date.now() }],
    }));
  };

  _updateVariable = (idx, field, val) => {
    this.setState(s => {
      const editVariables = [...s.editVariables];
      editVariables[idx] = { ...editVariables[idx], [field]: val };
      return { editVariables };
    });
  };

  _removeVariable = (idx) => {
    this.setState(s => ({ editVariables: s.editVariables.filter((_, i) => i !== idx) }));
  };

  _saveVariables = () => {
    const { selectedCollectionId, editVariables, collections } = this.state;
    const variables = editVariables.map(({ key, value }) => ({ key, value }));
    const updated = collections.map(c =>
      c.id !== selectedCollectionId ? c : { ...c, variables }
    );
    this.setState({ collections: updated, variablesSaved: true });
    setTimeout(() => this.setState({ variablesSaved: false }), 1800);
    if (chrome?.storage?.local) {
      chrome.storage.local.set({ [COLLECTIONS_KEY]: updated });
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

  // ── Variable autocomplete ─────────────────────────────────────────

  _checkVarSuggest = (value, field, idx = null, inputEl = null) => {
    const match = value.match(/\{\{([^}]*)$/);
    if (match) {
      const rect = inputEl ? inputEl.getBoundingClientRect() : null;
      this.setState({ varSuggest: { field, idx, filter: match[1].toLowerCase(), rect, bodyEl: field === 'body' ? inputEl : null }, varSuggestHighlight: -1 });
    } else {
      this.setState(s => s.varSuggest ? { varSuggest: null, varSuggestHighlight: -1 } : null);
    }
  };

  _getFilteredVars = () => {
    const { varSuggest, collections, editTemplateCollectionId } = this.state;
    if (!varSuggest) return [];
    const col = editTemplateCollectionId ? collections.find(c => c.id === editTemplateCollectionId) : null;
    const vars = (col?.variables || []).filter(v => v.key);
    return varSuggest.filter ? vars.filter(v => v.key.toLowerCase().includes(varSuggest.filter)) : vars;
  };

  // capture-phase listener: handles arrow/enter/esc for body (react-json-view intercepts bubbling)
  _onDocKeyDown = (e) => {
    const { varSuggest, varSuggestHighlight } = this.state;
    if (!varSuggest || varSuggest.field !== 'body') return;
    const filtered = this._getFilteredVars();
    if (filtered.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault(); e.stopPropagation();
      this.setState({ varSuggestHighlight: Math.min(varSuggestHighlight + 1, filtered.length - 1) });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      this.setState({ varSuggestHighlight: Math.max(varSuggestHighlight - 1, 0) });
    } else if (e.key === 'Enter' && varSuggestHighlight >= 0) {
      e.preventDefault(); e.stopPropagation();
      this._selectVarSuggestion(filtered[varSuggestHighlight].key);
    } else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      this.setState({ varSuggest: null, varSuggestHighlight: -1 });
    }
  };

  _onVarSuggestKeyDown = (e, filteredVars) => {
    const { varSuggest, varSuggestHighlight } = this.state;
    if (!varSuggest || filteredVars.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.setState({ varSuggestHighlight: Math.min(varSuggestHighlight + 1, filteredVars.length - 1) });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.setState({ varSuggestHighlight: Math.max(varSuggestHighlight - 1, 0) });
    } else if (e.key === 'Enter' && varSuggestHighlight >= 0) {
      e.preventDefault();
      this._selectVarSuggestion(filteredVars[varSuggestHighlight].key);
    } else if (e.key === 'Escape') {
      this.setState({ varSuggest: null, varSuggestHighlight: -1 });
    }
  };

  _onBodyKeyUp = (e) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'].includes(e.key)) return;
    const el = e.target;
    if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return;
    this._checkVarSuggest(el.value, 'body', null, el);
  };

  _selectVarSuggestion = (varKey) => {
    const { varSuggest } = this.state;
    if (!varSuggest) return;
    const { field, idx } = varSuggest;
    const replace = (val) => val.replace(/\{\{([^}]*)$/, `{{${varKey}}}`);
    if (field === 'url') {
      this.setState({ editUrl: replace(this.state.editUrl), varSuggest: null, varSuggestHighlight: -1 });
    } else if (field === 'hval') {
      const editHeaders = [...this.state.editHeaders];
      editHeaders[idx] = { ...editHeaders[idx], value: replace(editHeaders[idx].value) };
      this.setState({ editHeaders, varSuggest: null, varSuggestHighlight: -1 });
    } else if (field === 'body') {
      const el = varSuggest.bodyEl;
      if (el) {
        el.focus();
        const val = el.value;
        const pos = el.selectionStart ?? val.length;
        const before = val.slice(0, pos);
        const match = before.match(/\{\{([^}]*)$/);
        if (match) {
          el.setSelectionRange(pos - match[0].length, pos);
          document.execCommand('insertText', false, `{{${varKey}}}`);
        }
      }
      this.setState({ varSuggest: null, varSuggestHighlight: -1 });
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
    try { e.dataTransfer.setData('text/plain', templateId); } catch (_) {}
    this._dragTemplateId = templateId;
  };

  _onCollectionDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  _onCollectionDrop = (colId, e) => {
    e.preventDefault();
    let templateId = this._dragTemplateId;
    if (!templateId) {
      try { templateId = e.dataTransfer.getData('text/plain'); } catch (_) {}
    }
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
    if (!templates.length && !collections.length) return;

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
      selectedCollectionId, editVariables, variablesSaved,
      editCollectionId, editCollectionName, editTemplateCollectionId,
      editTemplateNameId, editTemplateNameValue,
      editName, editUrl, editHeaders, editBody, headersCollapsed, varSuggest, varSuggestHighlight, saved, position, size,
    } = this.state;

    const selected = templates.find(t => t.id === selectedId);
    const uncategorized = templates.filter(t => !t.collectionId);

    // Variables available for autocomplete (from the template's collection)
    const currentCol = editTemplateCollectionId
      ? collections.find(c => c.id === editTemplateCollectionId)
      : null;
    const currentVars = (currentCol?.variables || []).filter(v => v.key);
    const filteredVars = varSuggest
      ? currentVars.filter(v => !varSuggest.filter || v.key.toLowerCase().includes(varSuggest.filter))
      : [];
    const theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'twilight' : 'rjv-default';

    const modalStyle = {};
    if (position) { modalStyle.position = 'fixed'; modalStyle.left = position.x; modalStyle.top = position.y; modalStyle.margin = 0; }
    if (size) { modalStyle.width = size.width; if (position) modalStyle.height = size.height; }

    return (
      <>
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
                          <span
                            className={`tm-collection-name${selectedCollectionId === col.id ? ' tm-collection-name-active' : ''}`}
                            onClick={() => this._selectCollection(col)}
                            onDoubleClick={() => this._startRenameCollection(col)}
                          >
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

            {/* Right: variables panel or template editor */}
            <div className="tm-right-panel">
              <div className="tm-editor-panel">
                {selectedCollectionId ? (() => {
                  const selCol = collections.find(c => c.id === selectedCollectionId);
                  return selCol ? (
                    <>
                      <div className="tm-vars-title">
                        Variables — <span>{selCol.name}</span>
                      </div>
                      <div className="tm-vars-hint">
                        Use <code>{'{{variable_name}}'}</code> in template fields. Variables are resolved when loading a template.
                      </div>
                      <table className="tm-vars-table">
                        <thead>
                          <tr>
                            <th className="tm-vars-th">Variable</th>
                            <th className="tm-vars-th">Value</th>
                            <th className="tm-vars-th" style={{ width: 24 }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {editVariables.map((v, i) => (
                            <tr key={v._key}>
                              <td><input className="tm-input" placeholder="variable_name" value={v.key} onChange={e => this._updateVariable(i, 'key', e.target.value)} /></td>
                              <td><input className="tm-input" placeholder="value" value={v.value} onChange={e => this._updateVariable(i, 'value', e.target.value)} /></td>
                              <td><button className="tm-header-del" onClick={() => this._removeVariable(i)}>×</button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <button className="tm-add-header" onClick={this._addVariable}>+ Add Variable</button>
                    </>
                  ) : null;
                })() : !selected ? (
                  <div className="tm-empty" style={{ margin: 'auto' }}>Select a template to edit.<br />Or click a collection name to manage variables.</div>
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
                      <div className="tm-input-var-wrap">
                        <input
                          className="tm-input"
                          value={editUrl}
                          onChange={e => { this.setState({ editUrl: e.target.value }); this._checkVarSuggest(e.target.value, 'url', null, e.target); }}
                          onKeyDown={e => this._onVarSuggestKeyDown(e, filteredVars)}
                          onBlur={() => setTimeout(() => this.setState({ varSuggest: null, varSuggestHighlight: -1 }), 150)}
                        />
                      </div>
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
                              <div className="tm-input-var-wrap" style={{ flex: 1 }}>
                                <input
                                  className="tm-input tm-header-val"
                                  placeholder="value"
                                  value={h.value}
                                  onChange={e => { this._updateHeader(i, 'value', e.target.value); this._checkVarSuggest(e.target.value, 'hval', i, e.target); }}
                                  onKeyDown={e => this._onVarSuggestKeyDown(e, filteredVars)}
                                  onBlur={() => setTimeout(() => this.setState({ varSuggest: null, varSuggestHighlight: -1 }), 150)}
                                />
                              </div>
                              <button className="tm-header-del" onClick={() => this._removeHeader(i)}>×</button>
                            </div>
                          ))}
                          <button className="tm-add-header" onClick={this._addHeader}>+ Add header</button>
                        </div>
                      )}
                    </div>
                    <div className="tm-field-row tm-body-row">
                      <label className="tm-label">Request body</label>
                      <div className="tm-body-viewer" onKeyUp={this._onBodyKeyUp} onKeyDown={e => this._onVarSuggestKeyDown(e, filteredVars)}>
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

              {(selected || selectedCollectionId) && (
                <div className="tm-actions">
                  {selected && <button className="tm-delete-btn" onClick={this._delete}>🗑 Delete</button>}
                  {selectedCollectionId && <div />}
                  <button
                    className={`tm-save-btn${(saved || variablesSaved) ? ' tm-save-btn-ok' : ''}`}
                    onClick={selectedCollectionId ? this._saveVariables : this._save}
                  >
                    {(saved || variablesSaved) ? '✓ Saved' : '💾 Save'}
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="tm-resize-handle" onMouseDown={this._onResizeStart} />
        </div>
      </div>

      {/* Variable autocomplete — portal to escape overflow clipping */}
      {varSuggest && filteredVars.length > 0 && varSuggest.rect && ReactDOM.createPortal(
        <div
          className="tm-var-suggest"
          style={{
            position: 'fixed',
            top: varSuggest.rect.bottom + 2,
            left: varSuggest.rect.left,
            width: Math.max(varSuggest.rect.width, 220),
            zIndex: 99999,
          }}
        >
          {filteredVars.map((v, i) => (
            <div
              key={v.key}
              className={`tm-var-suggest-item${i === varSuggestHighlight ? ' tm-var-suggest-item-active' : ''}`}
              onMouseDown={e => { e.preventDefault(); this._selectVarSuggestion(v.key); }}
              onMouseEnter={() => this.setState({ varSuggestHighlight: i })}
            >
              <code className="tm-var-key">{'{{' + v.key + '}}'}</code>
              <span className="tm-var-val">{v.value}</span>
            </div>
          ))}
        </div>,
        document.body
      )}
      </>
    );
  }
}

const mapStateToProps = state => ({ open: state.toolbar.templateManagerOpen });
const mapDispatchToProps = { setTemplateManagerOpen };
export default connect(mapStateToProps, mapDispatchToProps)(TemplateManager);
