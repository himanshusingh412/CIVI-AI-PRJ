#!/usr/bin/env node
/**
 * Config doctor — answers "why isn't X working?" in one command.
 *
 * Most confusion in this project comes from a stale dev process: .env is read
 * once at boot, and Vite inlines VITE_* at startup, so editing .env while the
 * servers run changes nothing. This script compares what's on disk against
 * what the running server actually loaded and names the difference.
 */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';

const ROOT = path.resolve(import.meta.dirname, '..');
const API_PORT = Number(process.env.PORT || 8787);
const WEB_PORT = 3000;

const green = s => `\x1b[32m${s}\x1b[0m`;
const red = s => `\x1b[31m${s}\x1b[0m`;
const yellow = s => `\x1b[33m${s}\x1b[0m`;
const dim = s => `\x1b[2m${s}\x1b[0m`;

const OK = green('✓');
const BAD = red('✗');
const WARN = yellow('!');

function parseEnv(file) {
  if (!fs.existsSync(file)) return null;
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const portOpen = port =>
  new Promise(resolve => {
    const s = net.createConnection({ port, host: '127.0.0.1' });
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    setTimeout(() => { s.destroy(); resolve(false); }, 1500);
  });

const mask = v => (!v ? '' : v.length <= 12 ? '***' : `${v.slice(0, 6)}…${v.slice(-4)}`);

const problems = [];

console.log(`\n${dim('CivicAI config doctor')}\n`);

// ── 1. .env on disk ──
const env = parseEnv(path.join(ROOT, '.env'));
console.log('.env file');
if (!env) {
  console.log(`  ${BAD} .env not found — copy .env.example to .env`);
  problems.push('missing .env');
} else {
  const checks = [
    ['SESSION_SECRET', true, v => v.length >= 32, 'must be >= 32 chars'],
    ['GOOGLE_CLIENT_ID', false, v => v.endsWith('.apps.googleusercontent.com'), 'should end in .apps.googleusercontent.com'],
    ['VITE_GOOGLE_CLIENT_ID', false, v => v === env.GOOGLE_CLIENT_ID, 'should match GOOGLE_CLIENT_ID'],
    ['AI_API_KEY', false, () => true, ''],
    ['AWS_BEARER_TOKEN_BEDROCK', false, () => true, ''],
    ['RESEND_API_KEY', false, () => true, ''],
    /**
     * DATABASE_URL was absent from this list, which made the doctor silent
     * about the single variable that decides whether anything is saved.
     *
     * Both validations below cost real debugging time when wrong:
     *   -pooler   a direct connection exhausts its slot limit under
     *             serverless, failing only once traffic arrives
     *   sslmode   Neon refuses the connection outright without it
     */
    ['DATABASE_URL', false,
      v => v.startsWith('postgres') && v.includes('-pooler.') && v.includes('sslmode=require'),
      'use the POOLED string (host contains "-pooler") and keep ?sslmode=require'],
  ];
  // Copy-pasting docs verbatim leaves things like "<your new key>" behind.
  // These are worse than empty: the app treats them as configured and every
  // call fails with a confusing 401/403 instead of falling back cleanly.
  const isPlaceholder = v =>
    /^<.*>$/.test(v) ||
    /^(your|paste|replace|changeme|xxx+|todo)/i.test(v) ||
    v.includes('apps.googleusercontent.com') === false && /^sk-ant-\.\.\.$/.test(v);

  for (const [key, required, valid, hint] of checks) {
    const v = env[key] ?? '';
    if (v && isPlaceholder(v)) {
      console.log(`  ${BAD} ${key} = ${dim(v)} ${red('← placeholder, not a real value')}`);
      problems.push(`${key} still contains a placeholder — set it or leave it empty`);
      continue;
    }
    if (!v) {
      const icon = required ? BAD : WARN;
      console.log(`  ${icon} ${key} ${dim('(empty)')}`);
      if (required) problems.push(`${key} is required`);
    } else if (!valid(v)) {
      console.log(`  ${BAD} ${key} = ${mask(v)} ${dim(hint)}`);
      problems.push(`${key} ${hint}`);
    } else {
      console.log(`  ${OK} ${key} = ${mask(v)}`);
    }
  }
}

// ── 2. running processes ──
console.log('\nprocesses');
const apiUp = await portOpen(API_PORT);
const webUp = await portOpen(WEB_PORT);
console.log(`  ${apiUp ? OK : BAD} API server  :${API_PORT}`);
console.log(`  ${webUp ? OK : BAD} Vite dev    :${WEB_PORT}`);
if (!apiUp) problems.push(`nothing listening on :${API_PORT} — run "npm run dev:full"`);

// ── 3. what the RUNNING server actually loaded ──
if (apiUp) {
  console.log('\nrunning server (live values)');
  try {
    const health = await fetch(`http://127.0.0.1:${API_PORT}/api/health`).then(r => r.json());
    const cfgRes = await fetch(`http://127.0.0.1:${API_PORT}/api/config`);

    const live = {
      gemini: !!health?.providers?.gemini?.configured,
      bedrock: !!health?.providers?.bedrock?.configured,
      google: !!health?.google?.enabled,
      email: health?.email?.provider,
    };
    console.log(`  ${live.gemini ? OK : WARN} gemini      ${live.gemini}`);
    console.log(`  ${live.bedrock ? OK : WARN} bedrock     ${live.bedrock}`);
    console.log(`  ${live.google ? OK : WARN} google      ${live.google}`);
    console.log(`  ${dim('·')} email       ${live.email}`);

    if (cfgRes.status === 404) {
      console.log(`  ${BAD} /api/config missing — server is running OLD code`);
      problems.push('API server predates the current code — restart it');
    }

    // The decisive check: disk vs. memory.
    if (env) {
      const drift = [];
      if (!!env.AI_API_KEY !== live.gemini) drift.push('AI_API_KEY');
      if (!!env.GOOGLE_CLIENT_ID !== live.google) drift.push('GOOGLE_CLIENT_ID');
      if (!!env.AWS_BEARER_TOKEN_BEDROCK !== live.bedrock) drift.push('AWS_BEARER_TOKEN_BEDROCK');
      if (drift.length) {
        console.log(`\n  ${BAD} ${red('STALE PROCESS')} — .env on disk disagrees with the running server`);
        console.log(`     differs: ${drift.join(', ')}`);
        console.log(`     .env is read once at boot. ${yellow('Restart: Ctrl+C then npm run dev:full')}`);
        problems.push('stale server process — restart required');
      }
    }
  } catch (err) {
    console.log(`  ${BAD} could not read /api/health (${err.message})`);
    problems.push('API server not responding correctly');
  }
}

// ── verdict ──
console.log('');
if (!problems.length) {
  console.log(green('All good — config on disk matches the running servers.\n'));
  process.exit(0);
}
console.log(red(`${problems.length} issue${problems.length > 1 ? 's' : ''}:`));
for (const p of problems) console.log(`  • ${p}`);
console.log('');
process.exit(1);
