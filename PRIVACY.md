# Privacy Policy

**Last updated: July 1, 2026**

## Honoka Publish Chrome Extension

This extension operates fully locally. No data is sent to any external server unless you explicitly configure it to do so.

### Data Collection

This extension does **not** collect, store, or transmit any personal data to third parties.

### Data Storage

- **Local Storage (IndexedDB)**: The extension stores your browsing history related to Notion pages locally in your browser. This data never leaves your device.
- **Configuration**: Bridge server URL and other settings are stored locally in `chrome.storage`.

### Network Communication

The extension communicates only with:

1. **Your local Bridge server** (`http://127.0.0.1:<port>`) — a server you run on your own machine
2. **Notion API** (`api.notion.com`) — only if you configure a Notion token, to sync your documents
3. **AnyType API** (`http://127.0.0.1:44124`) — only if you configure AnyType credentials

No data is sent to any server operated by the extension developer.

### Third-Party Services

This extension does not use analytics, tracking, or advertising services of any kind.

### Data Retention

All data is stored locally on your device. You can clear all stored data at any time through the extension's settings or by clearing your browser data.

### Contact

For questions about this privacy policy, please open an issue at:
https://github.com/kotoroshinoto/honoka-publish/issues
