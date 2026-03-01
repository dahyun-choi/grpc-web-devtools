// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import React, { PureComponent } from 'react';
import { connect } from 'react-redux';
import { selectLogEntry } from '../state/network';
import MethodIcon from './MethodIcon';

class NetworkListRow extends PureComponent {
  formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${ms}`;
  }

  formatStatusCode(code) {
    if (code == null) return '';
    if (code === 0) return 'OK';
    return String(code);
  }

  render() {
    const { index, data, style, selectLogEntry, selectedIdx } = this.props;
    const log = data[index];
    const hasError = log.error || (log.statusCode != null && log.statusCode !== 0);
    return (
      <div
        className={`data-row ${(index + 1) % 2 === 0 ? "" : "odd"} ${index === selectedIdx ? "selected" : ""} ${hasError ? "error" : ""} `}
        style={style}
        onClick={() => selectLogEntry(index)
        }
      >
        <span className="time-cell">{this.formatTime(log.timestamp)}</span>
        <span className="name-cell">
          <MethodIcon methodType={log.methodType} isRequest={!!log.request} />
          {log.endpoint}
        </span>
        <span className={`code-cell ${hasError ? "error-code" : "ok-code"}`}>{this.formatStatusCode(log.statusCode)}</span>
      </div >
    );
  }
}

const mapStateToProps = state => ({ selectedIdx: state.network.selectedIdx });
const mapDispatchToProps = { selectLogEntry };
export default connect(mapStateToProps, mapDispatchToProps)(NetworkListRow);
