#!/usr/bin/env node
/**
 * i18n audit.
 *
 * Answers two questions that are otherwise guesses:
 *
 *   1. COVERAGE  — which user-facing strings are still hardcoded in
 *                  components instead of going through t()?
 *   2. PARITY    — which English keys have no translation in each locale?
 *
 * Run:  node scripts/check-i18n.mjs            (report)
 *       node scripts/check-i18n.mjs --strict   (exit 1 if hardcoded found)
 *       node scripts/check-i18n.mjs --locale hi
 *
 * ── on false positives ──
 *
 * A naive "find quoted strings" scan flags className, import paths, CSS
 * values, enum members and test ids, drowns the real findings, and gets
 * switched off within a day. The filters below are therefore deliberately
 * conservative: this reports FEWER things than a human would, so that what
 * it does report is worth reading. A clean run is not proof of full
 * coverage — it means the mechanical offenders are gone.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');

const args = process.argv.slice(2);
const STRICT = args.includes('--strict');
const ONLY_LOCALE = args.includes('--locale') ? args[args.indexOf('--locale') + 1] : null;

// Files that legitimately contain English literals: the dictionaries
// themselves, plus the locale metadata.
const SKIP_FILES = [/src[\\/]i18n[\\/]/];

// Attributes whose values reach a human (visually or via assistive tech).
const TEXT_ATTRS = ['placeholder', 'title', 'aria-label', 'aria-description', 'alt', 'loadingText'];

// Calls whose first string argument is shown to a person.
const MSG_CALLS = ['setError', 'setInfo', 'setToast', 'setMessage', 'setSuccess', 'toast', 'alert', 'notify'];

/**
 * Strings that look like prose but are not. Ordered cheapest-first.
 * A string must look like a SENTENCE OR LABEL to be reported: at least one
 * space or three letters, and not matching any technical shape below.
 */
const TECHNICAL = [
  /^[a-z0-9-]+$/,                       // css class, slug, enum member
  /^[A-Z0-9_]+$/,                        // CONSTANT_CASE
  /^[\w.-]+\/[\w./-]*$/,                 // paths, mime types
  /^https?:\/\//i,                       // urls
  /^[#.][\w-]+$/,                        // selectors
  /^\d/,                                 // starts with a digit
  /^[^a-zA-Z]*$/,                        // no letters at all
  /^(px|rem|em|vh|vw|auto|none|flex|grid|block|inline|absolute|relative|fixed|sticky)$/,
  /^(true|false|null|undefined|GET|POST|PATCH|PUT|DELETE)$/,
  /^[a-z]+([A-Z][a-z]*)+$/,              // camelCase identifier
  /^\s*$/,
  // Brand and product names are the same in every language; translating
  // them is a bug, not a gap.
  /^(CivicAI|MITRA|DigiLocker|WhatsApp|Google|Firebase|Vercel|Aadhaar|PAN)$/,
];

const isTechnical = (s) => {
  const v = s.trim();
  if (v.length < 3) return true;
  if (!/[a-zA-Z]{3}/.test(v)) return true;
  // A single lowercase word with no space is almost always an identifier.
  if (!/\s/.test(v) && !/^[A-Z]/.test(v)) return true;
  return TECHNICAL.some((re) => re.test(v));
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (['.tsx', '.ts'].includes(extname(p))) out.push(p);
  }
  return out;
}

function scanFile(file) {
  const rel = relative(ROOT, file);
  if (SKIP_FILES.some((re) => re.test(rel))) return null;

  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const findings = [];

  const add = (line, kind, text) => {
    if (isTechnical(text)) return;
    findings.push({ line: line + 1, kind, text: text.trim().slice(0, 72) });
  };

  /*
   * Multi-line import blocks are the single biggest source of noise: a
   * member list like `  MessageSquare,` is indistinguishable from a line of
   * JSX prose by shape alone. Track the block instead of trying to out-regex
   * it — 90 of the first 96 findings in App.tsx were import members, which is
   * exactly the ratio that gets a linter ignored.
   */
  let inImport = false;

  lines.forEach((raw, i) => {
    // Strip line comments so prose in comments is not reported.
    const line = raw.replace(/\/\/.*$/, '');
    if (/^\s*\*/.test(raw) || /^\s*\/\*/.test(raw)) return;

    if (/^\s*import\b/.test(raw)) inImport = !/;\s*$/.test(raw) && !/from\s+['"]/.test(raw);
    if (inImport) {
      if (/from\s+['"]|;\s*$/.test(raw)) inImport = false;
      return;
    }

    // Type positions look like JSX text once the angle brackets line up.
    if (/\b(Promise|Record|Array|Map|Set|Partial|Omit|Pick|React\.FC)\s*</.test(raw)) return;

    // 1. text-bearing JSX attributes with a literal value
    for (const attr of TEXT_ATTRS) {
      const m = line.match(new RegExp(`\\b${attr}\\s*=\\s*["']([^"']+)["']`));
      if (m) add(i, attr, m[1]);
    }

    // 2. user-facing message calls with a literal first argument
    for (const fn of MSG_CALLS) {
      const m = line.match(new RegExp(`\\b${fn}\\s*\\(\\s*["']([^"']{4,})["']`));
      if (m) add(i, fn, m[1]);
    }

    // 3. JSX text nodes: >Some words< on one line
    const jsx = line.match(/>\s*([A-Z][^<>{}"'`]{3,})\s*</);
    if (jsx) add(i, 'jsx-text', jsx[1]);

    // 4. a lone prose line between tags (multi-line JSX text).
    //    Requires a space: a single capitalised token on its own line is far
    //    more often an identifier than a sentence.
    if (
      /^\s*[A-Z][A-Za-z,'’\- ]{6,}[.?!]?\s*$/.test(raw) &&
      /\s\S/.test(raw.trim()) &&
      !/[<>{}=;()]/.test(raw)
    ) {
      add(i, 'jsx-text', raw);
    }
  });

  return findings.length ? { file: rel, findings } : null;
}

// ───────────────────────── parity ─────────────────────────
function parity() {
  const src = readFileSync(join(SRC, 'i18n', 'strings.ts'), 'utf8');

  const block = (name) => {
    const m = src.match(new RegExp(`(?:^|\\n)\\s*(?:const )?${name}\\s*:?[^=:]*[=:]\\s*\\{`));
    if (!m) return null;
    let i = m.index + m[0].length, depth = 1;
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      i++;
    }
    return src.slice(m.index + m[0].length, i);
  };

  const keysOf = (body) => new Set([...body.matchAll(/'([^']+)'\s*:/g)].map((m) => m[1]));

  const enBody = block('en');
  if (!enBody) return { error: 'could not locate the `en` dictionary' };
  const en = keysOf(enBody);

  const locales = [...src.matchAll(/\n  ([a-z]{2}):\s*\{/g)].map((m) => m[1]);
  const rows = [];
  for (const code of locales) {
    if (code === 'en') continue;
    if (ONLY_LOCALE && code !== ONLY_LOCALE) continue;
    const body = block(code);
    if (!body) continue;
    const have = keysOf(body);
    const missing = [...en].filter((k) => !have.has(k));
    rows.push({ code, total: en.size, have: have.size, missing });
  }
  return { en: en.size, rows };
}

// ───────────────────────── run ─────────────────────────
const results = walk(SRC).map(scanFile).filter(Boolean)
  .sort((a, b) => b.findings.length - a.findings.length);

const totalHardcoded = results.reduce((n, r) => n + r.findings.length, 0);

console.log('\n═══ HARDCODED USER-FACING STRINGS ═══\n');
if (!results.length) {
  console.log('  none found by the mechanical scan\n');
} else {
  for (const r of results) {
    console.log(`  ${r.file}  (${r.findings.length})`);
    for (const f of r.findings.slice(0, 6)) {
      console.log(`      ${String(f.line).padStart(4)}  [${f.kind}] ${f.text}`);
    }
    if (r.findings.length > 6) console.log(`      … ${r.findings.length - 6} more`);
  }
  console.log(`\n  TOTAL: ${totalHardcoded} in ${results.length} files`);
}

const p = parity();
console.log('\n═══ TRANSLATION PARITY ═══\n');
if (p.error) {
  console.log(`  ${p.error}`);
} else {
  console.log(`  English keys: ${p.en}\n`);
  for (const r of p.rows) {
    const pct = Math.round((r.have / r.total) * 100);
    const bar = '█'.repeat(Math.round(pct / 5)).padEnd(20, '·');
    console.log(`  ${r.code}  ${bar} ${String(pct).padStart(3)}%  ${r.have}/${r.total}  (${r.missing.length} missing)`);
  }
  if (ONLY_LOCALE && p.rows[0]?.missing.length) {
    console.log(`\n  Missing in ${ONLY_LOCALE}:`);
    for (const k of p.rows[0].missing) console.log(`    ${k}`);
  }
}
console.log('');

if (STRICT && totalHardcoded > 0) process.exit(1);
