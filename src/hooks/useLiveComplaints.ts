import { useCallback, useEffect, useRef, useState } from 'react';
import type { Complaint } from '../types';
import { listComplaints, type ComplaintFilters } from '../services/complaintService';
import { toUiComplaint } from '../services/complaintAdapter';

/**
 * Complaints from the database, kept current without a page refresh.
 *
 * Replaces `useState<Complaint[]>` seeded with mock rows. That old approach
 * meant a refresh erased everything a citizen filed, and the citizen and
 * admin portals could never see each other's data — they were two separate
 * arrays in two separate tabs.
 *
 * The SSE stream carries ids, not rows, so an event triggers a refetch
 * through the normal authorised endpoint. That costs one extra round trip
 * and buys a guarantee: the client can never render a record the server
 * would not have let it request. Pushing rows down the socket would mean
 * re-implementing scope rules in the event layer.
 */
export interface LiveComplaints {
  complaints: Complaint[];
  loading: boolean;
  error: string | null;
  /** True while the SSE stream is attached. Drives the "Live" indicator. */
  live: boolean;
  refresh: () => Promise<void>;
  /** Apply a local change immediately, before the server round trip. */
  patch: (id: string, change: Partial<Complaint>) => void;
  prepend: (c: Complaint) => void;
}

export function useLiveComplaints(filters: ComplaintFilters = {}): LiveComplaints {
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  // Serialised so the effect below re-runs when a filter VALUE changes,
  // not on every render because the caller passed a fresh object literal.
  const key = JSON.stringify(filters);

  const refresh = useCallback(async () => {
    try {
      const rows = await listComplaints(JSON.parse(key));
      // Adapt at the boundary: everything past this line speaks the UI model.
      setComplaints(rows.map(r => toUiComplaint(r as any)));
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load complaints.');
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => { void refresh(); }, [refresh]);

  /**
   * Coalesce bursts. A single admin action can emit an update and an SLA
   * escalation within milliseconds; without this the list refetches twice
   * for one logical change.
   */
  const timer = useRef<number | null>(null);
  const scheduleRefresh = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void refresh(); }, 250);
  }, [refresh]);

  useEffect(() => {
    // EventSource reconnects on its own after a drop, which matters on
    // serverless hosts that cut long-lived responses after ~60s.
    const es = new EventSource('/api/events', { withCredentials: true });

    const onChange = () => scheduleRefresh();
    es.addEventListener('ready', () => setLive(true));
    es.addEventListener('complaint_created', onChange);
    es.addEventListener('complaint_updated', onChange);
    es.addEventListener('sla_breach', onChange);
    es.onerror = () => setLive(false);

    return () => {
      if (timer.current) window.clearTimeout(timer.current);
      es.close();
    };
  }, [scheduleRefresh]);

  const patch = useCallback((id: string, change: Partial<Complaint>) => {
    setComplaints(prev => prev.map(c => (c.id === id ? { ...c, ...change } : c)));
  }, []);

  const prepend = useCallback((c: Complaint) => {
    setComplaints(prev => [c, ...prev.filter(p => p.id !== c.id)]);
  }, []);

  return { complaints, loading, error, live, refresh, patch, prepend };
}
