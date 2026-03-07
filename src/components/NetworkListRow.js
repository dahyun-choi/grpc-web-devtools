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

  formatDuration(ms) {
    if (ms == null) return '';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  formatStatusCode(code) {
    if (code == null) return '';

    const grpcStatusNames = {
      0: 'OK', 1: 'CANCELLED', 2: 'UNKNOWN', 3: 'INVALID_ARGUMENT',
      4: 'DEADLINE_EXCEEDED', 5: 'NOT_FOUND', 6: 'ALREADY_EXISTS',
      7: 'PERMISSION_DENIED', 8: 'RESOURCE_EXHAUSTED', 9: 'FAILED_PRECONDITION',
      10: 'ABORTED', 11: 'OUT_OF_RANGE', 12: 'UNIMPLEMENTED',
      13: 'INTERNAL', 14: 'UNAVAILABLE', 15: 'DATA_LOSS', 16: 'UNAUTHENTICATED'
    };

    return grpcStatusNames[code] || String(code);
  }

  render() {
    const { index, data, style, selectLogEntry, selectedIdx } = this.props;
    const { log: logArray, onContextMenu } = data;
    const log = logArray[index];
    const hasError = log.error || (log.statusCode != null && log.statusCode !== 0);
    return (
      <div
        className={`data-row ${(index + 1) % 2 === 0 ? "" : "odd"} ${index === selectedIdx ? "selected" : ""} ${hasError ? "error" : ""} ${log.isRepeat ? "repeat" : ""}`}
        style={style}
        onClick={() => selectLogEntry(index)}
        onContextMenu={(e) => { e.preventDefault(); if (onContextMenu) onContextMenu(e, log.entryId); }}
      >
        <span className="time-cell">{this.formatTime(log.timestamp)}</span>
        <span className="name-cell">
          <MethodIcon methodType={log.methodType} isRequest={!!log.request} />
          {log.endpoint}
          {log.isRepeat && <span className="repeat-icon">↩</span>}
          {log.streamCount > 0 && (
            <span className="stream-count-badge" title={`${log.streamCount} streaming messages${log.streamComplete ? ' (complete)' : ' (streaming...)'}`}>
              {log.streamCount}
            </span>
          )}
        </span>
        <span className={`code-cell ${hasError ? "error-code" : "ok-code"}`}>{this.formatStatusCode(log.statusCode)}</span>
        <span className="duration-cell">{this.formatDuration(log.duration)}</span>
      </div >
    );
  }
}

const mapStateToProps = state => ({ selectedIdx: state.network.selectedIdx });
const mapDispatchToProps = { selectLogEntry };
export default connect(mapStateToProps, mapDispatchToProps)(NetworkListRow);
