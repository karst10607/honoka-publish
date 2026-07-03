/**
 * Honoka Bridge client — clean-room implementation.
 * Detects and communicates with the local Bridge daemon.
 */
export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:44124';

export class BridgeClient {
  constructor(baseUrl = DEFAULT_BRIDGE_URL) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async request(method, path, body) {
    const url = `${this.baseUrl}${path}`;
    const opts = { method };
    if (body) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Bridge ${res.status}: ${text}`);
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    return res.text();
  }

  /** Check if Bridge is running and healthy. */
  async health() {
    try {
      const data = await this.request('GET', '/status');
      return { ok: true, version: data.version, docsDir: data.docsDir };
    } catch {
      return { ok: false };
    }
  }

  /** Save a clip to disk via Bridge. */
  async saveClip({ title, markdown, url, source }) {
    return this.request('POST', '/api/save', {
      title,
      markdown,
      url: url || '',
      source: source || 'extension',
      category: 'reference',
    });
  }

  /** Save clip and push to Notion via Bridge. */
  async saveAndPushToNotion({ title, markdown, url, source }) {
    return this.request('POST', '/api/save-and-notion', {
      title,
      markdown,
      url: url || '',
      source: source || 'extension',
      category: 'reference',
    });
  }

  /** Save clip and push to AnyType via Bridge. */
  async saveAndPushToAnytype({ title, markdown, url, source }) {
    return this.request('POST', '/api/save-and-anytype', {
      title,
      markdown,
      url: url || '',
      source: source || 'extension',
      category: 'reference',
    });
  }

  /** Get Bridge settings. */
  async getSettings() {
    return this.request('GET', '/api/settings');
  }

  /** Get list of locally saved docs. */
  async listDocs() {
    return this.request('GET', '/api/docs');
  }
}
