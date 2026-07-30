// AI calls go through the backend (server/index.ts) — no API key in the browser.
// Auth rides on the httpOnly session cookie; apiPost attaches the CSRF header.
import { apiPost, isAuthError } from './authService';

async function post<T>(path: string, body: unknown, fallback: T): Promise<T> {
  try {
    const res = await apiPost<T>(path, body);
    if (isAuthError(res)) {
      console.warn(`AI request degraded (${path}):`, res.error);
      return fallback;
    }
    return res;
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
