import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Moon, Sun, LogOut, User, ShieldCheck, MapPin, Building2, Key, CheckCircle, X } from 'lucide-react';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { PageBackground } from '../components/backgrounds/PageBackground';
import { DemoModeBanner } from '../components/IntegrationBadge';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useT } from '../i18n/I18nContext';
import { ROLE_LABELS } from '../services/identityService';

const EMP_ID_MAP: Record<string, string> = {
  super_admin: 'EMP-0001',
  state_admin: 'EMP-0002',
  district_admin: 'EMP-0003',
  department_officer: 'EMP-0004',
  field_officer: 'EMP-0005',
  auditor: 'EMP-0006',
  area_officer: 'EMP-0007',
};

/**
 * Shared chrome for every staff surface.
 */
export function StaffShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const t = useT();
  const { identity, signOut, signingOut } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const [showProfile, setShowProfile] = useState(false);

  const empId = identity?.role ? EMP_ID_MAP[identity.role] || 'EMP-STAFF' : 'EMP-STAFF';

  return (
    <div
      className="relative isolate min-h-screen flex flex-col"
      style={{ background: 'var(--color-bg-main)', color: 'var(--color-content)' }}
    >
      <PageBackground variant="admin" />
      <DemoModeBanner />

      <header
        className="h-16 glass border-b px-4 sm:px-8 flex items-center justify-between shrink-0"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <Link to="/" className="min-w-0" aria-label={t('staffShell.civicaiHome')}>
          <h1 className="font-display font-bold text-lg tracking-tight text-gradient-premium">
            {title}
          </h1>
          <p className="text-[11px] font-bold uppercase tracking-widest text-content-3 truncate">
            {subtitle}
          </p>
        </Link>

        <div className="flex items-center gap-2">
          {identity && identity.isStaff && (
            <button
              onClick={() => setShowProfile(true)}
              aria-label="View Staff Profile"
              className="h-10 px-3 rounded-xl bordered surface-2 flex items-center gap-2 text-xs font-bold
                         text-content hover:text-cta transition-colors shadow-sm"
            >
              <div className="w-6 h-6 rounded-lg grid place-items-center text-white" style={{ background: 'var(--color-cta)' }}>
                <User size={13} />
              </div>
              <span className="hidden sm:inline max-w-[130px] truncate">{identity.displayName}</span>
              <span className="px-2 py-0.5 rounded-md text-[10px] uppercase tracking-wider font-extrabold" style={{ background: 'var(--color-cta-pale)', color: 'var(--color-cta)' }}>
                {empId}
              </span>
            </button>
          )}

          <button
            onClick={toggleTheme}
            aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            className="w-10 h-10 rounded-xl bordered surface-2 grid place-items-center
                       text-content-3 hover:text-cta transition-colors"
          >
            {isDark ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
          </button>
          <button
            onClick={() => void signOut()}
            disabled={signingOut}
            aria-label={t('staffShell.signOut')}
            aria-busy={signingOut || undefined}
            className="w-10 h-10 rounded-xl grid place-items-center text-content-3
                       hover:text-danger transition-colors disabled:opacity-50"
          >
            <LogOut size={17} aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Staff Profile Modal */}
      {showProfile && identity && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="surface bordered rounded-2xl p-6 sm:p-8 max-w-lg w-full shadow-2xl relative space-y-6">
            <button
              onClick={() => setShowProfile(false)}
              className="absolute top-4 right-4 p-2 rounded-xl hover:bg-surface-2 text-content-3 hover:text-content transition-colors"
              aria-label="Close Profile"
            >
              <X size={18} />
            </button>

            {/* Profile Header */}
            <div className="flex items-center gap-4 border-b pb-5" style={{ borderColor: 'var(--color-border)' }}>
              <div className="w-14 h-14 rounded-2xl grid place-items-center text-white font-bold text-xl shadow-md" style={{ background: 'linear-gradient(135deg, var(--color-navy), var(--color-cta))' }}>
                <User size={28} />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-display font-bold text-xl text-content">{identity.displayName}</h2>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold" style={{ background: 'var(--color-cta-pale)', color: 'var(--color-cta)' }}>
                    {empId}
                  </span>
                </div>
                <p className="text-xs font-semibold text-content-3 mt-1 flex items-center gap-1.5">
                  <ShieldCheck size={14} className="text-success" />
                  <span>{ROLE_LABELS[identity.role] || identity.role}</span>
                </p>
              </div>
            </div>

            {/* Official Jurisdiction & Scope */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-content-3 mb-3 flex items-center gap-1.5">
                <MapPin size={14} /> Official Jurisdiction & Scope
              </h3>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="p-3 rounded-xl surface-2 border text-xs" style={{ borderColor: 'var(--color-border)' }}>
                  <span className="block text-[10px] font-bold text-content-3 uppercase">State</span>
                  <span className="font-bold text-content">{identity.scope.state || 'All States (National)'}</span>
                </div>
                <div className="p-3 rounded-xl surface-2 border text-xs" style={{ borderColor: 'var(--color-border)' }}>
                  <span className="block text-[10px] font-bold text-content-3 uppercase">District</span>
                  <span className="font-bold text-content">{identity.scope.district || 'All Districts'}</span>
                </div>
                <div className="p-3 rounded-xl surface-2 border text-xs" style={{ borderColor: 'var(--color-border)' }}>
                  <span className="block text-[10px] font-bold text-content-3 uppercase">Department</span>
                  <span className="font-bold text-content">{identity.scope.department || 'All Departments'}</span>
                </div>
                <div className="p-3 rounded-xl surface-2 border text-xs" style={{ borderColor: 'var(--color-border)' }}>
                  <span className="block text-[10px] font-bold text-content-3 uppercase">Ward / Officer ID</span>
                  <span className="font-bold text-content">{identity.scope.ward || identity.scope.officerId || 'Unrestricted'}</span>
                </div>
              </div>
            </div>

            {/* Authentication & Access Privileges */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-content-3 mb-3 flex items-center gap-1.5">
                <Key size={14} /> Account & Security Status
              </h3>
              <div className="p-3.5 rounded-xl surface-2 border text-xs space-y-2" style={{ borderColor: 'var(--color-border)' }}>
                <div className="flex items-center justify-between">
                  <span className="text-content-3">Auth Channel:</span>
                  <span className="font-mono font-bold capitalize text-content">{identity.channel} Authentication</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-content-3">Grant Authority:</span>
                  <span className="font-bold text-content">{identity.grantSource || 'Government Staff Directory'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-content-3">Security Level:</span>
                  <span className="font-bold text-success flex items-center gap-1">
                    <CheckCircle size={12} /> Verified Staff Member
                  </span>
                </div>
              </div>
            </div>

            {/* Active Permissions */}
            {identity.permissions && identity.permissions.length > 0 && (
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-content-3 mb-2 flex items-center gap-1.5">
                  <Building2 size={14} /> Active System Capabilities
                </h3>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-2 rounded-xl surface-2 border text-[11px]" style={{ borderColor: 'var(--color-border)' }}>
                  {identity.permissions.map((p, idx) => (
                    <span key={idx} className="px-2 py-1 rounded-md surface border font-mono font-medium text-content-2">
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-2">
              <button
                onClick={() => setShowProfile(false)}
                className="w-full h-11 rounded-xl text-sm font-bold text-white bg-cta hover:bg-cta-hover transition-colors shadow-sm"
              >
                Close Profile
              </button>
            </div>
          </div>
        </div>
      )}

      <main
        id="main-content"
        tabIndex={-1}
        className="flex-1 overflow-y-auto p-4 sm:p-6 focus:outline-none"
      >
        <ErrorBoundary scope="staff">{children}</ErrorBoundary>
      </main>
    </div>
  );
}
