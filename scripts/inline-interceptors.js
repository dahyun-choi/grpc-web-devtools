#!/usr/bin/env node

/**
 * Build script to inline grpc-web-interceptor.js and connect-web-interceptor.js
 * into content-script.js for immediate execution (no network delay).
 *
 * This solves the timing issue where other scripts (Sentry, etc.) wrap fetch/XHR
 * before our interceptor loads.
 */

const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '../public');
const buildDir = path.join(__dirname, '../build');

console.log('[Inline Interceptors] Starting build...');

// Read interceptor files
const grpcInterceptor = fs.readFileSync(
  path.join(publicDir, 'grpc-web-interceptor.js'),
  'utf8'
);

const connectInterceptor = fs.readFileSync(
  path.join(publicDir, 'connect-web-interceptor.js'),
  'utf8'
);

console.log('[Inline Interceptors] ✓ Read interceptor files');
console.log('[Inline Interceptors]   - grpc-web-interceptor.js:', grpcInterceptor.length, 'bytes');
console.log('[Inline Interceptors]   - connect-web-interceptor.js:', connectInterceptor.length, 'bytes');

// Create inline code bundle
// Wrap each interceptor in IIFE to avoid global scope pollution
const inlineCode = `
// ============================================================
// INLINE INTERCEPTORS - Bundled by scripts/inline-interceptors.js
// ============================================================

// gRPC-Web Interceptor (inline for immediate execution)
(function() {
  console.log('[Inline Build] Loading grpc-web-interceptor...');
  ${grpcInterceptor}
  console.log('[Inline Build] ✓ grpc-web-interceptor loaded');
})();

// Connect-Web Interceptor (inline for immediate execution)
(function() {
  console.log('[Inline Build] Loading connect-web-interceptor...');
  ${connectInterceptor}
  console.log('[Inline Build] ✓ connect-web-interceptor loaded');
})();

console.log('[Inline Build] All interceptors initialized');
`;

// Ensure build directory exists
if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true });
}

// Write inline bundle
const outputPath = path.join(buildDir, 'inline-interceptors.js');
fs.writeFileSync(outputPath, inlineCode);

console.log('[Inline Interceptors] ✓ Created inline bundle:', outputPath);
console.log('[Inline Interceptors] ✓ Bundle size:', inlineCode.length, 'bytes');
console.log('[Inline Interceptors] Done!');
