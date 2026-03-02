// @ts-check
const { test, expect, chromium } = require('@playwright/test');
const path = require('path');
const { launchBrowserWithExtension } = require('./helpers/extension');

test.describe('Page Interceptor Raw Request Capture', () => {
  let context;
  let extensionId;

  test.beforeAll(async () => {
    // Launch browser with extension
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

  test('should inject page-interceptor.js and capture raw requests', async () => {
    const page = await context.newPage();

    // Collect all console messages
    const consoleMessages = [];
    page.on('console', (msg) => {
      const text = msg.text();
      consoleMessages.push({ type: msg.type(), text });
      console.log(`[Page Console] ${msg.type()}: ${text}`);
    });

    // Navigate to the QA test page
    console.log('\n=== Navigating to test page ===');
    await page.goto('https://qa-privacy.shucle.com:15449/drt/management/stoppoint', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    // Wait a bit for interceptors to initialize
    await page.waitForTimeout(2000);

    console.log('\n=== Checking console logs ===');

    // Check if page interceptor was loaded
    const pageInterceptorLogs = consoleMessages.filter(m =>
      m.text.includes('[Page Interceptor]') ||
      m.text.includes('[Content Script]')
    );

    console.log('\nInterceptor logs found:', pageInterceptorLogs.length);
    pageInterceptorLogs.forEach(log => {
      console.log(`  ${log.type}: ${log.text}`);
    });

    // Verify page interceptor initialized
    expect(
      consoleMessages.some(m => m.text.includes('[Page Interceptor] Initializing'))
    ).toBeTruthy();

    // Verify gRPC DevTools injected
    expect(
      consoleMessages.some(m => m.text.includes('[gRPC DevTools] Injected script loaded'))
    ).toBeTruthy();

    // Verify interceptors are installed
    expect(
      consoleMessages.some(m => m.text.includes('XMLHttpRequest intercepted'))
    ).toBeTruthy();

    expect(
      consoleMessages.some(m => m.text.includes('fetch intercepted'))
    ).toBeTruthy();

    console.log('\n=== Checking for raw request capture ===');

    // Wait for gRPC requests to happen (page loads them automatically)
    await page.waitForTimeout(3000);

    // Check for raw request capture logs
    const rawRequestLogs = consoleMessages.filter(m =>
      m.text.includes('Pending raw request') ||
      m.text.includes('Sent raw request')
    );

    console.log('\nRaw request logs found:', rawRequestLogs.length);
    rawRequestLogs.forEach(log => {
      console.log(`  ${log.text}`);
    });

    // Check if raw requests were captured
    const rawRequestsCaptured = consoleMessages.some(m =>
      m.text.includes('Sent raw request for method')
    );

    if (!rawRequestsCaptured) {
      console.log('\n❌ NO RAW REQUESTS CAPTURED!');
      console.log('\nAll console messages:');
      consoleMessages.forEach(m => {
        console.log(`  [${m.type}] ${m.text}`);
      });
    } else {
      console.log('\n✓ Raw requests were captured');
    }

    // Check window.__grpcWebDevtoolsPendingByUrl
    const pendingRequests = await page.evaluate(() => {
      return {
        hasPendingByUrl: typeof window.__grpcWebDevtoolsPendingByUrl !== 'undefined',
        pendingSize: window.__grpcWebDevtoolsPendingByUrl?.size || 0,
        hasSentRawIds: typeof window.__grpcWebDevtools__sentRawIds !== 'undefined',
        sentRawIdsSize: window.__grpcWebDevtools__sentRawIds?.size || 0,
      };
    });

    console.log('\n=== Window state ===');
    console.log('Pending requests map exists:', pendingRequests.hasPendingByUrl);
    console.log('Pending requests size:', pendingRequests.pendingSize);
    console.log('Sent raw IDs set exists:', pendingRequests.hasSentRawIds);
    console.log('Sent raw IDs size:', pendingRequests.sentRawIdsSize);

    // Open DevTools panel
    console.log('\n=== Opening DevTools panel ===');
    const devtoolsUrl = `chrome-extension://${extensionId}/index.html`;
    const devtoolsPage = await context.newPage();

    // Collect DevTools console messages
    const devtoolsConsoleMessages = [];
    devtoolsPage.on('console', (msg) => {
      const text = msg.text();
      devtoolsConsoleMessages.push({ type: msg.type(), text });
      console.log(`[DevTools Console] ${msg.type()}: ${text}`);
    });

    await devtoolsPage.goto(devtoolsUrl);
    await devtoolsPage.waitForTimeout(2000);

    // Check raw cache size in DevTools
    const rawCacheInfo = await devtoolsPage.evaluate(() => {
      // Try to access the raw cache from the window
      return {
        logs: Array.from(document.querySelectorAll('*'))
          .map(el => el.textContent)
          .filter(text => text && text.includes('Raw cache'))
          .slice(0, 5),
      };
    });

    console.log('\n=== DevTools Raw Cache Info ===');
    console.log('Cache info:', rawCacheInfo.logs);

    // Look for raw cache logs in DevTools console
    const rawCacheLogs = devtoolsConsoleMessages.filter(m =>
      m.text.includes('Raw cache')
    );

    console.log('\nRaw cache logs in DevTools:');
    rawCacheLogs.forEach(log => {
      console.log(`  ${log.text}`);
    });

    // Take a screenshot for debugging
    await page.screenshot({ path: 'test-results/interceptor-page.png', fullPage: true });
    await devtoolsPage.screenshot({ path: 'test-results/interceptor-devtools.png', fullPage: true });

    console.log('\n=== Test Summary ===');
    console.log('✓ Screenshots saved to test-results/');

    // Assertions
    expect(rawRequestsCaptured, 'Raw requests should be captured').toBeTruthy();
    expect(pendingRequests.sentRawIdsSize, 'At least one raw request should be sent').toBeGreaterThan(0);
  });

  test('should trigger a new gRPC request and capture it', async () => {
    const page = await context.newPage();

    // Collect console messages
    const consoleMessages = [];
    page.on('console', (msg) => {
      const text = msg.text();
      consoleMessages.push({ type: msg.type(), text });
    });

    console.log('\n=== Loading page ===');
    await page.goto('https://qa-privacy.shucle.com:15449/drt/management/stoppoint', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    // Wait for initial load
    await page.waitForTimeout(3000);

    // Clear console messages to focus on new requests
    consoleMessages.length = 0;

    console.log('\n=== Triggering navigation (should trigger new gRPC requests) ===');

    // Navigate to a different page section to trigger new requests
    await page.goto('https://qa-privacy.shucle.com:15449/drt/operation/vehicle', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    // Wait for requests
    await page.waitForTimeout(3000);

    // Check for new raw request captures
    const newRawRequests = consoleMessages.filter(m =>
      m.text.includes('Sent raw request for method')
    );

    console.log('\nNew raw requests captured:', newRawRequests.length);
    newRawRequests.slice(0, 5).forEach(log => {
      console.log(`  ${log.text}`);
    });

    // Check if at least one request was captured
    expect(newRawRequests.length, 'Should capture at least one new raw request').toBeGreaterThan(0);
  });
});
