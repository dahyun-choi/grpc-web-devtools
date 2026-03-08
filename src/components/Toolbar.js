// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import React, { Component } from 'react';
import { connect } from 'react-redux';
import { setPreserveLog, clearLogAndCache, applyGlobalSearch } from '../state/network';
import { toggleFilter, setFilterValue, setSettingsOpen, setSplitPanel, setFieldInspector, setRequestGeneratorOpen } from '../state/toolbar';
import ClearIcon from '../icons/Clear';
import FilterIcon from '../icons/Filter';
import SettingsIcon from '../icons/Settings';
import Settings from './Settings';
import './Toolbar.css';

class Toolbar extends Component {
  _renderButtons() {
    const { clearLog, toggleFilter, setSettingsOpen, toolbar: { filterIsEnabled, filterIsOpen, settingsOpen }} = this.props;
    return (
        <>
          <ToolbarButton title="Clear" onClick={() => clearLog({ force: true })} >
            <ClearIcon />
          </ToolbarButton>
          <ToolbarButton
            title="Filter"
            onClick={() => toggleFilter()}
            className={(filterIsOpen ? "open " : "") + (filterIsEnabled ? "enabled" : "")}
           >
             <FilterIcon />
           </ToolbarButton>
          <ToolbarButton
            title="Settings"
            onClick={() => setSettingsOpen(!settingsOpen)}
            className={settingsOpen ? "open" : ""}
           >
             <SettingsIcon />
           </ToolbarButton>
          <ToolbarButton
            title="Request Generator — build and send a new gRPC request from proto schema"
            onClick={() => this.props.setRequestGeneratorOpen(true)}
          >
            <span style={{ fontSize: '11px', fontWeight: '600', letterSpacing: '-0.02em' }}>Gen</span>
          </ToolbarButton>
        </>
    )
  }

  _renderFilterToolbar() {
    const { filterIsOpen, filterValue } = this.props.toolbar;
    if (filterIsOpen) {
      return (
        <div className="toolbar">
          <div className="toolbar-shadow">
            <span className="toolbar-item text">
              <input
                type="text"
                placeholder="Filter"
                value={filterValue}
                onChange={this._onFilterValueChanged}
              />
            </span>
          </div>
        </div>
      );
    }
  }

  render() {
    const { preserveLog, toolbar, setSettingsOpen } = this.props;
    const { settingsOpen } = toolbar;
    return (
      <>
        <div className="toolbar">
          <div className="toolbar-shadow">
            {this._renderButtons()}
            <ToolbarDivider />
            <span className="toolbar-item text global-search">
              <input
                type="text"
                placeholder="Global search..."
                value={toolbar.globalSearchValue}
                onChange={this._onGlobalSearchChanged}
                title="Search in all requests/responses"
              />
            </span>
            <ToolbarDivider />
            <span className="toolbar-item checkbox" title="Do not clear log on page reload / navigation">
              <input
                type="checkbox"
                id="ui-checkbox-preserve-log"
                checked={preserveLog}
                onChange={this._onPreserveLogChanged}
              />
              <label htmlFor="ui-checkbox-preserve-log">Preserve log</label>
            </span>
            <span className="toolbar-item checkbox" title="Show request and response in separate panels">
              <input
                type="checkbox"
                id="ui-checkbox-split-panel"
                checked={toolbar.splitPanel}
                onChange={this._onSplitPanelChanged}
              />
              <label htmlFor="ui-checkbox-split-panel">Split panel</label>
            </span>
            <span className="toolbar-item checkbox" title="Hover or click JSON fields to see field number, proto type, and wire type">
              <input
                type="checkbox"
                id="ui-checkbox-field-inspector"
                checked={toolbar.fieldInspector}
                onChange={this._onFieldInspectorChanged}
              />
              <label htmlFor="ui-checkbox-field-inspector">Field inspector</label>
            </span>
          </div>
        </div>
        {this._renderFilterToolbar()}
        {settingsOpen && (
          <div className="settings-modal-overlay" onClick={() => setSettingsOpen(false)}>
            <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
              <div className="settings-modal-header">
                <h2>Settings</h2>
                <button className="settings-modal-close" onClick={() => setSettingsOpen(false)}>×</button>
              </div>
              <div className="settings-modal-content">
                <Settings />
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  _onPreserveLogChanged = e => {
    const { setPreserveLog } = this.props;
    setPreserveLog(e.target.checked);
  }

  _onFilterValueChanged = e => {
    const { setFilterValue } = this.props;
    setFilterValue(e.target.value);
  }

  _onGlobalSearchChanged = e => {
    const { applyGlobalSearch } = this.props;
    applyGlobalSearch(e.target.value);
  }

  _onSplitPanelChanged = e => {
    const { setSplitPanel } = this.props;
    setSplitPanel(e.target.checked);
  }

  _onFieldInspectorChanged = e => {
    const { setFieldInspector } = this.props;
    setFieldInspector(e.target.checked);
  }
}

class ToolbarDivider extends Component {
  render() {
    return (
      <div className="toolbar-item toolbar-divider" />
    );
  }
}

class ToolbarButton extends Component {
  render() {
    const { children, className = "", ...other } = this.props;
    return (
      <button className={"toolbar-button toolbar-item " + className} {...other}>
        {children}
      </button>
    );
  }
}

const mapStateToProps = state => ({
  preserveLog: state.network.preserveLog,
  toolbar: state.toolbar,
});
const mapDispatchToProps = {
  setPreserveLog,
  clearLog: clearLogAndCache,
  toggleFilter,
  setFilterValue,
  setSettingsOpen,
  setSplitPanel,
  setFieldInspector,
  setRequestGeneratorOpen,
  applyGlobalSearch
};
export default connect(mapStateToProps, mapDispatchToProps)(Toolbar);
