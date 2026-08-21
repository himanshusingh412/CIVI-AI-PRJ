#!/usr/bin/env node
/**
 * Generate an ADMIN_CREDENTIALS entry for the staff portal.
 *
 *   node scripts/hash-admin-password.mjs EMP-2012 ravi@gov.in
 *
 * Prompts for the password without echoing it, prints one JSON object, and
 * never writes anything to disk.
 *
 * The password is read from a TTY rather than taken as an argv parameter on
 * purpose: arguments are visible in `ps`, land in shell history, and get
 * captured by process accounting. A credential that is easy to pass on the
 * command line is a credential that leaks into three logs on its way in.
 */
import { createInterface } from 'node:readline';
import { hashPassword } from '../server/adminAuth.ts';

const [employeeId, subject] = process.argv.slice(2);

if (!employeeId || !subject) {
  console.error(`
Usage: node scripts/hash-admin-password.mjs <employeeId> <subject>

  employeeId  what the person types at /admin/login   e.g. EMP-2012
  subject     how they appear in the staff directory  e.g. ravi@gov.in
              (an email, or a phone in E.164 like +919000000001)

The subject MUST match the staff directory entry (server/staff.ts), because
the session is minted over it and the role lookup keys on its hash. A
credential whose subject is not in the directory will authenticate and then
resolve to no role at all.
`);
  process.exit(1);
}

function askHidden(prompt) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const onData = (ch) => {
      // Repaint the prompt with no echo, so the password never reaches the
      // terminal scrollback.
      const s = ch.toString();
      if (s === '\n' || s === '\r' || s === '') return;
      process.stdout.clearLine?.(0);
      process.stdout.cursorTo?.(0);
      process.stdout.write(prompt);
    };
    process.stdin.on('data', onData);
    rl.question(prompt, (answer) => {
      process.stdin.off('data', onData);
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const password = await askHidden('Password: ');

if (password.length < 12) {
  console.error('\nRefusing: use at least 12 characters. This credential opens a government portal.');
  process.exit(1);
}

const confirm = await askHidden('Confirm:  ');
if (confirm !== password) {
  console.error('\nPasswords do not match.');
  process.exit(1);
}

const passwordHash = await hashPassword(password);

console.log('\nAdd this object to the ADMIN_CREDENTIALS JSON array:\n');
console.log(JSON.stringify({ employeeId, subject, passwordHash }, null, 2));
console.log(`
ADMIN_CREDENTIALS is a SERVER-side variable. Never prefix it with VITE_ —
that would compile the hash into the browser bundle and hand every visitor
an offline cracking target.
`);
