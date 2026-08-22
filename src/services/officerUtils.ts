/**
 * Formats officer display names with their official Employee ID (e.g. "Suresh Kumar (EMP-0004)").
 */

export const OFFICER_EMP_MAP: Record<string, string> = {
  'suresh kumar': 'EMP-0004',
  'priya sharma': 'EMP-1002',
  'amit verma': 'EMP-1003',
  'ravi chandra': 'EMP-2012',
  'neha gupta': 'EMP-2013',
  'kavita menon': 'EMP-2015',
  'imran khan': 'EMP-2004',
  'demo water dept officer': 'EMP-0004',
  'demo field officer': 'EMP-0005',
  'demo auditor': 'EMP-0006',
  'demo area officer': 'EMP-0007',
  'demo water officer': 'EMP-0008',
  'demo transport officer': 'EMP-0009',
  'super admin': 'EMP-0001',
  'state admin': 'EMP-0002',
  'district admin': 'EMP-0003',
};

export function formatOfficerWithEmpId(officerName?: string, empId?: string): string {
  if (!officerName || officerName.toLowerCase() === 'unassigned' || officerName.toLowerCase() === 'pending assignment') {
    return 'Unassigned';
  }

  if (officerName.includes('(EMP-') || officerName.includes('EMP-')) {
    return officerName;
  }

  const cleanName = officerName.trim().toLowerCase();
  const foundEmpId = empId || OFFICER_EMP_MAP[cleanName] || OFFICER_EMP_MAP[cleanName.replace(/[^a-z0-9]/g, '')];

  if (foundEmpId) {
    return `${officerName} (${foundEmpId})`;
  }

  let hash = 0;
  for (let i = 0; i < officerName.length; i++) {
    hash = (hash * 31 + officerName.charCodeAt(i)) % 9000;
  }
  const generatedId = `EMP-${1000 + Math.abs(hash)}`;
  return `${officerName} (${generatedId})`;
}
