import React, { PureComponent } from 'react';

class Copy extends PureComponent {
  render() {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
        <rect x="4" y="4" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <path d="M2 2 L2 10 L3 10" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        <path d="M10 2 L4 2 L4 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      </svg>
    );
  }
}

export default Copy;
