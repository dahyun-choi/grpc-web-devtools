// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import React, { Component } from 'react';
import { connect } from 'react-redux';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList as List } from 'react-window';
import NetworkListRow from './NetworkListRow';
import { getNetworkEntry } from '../state/networkCache';
import protoManager from '../utils/ProtoManager';

import './NetworkList.css';

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
    protoStatus.files.forEach(f => args.push(`-proto ${f}`));
    args.push('-import-path <proto-import-dir>');
  }

  if (usePlaintext) args.push('-plaintext');

  const requestJson = JSON.stringify(fullEntry?.request ?? {}, null, 2);
  // Escape single quotes inside the JSON for shell safety
  const escapedJson = requestJson.replace(/'/g, "'\\''");
  args.push(`-d '${escapedJson}'`);

  args.push(server);
  args.push(methodPath);

  return args.join(' \\\n  ');
}

class NetworkList extends Component {
  constructor(props) {
    super(props);
    this.state = {
      contextMenu: { visible: false, x: 0, y: 0, entryId: null },
      modal: { visible: false, command: '', copied: false },
    };
    this.handleContextMenu = this.handleContextMenu.bind(this);
    this.hideContextMenu = this.hideContextMenu.bind(this);
    this.handleSaveAsTest = this.handleSaveAsTest.bind(this);
    this.closeModal = this.closeModal.bind(this);
    this.copyCommand = this.copyCommand.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    // Cache itemData to avoid unnecessary react-window re-renders
    this._cachedLog = null;
    this._cachedItemData = null;
  }

  componentDidMount() {
    document.addEventListener('click', this.hideContextMenu);
    document.addEventListener('keydown', this.handleKeyDown);
  }

  componentWillUnmount() {
    document.removeEventListener('click', this.hideContextMenu);
    document.removeEventListener('keydown', this.handleKeyDown);
  }

  handleKeyDown(e) {
    if (e.key === 'Escape') {
      if (this.state.modal.visible) this.closeModal();
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
    if (this._cachedLog !== this.props.network.log) {
      this._cachedLog = this.props.network.log;
      this._cachedItemData = { log: this._cachedLog, onContextMenu: this.handleContextMenu };
    }
    return this._cachedItemData;
  }

  render() {
    const { network } = this.props;
    const { contextMenu, modal } = this.state;

    return (
      <div className="widget vbox network-list">
        <div className="widget vbox">
          <div className="data-grid">
            <div className="header-container">
              <table className="header">
                <tbody>
                  <tr>
                    <th className="time-column">
                      <div>Time</div>
                    </th>
                    <th>
                      <div>Name</div>
                    </th>
                    <th className="code-column">
                      <div>Code</div>
                    </th>
                    <th className="duration-column">
                      <div>Time</div>
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
        </div>

        {/* Context menu */}
        {contextMenu.visible && (
          <div
            className="grpc-context-menu"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={e => e.stopPropagation()}
          >
            <button className="grpc-context-menu-item" onClick={this.handleSaveAsTest}>
              Copy as grpcurl
            </button>
          </div>
        )}

        {/* grpcurl command modal */}
        {modal.visible && (
          <div className="grpcurl-modal-overlay" onClick={this.closeModal}>
            <div className="grpcurl-modal" onClick={e => e.stopPropagation()}>
              <div className="grpcurl-modal-header">
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
            </div>
          </div>
        )}
      </div>
    );
  }
}

const mapStateToProps = state => ({ network: state.network })
export default connect(mapStateToProps)(NetworkList)
