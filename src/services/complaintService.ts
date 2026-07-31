import type { Complaint } from '../types';

/**
 * Citizen complaint API client.
 *
 * Every call is same-origin and carries the CSRF token from the double-submit
 * cookie, matching adminService. Reads go through the same path as writes so
 * there is one place where auth headers can be wrong.
 */

function csrfHeader(): Record<string, string> {
  const m = document.cookie.match(/(?:^|; )civicai_csrf=([^;]*)/);
  return m ? { 'x-csrf-token': decodeURIComponent(m[1]) } : {};
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...csrfHeader(),
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  const text = await res.text();
  // A non-JSON body here means the request hit Vite's HTML fallback rather
  // than the API — i.e. the proxy or the server is down, not a 4xx.
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch {
    throw new Error('The service is unavailable. Is the API running?');
  }
  if (!res.ok) throw new Error(data.message || data.error || `Request failed (${res.status})`);
  return data as T;
}

export interface ComplaintFilters {
  state?: string;
  district?: string;
  category?: string;
  status?: string;
  limit?: number;
}

export async function listComplaints(f: ComplaintFilters = {}): Promise<Complaint[]> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) qs.set(k, String(v));
  const q = qs.toString();
  const data = await call<{ complaints: Complaint[] }>(`/api/complaints${q ? `?${q}` : ''}`);
  return data.complaints ?? [];
}

export interface DuplicateHint {
  of: string;
  verdict: 'duplicate' | 'related';
  confidence: number;
  reasons: string[];
}

export async function createComplaint(
  input: Partial<Complaint>,
): Promise<{ complaint: Complaint; duplicate: DuplicateHint | null }> {
  return call('/api/complaints', { method: 'POST', body: JSON.stringify(input) });
}

export async function rateComplaint(id: string, rating: number): Promise<Complaint> {
  return call(`/api/complaints/${encodeURIComponent(id)}/feedback`, {
    method: 'POST',
    body: JSON.stringify({ rating }),
  });
}

export async function findDuplicates(id: string) {
  return call<{ matches: (DuplicateHint & { id: string; distanceM: number | null })[] }>(
    `/api/complaints/${encodeURIComponent(id)}/duplicates`,
  );
}
