export interface CitizenProfile {
  fullName: string;
  phone: string;
  email: string;
  state: string;
  district: string;
  ward: string;
  localBody: string;
}

function csrfHeader(): Record<string, string> {
  const m = typeof document !== 'undefined' ? document.cookie.match(/(?:^|; )civicai_csrf=([^;]*)/) : null;
  return m ? { 'x-csrf-token': decodeURIComponent(m[1]) } : {};
}

export async function fetchCitizenProfile(): Promise<CitizenProfile> {
  const res = await fetch('/api/citizen/profile', { credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Could not load profile.');
  return data.profile;
}

export async function updateCitizenProfile(update: Partial<CitizenProfile>): Promise<CitizenProfile> {
  const res = await fetch('/api/citizen/profile', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...csrfHeader(),
    },
    credentials: 'same-origin',
    body: JSON.stringify(update),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Could not update profile.');
  return data.profile;
}
