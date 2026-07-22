// Server-only PandaDoc API client. Never import from *.functions.ts at module scope;
// load dynamically inside handlers: `const { pandadoc } = await import('@/lib/pandadoc.server');`

const BASE = 'https://api.pandadoc.com/public/v1';

function apiKey(): string {
  const key = process.env.PANDADOC_API_KEY;
  if (!key) throw new Error('PANDADOC_API_KEY is not configured');
  return key;
}

function retryDelayMs(body: any, attempt: number): number {
  const detail = String(body?.detail ?? body?.message ?? '');
  const seconds = Number(detail.match(/available in (\d+) seconds/i)?.[1]);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000 + 250, 6000);
  return 750 * (attempt + 1);
}

async function request<T = any>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `API-Key ${apiKey()}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (res.status === 429 && attempt < 3) {
    await new Promise((r) => setTimeout(r, retryDelayMs(body, attempt)));
    return request<T>(path, init, attempt + 1);
  }
  if (!res.ok) {
    const msg = body?.detail || body?.message || body?.error || res.statusText;
    const raw = typeof text === 'string' ? text.slice(0, 600) : '';
    console.error(`[pandadoc] ${init.method ?? 'GET'} ${path} → ${res.status}: ${msg} | body=${raw}`);
    throw new Error(`PandaDoc ${res.status}: ${msg}`);
  }
  return body as T;
}

export interface PandaDocRecipient {
  email: string;
  first_name?: string;
  last_name?: string;
  role: string; // template role, e.g. 'client' or 'trophi'
}

export interface CreateFromTemplateArgs {
  name: string;
  templateUuid: string;
  recipients: PandaDocRecipient[];
  tokens?: Record<string, string>;
  fields?: Record<string, string>;
  metadata?: Record<string, string>;
}

export interface PandaDocDocument {
  id: string;
  name: string;
  status: string;
  date_created: string;
}

export const pandadoc = {
  async createFromTemplate(args: CreateFromTemplateArgs): Promise<PandaDocDocument> {
    const tokens = Object.entries(args.tokens ?? {}).map(([name, value]) => ({ name, value }));
    const fields = Object.fromEntries(
      Object.entries(args.fields ?? {}).map(([k, v]) => [k, { value: v }]),
    );
    return request<PandaDocDocument>('/documents', {
      method: 'POST',
      body: JSON.stringify({
        name: args.name,
        template_uuid: args.templateUuid,
        recipients: args.recipients,
        tokens,
        fields,
        metadata: args.metadata,
      }),
    });
  },

  async getDocument(id: string): Promise<PandaDocDocument & { recipients?: any[]; metadata?: Record<string, any> }> {
    return request(`/documents/${id}/details`);
  },

  // Downloads the final signed PDF. Only works when status is document.completed.
  async downloadDocumentPdf(id: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    const res = await fetch(`${BASE}/documents/${id}/download`, {
      headers: { Authorization: `API-Key ${apiKey()}`, Accept: 'application/pdf' },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`PandaDoc download ${id} → ${res.status}: ${text.slice(0, 200)}`);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    return { bytes: buf, contentType: res.headers.get('content-type') || 'application/pdf' };
  },

  async listByMetadata(metadata: Record<string, string>): Promise<PandaDocDocument[]> {
    const parts = Object.entries(metadata).map(([k, v]) => `${k}=${v}`).join(';');
    const qs = new URLSearchParams({ metadata: parts, count: '50' }).toString();
    const r = await request<{ results: PandaDocDocument[] }>(`/documents?${qs}`);
    return r.results ?? [];
  },


  async sendDocument(id: string, opts: { subject?: string; message?: string; silent?: boolean } = {}) {
    return request(`/documents/${id}/send`, {
      method: 'POST',
      body: JSON.stringify({
        subject: opts.subject ?? 'Please review and sign',
        message: opts.message ?? 'Your Trophi Hospitality documents are ready for signature.',
        silent: opts.silent ?? false,
      }),
    });
  },

  async createSession(id: string, recipientEmail: string, lifetimeSec = 900): Promise<{ id: string; expires_at: string }> {
    return request(`/documents/${id}/session`, {
      method: 'POST',
      body: JSON.stringify({ recipient: recipientEmail, lifetime: lifetimeSec }),
    });
  },

  // PandaDoc returns `document.uploaded` immediately after createFromTemplate
  // and transitions to `document.draft` once server-side processing finishes.
  // /send and /session both reject `document.uploaded`. Poll briefly.
  async waitForDraft(id: string, timeoutMs = 15000): Promise<string> {
    const started = Date.now();
    let last = '';
    while (Date.now() - started < timeoutMs) {
      const d = await this.getDocument(id);
      last = String(d.status ?? '');
      if (last !== 'document.uploaded' && last !== 'uploaded') return last;
      await new Promise((r) => setTimeout(r, 1200));
    }
    return last;
  },

  // Draft docs are permanently removed. Sent/completed docs return 400; caller
  // should void those separately. We swallow 404 so a partial cleanup can retry.
  async deleteDocument(id: string): Promise<void> {
    const res = await fetch(`${BASE}/documents/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `API-Key ${apiKey()}` },
    });
    if (res.status === 404 || res.status === 204) return;
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`PandaDoc delete ${id} → ${res.status}: ${text.slice(0, 200)}`);
    }
  },
};
