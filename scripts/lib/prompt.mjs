/**
 * Terminal prompts for the provisioning scripts.
 *
 * `askHidden` exists because readline's `question()` echoes every keystroke,
 * and the obvious workaround — let it echo, then clearLine() and repaint the
 * prompt — does not actually work. By the time the repaint runs the password
 * has already been written to the terminal; it is gone from the visible line
 * but not from a recorded session, from a scrollback buffer someone else
 * reads, or from the shoulder of the person standing behind you. "Briefly
 * displayed" is still displayed.
 *
 * So this turns echo off at the tty instead, in raw mode, and does the
 * rendering itself — which is to say, none.
 */
import { createInterface } from 'node:readline';

const CTRL_C = '\u0003';
const DEL = '\u007f';

/** Plain, echoing prompt. Returns the trimmed answer, or `dflt` if empty. */
export function makeAsker() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q, dflt = '') =>
    new Promise(res =>
      rl.question(dflt ? `${q} [${dflt}]: ` : `${q}: `, a => res(a.trim() || dflt)),
    );
  return { ask, close: () => rl.close() };
}

/**
 * Read a secret with echo disabled.
 *
 * Close any readline interface BEFORE calling this: readline keeps its own
 * listener on stdin and will echo the keystrokes this is trying to hide.
 *
 * Without a tty, echo cannot be suppressed at all, so this refuses rather
 * than silently accepting a visible password. Automation that needs a hash
 * should compute it offline and set ADMIN_CREDENTIALS directly.
 */
export function askHidden(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('no tty: run this in a terminal, where the password can be hidden'));
      return;
    }
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    let buf = '';
    const finish = (fn, arg) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off('data', onData);
      process.stdout.write('\n');
      fn(arg);
    };
    const onData = chunk => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return finish(resolve, buf);
        // Ctrl-C must be handled here: raw mode means the tty no longer turns
        // it into SIGINT, so without this the script cannot be quit.
        if (ch === CTRL_C) return finish(() => process.exit(130));
        if (ch === DEL || ch === '\b') buf = buf.slice(0, -1);
        else if (ch >= ' ') buf += ch;
      }
    };
    process.stdin.on('data', onData);
  });
}

/** Both prompts, matched. Exits non-zero on a short or mismatched password. */
export async function askNewPassword(minLength = 12) {
  const password = await askHidden('Password: ');
  if (password.length < minLength) {
    console.error(
      `\nRefusing: use at least ${minLength} characters. This opens a government portal.`,
    );
    process.exit(1);
  }
  if ((await askHidden('Confirm:  ')) !== password) {
    console.error('\nPasswords do not match.');
    process.exit(1);
  }
  return password;
}
