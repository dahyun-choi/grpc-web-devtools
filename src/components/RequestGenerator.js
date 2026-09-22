/* global chrome */

import React, { Component } from 'react';
import ReactJson from 'react-json-view';
import JsonCodeEditor from './JsonCodeEditor';
import { connect } from 'react-redux';
import { getNetworkEntry } from '../state/networkCache';
import { setRequestGeneratorOpen } from '../state/toolbar';
import protoManager from '../utils/ProtoManager';
import './RequestGenerator.css';

const GRPC_STATUS = {
  0: 'OK', 1: 'CANCELLED', 2: 'UNKNOWN', 3: 'INVALID_ARGUMENT',
  4: 'DEADLINE_EXCEEDED', 5: 'NOT_FOUND', 6: 'ALREADY_EXISTS',
  7: 'PERMISSION_DENIED', 8: 'RESOURCE_EXHAUSTED', 9: 'FAILED_PRECONDITION',
  10: 'ABORTED', 11: 'OUT_OF_RANGE', 12: 'UNIMPLEMENTED',
  13: 'INTERNAL', 14: 'UNAVAILABLE', 15: 'DATA_LOSS', 16: 'UNAUTHENTICATED',
};

const ALLOWED_HEADERS = [
  'content-type', 'grpc-timeout', 'grpc-encoding', 'grpc-accept-encoding',
  'x-grpc-web', 'authorization', 'app-version', 'instance-id', 'service-name',
];

class RequestGenerator extends Component {
  state = {
    methods: [],
    selectedMethod: null,
    searchQuery: '',
    dropdownOpen: false,
    highlightedIndex: -1,
    url: '',
    headers: [],
    body: {},
    sending: false,
    sentRequestId: null,
    response: null,
    responseCollapsed: 2,
    responseKey: 0,
    responseCopied: false,
    position: null, // { x, y } — null means centered (default)
    size: null,     // { width, height } — null means default CSS size
    templates: [],
    collections: [],
    templatesOpen: false,
    templateFilter: '',
    saveOpen: false,
    saveName: '',
    activeTab: 'body',
    schemaNavStack: [], // [{ label, fields, isEnum, enumValues }]
    editorValue: '{}',
  };

  _dropdownRef = React.createRef();
  _templatesRef = React.createRef();
  _saveRef = React.createRef();
  _dropdownListRef = React.createRef();
  _modalRef = React.createRef();
  _responseRef = React.createRef();
  _dragOffset = { x: 0, y: 0 };
  _isDragging = false;
  _isResizing = false;
  _resizeStart = { x: 0, y: 0, w: 0, h: 0 };

  componentDidMount() {
    document.addEventListener('mousedown', this._handleOutsideClick);
    document.addEventListener('mousemove', this._onDragMove);
    document.addEventListener('mouseup', this._onDragEnd);
    this._loadTemplates();
  }

  componentWillUnmount() {
    document.removeEventListener('mousedown', this._handleOutsideClick);
    document.removeEventListener('mousemove', this._onDragMove);
    document.removeEventListener('mouseup', this._onDragEnd);
  }

  componentDidUpdate(prevProps) {
    // Modal opened — refresh method list only, preserve user's input
    if (this.props.open && !prevProps.open) {
      const allMethods = protoManager.getAllMethods();
      this.setState({ methods: this._filterToUsedMethods(allMethods) });
      this._loadTemplates();
    }

    // Watch for response matching sentRequestId
    if (this.state.sentRequestId && this.props.log !== prevProps.log) {
      const entry = this.props.log.find(e => e.requestId === this.state.sentRequestId);
      if (entry) {
        const cached = entry.entryId ? getNetworkEntry(entry.entryId) : null;
        this.setState({
          sending: false,
          sentRequestId: null,
          response: {
            data: cached?.response ?? null,
            error: entry.error ?? cached?.error ?? null,
            statusCode: entry.statusCode,
          },
        }, () => {
          this._responseRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        });
      }
    }
  }

  _handleOutsideClick = (e) => {
    if (this._dropdownRef.current && !this._dropdownRef.current.contains(e.target)) {
      this.setState({ dropdownOpen: false, highlightedIndex: -1 });
    }
    if (this._templatesRef.current && !this._templatesRef.current.contains(e.target)) {
      this.setState({ templatesOpen: false, templateFilter: '' });
    }
    if (this._saveRef.current && !this._saveRef.current.contains(e.target)) {
      this.setState({ saveOpen: false, saveName: '' });
    }
  };

  _loadTemplates = () => {
    if (chrome?.storage?.local) {
      chrome.storage.local.get(['grpc_devtools_templates_v1', 'grpc_devtools_collections_v1'], (result) => {
        this.setState({
          templates: result['grpc_devtools_templates_v1'] || [],
          collections: result['grpc_devtools_collections_v1'] || [],
        });
      });
    }
  };

  _resolveVars = (str, vars) =>
    vars.reduce((s, { key, value }) =>
      s.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value), str);

  _reorderByProto = (messageType, obj) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    const snakeToCamel = s => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
    const result = {};
    const fields = messageType.fieldsArray || Object.values(messageType.fields);
    for (const field of fields) {
      const camelName = snakeToCamel(field.name);
      if (!(camelName in obj)) continue;
      try { field.resolve(); } catch (_) {}
      const val = obj[camelName];
      if (field.resolvedType?.fields) {
        result[camelName] = field.repeated && Array.isArray(val)
          ? val.map(item => this._reorderByProto(field.resolvedType, item))
          : this._reorderByProto(field.resolvedType, val);
      } else {
        result[camelName] = val;
      }
    }
    for (const key in obj) { if (!(key in result)) result[key] = obj[key]; }
    return result;
  };

  _applyTemplate = (template) => {
    let headers = (template.headers || []).map((h, i) => ({
      id: Date.now() + i,
      key: h.key,
      value: h.value,
    }));
    let url = template.url || '';
    const matched = this.state.methods.find(m =>
      m.fullPath === template.method ||
      template.method?.endsWith(`/${m.fullPath}`) ||
      template.url?.includes(`/${m.fullPath}`)
    );

    // Reorder request body to proto declaration order at load time
    let body = template.request || {};
    try {
      if (protoManager.isReady()) {
        const typeInfo = protoManager.getMessageType(template.method);
        if (typeInfo?.requestType) {
          body = this._reorderByProto(typeInfo.requestType, body);
        }
      }
    } catch (_) {}

    // Resolve collection variables: replace {{key}} with value
    const collection = this.state.collections.find(c => c.id === template.collectionId);
    const vars = (collection?.variables || []).filter(v => v.key);
    if (vars.length) {
      url = this._resolveVars(url, vars);
      headers = headers.map(h => ({ ...h, value: this._resolveVars(h.value, vars) }));
      try {
        const bodyStr = this._resolveVars(JSON.stringify(body), vars);
        body = JSON.parse(bodyStr);
      } catch (_) {}
    }

    this.setState({
      url: url,
      headers,
      body,
      editorValue: JSON.stringify(body, null, 2),
      selectedMethod: matched || null,
      templatesOpen: false,
      templateFilter: '',
      response: null,
    });
  };

  _deleteTemplate = (templateId, e) => {
    e.stopPropagation();
    const updated = this.state.templates.filter(t => t.id !== templateId);
    this.setState({ templates: updated });
    if (chrome?.storage?.local) {
      chrome.storage.local.set({ grpc_devtools_templates_v1: updated });
    }
  };

  _saveAsTemplate = () => {
    const { selectedMethod, url, headers, editorValue, saveName, templates } = this.state;
    const name = saveName.trim();
    if (!name) return;
    let request = {};
    try { request = JSON.parse(editorValue); } catch (_) {}
    const template = {
      id: String(Date.now()),
      name,
      method: selectedMethod?.fullPath || '',
      url,
      headers: headers.map(({ key, value }) => ({ key, value })),
      request,
      savedAt: Date.now(),
    };
    const updated = [template, ...templates];
    this.setState({ templates: updated, saveOpen: false, saveName: '' });
    if (chrome?.storage?.local) {
      chrome.storage.local.set({ grpc_devtools_templates_v1: updated });
    }
  };

  _exportTemplates = () => {
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

  _importTemplates = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        const imported = Array.isArray(parsed) ? parsed : (parsed.templates || []);
        if (!imported.length) return;
        // Merge: skip duplicates by id
        const existing = this.state.templates;
        const existingIds = new Set(existing.map(t => t.id));
        const newOnes = imported.filter(t => t.id && !existingIds.has(t.id));
        const merged = [...existing, ...newOnes];
        this.setState({ templates: merged });
        if (chrome?.storage?.local) {
          chrome.storage.local.set({ grpc_devtools_templates_v1: merged });
        }
      } catch (_) {}
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  _onDragStart = (e) => {
    // Only drag on header itself, not on buttons inside it
    if (e.target.closest('button')) return;
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
      const w = Math.max(400, this._resizeStart.w + dx);
      const h = Math.max(280, this._resizeStart.h + dy);
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
    // Lock position so modal stays in place during resize
    if (!this.state.position) {
      this.setState({ position: { x: rect.left, y: rect.top } });
    }
  };

  _onKeyDown = (e) => {
    const { dropdownOpen, highlightedIndex } = this.state;
    const filtered = this._filteredMethods();

    if (!dropdownOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        this.setState({ dropdownOpen: true, searchQuery: '', highlightedIndex: 0 });
        e.preventDefault();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.min(highlightedIndex + 1, filtered.length - 1);
      this.setState({ highlightedIndex: next }, () => this._scrollHighlightedIntoView(next));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = Math.max(highlightedIndex - 1, 0);
      this.setState({ highlightedIndex: prev }, () => this._scrollHighlightedIntoView(prev));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < filtered.length) {
        this._selectMethod(filtered[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      this.setState({ dropdownOpen: false, highlightedIndex: -1 });
    }
  };

  _scrollHighlightedIntoView(index) {
    const list = this._dropdownListRef.current;
    if (!list) return;
    const item = list.children[index];
    if (item) item.scrollIntoView({ block: 'nearest' });
  };

  _close = () => this.props.setRequestGeneratorOpen(false);

  _clear = () => {
    const allMethods = protoManager.getAllMethods();
    this.setState({
      methods: this._filterToUsedMethods(allMethods),
      selectedMethod: null,
      searchQuery: '',
      dropdownOpen: false,
      highlightedIndex: -1,
      url: '',
      headers: [],
      body: {},
      editorValue: '{}',
      response: null,
    });
  };

  // ── Method selection ──────────────────────────────────────────────────────

  /** Keep only methods whose package is used on the current page.
   *  e.g. if log has "opgwv1.OpGw/Foo", show all methods under "opgwv1.*" */
  _filterToUsedMethods(allMethods) {
    const { log } = this.props;
    if (!log || log.length === 0) return allMethods;

    const usedPackages = new Set();
    log.forEach(entry => {
      if (!entry.method) return;
      try {
        const methodPath = entry.method.startsWith('http')
          ? new URL(entry.method).pathname.substring(1)
          : entry.method;
        // methodPath: "ridergwv1.RiderGw/CreateDemand" → package "ridergwv1"
        const pkg = methodPath.split('.')[0];
        if (pkg) usedPackages.add(pkg);
      } catch (e) { /* ignore */ }
    });

    if (usedPackages.size === 0) return allMethods;
    const filtered = allMethods.filter(m => usedPackages.has(m.servicePath.split('.')[0]));
    return filtered.length > 0 ? filtered : allMethods;
  }

  _filteredMethods() {
    const q = this.state.searchQuery.toLowerCase();
    if (!q) return this.state.methods;
    return this.state.methods.filter(m =>
      m.fullPath.toLowerCase().includes(q) ||
      m.methodName.toLowerCase().includes(q) ||
      m.serviceName.toLowerCase().includes(q)
    );
  }

  _selectMethod = (m) => {
    const headers = this._getHeadersForMethod(m.fullPath);
    const url = this._getUrlForMethod(m.fullPath);
    const body = protoManager.generateSkeletonForMethod(m.fullPath);
    this.setState({
      selectedMethod: m,
      searchQuery: '',
      dropdownOpen: false,
      highlightedIndex: -1,
      body,
      editorValue: JSON.stringify(body, null, 2),
      headers,
      url,
      response: null,
      schemaNavStack: [],
    });
  };

  // ── Auto-populate from raw cache ─────────────────────────────────────────

  _getHeadersForMethod(methodFullPath) {
    const rawCache = window.__GRPCWEB_DEVTOOLS_RAW_CACHE__;
    const entry = this._findBestCacheEntry(rawCache, methodFullPath);
    if (!entry?.headers) {
      return [{ id: Date.now(), key: 'content-type', value: 'application/grpc-web+proto' }];
    }
    return entry.headers
      .filter(h => {
        const n = h.name.toLowerCase();
        return ALLOWED_HEADERS.includes(n) || (n.startsWith('x-') && !n.startsWith('x-forwarded'));
      })
      .map((h, i) => ({ id: i, key: h.name, value: h.value }));
  }

  _getUrlForMethod(methodFullPath) {
    const rawCache = window.__GRPCWEB_DEVTOOLS_RAW_CACHE__;
    const entry = this._findBestCacheEntry(rawCache, methodFullPath);
    if (!entry?.url) return '';
    try {
      const u = new URL(entry.url);
      return `${u.origin}/${methodFullPath}`;
    } catch (e) {
      return '';
    }
  }

  _findBestCacheEntry(rawCache, methodFullPath) {
    if (!rawCache) return null;
    const pkg = methodFullPath.split('.')[0];
    let best = null;
    for (const entry of rawCache.values()) {
      if (!entry?.url) continue;
      const matches = entry.url.includes(`/${pkg}.`);
      if (matches && (!best || (entry.timestamp || 0) > (best.timestamp || 0))) best = entry;
    }
    if (!best) {
      for (const entry of rawCache.values()) {
        if (entry?.url && (!best || (entry.timestamp || 0) > (best.timestamp || 0))) best = entry;
      }
    }
    return best;
  }

  // ── Schema docs table ────────────────────────────────────────────────────

  _schemaDrillDown = (field) => {
    this.setState(s => ({
      schemaNavStack: [...s.schemaNavStack, {
        label: field.typeName,
        fields: field.fields || [],
        isEnum: field.kind === 'enum',
        enumValues: field.enumValues || [],
        enumComments: field.enumComments || {},
      }],
    }));
  };

  _schemaBack = () => {
    this.setState(s => ({ schemaNavStack: s.schemaNavStack.slice(0, -1) }));
  };

  _renderDocsTable = (fields) => {
    if (!fields?.length) return <div className="rg-schema-empty">No fields defined</div>;
    const hasDesc = fields.some(f => f.description);
    return (
      <table className="rg-docs-table">
        <thead>
          <tr>
            <th className="rg-docs-th-name">Field</th>
            <th className="rg-docs-th-type">Type</th>
            {hasDesc && <th className="rg-docs-th-desc">Description</th>}
          </tr>
        </thead>
        <tbody>
          {fields.map(f => {
            const drillable = f.kind === 'message' || f.kind === 'enum';
            return (
              <tr
                key={f.name}
                className={drillable ? 'rg-docs-row-drill' : ''}
                onClick={drillable ? () => this._schemaDrillDown(f) : undefined}
              >
                <td className="rg-docs-td-name">
                  <div className="rg-docs-name-inner">
                    {f.name}
                    {f.repeated && <span className="rg-docs-repeated">[ ]</span>}
                  </div>
                </td>
                <td className="rg-docs-td-type">
                  <div className="rg-docs-type-inner">
                    <span className={`rg-docs-type-${f.kind}`}>{f.typeName}</span>
                    {f.kind === 'enum' && !hasDesc && (
                      <span className="rg-docs-enum-preview">
                        {' '}{f.enumValues.slice(0, 3).join(' · ')}
                        {f.enumValues.length > 3 && ` +${f.enumValues.length - 3}`}
                      </span>
                    )}
                    {drillable && <span className="rg-docs-drill-arrow">›</span>}
                  </div>
                </td>
                {hasDesc && <td className="rg-docs-td-desc">{f.description || ''}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  _renderEnumTable = (enumValues, enumComments = {}) => {
    const hasDesc = Object.keys(enumComments).some(k => enumComments[k]);
    return (
      <div className="rg-docs-enum-wrap">
        <span className="rg-docs-enum-badge">Enum</span>
        <table className="rg-docs-table">
          <thead>
            <tr>
              <th className="rg-docs-th-name">Value</th>
              {hasDesc && <th className="rg-docs-th-desc">Description</th>}
            </tr>
          </thead>
          <tbody>
            {enumValues.map(v => (
              <tr key={v}>
                <td className="rg-docs-td-name rg-docs-enum-val">{v}</td>
                {hasDesc && <td className="rg-docs-td-desc">{enumComments[v] || ''}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  _renderSchemaTabContent = (schema) => {
    const { schemaNavStack } = this.state;
    const current = schemaNavStack[schemaNavStack.length - 1];

    return (
      <div className="rg-schema-tab">
        {schemaNavStack.length > 0 && (
          <div className="rg-docs-nav">
            <button className="rg-docs-back" onClick={this._schemaBack}>‹ Back</button>
            <div className="rg-docs-breadcrumb">
              {schemaNavStack.map((item, i) => (
                <span key={i}>
                  {i > 0 && <span className="rg-docs-sep">›</span>}
                  <span
                    className={i < schemaNavStack.length - 1 ? 'rg-docs-crumb-link' : 'rg-docs-crumb-current'}
                    onClick={i < schemaNavStack.length - 1 ? () => this.setState({ schemaNavStack: schemaNavStack.slice(0, i + 1) }) : undefined}
                  >
                    {item.label}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}
        {current ? (
          current.isEnum
            ? this._renderEnumTable(current.enumValues, current.enumComments)
            : this._renderDocsTable(current.fields)
        ) : (
          <>
            <div className="rg-schema-section-label">Request — {schema.requestTypeName}</div>
            {this._renderDocsTable(schema.fields)}
            {schema.responseTypeName && (
              <>
                <div className="rg-schema-section-label rg-schema-section-label-response">Response — {schema.responseTypeName}</div>
                {this._renderDocsTable(schema.responseFields || [])}
              </>
            )}
          </>
        )}
      </div>
    );
  };

  // ── Headers editing ───────────────────────────────────────────────────────

  _addHeader = () => {
    this.setState(s => ({
      headers: [...s.headers, { id: Date.now(), key: '', value: '' }],
    }));
  };

  _removeHeader = (id) => {
    this.setState(s => ({ headers: s.headers.filter(h => h.id !== id) }));
  };

  _updateHeader = (id, field, value) => {
    this.setState(s => ({
      headers: s.headers.map(h => h.id === id ? { ...h, [field]: value } : h),
    }));
  };

  // ── Body editing ──────────────────────────────────────────────────────────

  _onBodyEdit = (e) => this.setState({ body: e.updated_src });
  _onBodyAdd  = (e) => this.setState({ body: e.updated_src });
  _onBodyDelete = (e) => this.setState({ body: e.updated_src });

  _copyResponse = () => {
    const { response } = this.state;
    if (!response?.data) return;
    navigator.clipboard.writeText(JSON.stringify(response.data, null, 2));
    this.setState({ responseCopied: true });
    setTimeout(() => this.setState({ responseCopied: false }), 1500);
  };

  _toggleResponseCollapse = () => {
    this.setState(s => ({
      responseCollapsed: s.responseCollapsed === false ? 2 : false,
      responseKey: s.responseKey + 1,
    }));
  };

  _useExample = () => {
    const { selectedMethod } = this.state;
    if (!selectedMethod) return;

    // 1. 캡처된 실제 요청 데이터 우선 사용
    const { log } = this.props;
    if (log && log.length > 0) {
      const match = [...log].reverse().find(e => {
        if (!e.method) return false;
        try {
          const path = e.method.startsWith('http')
            ? new URL(e.method).pathname.replace(/^\//, '')
            : e.method;
          return path === selectedMethod.fullPath;
        } catch { return false; }
      });
      if (match) {
        const cached = match.entryId ? getNetworkEntry(match.entryId) : null;
        if (cached?.request) {
          this.setState({ body: cached.request, editorValue: JSON.stringify(cached.request, null, 2) });
          return;
        }
      }
    }

    // 2. proto 스키마 기반 예시 생성 (fallback)
    const body = protoManager.generateExampleForMethod(selectedMethod.fullPath);
    const finalBody = body || {};
    this.setState({ body: finalBody, editorValue: JSON.stringify(finalBody, null, 2) });
  };

  // ── CodeMirror JSON editor ────────────────────────────────────────────────

  _onEditorChange = (value) => {
    this.setState({ editorValue: value });
    try { this.setState({ body: JSON.parse(value) }); } catch (_) {}
  };

  _findSchemaField = (fields, name) => {
    if (!fields) return null;
    for (const f of fields) {
      if (f.name === name) return f;
      if (f.fields) { const r = this._findSchemaField(f.fields, name); if (r) return r; }
    }
    return null;
  };

  _analyzeJsonContext = (before) => {
    // Stack frame: { type: 'object'|'array', key: string|null }
    // object → key = active field name (null while expecting next key)
    // array  → key = owner field name (for repeated enum completions)
    const stack = [];
    let i = 0;

    while (i < before.length) {
      const ch = before[i];
      if (ch === '{') {
        stack.push({ type: 'object', key: null }); i++;
      } else if (ch === '}') {
        stack.pop(); i++;
      } else if (ch === '[') {
        const ownerKey = stack.length > 0 && stack[stack.length - 1].type === 'object'
          ? stack[stack.length - 1].key : null;
        stack.push({ type: 'array', key: ownerKey }); i++;
      } else if (ch === ']') {
        stack.pop(); i++;
      } else if (ch === ',') {
        if (stack.length > 0 && stack[stack.length - 1].type === 'object')
          stack[stack.length - 1].key = null;
        i++;
      } else if (ch === '"') {
        i++;
        let s = '';
        while (i < before.length && before[i] !== '"') {
          if (before[i] === '\\') i++;
          if (i < before.length) { s += before[i]; i++; }
        }
        if (i >= before.length) {
          if (!stack.length) return null;
          const frame = stack[stack.length - 1];
          if (frame.type === 'array') {
            return { mode: 'value', fieldName: frame.key, partial: s };
          }
          if (frame.key === null) {
            const path = stack.slice(0, -1).map(f => f.key).filter(Boolean);
            return { mode: 'key', path, partial: s };
          }
          return { mode: 'value', fieldName: frame.key, partial: s };
        }
        i++; // skip closing "
        let j = i;
        while (j < before.length && /[\s]/.test(before[j])) j++;
        if (before[j] === ':' && stack.length > 0 && stack[stack.length - 1].type === 'object') {
          stack[stack.length - 1].key = s;
          i = j + 1;
        }
      } else {
        i++;
      }
    }
    return null;
  };

  _getCompletions = (before) => {
    const { selectedMethod } = this.state;
    if (!selectedMethod) return null;
    const schema = protoManager.getSchemaForMethod(selectedMethod.fullPath);
    if (!schema) return null;

    const ctx = this._analyzeJsonContext(before);
    if (!ctx) return null;

    if (ctx.mode === 'value') {
      const field = this._findSchemaField(schema.fields, ctx.fieldName);
      if (!field) return null;
      let candidates = null;
      if (field.kind === 'enum') candidates = field.enumValues;
      else if (field.typeName === 'bool') candidates = ['true', 'false'];
      if (!candidates?.length) return null;
      const filtered = ctx.partial
        ? candidates.filter(s => s.toLowerCase().startsWith(ctx.partial.toLowerCase()))
        : candidates;
      if (!filtered.length) return null;
      return { options: filtered, partial: ctx.partial };
    }

    return null;
  };

  // ── Send ──────────────────────────────────────────────────────────────────

  _sendRequest = () => {
    const { selectedMethod, url, headers, body } = this.state;
    if (!selectedMethod || !url) return;

    // Encode body to protobuf binary
    const encoded = protoManager.encodeMessage(selectedMethod.fullPath, body);
    if (!encoded) {
      this.setState({ response: { data: null, error: { message: 'Failed to encode request body. Check proto schema.' }, statusCode: null } });
      return;
    }

    const framed = protoManager.buildGrpcWebFrame(encoded);
    let binary = '';
    for (let i = 0; i < framed.length; i++) binary += String.fromCharCode(framed[i]);
    const bodyBase64 = btoa(binary);

    const headersObj = {};
    headers.forEach(h => { if (h.key) headersObj[h.key] = h.value; });

    const requestId = Math.floor(Math.random() * 1000000);
    this.setState({ sending: true, sentRequestId: requestId, response: null });

    const code = `
(function() {
  const url = ${JSON.stringify(url)};
  const bodyBase64 = ${JSON.stringify(bodyBase64)};
  const headers = ${JSON.stringify(headersObj)};
  const grpcMethod = ${JSON.stringify(url)};
  const requestBody = ${JSON.stringify(body)};
  const requestId = ${requestId};

  const binaryString = atob(bodyBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);

  const __start = Date.now();
  fetch(url, { method: 'POST', headers: headers, body: bytes, credentials: 'omit', mode: 'cors' })
    .then(response => response.arrayBuffer().then(buf => {
      const __duration = Date.now() - __start;
      const rb = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < rb.byteLength; i++) bin += String.fromCharCode(rb[i]);
      window.postMessage({
        type: '__GRPCWEB_DEVTOOLS__',
        method: grpcMethod,
        methodType: 'unary',
        requestId: requestId,
        request: requestBody,
        responseBodyBase64: btoa(bin),
        duration: __duration,
        isGenerated: true,
      }, '*');
    }))
    .catch(err => {
      const __duration = Date.now() - __start;
      window.postMessage({
        type: '__GRPCWEB_DEVTOOLS__',
        method: grpcMethod,
        methodType: 'unary',
        requestId: requestId,
        request: requestBody,
        error: { code: -1, message: err.message },
        duration: __duration,
        isGenerated: true,
      }, '*');
    });
})();
`;

    chrome.devtools.inspectedWindow.eval(code, (_result, exception) => {
      if (exception) {
        this.setState({
          sending: false,
          sentRequestId: null,
          response: { data: null, error: { message: exception.value || 'Eval error' }, statusCode: null },
        });
      }
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────

  render() {
    if (!this.props.open) return null;
    const { selectedMethod, searchQuery, dropdownOpen, url, headers, body, sending, response, responseCollapsed, responseKey, responseCopied, position, size, templates, templatesOpen, templateFilter, saveOpen, saveName, activeTab, editorValue } = this.state;
    const filtered = this._filteredMethods();
    const ready = protoManager.isReady();
    const schema = ready && selectedMethod ? protoManager.getSchemaForMethod(selectedMethod.fullPath) : null;
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = isDark ? 'twilight' : 'rjv-default';

    const modalStyle = {};
    if (selectedMethod && !size) modalStyle.minHeight = '480px';
    if (position) {
      modalStyle.position = 'fixed';
      modalStyle.left = position.x;
      modalStyle.top = position.y;
      modalStyle.margin = 0;
      modalStyle.maxHeight = 'none';
    }
    if (size) {
      modalStyle.width = size.width;
      if (position) modalStyle.height = size.height;
    }

    return (
      <div className="rg-overlay">
        <div className="rg-modal" ref={this._modalRef} style={modalStyle} onClick={e => e.stopPropagation()}>

          {/* Header — drag handle */}
          <div className="rg-header" onMouseDown={this._onDragStart}>
            <span className="rg-title">Request Generator</span>
            <div className="rg-header-actions">
              <div className="rg-templates-wrap" ref={this._templatesRef}>
                <button
                  className={`rg-clear-btn${templatesOpen ? ' rg-btn-active' : ''}`}
                  onClick={() => this.setState(s => ({ templatesOpen: !s.templatesOpen, templateFilter: '' }))}
                  title="Load from saved templates"
                >
                  Templates{templates.length > 0 ? ` (${templates.length})` : ''}
                </button>
                {templatesOpen && (
                  <div className="rg-templates-panel">
                    <div className="rg-templates-search-row">
                      <input
                        className="rg-templates-search"
                        placeholder="Filter templates..."
                        value={templateFilter}
                        onChange={e => this.setState({ templateFilter: e.target.value })}
                        autoFocus
                      />

                    </div>
                    {templates.length === 0 ? (
                      <div className="rg-templates-empty">
                        No saved templates yet.<br />
                        Right-click any request → "💾 Save as Template"
                      </div>
                    ) : (
                      <div className="rg-templates-list">
                        {templates
                          .filter(t => !templateFilter || t.name.toLowerCase().includes(templateFilter.toLowerCase()) || (t.method || '').toLowerCase().includes(templateFilter.toLowerCase()))
                          .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
                          .map(t => (
                            <div key={t.id} className="rg-template-item" onClick={() => this._applyTemplate(t)}>
                              <span className="rg-template-name">{t.name}</span>
                              <span className="rg-template-method">{t.method}</span>
                              <button className="rg-template-del" onClick={(e) => this._deleteTemplate(t.id, e)} title="Delete">×</button>
                            </div>
                          ))
                        }
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="rg-save-wrap" ref={this._saveRef}>
                <button
                  className={`rg-clear-btn${saveOpen ? ' rg-btn-active' : ''}`}
                  onClick={() => this.setState(s => ({ saveOpen: !s.saveOpen, saveName: s.selectedMethod?.fullPath ? (s.saveName || s.selectedMethod.fullPath.split('/').pop()) : s.saveName }))}
                  title="Save current request as template"
                  disabled={!selectedMethod}
                >
                  Save
                </button>
                {saveOpen && (
                  <div className="rg-save-panel">
                    <div className="rg-save-label">Save as Template</div>
                    <input
                      className="rg-save-input"
                      placeholder="Template name..."
                      value={saveName}
                      onChange={e => this.setState({ saveName: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Enter') this._saveAsTemplate(); if (e.key === 'Escape') this.setState({ saveOpen: false, saveName: '' }); }}
                      autoFocus
                    />
                    <div className="rg-save-actions">
                      <button className="rg-save-cancel" onClick={() => this.setState({ saveOpen: false, saveName: '' })}>Cancel</button>
                      <button className="rg-save-confirm" onClick={this._saveAsTemplate} disabled={!saveName.trim()}>Save</button>
                    </div>
                  </div>
                )}
              </div>
              <button className="rg-clear-btn" onClick={this._clear} title="Clear all fields">Clear</button>
              <button className="rg-close" onClick={this._close}>✕</button>
            </div>
          </div>

          {!ready && (
            <div className="rg-content">
              <div className="rg-no-proto">
                Upload proto files in Settings to use Request Generator.
              </div>
            </div>
          )}

          {ready && (
            <>
              {/* Fixed top: Method + URL */}
              <div className="rg-pane-top">
                <div className="rg-pane-row">
                  <div className="rg-method-wrap" ref={this._dropdownRef}>
                    <input
                      className="rg-method-input"
                      type="text"
                      placeholder="Search methods..."
                      value={dropdownOpen ? searchQuery : (selectedMethod?.fullPath ?? '')}
                      onFocus={() => this.setState({ dropdownOpen: true, searchQuery: '', highlightedIndex: -1 })}
                      onChange={e => this.setState({ searchQuery: e.target.value, dropdownOpen: true, highlightedIndex: 0 })}
                      onKeyDown={this._onKeyDown}
                      readOnly={!dropdownOpen}
                    />
                    {dropdownOpen && (
                      <div className="rg-dropdown" ref={this._dropdownListRef}>
                        {filtered.length === 0
                          ? <div className="rg-dropdown-empty">No methods found</div>
                          : filtered.map((m, i) => (
                            <div
                              key={m.fullPath}
                              className={`rg-dropdown-item${selectedMethod?.fullPath === m.fullPath ? ' selected' : ''}${this.state.highlightedIndex === i ? ' highlighted' : ''}`}
                              onMouseDown={() => this._selectMethod(m)}
                              onMouseEnter={() => this.setState({ highlightedIndex: i })}
                            >
                              <span className="rg-dp-service">{m.serviceName}</span>
                              <span className="rg-dp-sep"> / </span>
                              <span className="rg-dp-method">{m.methodName}</span>
                            </div>
                          ))
                        }
                      </div>
                    )}
                  </div>
                </div>
                <div className="rg-pane-row rg-url-row">
                  <input
                    className="rg-url-input"
                    type="text"
                    value={url}
                    onChange={e => this.setState({ url: e.target.value })}
                    placeholder="https://your-api.example.com:443/package.Service/Method"
                  />
                  <button
                    className="rg-send-btn"
                    onClick={this._sendRequest}
                    disabled={sending || !selectedMethod || !url}
                  >
                    {sending ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </div>

              {/* Tab bar */}
              <div className="rg-tab-bar">
                <button className={`rg-tab${activeTab === 'body' ? ' active' : ''}`} onClick={() => this.setState({ activeTab: 'body' })}>Body</button>
                <button className={`rg-tab${activeTab === 'headers' ? ' active' : ''}`} onClick={() => this.setState({ activeTab: 'headers' })}>
                  Headers{headers.length > 0 ? ` (${headers.length})` : ''}
                </button>
                {schema && (
                  <button className={`rg-tab${activeTab === 'schema' ? ' active' : ''}`} onClick={() => this.setState({ activeTab: 'schema' })}>Schema</button>
                )}
                <div className="rg-tab-spacer" />
                {activeTab === 'body' && (
                  <button className="rg-tab-action-btn" onClick={this._useExample} disabled={!selectedMethod}>Use Example</button>
                )}
                {activeTab === 'headers' && (
                  <button className="rg-tab-action-btn" onClick={this._addHeader}>+ Add</button>
                )}
              </div>

              {/* Scrollable content */}
              <div className="rg-content">
                {/* Body tab */}
                {activeTab === 'body' && (
                  <div className="rg-cm-wrap">
                    <JsonCodeEditor
                      value={editorValue}
                      onChange={this._onEditorChange}
                      getCompletions={this._getCompletions}
                      isDark={isDark}
                    />
                  </div>
                )}

                {/* Headers tab */}
                {activeTab === 'headers' && (
                  <div className="rg-headers-list">
                    {headers.length === 0 && (
                      <div className="rg-tab-empty">No headers. Click "+ Add" to add one.</div>
                    )}
                    {headers.map(h => (
                      <div key={h.id} className="rg-header-row">
                        <input className="rg-hkey" value={h.key} onChange={e => this._updateHeader(h.id, 'key', e.target.value)} placeholder="Header name" />
                        <input className="rg-hval" value={h.value} onChange={e => this._updateHeader(h.id, 'value', e.target.value)} placeholder="Value" />
                        <button className="rg-hdel" onClick={() => this._removeHeader(h.id)}>×</button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Schema tab */}
                {activeTab === 'schema' && schema && this._renderSchemaTabContent(schema)}

                {/* Response */}
                {response && (
                  <div className="rg-response-section" ref={this._responseRef}>
                    <div className="rg-response-header">
                      <div className={`rg-status ${response.error ? 'error' : 'ok'}`}>
                        {response.statusCode !== null && response.statusCode !== undefined
                          ? `${GRPC_STATUS[response.statusCode] ?? response.statusCode} (${response.statusCode})`
                          : response.error ? 'Error' : 'OK'
                        }
                        {response.error?.message && (
                          <span className="rg-err-msg"> — {response.error.message}</span>
                        )}
                      </div>
                      {response.data && (
                        <div className="rg-response-actions">
                          <button className="rg-resp-btn" onClick={this._toggleResponseCollapse} data-tooltip={responseCollapsed === false ? 'Collapse all' : 'Expand all'}>
                            {responseCollapsed === false ? '⊟' : '⊞'}
                          </button>
                          <button className={`rg-resp-btn${responseCopied ? ' copied' : ''}`} onClick={this._copyResponse} data-tooltip={responseCopied ? 'Copied!' : 'Copy JSON'}>
                            {responseCopied ? '✓' : '⎘'}
                          </button>
                        </div>
                      )}
                    </div>
                    {response.data && (
                      <div className="rg-response-body">
                        <ReactJson key={responseKey} src={response.data} name={null} theme={theme} iconStyle="square" displayDataTypes={false} displayObjectSize={false} enableClipboard={false} collapsed={responseCollapsed} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Resize handle */}
          <div className="rg-resize-handle" onMouseDown={this._onResizeStart} />
        </div>
      </div>
    );
  }
}

const mapStateToProps = state => ({
  open: state.toolbar.requestGeneratorOpen,
  log: state.network.log,
});
const mapDispatchToProps = { setRequestGeneratorOpen };
export default connect(mapStateToProps, mapDispatchToProps)(RequestGenerator);
