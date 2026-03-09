// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import React, { PureComponent } from 'react';
import { connect } from 'react-redux';
import { selectLogEntry } from '../state/network';
import MethodIcon from './MethodIcon';

function highlightText(text, keyword) {
  if (!keyword || !keyword.trim() || !text) return text;
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  if (parts.length <= 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1
      ? <mark key={i} className="search-highlight-list">{part}</mark>
      : part
  );
}

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
    const { log: logArray, onContextMenu, scenarioEntryIds, colWidths = { time: 100, code: 60, duration: 60 }, globalSearchValue } = data;
    const log = logArray[index];
    const hasError = log.error || (log.statusCode != null && log.statusCode !== 0);
    const scenarioIdx = scenarioEntryIds ? scenarioEntryIds.indexOf(log.entryId) : -1;
    return (
      <div
        className={`data-row ${(index + 1) % 2 === 0 ? "" : "odd"} ${index === selectedIdx ? "selected" : ""} ${hasError ? "error" : ""} ${log.isEditRepeat ? "edit-repeat" : log.isRepeat ? "repeat" : ""} ${log.isGenerated ? "generated" : ""}`}
        style={style}
        onClick={() => selectLogEntry(index)}
        onContextMenu={(e) => { e.preventDefault(); if (onContextMenu) onContextMenu(e, log.entryId); }}
      >
        <span className="time-cell" style={{ width: colWidths.time - 5 }}>{this.formatTime(log.timestamp)}</span>
        <span className="name-cell">
          <MethodIcon methodType={log.methodType} isRequest={!!log.request} />
          {highlightText(log.endpoint, globalSearchValue)}
          {scenarioIdx >= 0 && (
            <span className="scenario-badge" title={`Scenario step ${scenarioIdx + 1}`}>{scenarioIdx + 1}</span>
          )}
          {log.isEditRepeat
            ? <span className="edit-repeat-icon">✎↩</span>
            : log.isRepeat && <span className="repeat-icon">↩</span>
          }
          {log.isGenerated && <span className="generated-icon">✦</span>}
          {log.streamCount > 0 && (
            <span className="stream-count-badge" title={`${log.streamCount} streaming messages${log.streamComplete ? ' (complete)' : ' (streaming...)'}`}>
              {log.streamCount}
            </span>
          )}
        </span>
        <span className={`code-cell ${hasError ? "error-code" : "ok-code"}`} style={{ width: colWidths.code }}>{this.formatStatusCode(log.statusCode)}</span>
        <span className="duration-cell" style={{ width: colWidths.duration - 4 }}>{this.formatDuration(log.duration)}</span>
      </div >
    );
  }
}

const mapStateToProps = state => ({ selectedIdx: state.network.selectedIdx });
const mapDispatchToProps = { selectLogEntry };
export default connect(mapStateToProps, mapDispatchToProps)(NetworkListRow);
