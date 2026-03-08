# gRPC-Web Dev Tools

[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

![gRPC-Web Dev Tools](screenshots/store_light_dark.png)
Now supports dark mode.

## Installation

### Chrome

Via
the [Chrome Web Store](https://chrome.google.com/webstore/detail/grpc-web-developer-tools/kanmilmfkjnoladbbamlclhccicldjaj) (
recommended)

or

1. build it with `make build`
1. open the **Extension Management** page by navigating to `chrome://extensions`.
1. enable **Developer Mode** by clicking the toggle switch next to "Developer mode".
1. Click the **LOAD UNPACKED** button and select the extension `./build` directory.

### Firefox

Via [Firefox Browser Add-Ons](https://addons.mozilla.org/en-US/firefox/addon/grpc-web-developer-tools/) (recommended)

or

1. build and package with `make package`
1. enter `about:debugging` in the URL bar of Firefox
1. click **This Firefox** > **Load Temporary Add-on...**
1. select the `grpc-web-devtools.zip` extention file

## Usage

```javascript
const enableDevTools = window.__GRPCWEB_DEVTOOLS__ || (() => {
});
const client = new EchoServiceClient('http://myapi.com');
enableDevTools([
  client,
]);
```

> NOTE: Requires that your generated client(s) use `protoc-gen-grpc-web` >= 1.0.4

## Example

The example uses `docker-compose` to start a simple gRPC server, JavaScript client and the Envoy proxy for gRPC-Web:

```bash
make example-up
```

Example will be running on [http://localhost:8080](http://localhost:8080)

To stop the example:

```bash
make example-down
```

## Connect-Web

grpc-web-devtools now also supports [connect-web](https://github.com/bufbuild/connect-web)!

```ts
// __CONNECT_WEB_DEVTOOLS__ is loaded in as a script, so it is not guaranteed to be loaded before your code.
const interceptors: Interceptor[] = window.__CONNECT_WEB_DEVTOOLS__ !== "undefined" ?
  [window.__CONNECT_WEB_DEVTOOLS__]
  : [];
// To get around the fact that __CONNECT_WEB_DEVTOOLS__ might not be loaded, we can listen for a custom event,
// and then push the interceptor to our array once loaded.
window.addEventListener("connect-web-dev-tools-ready", () => {
  if (typeof window.__CONNECT_WEB_DEVTOOLS__ !== "undefined") {
    interceptors.push(window.__CONNECT_WEB_DEVTOOLS__);
  }
});
// Now we can use the interceptors in our transport
const transport: Transport = createGrpcWebTransport({
  baseUrl: getApiHostname(),
  interceptors,
});
```
This will also work for the connect protocol
```ts
const transport: Transport = ConnectTransportOptions({
  baseUrl: getApiHostname(),
  interceptors,
});
```

## Added Features

### Field Inspector

Hover over any field key in the request or response JSON viewer to instantly see its protobuf schema metadata.

- Enable with the **Field inspector** checkbox in the toolbar (checked by default when proto files are uploaded)
- **Hover** over a field key to show a floating tooltip with:
  - **Field #** — protobuf field number
  - **Type** — proto scalar or message type (e.g. `string`, `int32`, `Zone`)
  - **Wire** — wire type code and label (e.g. `2 (length-delimited)`)
  - **Rule** — field rule (`optional`, `repeated`, etc.)
- **Click** a field key to pin the tooltip in the corner of the panel; click ✕ to dismiss
- Works with both snake_case proto fields (e.g. `zone_id`) and their camelCase JSON representations (e.g. `zoneId`)
- Searches recursively through nested message types when the field is not at the top level

### Proto File Upload & Binary Decoding

Upload your `.proto` files in **Settings** to automatically decode protobuf binary messages into readable JSON. Without proto files, raw base64-encoded binary is displayed as-is.

- **Hot reload** — uploading new proto files immediately re-decodes all previously captured responses in the request list; no need to re-trigger network calls. The Settings panel shows how many existing responses were re-decoded (e.g. `Re-decoded 12 existing response(s)`).

- Supports multiple `.proto` files with cross-package imports
- Namespace-aware type resolution — correctly handles same-named messages across different packages (e.g. `commonv1.District` vs `webgwv1.District`)
- Auto-detects binary format mismatch for nested messages and falls back to the same-named type in the parent package
- Packed repeated enum/varint fields are decoded correctly

### Repeat Request

Replay any captured gRPC request with a single click using the **Repeat** button in the request detail panel.

- Uses the `chrome.debugger` API to reliably capture the original raw request body
- The replayed response is decoded with proto files if available
- Repeat requests are visually distinguished with a **↩ icon** and **yellow background** in the request list
- If no proto files are uploaded, clicking Repeat opens the Settings panel automatically

### Edit & Repeat

Modify request parameters and resend with the **Edit & Repeat** button.

- Edit request body as JSON directly in the panel
- Edit mode is clearly indicated with a blue header, **✏ Editing** badge, and left border accent
- **Send** and **Cancel** buttons appear in edit mode; Copy and Collapse buttons remain visible at all times
- Edited requests are re-encoded to protobuf binary using the uploaded `.proto` schema
- If no changes are made, the original raw request body is used as-is
- Response is decoded and displayed alongside the gRPC status code
- After sending, **Sent!!!** feedback appears on the Edit & Repeat button
- If no proto files are uploaded, clicking Edit & Repeat opens the Settings panel automatically
- Edit & Repeat requests are visually distinguished from plain Repeat with a **✎↩ icon** and **orange background**

### Request/Response Diff

Compare a repeated request against its original side-by-side using a git-style unified diff view.

- Selecting a repeat entry (↩) automatically switches to the **Diff** tab in both the Request and Response panels
- The **Diff** tab shows a color-coded unified diff: <span style="color:red">red lines (−)</span> are from the original, <span style="color:green">green lines (+)</span> are from the repeat
- If nothing changed, a **"No differences"** indicator is shown
- In **merged panel** mode (split off), a **Diff** toggle button appears in the section header — click to switch between the normal JSON view and a stacked diff showing request and response changes together
- Click the **Body** button (or any other tab) to return to the normal view

### Split Panel Toggle

A **Split panel** checkbox in the toolbar controls the detail view layout.

- **Checked (default)** — request and response are shown in separate resizable panels
- **Unchecked** — request and response are merged into a single JSON viewer (`{ request: {...}, response: {...} }`) for a compact view
- All action buttons (Edit & Repeat, Repeat, Copy, Collapse) are available in both modes

### Request/Response Headers

A **Headers** tab is available in the request detail panel showing:

- Request headers (method, content-type, authorization, etc.)
- Response headers and HTTP status

### Duration Column

The gRPC request list includes a **duration column** showing the elapsed time from request sent to response received (e.g. `123 ms`, `1.2 s`).

### Global Search

Use the **Global search** field in the toolbar to filter the request list by searching across all request bodies, response bodies, methods, and error messages.

### Server Streaming RPC

Server-streaming RPCs are tracked in a single row that updates in place as messages arrive, similar to Proxyman/Postman.

- All streaming messages from the same method accumulate in **one row** — polling-style streams (where each poll creates a new connection) are grouped automatically
- A **stream count badge** on the row shows the number of messages received so far
- The **Time** column reflects the timestamp of the most recent message
- The **Code** column updates live: shows `OK` while receiving responses, the gRPC error code (e.g. `CANCELLED`) if the stream is aborted, and resets back to `OK` automatically when the stream resumes after being cancelled
- The response panel shows an **accordion list** of all received messages (`Message 1`, `Message 2`, …), each with a per-message timestamp
- Individual messages can be expanded/collapsed independently; the **Collapse/Expand** button in the section header controls all messages at once
- A **✓ Stream complete** indicator appears when the server signals EOF

### Request Generator

Build and send a brand-new gRPC request directly from the DevTools panel without re-triggering it from the page.

- Click the **Gen** button in the toolbar to open the Request Generator modal
- **Method selector** — searches all methods from the uploaded proto files, filtered to packages already seen on the current page (e.g. if the page uses `ridergwv1.*`, only those methods are shown); use arrow keys + Enter for keyboard navigation
- **URL** — auto-populated from the most recent matching captured request
- **Headers** — auto-populated from the captured request (filtered to safe headers only: `content-type`, `authorization`, `x-*`, etc.)
- **Request body** — pre-filled with an auto-generated example from the proto schema; edit inline via the JSON editor; **Reset** button restores the example
- Click **Send →** to execute the request in the page context; the response appears below with status code, and also in the request list
- Generated requests are shown with a **✦ icon** and **purple background** in the list
- **Copy** and **Expand/Collapse** buttons on the response section; collapse state is synced with the button
- Modal is **draggable** (drag the header) and **resizable** (bottom-right handle)
- State is preserved when the modal is closed; **Clear** button resets all fields
- Requires proto files to be uploaded in Settings

### Load Test

Replay a captured request repeatedly to stress-test an endpoint.

- **Right-click** any row in the request list → **Load Test**
- Configure:
  - **Requests** — total number of requests to send (1–1000)
  - **Interval** — delay between each request in seconds (0 = fire as fast as possible)
- Click **Start** to begin; a progress bar shows `fired / total` along with `ok` and `fail` counts
- Click **■ Stop** to cancel mid-run
- Each replayed request appears in the list as a repeat entry (yellow ↩)

### Copy as grpcurl

Right-click any row in the request list to generate a ready-to-run `grpcurl` command.

```bash
grpcurl \
  -proto api/ridergw/v1/service.proto \
  -import-path shucle-proto \
  -d '{
  "demand": {
    "serviceType": "shucle-test10",
    ...
  }
}' \
  qa.shucle.com:15443 \
  ridergwv1.RiderGw/CreateDemand
```

- **Server address** — extracted automatically from the captured request URL (`host:port`)
- **`-proto`** — the specific proto file for the request's service package is selected automatically:
  - Package name is extracted from the method path (e.g. `/ridergwv1.RiderGw/CreateDemand` → `ridergwv1`)
  - The uploaded proto files are searched for a `package ridergwv1;` declaration
  - `service.proto` in the same directory is preferred (e.g. `api/ridergw/v1/service.proto`)
  - Falls back to listing all proto files if no match is found
- **`-import-path`** — set automatically from the root directory name when uploading a proto directory (e.g. uploading the `shucle-proto` folder sets `-import-path shucle-proto`); omitted if no proto files are uploaded
- **`-plaintext`** — added automatically for `http://` endpoints
- **`-d`** — populated with the captured request body as formatted JSON
- The command is shown in a modal with a **Copy to clipboard** button; press `Escape` to close

### Other Improvements

- **OPTIONS preflight filtering** — preflight requests are hidden from the request list
- **Status code display** — gRPC status codes are shown in the request list for quick error identification
- **Expand/Collapse in edit mode** — Collapse/Expand button works correctly even after manually interacting with JSON nodes in edit mode
