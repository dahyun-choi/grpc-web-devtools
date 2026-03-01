// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import React, { Component } from 'react';
import { connect } from 'react-redux';
import { setPreserveLog, clearLogAndCache, applyGlobalSearch } from '../state/network';
import { toggleFilter, setFilterValue } from '../state/toolbar';
import ClearIcon from '../icons/Clear';
import FilterIcon from '../icons/Filter';
import SettingsIcon from '../icons/Settings';
import Settings from './Settings';
import './Toolbar.css';

class Toolbar extends Component {
  state = {
    settingsOpen: false,
  };

  _renderButtons() {
    const { clearLog, toggleFilter, toolbar: { filterIsEnabled, filterIsOpen }} = this.props;
    const { settingsOpen } = this.state;
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
            onClick={() => this.setState({ settingsOpen: !settingsOpen })}
            className={settingsOpen ? "open" : ""}
           >
             <SettingsIcon />
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
    const { preserveLog, toolbar } = this.props;
    const { settingsOpen } = this.state;
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
          </div>
        </div>
        {this._renderFilterToolbar()}
        {settingsOpen && (
          <div className="settings-modal-overlay" onClick={() => this.setState({ settingsOpen: false })}>
            <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
              <div className="settings-modal-header">
                <h2>Settings</h2>
                <button className="settings-modal-close" onClick={() => this.setState({ settingsOpen: false })}>×</button>
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
  applyGlobalSearch
};
export default connect(mapStateToProps, mapDispatchToProps)(Toolbar);
