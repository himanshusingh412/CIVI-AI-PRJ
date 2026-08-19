# Tech stack

| Layer | Choice | Why this one |
|---|---|---|
| UI | React 19 | Concurrent rendering; the team knows it |
| Build | Vite 6 | Fast cold start, straightforward manual chunking |
| Language | TypeScript 5.8 | `strictNullChecks` is **off** — see the note below |
| Styling | Tailwind 4 + CSS custom properties | Tokens live in `index.css` so theming is one file |
| Routing | React Router 7 | |
| Motion | `motion` (Framer) | Respects `prefers-reduced-motion` throughout |
| Charts | Recharts | |
| Maps | Leaflet + react-leaflet | No API key, no vendor account |
| 3D | ogl | ~10× smaller than three.js for two shaders |
| Icons | lucide-react | Tree-shakeable |
| Server | Express 4 | |
| Runtime | Node 20+, `tsx` in development | |
| Database | Postgres (Neon serverless driver) | HTTP driver survives serverless |
| AI | `@google/genai`, plus REST for Bedrock and Anthropic | |
| Tests | `node:test` via `tsx` | No framework dependency |
| Hosting | Vercel | |

## Notable non-choices

**No server framework beyond Express.** Auth, RBAC, rate limiting, CSRF and
the audit log are hand-rolled — about 3,000 lines, all inspectable. A
grievance portal's security properties should be readable end to end rather
than distributed across a framework's conventions.

**No i18n library.** Lookup with fallback plus a direction flip is ~40 lines.
A 40 kB dependency would cost more than it returns on a portal whose users
are largely on slow connections.

**No state management library.** React context for auth, theme, config and
language; local state elsewhere. Nothing here needs Redux.

**No ORM.** Parameterised tagged templates through the Neon driver. The
schema is SQL in `db/`, readable by a DBA who has never seen this codebase.

**No multipart parser.** Uploads are raw bodies, one file per request.
Multipart libraries have a long history of path-traversal and
resource-exhaustion issues on exactly this kind of endpoint.

## About `strictNullChecks`

It is off, inherited from the project's origin. That has a real consequence
this codebase works around repeatedly: **TypeScript will not narrow a
discriminated union on `result.ok`** unless the success branch explicitly
declares the failure members as `undefined`.

```ts
export type Result =
  | { ok: true;  value: string; reason?: undefined }
  | { ok: false; reason: string; value?: undefined };
```

That `reason?: undefined` is load-bearing. It appears in `sms.ts`, `rbac.ts`,
`ocr.ts` and `whatsapp.ts`, each with a comment saying so. Turning
`strictNullChecks` on is the right long-term fix and a large change.

## Bundle

| Chunk | Raw | Gzip | Loaded |
|---|---|---|---|
| charts | 311 kB | 86 kB | citizen dashboard |
| react | 194 kB | 61 kB | always |
| maps | 154 kB | 45 kB | dashboard, wizard |
| index | ~177 kB | ~49 kB | always |
| motion | 127 kB | 42 kB | always |
| vendor | 119 kB | 40 kB | always |
| backgrounds | 45 kB | 13 kB | only on capable devices |
| staff portals | <25 kB each | | only for staff |

Staff bundles are lazy, so a citizen never downloads the administration
code. `charts` is the largest single item and is still pulled in by the
citizen dashboard — the highest-value remaining optimisation.
