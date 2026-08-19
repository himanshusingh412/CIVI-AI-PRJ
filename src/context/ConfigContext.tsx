import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Runtime deployment configuration, fetched once and shared.
 *
 * Everything the UI knows about which integrations are real comes from here.
 * Components must never hardcode a status: a green "Connected" pill written
 * by hand is a claim nobody verified, and the whole point of the mode system
 * (see server/config.ts) is that the badge cannot drift from reality.
 *
 * Fetched at runtime rather than baked in at build time so rotating a client
 * ID or switching a provider does not require a rebuild.
 */

export type IntegrationMode = 'live' | 'demo' | 'config_required' | 'disabled';

export type Integration = {
  key: string;
  label: string;
  mode: IntegrationMode;
  provider: string;
  detail: string;
};

export type RuntimeConfig = {
  googleClientId: string;
  demoMode: boolean;
  environment: 'production' | 'development';
  features: Record<string, boolean>;
  integrations: Integration[];
};

/**
 * Used until the fetch lands, and permanently if the backend is unreachable.
 *
 * Note what it claims: nothing. Every integration is absent, so the UI
 * renders "unknown" rather than optimistically showing features as working
 * while the server is down.
 */
const EMPTY: RuntimeConfig = {
  googleClientId: '',
  demoMode: false,
  environment: 'development',
  features: {},
  integrations: [],
};

type ConfigContextValue = {
  config: RuntimeConfig;
  loading: boolean;
  /** True when the backend could not be reached at all. */
  offline: boolean;
  integration: (key: string) => Integration | null;
  modeOf: (key: string) => IntegrationMode | 'unknown';
  enabled: (feature: string) => boolean;
};

const ConfigContext = createContext<ConfigContextValue | null>(null);

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<RuntimeConfig>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const res = await fetch('/api/config', { credentials: 'same-origin', signal: ac.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as RuntimeConfig;
        setConfig({ ...EMPTY, ...body });
        setOffline(false);
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        setOffline(true);
      } finally {
        setLoading(false);
      }
    })();
    return () => ac.abort();
  }, []);

  const value = useMemo<ConfigContextValue>(() => {
    const byKey = new Map(config.integrations.map(i => [i.key, i]));
    return {
      config,
      loading,
      offline,
      integration: key => byKey.get(key) ?? null,
      modeOf: key => byKey.get(key)?.mode ?? 'unknown',
      // Absent means "not reported yet", which must not read as enabled.
      enabled: feature => config.features[feature] === true,
    };
  }, [config, loading, offline]);

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig() {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfig must be used within a <ConfigProvider>');
  return ctx;
}
