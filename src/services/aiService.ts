// AI calls go through the backend (server/index.ts) — no API key in the browser.
import { authHeaders } from './authService';

async function post<T>(path: string, body: unknown, fallback: T): Promise<T> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
    if (res.status === 429) {
      const data = await res.json().catch(() => ({}));
      console.warn('AI rate limited:', data.message);
      return fallback;
    }
    if (!res.ok) throw new Error(`API ${path} responded ${res.status}`);
    return (await res.json()) as T;
  } catch (error) {
    console.error(`AI request failed (${path}):`, error);
    return fallback;
  }
}

export async function analyzeComplaint(description: string): Promise<any> {
  return post('/api/analyze-complaint', { description }, {
    sentiment: 'Neutral',
    priority: 'Medium',
    category: 'General',
  });
}

export async function generateResponseTemplates(complaint: any) {
  const data = await post<{ templates: string[] }>(
    '/api/response-templates',
    { description: complaint.description, category: complaint.category },
    {
      templates: [
        'Thank you for reaching out. We are investigating.',
        'This issue has been routed to the field team.',
        'We expect resolution within the SLA period.',
      ],
    },
  );
  return data.templates;
}
