/**
 * Split a .sql file into individual statements.
 *
 * Shared by db/seed.mjs and server/store.postgres.ts so the schema is applied
 * identically by both. They previously disagreed about the schema, which is
 * the bug this module exists to make impossible to repeat.
 *
 * Required because `@neondatabase/serverless`'s `neon()` HTTP driver sends
 * every query as a PREPARED statement, and Postgres refuses to parse more
 * than one command in one of those:
 *
 *   NeonDbError: cannot insert multiple commands into a prepared statement
 *
 * `split(';')` is not sufficient: 001_schema.sql contains dollar-quoted
 * function bodies whose semicolons would shred the statements. This tracks
 * every context in which a `;` is NOT a terminator.
 */
export function splitStatements(text) {
  const out = [];
  let buf = '';
  let i = 0;

  while (i < text.length) {
    const two = text.slice(i, i + 2);

    if (two === '--') {                       // line comment
      const nl = text.indexOf('\n', i);
      const end = nl === -1 ? text.length : nl;
      buf += text.slice(i, end);
      i = end;
      continue;
    }
    if (two === '/*') {                       // block comment (Postgres nests)
      let depth = 1; let j = i + 2;
      while (j < text.length && depth > 0) {
        if (text.slice(j, j + 2) === '/*') { depth++; j += 2; }
        else if (text.slice(j, j + 2) === '*/') { depth--; j += 2; }
        else j++;
      }
      buf += text.slice(i, j);
      i = j;
      continue;
    }
    if (text[i] === "'" || text[i] === '"') { // quoted literal / identifier
      const q = text[i];
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === q) {
          if (text[j + 1] === q) { j += 2; continue; } // '' escape
          j++; break;
        }
        if (q === "'" && text[j] === '\\') { j += 2; continue; }
        j++;
      }
      buf += text.slice(i, j);
      i = j;
      continue;
    }
    const dollar = /^\$[A-Za-z_0-9]*\$/.exec(text.slice(i));
    if (dollar) {                             // $$ ... $$ or $tag$ ... $tag$
      const tag = dollar[0];
      const close = text.indexOf(tag, i + tag.length);
      const j = close === -1 ? text.length : close + tag.length;
      buf += text.slice(i, j);
      i = j;
      continue;
    }
    if (text[i] === ';') {                    // top-level terminator
      if (buf.trim()) out.push(buf.trim());
      buf = '';
      i++;
      continue;
    }
    buf += text[i];
    i++;
  }

  if (buf.trim()) out.push(buf.trim());
  return out;
}
