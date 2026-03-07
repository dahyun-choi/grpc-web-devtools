// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import React, { Component } from 'react';
import protoManager from '../utils/ProtoManager';
import './Settings.css';

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
    importPathInput: '',
  };

  componentDidMount() {
    this.updateProtoStatus();
  }

  updateProtoStatus = () => {
    const status = protoManager.getStatus();
    this.setState({ protoStatus: status, importPathInput: status.importPath || '' });
  };

  handleImportPathChange = (e) => {
    this.setState({ importPathInput: e.target.value });
  };

  handleImportPathSave = async () => {
    const path = this.state.importPathInput.trim();
    await protoManager.setImportPath(path);
    this.updateProtoStatus();
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
      this.setState({
        uploading: false,
        uploadSuccess: `Successfully loaded ${count} proto file(s)`,
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
    const { protoStatus, uploading, uploadError, uploadSuccess, importPathInput } = this.state;

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
              <details>
                <summary>Loaded files ({protoStatus.fileCount})</summary>
                <ul>
                  {protoStatus.files.map((file, idx) => (
                    <li key={idx}>{file}</li>
                  ))}
                </ul>
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
          </div>
        </div>

        <div className="settings-section">
          <h3>grpcurl Import Path</h3>
          <p className="settings-description">
            Set the <code>-import-path</code> value used when generating grpcurl commands (right-click on a request).
            This is the root directory that contains your proto files.
          </p>
          <div className="settings-import-path-row">
            <input
              className="settings-import-path-input"
              type="text"
              placeholder="/path/to/your/proto-root"
              value={importPathInput}
              onChange={this.handleImportPathChange}
              onKeyDown={(e) => { if (e.key === 'Enter') this.handleImportPathSave(); }}
            />
            <button
              className="settings-upload-button"
              onClick={this.handleImportPathSave}
            >
              Save
            </button>
          </div>
          {protoStatus.importPath && (
            <div className="settings-success" style={{ marginTop: 6 }}>
              Saved: {protoStatus.importPath}
            </div>
          )}
        </div>
      </div>
    );
  }
}

export default Settings;
