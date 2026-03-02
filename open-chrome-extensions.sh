#!/bin/bash

# Open Chrome Extensions page automatically

echo "🚀 Opening Chrome Extensions page..."
echo ""
echo "Build directory: $(pwd)/build"
echo ""

# Try to open Chrome extensions page
if command -v open &> /dev/null; then
  # macOS
  open -a "Google Chrome" "chrome://extensions"
  echo "✅ Chrome Extensions page opened!"
  echo ""
  echo "Next steps:"
  echo "1. Enable 'Developer mode' (top right)"
  echo "2. Click 'Load unpacked'"
  echo "3. Navigate to: $(pwd)/build"
  echo ""
else
  echo "Please open Chrome and navigate to: chrome://extensions"
fi
