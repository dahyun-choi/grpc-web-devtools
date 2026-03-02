// @ts-check
const { test, expect, chromium } = require('@playwright/test');
const { launchBrowserWithExtension } = require('./helpers/extension');

test.describe('URL-based Matching Test', () => {
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

  test('should capture requests and match by URL for Repeat', async () => {
    const page = await context.newPage();

    console.log('\n=== Opening test page ===');
    await page.goto('https://qa-privacy.shucle.com:15449/drt/management/stoppoint', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    // Wait for initial load
    await page.waitForTimeout(3000);

    console.log('\n=== Opening DevTools Panel (as separate page) ===');
    const devtoolsUrl = `chrome-extension://${extensionId}/index.html`;
    const devtoolsPage = await context.newPage();

    // Collect console messages
    const consoleMessages = [];
    devtoolsPage.on('console', (msg) => {
      const text = msg.text();
      consoleMessages.push(text);
      console.log(`[DevTools Console] ${msg.type()}: ${text}`);
    });

    await devtoolsPage.goto(devtoolsUrl);
    await devtoolsPage.waitForTimeout(2000);

    console.log('\n=== Checking DebuggerCapture initialization ===');
    const hasDebuggerInit = consoleMessages.some(m =>
      m.includes('[Index] Initializing DebuggerCapture') ||
      m.includes('[DebuggerCapture] ✓ Debugger attached')
    );
    console.log('DebuggerCapture initialized:', hasDebuggerInit);

    console.log('\n=== Triggering gRPC requests ===');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);

    console.log('\n=== Checking captured requests ===');
    const capturedLogs = consoleMessages.filter(m =>
      m.includes('[DebuggerCapture] Captured gRPC request') ||
      m.includes('[Index] ✓ Cached raw request')
    );
    console.log('Captured request logs:', capturedLogs.length);
    capturedLogs.slice(0, 3).forEach(log => console.log('  ', log));

    console.log('\n=== Checking raw cache ===');
    const cacheInfo = await devtoolsPage.evaluate(() => {
      const rawCache = window.__GRPCWEB_DEVTOOLS_RAW_CACHE__;
      const store = window.store;

      if (!rawCache || !store) {
        return {
          error: 'Cache or store not available',
          rawCacheExists: !!rawCache,
          storeExists: !!store
        };
      }

      const state = store.getState();
      const cacheEntries = Array.from(rawCache.entries()).map(([key, value]) => ({
        key,
        keyType: typeof key,
        url: value.url,
        hasBody: !!value.body
      }));

      return {
        rawCacheSize: rawCache.size,
        cacheKeys: Array.from(rawCache.keys()),
        networkLogSize: state?.network?.log?.length || 0,
        networkEntries: state?.network?.log?.slice(0, 3).map(e => ({
          entryId: e.entryId,
          requestId: e.requestId,
          method: e.method
        })) || [],
        cacheEntries: cacheEntries.slice(0, 3)
      };
    });

    console.log('\n=== Cache Information ===');
    console.log('Raw cache size:', cacheInfo.rawCacheSize);
    console.log('Network log size:', cacheInfo.networkLogSize);
    console.log('Cache keys:', cacheInfo.cacheKeys?.slice(0, 5));
    console.log('\nNetwork entries (first 3):');
    cacheInfo.networkEntries?.forEach(e => {
      console.log(`  Entry ${e.entryId}: requestId=${e.requestId}, method=${e.method?.substring(0, 80)}`);
    });
    console.log('\nCache entries (first 3):');
    cacheInfo.cacheEntries?.forEach(e => {
      console.log(`  Key ${e.key} (${e.keyType}): url=${e.url?.substring(0, 80)}, hasBody=${e.hasBody}`);
    });

    console.log('\n=== Testing URL-based matching ===');

    // Simulate Repeat button click
    const repeatResult = await devtoolsPage.evaluate(() => {
      const store = window.store;
      const rawCache = window.__GRPCWEB_DEVTOOLS_RAW_CACHE__;

      if (!store || !rawCache) {
        return { error: 'Store or cache not available' };
      }

      const state = store.getState();
      const entry = state.network.log[0]; // Get first entry

      if (!entry) {
        return { error: 'No network entries' };
      }

      const method = entry.method;
      console.log('[Test] Testing entry:', entry.entryId, 'method:', method);
      console.log('[Test] Entry requestId:', entry.requestId);

      // Try URL-based matching
      let foundByUrl = false;
      let matchedKey = null;
      let matchedUrl = null;

      for (const [cacheKey, cacheValue] of rawCache.entries()) {
        if (cacheValue.url === method ||
            cacheValue.url.includes(method) ||
            method.includes(cacheValue.url)) {
          foundByUrl = true;
          matchedKey = cacheKey;
          matchedUrl = cacheValue.url;
          console.log('[Test] ✓ Found by URL match:', { cacheKey, cacheUrl: cacheValue.url, entryMethod: method });
          break;
        }
      }

      return {
        entryId: entry.entryId,
        requestId: entry.requestId,
        method: method,
        foundByUrl,
        matchedKey,
        matchedUrl,
        rawCacheSize: rawCache.size
      };
    });

    console.log('\n=== URL Matching Result ===');
    console.log('Entry ID:', repeatResult.entryId);
    console.log('Entry requestId:', repeatResult.requestId);
    console.log('Entry method:', repeatResult.method?.substring(0, 100));
    console.log('Found by URL:', repeatResult.foundByUrl ? '✅ YES' : '❌ NO');
    console.log('Matched cache key:', repeatResult.matchedKey);
    console.log('Matched URL:', repeatResult.matchedUrl?.substring(0, 100));

    // Take screenshots
    await page.screenshot({
      path: 'test-results/url-matching-page.png',
      fullPage: true
    });
    await devtoolsPage.screenshot({
      path: 'test-results/url-matching-devtools.png',
      fullPage: true
    });

    console.log('\n=== Test Summary ===');
    console.log('✓ Screenshots saved');
    console.log('DebuggerCapture initialized:', hasDebuggerInit ? '✅' : '❌');
    console.log('Requests captured:', cacheInfo.rawCacheSize > 0 ? '✅' : '❌');
    console.log('URL matching works:', repeatResult.foundByUrl ? '✅' : '❌');

    // Assertions
    expect(cacheInfo.rawCacheSize, 'Should have captured raw requests').toBeGreaterThan(0);
    expect(repeatResult.foundByUrl, 'Should find request by URL matching').toBe(true);
  });
});
