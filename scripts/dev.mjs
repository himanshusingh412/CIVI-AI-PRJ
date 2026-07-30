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
  run('api', 'npx', ['tsx', 'watch', 'server/index.ts']);
  run('web', 'npx', ['vite', '--port', String(WEB_PORT)]);
  console.log(`\n[dev] api :${API_PORT}  ·  web :${WEB_PORT}`);
  console.log('[dev] run "npm run doctor" in another terminal if something looks wrong\n');
}, 400);
