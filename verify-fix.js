#!/usr/bin/env node

/**
 * Verification script for URL-based matching fix
 */

const fs = require('fs');
const path = require('path');

console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║                                                                ║');
console.log('║      URL-based Matching Fix Verification                      ║');
console.log('║                                                                ║');
console.log('╚════════════════════════════════════════════════════════════════╝');
console.log('');

// Check build exists
const buildPath = path.join(__dirname, 'build');
if (!fs.existsSync(buildPath)) {
  console.log('❌ Build directory not found!');
  console.log('   Run: npm run build');
  process.exit(1);
}

console.log('✅ Build directory exists');

// Check manifest has debugger permission
const manifestPath = path.join(buildPath, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

if (manifest.permissions && manifest.permissions.includes('debugger')) {
  console.log('✅ Debugger permission in manifest.json');
} else {
  console.log('❌ Debugger permission missing!');
  process.exit(1);
}

// Check main bundle exists
const staticJsPath = path.join(buildPath, 'static', 'js');
const jsFiles = fs.readdirSync(staticJsPath).filter(f => f.startsWith('main.') && f.endsWith('.js'));

if (jsFiles.length === 0) {
  console.log('❌ Main bundle not found!');
  process.exit(1);
}

const mainJsPath = path.join(staticJsPath, jsFiles[0]);
const mainJsContent = fs.readFileSync(mainJsPath, 'utf8');

console.log(`✅ Main bundle exists: ${jsFiles[0]}`);

// Verify URL-based matching logic is in the bundle
const checks = [
  { name: 'URL-based lookup', pattern: 'Attempting URL-based lookup' },
  { name: 'Found by URL match', pattern: 'Found by URL match' },
  { name: 'Found by requestId', pattern: 'Found by requestId' },
  { name: 'Found by entryId', pattern: 'Found by entryId' },
  { name: 'DebuggerCapture class', pattern: 'DebuggerCapture' },
  { name: 'chrome.debugger.attach', pattern: 'debugger.attach' },
  { name: 'Network.enable', pattern: 'Network.enable' },
];

console.log('\n📋 Checking bundle contents:');
console.log('');

let allPassed = true;

checks.forEach(check => {
  const found = mainJsContent.includes(check.pattern);
  const status = found ? '✅' : '❌';
  console.log(`${status} ${check.name}`);
  if (!found) {
    allPassed = false;
  }
});

console.log('');

if (allPassed) {
  console.log('🎉 All checks passed!');
  console.log('');
  console.log('The build contains all necessary code for URL-based matching.');
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('📋 Manual Testing Steps:');
  console.log('');
  console.log('1. Open Chrome: chrome://extensions');
  console.log('2. Click "Reload" button on gRPC-Web DevTools extension');
  console.log('3. Open: https://qa-privacy.shucle.com:15449/drt/management/stoppoint');
  console.log('4. Press F12 → Click "gRPC-Web DevTools" tab');
  console.log('5. Verify yellow "automated test software" banner appears');
  console.log('6. Open Console and check logs:');
  console.log('   - [DebuggerCapture] ✓ Debugger attached');
  console.log('   - [DebuggerCapture] Captured gRPC request');
  console.log('   - [Index] ✓ Cached raw request');
  console.log('7. Click any gRPC request in the list');
  console.log('8. Click "Repeat" button');
  console.log('9. Check Console for:');
  console.log('   - [Panel] ✓ Found by URL match');
  console.log('   - [Panel] ✓ Repeating request');
  console.log('');
  console.log('Expected result: ✅ No alert, new request appears in list');
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
} else {
  console.log('⚠️  Some checks failed!');
  console.log('');
  console.log('Please rebuild the project:');
  console.log('  npm run build');
  console.log('');
  process.exit(1);
}
