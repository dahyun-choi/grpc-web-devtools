#!/bin/bash

# gRPC-Web DevTools - Quick Manual Test Helper
# This script helps you quickly verify the chrome.debugger API implementation

echo "======================================"
echo "gRPC-Web DevTools - Test Helper"
echo "======================================"
echo ""

# Check if build exists
if [ ! -d "build" ]; then
  echo "❌ Build directory not found!"
  echo "   Run: npm run build"
  exit 1
fi

echo "✅ Build directory found"
echo ""

# Verify debugger permission
if grep -q '"debugger"' build/manifest.json; then
  echo "✅ Debugger permission in manifest.json"
else
  echo "❌ Debugger permission missing!"
  exit 1
fi

# Verify main.js exists
if ls build/static/js/main.*.js 1> /dev/null 2>&1; then
  MAIN_JS=$(ls build/static/js/main.*.js)
  SIZE=$(du -h "$MAIN_JS" | cut -f1)
  echo "✅ Main bundle exists: $SIZE"
else
  echo "❌ Main bundle not found!"
  exit 1
fi

echo ""
echo "======================================"
echo "📋 MANUAL TEST STEPS"
echo "======================================"
echo ""
echo "1. Open Chrome and navigate to:"
echo "   chrome://extensions"
echo ""
echo "2. Enable 'Developer mode' (top right toggle)"
echo ""
echo "3. Click 'Load unpacked' and select:"
echo "   $(pwd)/build"
echo ""
echo "4. Open test page:"
echo "   https://qa-privacy.shucle.com:15449/drt/management/stoppoint"
echo ""
echo "5. Press F12 to open DevTools"
echo ""
echo "6. Click 'gRPC-Web DevTools' tab"
echo ""
echo "7. ⚠️ VERIFY YELLOW BANNER at top of browser:"
echo "   'Chrome is being controlled by automated test software'"
echo ""
echo "8. Open DevTools Console and verify logs:"
echo "   [Index] Initializing DebuggerCapture for tab: XXX"
echo "   [DebuggerCapture] ✓ Debugger attached"
echo "   [DebuggerCapture] ✓ Ready to capture requests"
echo ""
echo "9. Refresh page and check for capture logs:"
echo "   [DebuggerCapture] Captured gRPC request: ..."
echo "   [DebuggerCapture] ✓ Captured raw request body: ..."
echo "   [Index] ✓ Cached raw request for ID: ..."
echo ""
echo "10. In Console, verify cache size:"
echo "    console.log('Raw cache size:', window.rawRequestsCache?.size)"
echo ""
echo "11. Click any gRPC request in the list"
echo ""
echo "12. Click 'Repeat' button (should work without alert)"
echo ""
echo "13. Verify new request appears in network list"
echo ""
echo "======================================"
echo "📊 EXPECTED RESULTS"
echo "======================================"
echo ""
echo "✅ Yellow 'automated test software' banner visible"
echo "✅ DebuggerCapture initialization logs appear"
echo "✅ gRPC requests captured with body"
echo "✅ Raw cache size > 0"
echo "✅ Repeat button works without errors"
echo "✅ New network entries created on Repeat"
echo ""
echo "======================================"
echo "🐛 IF SOMETHING FAILS"
echo "======================================"
echo ""
echo "See detailed troubleshooting in:"
echo "  $(pwd)/MANUAL_TEST_GUIDE.md"
echo ""
echo "Common issues:"
echo "- No yellow banner: Check Console for errors"
echo "- Raw cache size 0: Refresh page to trigger requests"
echo "- Repeat fails: Check if request was captured"
echo ""
echo "======================================"
echo ""
echo "Ready to test! Follow the steps above."
echo ""
