#!/usr/bin/env node
/**
 * One-shot codemod: lift hardcoded user-facing strings into the dictionary.
 *
 *   node scripts/i18n-extract.mjs --dry            preview
 *   node scripts/i18n-extract.mjs --files a,b,c    apply to specific files
 *
 * Handles only the three shapes where the replacement is STRUCTURALLY safe,
 * because a codemod that produces broken JSX costs more than it saves:
 *
 *   attr="Text"     → attr={t('key')}
 *   fn('Text')      → fn(t('key'))
 *   >Text<          → >{t('key')}<     (single line only)
 *
 * Multi-line JSX prose is deliberately left alone — the closing context is
 * not visible on the line being rewritten, so the safe move is to report it
 * and let a human place it. Run scripts/check-i18n.mjs afterwards to see
 * what is left.
 *
 * English values come from the source itself, so the English dictionary is
 * always complete by construction. Translations are NOT invented here:
 * check-i18n.mjs then reports them as missing, which is the honest state.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const FILES = args.includes('--files') ? args[args.indexOf('--files') + 1].split(',') : [];

const TEXT_ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'loadingText'];
const MSG_CALLS = ['setError', 'setInfo', 'setToast', 'setMessage', 'setSuccess'];

const BRANDS = /^(CivicAI|MITRA|DigiLocker|WhatsApp|Google|Firebase|Aadhaar|PAN)$/;

/** Stable, readable key from a file path and the string itself. */
function makeKey(file, text) {
  const ns = file
    .replace(/^src\//, '')
    .replace(/\.(tsx|ts)$/, '')
    .split('/')
    .pop()
    .replace(/Page$|Screen$/, '')
    .replace(/^./, (c) => c.toLowerCase());

  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join('');

  return `${ns}.${slug || 'text'}`;
}

const skip = (t) => {
  const v = t.trim();
  return (
    v.length < 3 ||
    !/[a-zA-Z]{3}/.test(v) ||
    BRANDS.test(v) ||
    /^[a-z0-9-]+$/.test(v) ||
    /^[A-Z0-9_]+$/.test(v) ||
    /^\d/.test(v) ||
    /^https?:/.test(v) ||
    // Code that merely LOOKS like prose once it sits between two angle
    // brackets: `Date.parse(r.slaDeadline)` in an arrow-function body reads
    // as a JSX text node to a line-based regex. Any call, member access or
    // operator disqualifies it.
    /[(){}[\]=;]|\w\.\w/.test(v) ||
    (!/\s/.test(v) && !/^[A-Z]/.test(v))
  );
};

const collected = new Map(); // key -> english

function convert(rel) {
  const abs = join(ROOT, rel);
  let src = readFileSync(abs, 'utf8');
  const before = src;
  let n = 0;

  const take = (text) => {
    const key = makeKey(rel, text);
    if (!collected.has(key)) collected.set(key, text);
    n++;
    return key;
  };

  const lines = src.split('\n');
  let inImport = false;

  const out = lines.map((raw) => {
    if (/^\s*import\b/.test(raw)) inImport = !/from\s+['"]/.test(raw);
    if (inImport) { if (/from\s+['"]/.test(raw)) inImport = false; return raw; }
    if (/^\s*[*/]/.test(raw)) return raw;
    if (/\b(Promise|Record|Array|Map|Set|Partial|Omit|Pick|React\.FC)\s*</.test(raw)) return raw;

    let line = raw;

    for (const attr of TEXT_ATTRS) {
      line = line.replace(new RegExp(`(\\b${attr}=)"([^"]+)"`, 'g'), (m, p, txt) =>
        skip(txt) ? m : `${p}{t('${take(txt)}')}`);
    }

    for (const fn of MSG_CALLS) {
      line = line.replace(new RegExp(`(\\b${fn}\\()'([^']{4,})'`, 'g'), (m, p, txt) =>
        skip(txt) ? m : `${p}t('${take(txt)}')`);
      line = line.replace(new RegExp(`(\\b${fn}\\()"([^"]{4,})"`, 'g'), (m, p, txt) =>
        skip(txt) ? m : `${p}t('${take(txt)}')`);
    }

    // single-line JSX text node
    line = line.replace(/>(\s*)([A-Z][^<>{}"'`\n]{2,}?)(\s*)</g, (m, a, txt, b) =>
      skip(txt) ? m : `>${a}{t('${take(txt.trim())}')}${b}<`);

    return line;
  });

  src = out.join('\n');

  /*
   * Bring `t` into scope wherever the rewrite introduced it.
   *
   * This is the half a naive codemod forgets: lifting the string is useless
   * if the identifier is undefined at the call site, and a file can hold
   * several components (RequireRole + AccessRefused in one file, say), each
   * needing its OWN hook call — hooks cannot be hoisted to module scope.
   *
   * So: find every function component that now references t( and does not
   * already bind it, and insert the hook on the line after its opening
   * brace. Components are matched on the React convention of a capitalised
   * name, which is also exactly the rule that decides whether hooks are
   * legal inside them.
   */
  if (n > 0) {
    // Check for the NAMED import, not merely the module path: a file that
    // already imports `useI18n` from this module still has no `useT` in
    // scope, and matching on the path alone silently skips adding it.
    if (!/\buseT\b[^\n]*from ['"][^'"]*i18n\/I18nContext['"]/.test(src)) {
      const depth = '../'.repeat(rel.split('/').length - 2) || './';
      // Extend an existing import from this module rather than adding a
      // second import statement for the same path.
      const existing = src.match(/import \{([^}]*)\} from (['"][^'"]*i18n\/I18nContext['"]);/);
      if (existing) {
        src = src.replace(
          existing[0],
          `import {${existing[1].replace(/\s+$/, '')}, useT } from ${existing[2]};`,
        );
      } else {
        const importLine = `import { useT } from '${depth}i18n/I18nContext';`;
        const ls = src.split('\n');
        let last = 0;
        for (let i = 0; i < Math.min(ls.length, 80); i++) {
          if (/from\s+['"]/.test(ls[i]) && /^\s*(import|\})/.test(ls[i])) last = i;
        }
        ls.splice(last + 1, 0, importLine);
        src = ls.join('\n');
      }
    }

    const compRe = /^(?:export\s+)?function\s+([A-Z]\w*)\s*\([\s\S]*?\)\s*(?::[^{]*)?\{$/gm;
    const bodies = [...src.matchAll(compRe)];
    for (let i = bodies.length - 1; i >= 0; i--) {
      const m = bodies[i];
      const start = m.index + m[0].length;
      const next = bodies[i + 1]?.index ?? src.length;
      const body = src.slice(start, next);
      if (!/\bt\(/.test(body)) continue;
      if (/\b(const|let)\s*\{?[^}\n]*\bt\b[^}\n]*\}?\s*=/.test(body.slice(0, 400))) continue;
      src = src.slice(0, start) + '\n  const t = useT();' + src.slice(start);
    }
  }

  if (src !== before && !DRY) writeFileSync(abs, src);
  return n;
}

const targets = FILES.length ? FILES : [];
if (!targets.length) {
  console.error('Pass --files a.tsx,b.tsx (this codemod is deliberately opt-in per file).');
  process.exit(1);
}

let total = 0;
for (const f of targets) {
  const n = convert(f);
  total += n;
  console.log(`  ${f}: ${n} strings lifted`);
}

console.log(`\n${total} strings → ${collected.size} keys\n`);
console.log('── paste into the `en` dictionary ──\n');
for (const [k, v] of [...collected].sort()) {
  const esc = v.replace(/'/g, "\\'");
  console.log(`  '${k}': '${esc}',`);
}
