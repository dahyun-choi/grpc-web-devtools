// @ts-check
const { test, expect, chromium } = require('@playwright/test');
const { launchBrowserWithExtension } = require('./helpers/extension');

test.describe('DebuggerCapture API Test', () => {
  let context;
  let extensionId;

  test.beforeAll(async () => {
    const result = await launchBrowserWithExtension(chromium);
    context = result.context;
    extensionId = result.extensionId;
    console.log('✓ Extension loaded:', extensionId);
  });

  test.afterAll(async () => {
    if (context) {
      await context.close();
    }
  });

  test('should use chrome.debugger API to capture raw requests', async () => {
    const page = await context.newPage();

    console.log('\n=== Opening test page ===');
    await page.goto('https://qa-privacy.shucle.com:15449/drt/management/stoppoint', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    // Wait for page to fully load
    await page.waitForTimeout(3000);

    console.log('\n=== Opening DevTools Panel ===');
    const devtoolsUrl = `chrome-extension://${extensionId}/index.html`;
    const devtoolsPage = await context.newPage();

    // Collect DevTools console messages
    const devtoolsConsole = [];
    devtoolsPage.on('console', (msg) => {
      const text = msg.text();
      devtoolsConsole.push(text);
      console.log(`[DevTools] ${msg.type()}: ${text}`);
    });

    await devtoolsPage.goto(devtoolsUrl);

    // Wait for DevTools to initialize
    await devtoolsPage.waitForTimeout(2000);

    console.log('\n=== Checking DebuggerCapture Initialization ===');

    // Check if DebuggerCapture was initialized
    const hasDebuggerInit = devtoolsConsole.some(m =>
      m.includes('[Index] Initializing DebuggerCapture')
    );
    console.log('DebuggerCapture initialized:', hasDebuggerInit);

    const hasDebuggerAttached = devtoolsConsole.some(m =>
      m.includes('[DebuggerCapture] ✓ Debugger attached') ||
      m.includes('[Index] ✓ DebuggerCapture enabled')
    );
    console.log('Debugger attached:', hasDebuggerAttached);

    // Navigate to trigger new gRPC requests
    console.log('\n=== Triggering gRPC requests ===');
    await page.goto('https://qa-privacy.shucle.com:15449/drt/operation/vehicle', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    // Wait for requests to be captured
    await page.waitForTimeout(5000);

    console.log('\n=== Checking for Captured Requests ===');

    // Check for captured requests in console
    const capturedRequests = devtoolsConsole.filter(m =>
      m.includes('[DebuggerCapture] Captured gRPC request') ||
      m.includes('[DebuggerCapture] ✓ Captured raw request body')
    );

    console.log('Captured requests logs:', capturedRequests.length);
    capturedRequests.slice(0, 5).forEach(log => {
      console.log('  ', log);
    });

    // Check cache size
    const cacheUpdates = devtoolsConsole.filter(m =>
      m.includes('Cache size:')
    );

    console.log('\nCache updates:', cacheUpdates.length);
    cacheUpdates.slice(-3).forEach(log => {
      console.log('  ', log);
    });

    // Get raw cache size from DevTools page
    const rawCacheSize = await devtoolsPage.evaluate(() => {
      // Try to access the store
      if (window.store) {
        const state = window.store.getState();
        return {
          networkLogSize: state?.network?.log?.length || 0
        };
      }
      return { networkLogSize: 0 };
    });

    console.log('\n=== Test Results ===');
    console.log('Network log size:', rawCacheSize.networkLogSize);

    // Take screenshots
    await page.screenshot({
      path: 'test-results/debugger-capture-page.png',
      fullPage: true
    });
    await devtoolsPage.screenshot({
      path: 'test-results/debugger-capture-devtools.png',
      fullPage: true
    });

    console.log('✓ Screenshots saved');

    // Assertions
    if (hasDebuggerInit) {
      console.log('\n✓ DebuggerCapture was initialized');
    } else {
      console.log('\n✗ DebuggerCapture was NOT initialized');
      console.log('\nAll DevTools console messages:');
      devtoolsConsole.forEach(m => console.log('  ', m));
    }

    // We expect at least some network entries
    expect(rawCacheSize.networkLogSize, 'Should have network entries').toBeGreaterThan(0);
  });
});
