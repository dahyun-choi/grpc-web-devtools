// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

// Map of Panel connections. The 'tabId' is used as key.
// There are two connections/ports for every tabId
// 1) Port to the panel script
// 2) Port to the content script
//
// Example:
// connections[1].panel => pane port
// connections[1].content => content port
var connections = {};

chrome.runtime.onConnect.addListener(port => {
  if (port.name != "panel" && port.name != "content") {
    return;
  }

  var extensionListener = message => {
    var tabId = port.sender.tab && port.sender.tab.id >= 0 ? port.sender.tab.id : message.tabId;

    // The original connection event doesn't include the tab ID of the
    // DevTools page, so we need to send it explicitly (attached
    // to the 'init' event).
    if (message.action == "init") {
      if (!connections[tabId]) {
        connections[tabId] = {};
      }
      connections[tabId][port.name] = port;
      return;
    }

    // Handle ping messages (health check)
    if (message.action == "ping") {
      // Just acknowledge - connection is alive
      return;
    }

    // Handle triggerRepeat action
    if (message.action == "triggerRepeat") {
      console.log('[Background] Received triggerRepeat for tab:', tabId);
      console.log('[Background] Data:', message.data);

      if (connections[tabId] && connections[tabId].content) {
        console.log('[Background] Forwarding to content script');
        try {
          connections[tabId].content.postMessage(message);
          console.log('[Background] ✓ Message sent to content script');
        } catch (err) {
          console.error('[Background] Failed to send message:', err);
        }
      } else {
        console.error('[Background] No content connection for tab:', tabId);
        console.error('[Background] Available tabs:', Object.keys(connections));
      }
      return;
    }

    // Handle notifyRepeat action
    if (message.action == "notifyRepeat") {
      console.log('[Background] Received notifyRepeat for tab:', tabId);
      console.log('[Background] Data:', message.data);

      if (connections[tabId] && connections[tabId].content) {
        console.log('[Background] Forwarding to content script');
        try {
          connections[tabId].content.postMessage(message);
          console.log('[Background] ✓ Message sent to content script');
        } catch (err) {
          console.error('[Background] Failed to send message:', err);
        }
      } else {
        console.error('[Background] No content connection for tab:', tabId);
        console.error('[Background] Available tabs:', Object.keys(connections));
      }
      return;
    }

    // Handle repeat request
    if (message.action == "repeatRequest") {
      console.log('[Background] Received repeat request for tab:', tabId);
      console.log('[Background] Message:', JSON.stringify(message, null, 2));
      console.log('[Background] Available connections:', Object.keys(connections));
      console.log('[Background] Tab connections:', connections[tabId] ? Object.keys(connections[tabId]) : 'none');

      if (connections[tabId] && connections[tabId].content) {
        console.log('[Background] Forwarding to content script');
        connections[tabId].content.postMessage(message);
      } else {
        console.error('[Background] No content connection for tab:', tabId);
        console.error('[Background] Connections state:', connections);
      }
      return;
    }

    // Other messages are relayed to specified target if any
    // and if the connection exists.
    if (message.target) {
      console.log('[Background] Routing message to target:', message.target);
      if (connections[tabId] && connections[tabId][message.target]) {
        var conn = connections[tabId][message.target];
        try {
          conn.postMessage(message);
          console.log('[Background] ✓ Message sent to', message.target);
        } catch (err) {
          console.error('[Background] Failed to send message to', message.target, ':', err);
        }
      } else {
        console.error('[Background] No connection found for target:', message.target);
        console.error('[Background] Tab:', tabId, 'Available targets:', connections[tabId] ? Object.keys(connections[tabId]) : 'none');
      }
    }
  };

  // Listen to messages sent from the panel script.
  port.onMessage.addListener(extensionListener);

  // Remove panel connection on disconnect.
  port.onDisconnect.addListener(function (port) {
    port.onMessage.removeListener(extensionListener);

    var tabs = Object.keys(connections);
    for (var i = 0, len = tabs.length; i < len; i++) {
      if (connections[tabs[i]][port.name] === port) {
        delete connections[tabs[i]][port.name];

        // If there is not port associated to the tab, remove it
        // from the connections map.
        if (Object.keys(connections[tabs[i]]).length === 0) {
          delete connections[tabs[i]];
        }
        break;
      }
    }
  });
});

// Handle repeat request messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "repeatRequest") {
    // Find the tab's content connection
    const tabId = sender.tab ? sender.tab.id : null;

    if (tabId && connections[tabId] && connections[tabId].content) {
      // Forward to content script
      connections[tabId].content.postMessage({
        action: "repeatRequest",
        data: message.data
      });
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: "No content connection found" });
    }
    return true; // Keep the message channel open for async response
  }
});
