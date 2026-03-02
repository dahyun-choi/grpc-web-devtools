// Helper functions for Chrome extension testing with Playwright

const path = require('path');

/**
 * Launch a browser context with the Chrome extension loaded
 * @param {import('@playwright/test').Browser} browser
 * @returns {Promise<import('@playwright/test').BrowserContext>}
 */
async function launchWithExtension(browser) {
  const extensionPath = path.join(__dirname, '../../build');

  const context = await browser.newContext({
    // Simulate a real user agent
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  // Load the extension by using a persistent context
  // Note: For Manifest V3 extensions, we need to use the service worker
  return context;
}

/**
 * Launch browser with extension using args (alternative approach)
 * @param {import('@playwright/test').ChromiumBrowserContext} chromium
 * @returns {Promise<{context: import('@playwright/test').BrowserContext, extensionId: string}>}
 */
async function launchBrowserWithExtension(chromium) {
  const extensionPath = path.join(__dirname, '../../build');

  const context = await chromium.launchPersistentContext('', {
    headless: false, // Extensions require non-headless mode
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });

  // Get the extension ID
  let [background] = context.serviceWorkers();
  if (!background) {
    background = await context.waitForEvent('serviceworker');
  }

  const extensionId = background.url().split('/')[2];
  console.log('Extension loaded with ID:', extensionId);

  return { context, extensionId };
}

/**
 * Open DevTools panel for a page
 * @param {import('@playwright/test').Page} page
 * @param {string} extensionId
 * @returns {Promise<import('@playwright/test').Page>}
 */
async function openDevToolsPanel(page, extensionId) {
  // Navigate to the devtools panel
  const devtoolsUrl = `chrome-extension://${extensionId}/index.html`;
  const devtoolsPage = await page.context().newPage();
  await devtoolsPage.goto(devtoolsUrl);
  return devtoolsPage;
}

/**
 * Wait for gRPC requests to appear in the extension
 * @param {import('@playwright/test').Page} devtoolsPage
 * @param {number} timeout
 * @returns {Promise<void>}
 */
async function waitForGrpcRequests(devtoolsPage, timeout = 5000) {
  await devtoolsPage.waitForFunction(
    () => {
      const state = window.__REDUX_DEVTOOLS_EXTENSION__?.getState?.() || window.store?.getState();
      return state?.network?.log?.length > 0;
    },
    { timeout }
  );
}

/**
 * Get network log from extension state
 * @param {import('@playwright/test').Page} devtoolsPage
 * @returns {Promise<any[]>}
 */
async function getNetworkLog(devtoolsPage) {
  return await devtoolsPage.evaluate(() => {
    // Access Redux store
    const state = window.store?.getState();
    return state?.network?.log || [];
  });
}

/**
 * Get selected entry from extension state
 * @param {import('@playwright/test').Page} devtoolsPage
 * @returns {Promise<any>}
 */
async function getSelectedEntry(devtoolsPage) {
  return await devtoolsPage.evaluate(() => {
    const state = window.store?.getState();
    return state?.network?.selectedEntry;
  });
}

/**
 * Upload proto files to the extension
 * @param {import('@playwright/test').Page} devtoolsPage
 * @param {string[]} protoPaths - Array of paths to .proto files
 * @returns {Promise<void>}
 */
async function uploadProtoFiles(devtoolsPage, protoPaths) {
  // Click settings button
  await devtoolsPage.click('[title="Settings"]');

  // Wait for file input
  const fileInput = await devtoolsPage.locator('input[type="file"]');

  // Upload files
  await fileInput.setInputFiles(protoPaths);

  // Wait for upload to complete
  await devtoolsPage.waitForTimeout(1000);

  // Close settings
  await devtoolsPage.click('[title="Settings"]');
}

/**
 * Click the Repeat button for a request
 * @param {import('@playwright/test').Page} devtoolsPage
 * @returns {Promise<void>}
 */
async function clickRepeatButton(devtoolsPage) {
  const repeatButton = devtoolsPage.locator('button:has-text("Repeat")');
  await repeatButton.click();
}

/**
 * Click Edit & Repeat and modify the request
 * @param {import('@playwright/test').Page} devtoolsPage
 * @param {Function} editCallback - Callback function to edit the JSON
 * @returns {Promise<void>}
 */
async function editAndRepeatRequest(devtoolsPage, editCallback) {
  // Click Edit & Repeat button
  const editButton = devtoolsPage.locator('button:has-text("Edit & Repeat")');
  await editButton.click();

  // Wait for edit mode
  await devtoolsPage.waitForSelector('.edit-mode');

  // Perform edits using the callback
  if (editCallback) {
    await editCallback(devtoolsPage);
  }

  // Click Send button
  const sendButton = devtoolsPage.locator('button:has-text("Send")');
  await sendButton.click();
}

/**
 * Select a network entry by index
 * @param {import('@playwright/test').Page} devtoolsPage
 * @param {number} index
 * @returns {Promise<void>}
 */
async function selectNetworkEntry(devtoolsPage, index) {
  const entries = devtoolsPage.locator('.network-list-row');
  await entries.nth(index).click();
}

/**
 * Get console logs from a page
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string[]>}
 */
async function collectConsoleLogs(page) {
  const logs = [];

  page.on('console', (msg) => {
    logs.push(`[${msg.type()}] ${msg.text()}`);
  });

  return logs;
}

/**
 * Wait for element with timeout
 * @param {import('@playwright/test').Page} page
 * @param {string} selector
 * @param {number} timeout
 * @returns {Promise<boolean>}
 */
async function waitForElement(page, selector, timeout = 5000) {
  try {
    await page.waitForSelector(selector, { timeout });
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  launchWithExtension,
  launchBrowserWithExtension,
  openDevToolsPanel,
  waitForGrpcRequests,
  getNetworkLog,
  getSelectedEntry,
  uploadProtoFiles,
  clickRepeatButton,
  editAndRepeatRequest,
  selectNetworkEntry,
  collectConsoleLogs,
  waitForElement,
};
