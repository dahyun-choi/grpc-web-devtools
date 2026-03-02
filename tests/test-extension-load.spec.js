// @ts-check
const { test, expect, chromium } = require('@playwright/test');
const { launchBrowserWithExtension } = require('./helpers/extension');

test.describe('Extension Loading Test', () => {
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

  test('should load extension and verify core files', async () => {
    console.log('\n=== Testing Extension Load ===');

    const page = await context.newPage();

    // Test that extension resources are accessible
    const tests = [
      { name: 'manifest.json', url: `chrome-extension://${extensionId}/manifest.json` },
      { name: 'index.html', url: `chrome-extension://${extensionId}/index.html` },
      { name: 'background.js', url: `chrome-extension://${extensionId}/background.js` },
    ];

    for (const test of tests) {
      try {
        const response = await page.goto(test.url);
        const status = response ? response.status() : 0;
        console.log(`✓ ${test.name}: ${status === 200 ? 'OK' : 'Status ' + status}`);
        expect(status).toBe(200);
      } catch (err) {
        console.log(`✗ ${test.name}: Failed - ${err.message}`);
        throw err;
      }
    }

    // Verify manifest content
    await page.goto(`chrome-extension://${extensionId}/manifest.json`);
    const manifestText = await page.textContent('body');
    const manifest = JSON.parse(manifestText);

    console.log('\n=== Manifest Verification ===');
    console.log('Name:', manifest.name);
    console.log('Version:', manifest.version);
    console.log('Permissions:', manifest.permissions);

    expect(manifest.name).toBe('gRPC-Web Developer Tools');
    expect(manifest.permissions).toContain('storage');
    expect(manifest.permissions).toContain('debugger');

    console.log('\n✅ Extension loaded successfully with all required permissions!');
  });

  test('should verify DebuggerCapture in bundle', async () => {
    const page = await context.newPage();

    // Get the main JS file
    await page.goto(`chrome-extension://${extensionId}/index.html`);

    const scriptSrcs = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script[src]'));
      return scripts.map(s => s.src);
    });

    console.log('\n=== Checking main bundle ===');
    console.log('Script sources:', scriptSrcs);

    // Find main bundle
    const mainBundle = scriptSrcs.find(src => src.includes('/main.') && src.endsWith('.js'));

    if (!mainBundle) {
      throw new Error('Main bundle not found!');
    }

    console.log('Main bundle:', mainBundle);

    // Fetch and check bundle content
    const response = await page.goto(mainBundle);
    const bundleContent = await response.text();

    const requiredStrings = [
      'DebuggerCapture',
      'chrome.debugger.attach',
      'Network.enable',
      'Found by URL match',
      'Attempting URL-based lookup'
    ];

    console.log('\n=== Bundle Content Checks ===');
    for (const str of requiredStrings) {
      const found = bundleContent.includes(str);
      console.log(`${found ? '✅' : '❌'} "${str}": ${found ? 'Found' : 'NOT FOUND'}`);
      expect(found, `Bundle should contain "${str}"`).toBe(true);
    }

    console.log('\n✅ All required code is in the bundle!');
  });
});
