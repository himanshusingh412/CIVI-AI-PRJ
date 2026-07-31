#!/usr/bin/env node
/**
 * Dev launcher.
 *
 * Frees the ports before starting, because the classic failure here is an
 * orphaned server from a previous run still holding :8787 with a stale copy
 * of .env — the new process then silently fails to bind (or you keep talking
 * to the old one) and nothing you change appears to take effect.
 *
 * Also tears both children down together, so Ctrl+C never leaves one behind.
 */
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

// `--preview` serves the production build instead of the dev server, so the
// exact bundle that ships can be exercised against a live API.
const PREVIEW = process.argv.includes('--preview');

const ROOT = path.resolve(import.meta.dirname, '..');
const API_PORT = Number(process.env.PORT || 8787);
const WEB_PORT = 3000;

function freePort(port) {
  try {
    // lsof exists on macOS and most Linux images; -t gives bare PIDs.
    const pids = execSync(`lsof -ti tcp:${port} 2>/dev/null || true`, { encoding: 'utf8' })
      .split('\n').map(s => s.trim()).filter(Boolean);
    for (const pid of pids) {
      if (Number(pid) === process.pid) continue;
      try {
        process.kill(Number(pid), 'SIGTERM');
        console.log(`[dev] freed port ${port} (killed stale pid ${pid})`);
      } catch { /* already gone */ }
    }
  } catch {
    // lsof unavailable — not fatal, the child will report EADDRINUSE itself.
  }
}

freePort(API_PORT);
freePort(WEB_PORT);

const children = [];
function run(name, cmd, args) {
  const child = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: false });
  child.on('exit', code => {
    if (code !== 0 && code !== null) console.error(`[dev] ${name} exited with code ${code}`);
    shutdown();
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try { c.kill('SIGTERM'); } catch { /* already dead */ }
  }
  setTimeout(() => process.exit(0), 300).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Small delay so the freed ports are actually released before rebinding.
setTimeout(() => {
  // The API always starts here. Starting the frontend alone is the single
  // most common way this app appears broken: every /api call falls through
  // to Vite's HTML and the UI reports "service unavailable".
  run('api', 'npx', ['tsx', 'watch', 'server/index.ts']);

  if (PREVIEW) {
    if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
      console.error('[dev] no dist/ found — run "npm run build" first.');
      shutdown();
      return;
    }
    run('web', 'npx', ['vite', 'preview', '--port', String(WEB_PORT)]);
  } else {
    run('web', 'npx', ['vite', '--port', String(WEB_PORT)]);
  }

  console.log(`\n[dev] api :${API_PORT}  ·  web :${WEB_PORT}  ${PREVIEW ? '(production build)' : '(dev server)'}`);
  console.log('[dev] run "npm run doctor" in another terminal if something looks wrong\n');
}, 400);
