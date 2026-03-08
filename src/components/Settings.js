// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import React, { Component } from 'react';
import protoManager from '../utils/ProtoManager';
import './Settings.css';

// ── File tree ─────────────────────────────────────────────────────────────────

function buildFileTree(files) {
  const root = {};
  for (const filePath of files) {
    const parts = filePath.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node[parts[i]]) node[parts[i]] = {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = null;
  }
  return root;
}

function sorted(node) {
  return Object.entries(node).sort(([ak, av], [bk, bv]) => {
    if ((av !== null) !== (bv !== null)) return av !== null ? -1 : 1;
    return ak.localeCompare(bk);
  });
}

function FileTreeNode({ name, node }) {
  if (node === null) {
    return <div className="pt-file">{name}</div>;
  }
  return (
    <details className="pt-dir" open>
      <summary className="pt-dir-summary">{name}</summary>
      <div className="pt-children">
        {sorted(node).map(([n, c]) => <FileTreeNode key={n} name={n} node={c} />)}
      </div>
    </details>
  );
}

function FileTree({ files }) {
  const tree = buildFileTree(files);
  return (
    <div className="pt-root">
      {sorted(tree).map(([name, node]) => <FileTreeNode key={name} name={name} node={node} />)}
    </div>
  );
}

class Settings extends Component {
  state = {
    protoStatus: {
      ready: false,
      fileCount: 0,
      files: [],
      importPath: '',
    },
    uploading: false,
    uploadError: null,
    uploadSuccess: null,
  };

  componentDidMount() {
    this.updateProtoStatus();
  }

  updateProtoStatus = () => {
    const status = protoManager.getStatus();
    this.setState({ protoStatus: status });
  };

  handleProtoUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    this.setState({ uploading: true, uploadError: null, uploadSuccess: null });

    try {
      console.log('[Settings] Starting proto upload with', files.length, 'files');

      // Add timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Upload timeout after 30 seconds. Check browser console for details.')), 30000);
      });

      const loadPromise = protoManager.loadProtoFiles(files);

      const count = await Promise.race([loadPromise, timeoutPromise]);

      console.log('[Settings] Loaded', count, 'proto files');
      this.updateProtoStatus();

      // Proto hot reload: re-decode all existing entries with the new schema
      const redecodedCount = window.__GRPCWEB_DEVTOOLS_REDECODE_ALL__?.() ?? 0;

      this.setState({
        uploading: false,
        uploadSuccess: `Successfully loaded ${count} proto file(s)${redecodedCount > 0 ? ` · Re-decoded ${redecodedCount} existing response(s)` : ''}`,
      });

      // Clear success message after 3 seconds
      setTimeout(() => {
        this.setState({ uploadSuccess: null });
      }, 3000);
    } catch (error) {
      console.error('[Settings] Failed to load proto files:', error);
      this.setState({
        uploading: false,
        uploadError: error.message || 'Failed to load proto files. Check browser console (F12) for details.',
      });
    }

    // Reset input
    if (e.target) {
      e.target.value = '';
    }
  };

  handleClearProtos = async () => {
    if (!window.confirm('Clear all loaded proto files?')) {
      return;
    }

    await protoManager.clearStorage();
    this.updateProtoStatus();
  };

  render() {
    const { protoStatus, uploading, uploadError, uploadSuccess } = this.state;

    return (
      <div className="settings-container">
        <div className="settings-section">
          <h3>Proto Files</h3>
          <p className="settings-description">
            Upload your .proto files to enable Edit & Repeat with actual protobuf encoding.
            You can upload a directory containing all your proto files.
          </p>

          <div className="settings-status">
            <div className={`status-indicator ${protoStatus.ready ? 'ready' : 'not-ready'}`}>
              {protoStatus.ready ? '✓' : '○'}
            </div>
            <div className="status-text">
              {protoStatus.ready
                ? `${protoStatus.fileCount} proto file(s) loaded`
                : 'No proto files loaded'}
            </div>
          </div>

          {uploadError && (
            <div className="settings-error">
              Error: {uploadError}
            </div>
          )}

          {uploadSuccess && (
            <div className="settings-success">
              {uploadSuccess}
            </div>
          )}

          {protoStatus.fileCount > 0 && (
            <div className="settings-file-list">
              <details open>
                <summary>Loaded files ({protoStatus.fileCount})</summary>
                <FileTree files={protoStatus.files} />
              </details>
            </div>
          )}

          <div className="settings-actions">
            <label className="settings-upload-button">
              {uploading ? 'Uploading...' : 'Upload Proto Directory'}
              <input
                type="file"
                multiple
                webkitdirectory="true"
                directory="true"
                onChange={this.handleProtoUpload}
                disabled={uploading}
                style={{ display: 'none' }}
              />
            </label>

            {protoStatus.ready && (
              <button
                className="settings-clear-button"
                onClick={this.handleClearProtos}
                disabled={uploading}
              >
                Clear Proto Files
              </button>
            )}
          </div>

          <div className="settings-note">
            <strong>Note:</strong> Proto files are cached in browser storage. You only need to upload them once.
            {protoStatus.importPath && (
              <span> grpcurl <code>-import-path</code> is auto-detected as <code>{protoStatus.importPath}</code>.</span>
            )}
          </div>
        </div>
      </div>
    );
  }
}

export default Settings;
