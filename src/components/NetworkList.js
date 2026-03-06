// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import React, { Component } from 'react';
import { connect } from 'react-redux';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList as List } from 'react-window';
import NetworkListRow from './NetworkListRow';

import './NetworkList.css';

class NetworkList extends Component {
  render() {
    const { network } = this.props;
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
                    itemData={network.log}
                    overscanCount={15}
                  >
                    {NetworkListRow}
                  </List>
                )}
              </AutoSizer>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

const mapStateToProps = state => ({ network: state.network })
export default connect(mapStateToProps)(NetworkList)
