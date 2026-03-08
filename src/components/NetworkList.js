// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import React, { Component } from 'react';
import ReactDOM from 'react-dom';
import { connect } from 'react-redux';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList as List } from 'react-window';
import NetworkListRow from './NetworkListRow';
import LoadTestModal from './LoadTestModal';
import ScenarioModal from './ScenarioModal';
import { getNetworkEntry } from '../state/networkCache';
import { selectLogEntry, setPendingAction } from '../state/network';
import protoManager from '../utils/ProtoManager';

import './NetworkList.css';
import './ScenarioModal.css';

// ── grpcurl command builder ──────────────────────────────────────────────────

function buildGrpcurlCommand(summaryEntry, fullEntry) {
  let server = '<server>:<port>';
  let methodPath = summaryEntry.method || '';
  let usePlaintext = false;

  try {
    const url = new URL(summaryEntry.method);
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    server = `${url.hostname}:${port}`;
    methodPath = url.pathname;
    usePlaintext = url.protocol === 'http:';
  } catch (_) {
    // method is not a full URL — use as-is
  }

  if (methodPath.startsWith('/')) methodPath = methodPath.slice(1);

  const args = ['grpcurl'];

  const protoStatus = protoManager.getStatus();
  if (protoStatus.ready && protoStatus.files.length > 0) {
    const matchedProto = protoManager.findProtoFileForMethod(summaryEntry.method);
    if (matchedProto) {
      args.push(`-proto ${matchedProto}`);
    } else {
      const prefix = protoStatus.importPath ? protoStatus.importPath + '/' : '';
      protoStatus.files.forEach(f => {
        const protoPath = prefix && f.startsWith(prefix) ? f.slice(prefix.length) : f;
        args.push(`-proto ${protoPath}`);
      });
    }
    if (protoStatus.importPath) {
      args.push(`-import-path ${protoStatus.importPath}`);
    }
  }

  if (usePlaintext) args.push('-plaintext');

  const requestJson = JSON.stringify(fullEntry?.request ?? {}, null, 2);
  const escapedJson = requestJson.replace(/'/g, "'\\''");
  args.push(`-d '${escapedJson}'`);

  args.push(server);
  args.push(methodPath);

  return args.join(' \\\n  ');
}

// ── Schema syntax tokenizer ───────────────────────────────────────────────────

const SCALAR_TYPES = new Set([
  'string','int32','int64','uint32','uint64','sint32','sint64',
  'fixed32','fixed64','sfixed32','sfixed64','float','double','bool','bytes',
]);

function tokenizeSchemaLine(text) {
  if (!text) return [];
  if (text.startsWith('//')) return [{ text, cls: 'sst-comment' }];
  if (text === '}') return [{ text: '}', cls: 'sst-punct' }];

  let m = text.match(/^(message|enum) (\w+) (\{)$/);
  if (m) return [
    { text: m[1], cls: 'sst-kw' },
    { text: ' ', cls: '' },
    { text: m[2], cls: 'sst-decl' },
    { text: ' ', cls: '' },
    { text: '{', cls: 'sst-punct' },
  ];

  // Enum value: "  ENUM_VALUE = 0;"
  m = text.match(/^(  )([A-Z_][A-Z0-9_]*) = (\d+)(;)$/);
  if (m) return [
    { text: '  ', cls: '' },
    { text: m[2], cls: 'sst-eval' },
    { text: ' ', cls: '' },
    { text: '=', cls: 'sst-punct' },
    { text: ' ', cls: '' },
    { text: m[3], cls: 'sst-num' },
    { text: ';', cls: 'sst-punct' },
  ];

  // Field: "  (repeated )?Type name = N;"
  m = text.match(/^(  )(repeated )?(\S+) (\w+) = (\d+)(;)$/);
  if (m) {
    const tokens = [{ text: '  ', cls: '' }];
    if (m[2]) tokens.push({ text: 'repeated', cls: 'sst-kw' }, { text: ' ', cls: '' });
    tokens.push(
      { text: m[3], cls: SCALAR_TYPES.has(m[3]) ? 'sst-type-scalar' : 'sst-type-ref' },
      { text: ' ', cls: '' },
      { text: m[4], cls: 'sst-fname' },
      { text: ' ', cls: '' },
      { text: '=', cls: 'sst-punct' },
      { text: ' ', cls: '' },
      { text: m[5], cls: 'sst-num' },
      { text: ';', cls: 'sst-punct' },
    );
    return tokens;
  }

  return [{ text, cls: '' }];
}

// ── Schema line builder ───────────────────────────────────────────────────────
// Returns Array<{ text: string, enumDef?: string }>
// enumDef is set on enum-type field lines; callers can show it as a tooltip.

function buildSchemaLines(method, typeInfo) {
  if (!typeInfo) {
    return [{ text: `// No schema found\n// Proto files may not be loaded, or method not matched.\n// Method: ${method}` }];
  }

  const visited = new Set();
  const tooltipDefCache = new Map();

  function getEnumDef(enumType) {
    const key = enumType.fullName || enumType.name;
    if (!tooltipDefCache.has(key)) {
      let def = `enum ${enumType.name} {\n`;
      for (const [name, val] of Object.entries(enumType.values || {})) {
        def += `  ${name} = ${val};\n`;
      }
      def += '}';
      tooltipDefCache.set(key, def);
    }
    return tooltipDefCache.get(key);
  }

  function getMsgDef(type) {
    if (!type || !type.fields) return null;
    const key = type.fullName || type.name;
    if (!tooltipDefCache.has(key)) {
      const fields = Object.values(type.fields).sort((a, b) => a.id - b.id);
      let def = `message ${type.name} {\n`;
      for (const f of fields) {
        const rule = f.rule === 'repeated' ? 'repeated ' : '';
        def += `  ${rule}${f.type} ${f.name} = ${f.id};\n`;
      }
      def += '}';
      tooltipDefCache.set(key, def);
    }
    return tooltipDefCache.get(key);
  }

  function typeToLines(type) {
    if (!type || !type.fields) return [];
    const key = type.fullName || type.name;
    if (visited.has(key)) return [];
    visited.add(key);

    const fields = Object.values(type.fields).sort((a, b) => a.id - b.id);
    const lines = [{ text: `message ${type.name} {` }];

    for (const f of fields) {
      try { f.resolve(); } catch (_) {}
      const rule = f.rule === 'repeated' ? 'repeated ' : '';
      const prefix = `  ${rule}`;
      const suffix = ` ${f.name} = ${f.id};`;
      if (f.resolvedType && f.resolvedType.values && !f.resolvedType.fields) {
        lines.push({ prefix, typeName: f.type, suffix, tooltipDef: getEnumDef(f.resolvedType) });
      } else if (f.resolvedType && f.resolvedType.fields) {
        lines.push({ prefix, typeName: f.type, suffix, tooltipDef: getMsgDef(f.resolvedType) });
      } else {
        lines.push({ text: `${prefix}${f.type}${suffix}` });
      }
    }

    lines.push({ text: `}` });

    return lines;
  }

  let methodPath = method;
  try {
    if (method && method.startsWith('http')) methodPath = new URL(method).pathname.slice(1);
  } catch (_) {}

  return [
    { text: `// ${methodPath}` },
    { text: '' },
    { text: '// Request' },
    ...typeToLines(typeInfo.requestType),
    { text: '' },
    { text: '// Response' },
    ...typeToLines(typeInfo.responseType),
  ];
}

// ── Component ────────────────────────────────────────────────────────────────

class NetworkList extends Component {
  _grpcurlModalRef = React.createRef();
  _schemaModalRef = React.createRef();
  _mdActiveRef = null;
  _mdActivePosKey = null;
  _mdActiveSizeKey = null;
  _mdDragOffset = { x: 0, y: 0 };
  _mdIsDragging = false;
  _mdIsResizing = false;
  _mdResizeData = { x: 0, y: 0, w: 0, h: 0 };

  _mdDragStart = (ref, posKey, e) => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    const modal = ref.current;
    if (!modal) return;
    const rect = modal.getBoundingClientRect();
    this._mdActiveRef = ref;
    this._mdActivePosKey = posKey;
    this._mdDragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    this._mdIsDragging = true;
    modal.style.userSelect = 'none';
  };

  _mdResizeStart = (ref, posKey, sizeKey, e) => {
    e.preventDefault();
    e.stopPropagation();
    const modal = ref.current;
    if (!modal) return;
    const rect = modal.getBoundingClientRect();
    this._mdActiveRef = ref;
    this._mdActivePosKey = posKey;
    this._mdActiveSizeKey = sizeKey;
    this._mdResizeData = { x: e.clientX, y: e.clientY, w: rect.width, h: rect.height };
    this._mdIsResizing = true;
    modal.style.userSelect = 'none';
    if (!this.state[posKey]) {
      this.setState({ [posKey]: { x: rect.left, y: rect.top } });
    }
  };

  _mdMove = (e) => {
    if (this._mdIsResizing) {
      const modal = this._mdActiveRef?.current;
      if (!modal) return;
      const dx = e.clientX - this._mdResizeData.x;
      const dy = e.clientY - this._mdResizeData.y;
      this.setState({
        [this._mdActiveSizeKey]: {
          width: Math.max(380, this._mdResizeData.w + dx),
          height: Math.max(200, this._mdResizeData.h + dy),
        },
      });
      return;
    }
    if (!this._mdIsDragging) return;
    const modal = this._mdActiveRef?.current;
    if (!modal) return;
    const x = Math.max(0, Math.min(e.clientX - this._mdDragOffset.x, window.innerWidth - modal.offsetWidth));
    const y = Math.max(0, Math.min(e.clientY - this._mdDragOffset.y, window.innerHeight - modal.offsetHeight));
    this.setState({ [this._mdActivePosKey]: { x, y } });
  };

  _mdEnd = () => {
    const modal = this._mdActiveRef?.current;
    if (modal) modal.style.userSelect = '';
    this._mdIsDragging = false;
    this._mdIsResizing = false;
    this._mdActiveRef = null;
    this._mdActivePosKey = null;
    this._mdActiveSizeKey = null;
  };

  constructor(props) {
    super(props);
    this.state = {
      contextMenu: { visible: false, x: 0, y: 0, entryId: null },
      modal: { visible: false, command: '', copied: false },
      grpcurlPos: null, grpcurlSize: null,
      schemaPos: null, schemaSize: null,
      loadTest: { visible: false, entryId: null },
      schemaModal: { visible: false, schemaLines: [] },
      schemaTooltip: null,
      scenarioEntryIds: [],  // ordered list of entryIds in the scenario
      scenarioVisible: false,
      colWidths: { time: 100, code: 60, duration: 60 },
    };
    this.handleContextMenu = this.handleContextMenu.bind(this);
    this.hideContextMenu = this.hideContextMenu.bind(this);
    this.handleSaveAsTest = this.handleSaveAsTest.bind(this);
    this.handleOpenLoadTest = this.handleOpenLoadTest.bind(this);
    this.handleViewSchema = this.handleViewSchema.bind(this);
    this.handleRepeat = this.handleRepeat.bind(this);
    this.handleEditRepeat = this.handleEditRepeat.bind(this);
    this.handleScenarioToggle = this.handleScenarioToggle.bind(this);
    this.handleScenarioRemoveStep = this.handleScenarioRemoveStep.bind(this);
    this.handleScenarioClear = this.handleScenarioClear.bind(this);
    this.closeModal = this.closeModal.bind(this);
    this.copyCommand = this.copyCommand.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this._cachedLog = null;
    this._cachedScenarioIds = null;
    this._cachedColWidths = null;
    this._cachedItemData = null;
  }

  componentDidMount() {
    document.addEventListener('click', this.hideContextMenu);
    document.addEventListener('keydown', this.handleKeyDown);
    document.addEventListener('mousemove', this._mdMove);
    document.addEventListener('mouseup', this._mdEnd);
  }

  componentWillUnmount() {
    document.removeEventListener('click', this.hideContextMenu);
    document.removeEventListener('keydown', this.handleKeyDown);
    document.removeEventListener('mousemove', this._mdMove);
    document.removeEventListener('mouseup', this._mdEnd);
  }

  handleKeyDown(e) {
    if (e.key === 'Escape') {
      if (this.state.scenarioVisible) this.setState({ scenarioVisible: false });
      else if (this.state.schemaModal.visible) this.setState({ schemaModal: { visible: false, schemaLines: [] }, schemaTooltip: null });
      else if (this.state.loadTest.visible) this.setState({ loadTest: { visible: false, entryId: null } });
      else if (this.state.modal.visible) this.closeModal();
      else if (this.state.contextMenu.visible) this.hideContextMenu();
    }
  }

  handleContextMenu(e, entryId) {
    e.preventDefault();
    e.stopPropagation();
    this.setState({
      contextMenu: { visible: true, x: e.clientX, y: e.clientY, entryId },
    });
  }

  hideContextMenu() {
    if (this.state.contextMenu.visible) {
      this.setState(s => ({ contextMenu: { ...s.contextMenu, visible: false } }));
    }
  }

  handleSaveAsTest(e) {
    e.stopPropagation();
    const { entryId } = this.state.contextMenu;
    const fullEntry = getNetworkEntry(entryId);
    const summaryEntry = this.props.network.log.find(en => en.entryId === entryId);
    if (!summaryEntry) return;

    const command = buildGrpcurlCommand(summaryEntry, fullEntry);
    this.setState({
      contextMenu: { ...this.state.contextMenu, visible: false },
      modal: { visible: true, command, copied: false },
    });
  }

  handleOpenLoadTest(e) {
    e.stopPropagation();
    const { entryId } = this.state.contextMenu;
    this.setState({
      contextMenu: { ...this.state.contextMenu, visible: false },
      loadTest: { visible: true, entryId },
    });
  }

  handleViewSchema(e) {
    e.stopPropagation();
    const { entryId } = this.state.contextMenu;
    const summaryEntry = this.props.network.log.find(en => en.entryId === entryId);
    const method = summaryEntry ? summaryEntry.method : '';
    let schemaLines;
    try {
      const typeInfo = method ? protoManager.getMessageType(method) : null;
      schemaLines = buildSchemaLines(method, typeInfo);
    } catch (err) {
      schemaLines = [{ text: `// Error: ${err.message}` }];
    }
    this.setState({
      contextMenu: { ...this.state.contextMenu, visible: false },
      schemaModal: { visible: true, schemaLines },
    });
  }

  handleRepeat(e) {
    e.stopPropagation();
    const { entryId } = this.state.contextMenu;
    const index = this.props.network.log.findIndex(en => en.entryId === entryId);
    if (index < 0) return;
    this.props.selectLogEntry(index);
    this.props.setPendingAction({ type: 'repeat', entryId });
    this.setState({ contextMenu: { ...this.state.contextMenu, visible: false } });
  }

  handleEditRepeat(e) {
    e.stopPropagation();
    const { entryId } = this.state.contextMenu;
    const index = this.props.network.log.findIndex(en => en.entryId === entryId);
    if (index < 0) return;
    this.props.selectLogEntry(index);
    this.props.setPendingAction({ type: 'edit', entryId });
    this.setState({ contextMenu: { ...this.state.contextMenu, visible: false } });
  }

  handleScenarioToggle(e) {
    e.stopPropagation();
    const { entryId } = this.state.contextMenu;
    this.setState(s => {
      const ids = s.scenarioEntryIds;
      const newIds = ids.includes(entryId)
        ? ids.filter(id => id !== entryId)
        : [...ids, entryId];
      return { scenarioEntryIds: newIds, contextMenu: { ...s.contextMenu, visible: false } };
    });
  }

  handleScenarioRemoveStep(entryId) {
    this.setState(s => ({ scenarioEntryIds: s.scenarioEntryIds.filter(id => id !== entryId) }));
  }

  handleScenarioClear() {
    this.setState({ scenarioEntryIds: [], scenarioVisible: false });
  }

  startResize(col, e) {
    e.preventDefault();
    const startX = e.clientX;
    const { colWidths } = this.state;
    const startWidth = colWidths[col];
    const startCodeWidth = colWidths.code;

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      if (col === 'time') {
        // 오른쪽 핸들: 드래그 우 → time 커짐, name 줄어듦
        const newWidth = Math.max(40, startWidth + delta);
        this.setState(s => ({ colWidths: { ...s.colWidths, time: newWidth } }));
      } else if (col === 'code') {
        // 왼쪽 핸들(name-code 경계): 드래그 좌 → code 커짐, name 줄어듦
        const newWidth = Math.max(40, startWidth - delta);
        this.setState(s => ({ colWidths: { ...s.colWidths, code: newWidth } }));
      } else if (col === 'duration') {
        // 왼쪽 핸들(code-duration 경계): 드래그 좌 → duration 커지고 code 줄어듦
        const newDuration = Math.max(40, startWidth - delta);
        const newCode = Math.max(40, startCodeWidth + delta);
        this.setState(s => ({ colWidths: { ...s.colWidths, code: newCode, duration: newDuration } }));
      }
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  closeModal() {
    this.setState({ modal: { visible: false, command: '', copied: false } });
  }

  copyCommand() {
    const { command } = this.state.modal;
    navigator.clipboard.writeText(command).then(() => {
      this.setState({ modal: { ...this.state.modal, copied: true } });
      setTimeout(() => {
        this.setState(s => ({ modal: { ...s.modal, copied: false } }));
      }, 1500);
    }).catch(() => {
      const ta = document.querySelector('.grpcurl-command-text');
      if (ta) { ta.select(); document.execCommand('copy'); }
    });
  }

  getItemData() {
    const { log } = this.props.network;
    const { scenarioEntryIds, colWidths } = this.state;
    if (this._cachedLog !== log || this._cachedScenarioIds !== scenarioEntryIds || this._cachedColWidths !== colWidths) {
      this._cachedLog = log;
      this._cachedScenarioIds = scenarioEntryIds;
      this._cachedColWidths = colWidths;
      this._cachedItemData = { log, onContextMenu: this.handleContextMenu, scenarioEntryIds, colWidths };
    }
    return this._cachedItemData;
  }

  render() {
    const { network } = this.props;
    const { contextMenu, modal, grpcurlPos, grpcurlSize, loadTest, schemaModal, schemaPos, schemaSize, schemaTooltip, scenarioEntryIds, scenarioVisible, colWidths } = this.state;

    const grpcurlStyle = {};
    if (grpcurlPos) { grpcurlStyle.position = 'fixed'; grpcurlStyle.left = grpcurlPos.x; grpcurlStyle.top = grpcurlPos.y; grpcurlStyle.margin = 0; }
    if (grpcurlSize) { grpcurlStyle.width = grpcurlSize.width; grpcurlStyle.maxWidth = 'none'; grpcurlStyle.height = grpcurlSize.height; grpcurlStyle.maxHeight = 'none'; }

    const schemaStyle = {};
    if (schemaPos) { schemaStyle.position = 'fixed'; schemaStyle.left = schemaPos.x; schemaStyle.top = schemaPos.y; schemaStyle.margin = 0; }
    if (schemaSize) { schemaStyle.width = schemaSize.width; schemaStyle.maxWidth = 'none'; schemaStyle.height = schemaSize.height; schemaStyle.maxHeight = 'none'; }
    const inScenario = scenarioEntryIds.includes(contextMenu.entryId);

    return (
      <div className="widget vbox network-list">
        <div className="widget vbox">
          <div className="data-grid">
            <div className="header-container">
              <table className="header">
                <tbody>
                  <tr>
                    <th className="time-column" style={{ width: colWidths.time }}>
                      <div>Time</div>
                      <div className="resize-handle" onMouseDown={e => this.startResize('time', e)} />
                    </th>
                    <th><div>Name</div></th>
                    <th className="code-column" style={{ width: colWidths.code }}>
                      <div className="resize-handle resize-handle-left" onMouseDown={e => this.startResize('code', e)} />
                      <div>Code</div>
                    </th>
                    <th className="duration-column" style={{ width: colWidths.duration }}>
                      <div className="resize-handle resize-handle-left" onMouseDown={e => this.startResize('duration', e)} />
                      <div>Duration</div>
                    </th>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="data-container">
              <AutoSizer disableWidth>
                {({ height }) => (
                  <List
                    className="data"
                    itemCount={network.log.length}
                    height={height}
                    itemSize={21}
                    itemData={this.getItemData()}
                    overscanCount={15}
                  >
                    {NetworkListRow}
                  </List>
                )}
              </AutoSizer>
            </div>
          </div>

          {/* Scenario bar */}
          {scenarioEntryIds.length > 0 && (
            <div className="scenario-bar">
              <span className="scenario-bar-label">
                🎬 Scenario · <strong>{scenarioEntryIds.length}</strong> step{scenarioEntryIds.length !== 1 ? 's' : ''}
              </span>
              <button
                className="scenario-bar-btn scenario-bar-play"
                onClick={() => this.setState({ scenarioVisible: true })}
              >
                ▶ Replay
              </button>
              <button
                className="scenario-bar-btn scenario-bar-clear"
                onClick={this.handleScenarioClear}
                title="Clear scenario"
              >
                ✕
              </button>
            </div>
          )}
        </div>

        {ReactDOM.createPortal(<>
          {/* Context menu */}
          {contextMenu.visible && (
            <div
              className="grpc-context-menu"
              style={{ top: contextMenu.y, left: contextMenu.x }}
              onClick={e => e.stopPropagation()}
            >
              <button className="grpc-context-menu-item" onClick={this.handleRepeat}>
                Repeat
              </button>
              <button className="grpc-context-menu-item" onClick={this.handleEditRepeat}>
                Edit &amp; Repeat
              </button>
              <div className="grpc-context-menu-divider" />
              <button className="grpc-context-menu-item" onClick={this.handleSaveAsTest}>
                Copy as grpcurl
              </button>
              <button className="grpc-context-menu-item" onClick={this.handleOpenLoadTest}>
                Load Test
              </button>
              <button className="grpc-context-menu-item" onClick={this.handleViewSchema}>
                View Schema
              </button>
              <button className="grpc-context-menu-item" onClick={this.handleScenarioToggle}>
                {inScenario ? '🎬 Remove from Scenario' : '🎬 Add to Scenario'}
              </button>
            </div>
          )}

          {/* grpcurl command modal */}
          {modal.visible && (
            <div className="grpcurl-modal-overlay" style={{ pointerEvents: 'none' }}>
              <div className="grpcurl-modal" ref={this._grpcurlModalRef} style={{ ...grpcurlStyle, pointerEvents: 'auto' }} onClick={e => e.stopPropagation()}>
                <div className="grpcurl-modal-header" style={{ cursor: 'move' }} onMouseDown={e => this._mdDragStart(this._grpcurlModalRef, 'grpcurlPos', e)}>
                  <span className="grpcurl-modal-title">Copy as grpcurl</span>
                  <button className="grpcurl-modal-close" onClick={this.closeModal}>✕</button>
                </div>
                <textarea
                  className="grpcurl-command-text"
                  readOnly
                  value={modal.command}
                  onClick={e => e.target.select()}
                  spellCheck={false}
                />
                <div className="grpcurl-modal-footer">
                  <button
                    className={`grpcurl-copy-button${modal.copied ? ' copied' : ''}`}
                    onClick={this.copyCommand}
                  >
                    {modal.copied ? '✓ Copied!' : 'Copy to clipboard'}
                  </button>
                </div>
                <div className="grpcurl-resize-handle" onMouseDown={e => this._mdResizeStart(this._grpcurlModalRef, 'grpcurlPos', 'grpcurlSize', e)} />
              </div>
            </div>
          )}

          {/* Schema modal */}
          {schemaModal.visible && (
            <div className="grpcurl-modal-overlay" style={{ pointerEvents: 'none' }}>
              <div className="grpcurl-modal schema-modal" ref={this._schemaModalRef} style={{ ...schemaStyle, pointerEvents: 'auto' }} onClick={e => e.stopPropagation()}>
                <div className="grpcurl-modal-header" style={{ cursor: 'move' }} onMouseDown={e => this._mdDragStart(this._schemaModalRef, 'schemaPos', e)}>
                  <span className="grpcurl-modal-title">View Schema</span>
                  <button className="grpcurl-modal-close" onClick={() => this.setState({ schemaModal: { visible: false, schemaLines: [] }, schemaTooltip: null })}>✕</button>
                </div>
                <pre className="schema-content">
                  {schemaModal.schemaLines.map((line, i) => {
                    if (line.tooltipDef) {
                      const isRepeated = line.prefix.includes('repeated');
                      const sm = line.suffix.match(/^( )(\w+)( )(=)( )(\d+)(;)$/);
                      return (
                        <span key={i}>
                          {'  '}
                          {isRepeated && <><span className="sst-kw">repeated</span>{' '}</>}
                          <span
                            className="sst-type-ref schema-tooltip-field"
                            onMouseEnter={e => this.setState({ schemaTooltip: { text: line.tooltipDef, x: e.clientX + 14, y: e.clientY + 14 } })}
                            onMouseMove={e => this.setState({ schemaTooltip: { text: line.tooltipDef, x: e.clientX + 14, y: e.clientY + 14 } })}
                            onMouseLeave={() => this.setState({ schemaTooltip: null })}
                          >{line.typeName}</span>
                          {sm ? <>
                            {' '}<span className="sst-fname">{sm[2]}</span>{' '}
                            <span className="sst-punct">=</span>{' '}
                            <span className="sst-num">{sm[6]}</span><span className="sst-punct">;</span>
                          </> : line.suffix}
                          {'\n'}
                        </span>
                      );
                    }
                    const tokens = tokenizeSchemaLine(line.text || '');
                    if (!tokens.length) return '\n';
                    return (
                      <span key={i}>
                        {tokens.map((tok, j) =>
                          tok.cls ? <span key={j} className={tok.cls}>{tok.text}</span> : tok.text
                        )}
                        {'\n'}
                      </span>
                    );
                  })}
                </pre>
                <div className="grpcurl-resize-handle" onMouseDown={e => this._mdResizeStart(this._schemaModalRef, 'schemaPos', 'schemaSize', e)} />
              </div>
            </div>
          )}

          {/* Schema enum tooltip */}
          {schemaTooltip && (
            <div className="schema-enum-tooltip" style={{ top: schemaTooltip.y, left: schemaTooltip.x }}>
              <pre>{schemaTooltip.text}</pre>
            </div>
          )}

          {/* Load Test modal */}
          {loadTest.visible && (
            <LoadTestModal
              entryId={loadTest.entryId}
              log={network.log}
              onClose={() => this.setState({ loadTest: { visible: false, entryId: null } })}
            />
          )}

          {/* Scenario modal */}
          {scenarioVisible && (
            <ScenarioModal
              scenarioEntryIds={scenarioEntryIds}
              log={network.log}
              onClose={() => this.setState({ scenarioVisible: false })}
              onRemoveStep={this.handleScenarioRemoveStep}
              onClearScenario={this.handleScenarioClear}
            />
          )}
        </>, document.body)}

      </div>
    );
  }
}

const mapStateToProps = state => ({ network: state.network });
const mapDispatchToProps = { selectLogEntry, setPendingAction };
export default connect(mapStateToProps, mapDispatchToProps)(NetworkList);
