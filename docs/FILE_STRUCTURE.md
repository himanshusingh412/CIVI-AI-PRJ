# File structure

```
civicai/
├── api/index.ts              Vercel entry — re-exports the Express app
├── server/
│   ├── index.ts              app assembly, middleware order, health
│   ├── config.ts             integration modes (live/demo/config/disabled)
│   ├── auth.ts               OTP, stateless HMAC sessions
│   ├── staff.ts              identity → role + jurisdiction
│   ├── rbac.ts               capability × scope
│   ├── workflow.ts           14-state machine
│   ├── admin.ts              staff API
│   ├── complaints.ts         citizen API + pre-submission review
│   ├── store.ts              persistence interface + in-memory impl
│   ├── store.postgres.ts     Postgres impl
│   ├── ocr.ts                document reading (gemini-vision | fixture)
│   ├── matching.ts           normalisation + fuzzy comparison
│   ├── verify.ts             cross-document report
│   ├── documents.ts          verification API (stores nothing)
│   ├── digilocker.ts         OAuth + simulator
│   ├── digilockerRoutes.ts   consent screen, callback, import
│   ├── notifications.ts      NotificationService + adapters
│   ├── notificationRoutes.ts preferences + inbox
│   ├── whatsapp.ts           transport, consent, window, signatures, replay
│   ├── whatsappRoutes.ts     webhook + conversation
│   ├── chat.ts               assistant understanding
│   ├── providers.ts          AI failover, text + vision
│   ├── security.ts           cookies, CSRF, timing, bot detection
│   ├── rateLimit.ts          per-surface limiters
│   ├── audit.ts              hash-chained log
│   ├── sla.ts                breach sweep + escalation
│   ├── duplicates.ts         similarity scoring
│   ├── media.ts              image storage
│   ├── email.ts  sms.ts      delivery
│   ├── events.ts             SSE
│   └── limits.ts             clamps and budgets
│
├── src/
│   ├── main.tsx              routes, providers, lazy boundaries
│   ├── App.tsx               citizen dashboard
│   ├── pages/
│   │   ├── LandingPage.tsx
│   │   ├── SignInPage.tsx
│   │   ├── AssistantPage.tsx
│   │   ├── DocumentVerificationPage.tsx
│   │   ├── ReportWizardPage.tsx
│   │   └── NotificationSettingsPage.tsx
│   ├── portals/
│   │   ├── RequireRole.tsx   render gate (NOT a security boundary)
│   │   ├── StaffShell.tsx    shared staff chrome
│   │   ├── OfficerPortalPage.tsx
│   │   ├── DepartmentPortalPage.tsx
│   │   └── AdminPortalPage.tsx
│   ├── components/
│   │   ├── admin/            AdminPortal, ComplaintDrawer
│   │   ├── staff/            OfficerWorkspace
│   │   ├── backgrounds/      PageBackground, Aurora, Threads
│   │   └── …                 Button, Skeleton, LanguagePicker, IntegrationBadge
│   ├── context/              Auth, Theme, Config
│   ├── hooks/                useVoice, useLiveComplaints, useThemeTokens
│   ├── services/             typed API clients
│   ├── i18n/                 locales, strings, provider
│   └── index.css             design tokens
│
├── db/
│   ├── 001_schema.sql        tables, indexes, triggers, complaints_api view
│   ├── 002_rls.sql           row-level security
│   └── seed.mjs              demonstration data
│
├── tests/                    matching · rbac · whatsapp · verify
├── docs/                     this documentation set
├── design/                   logo assets, brand plates
├── public/                   favicon, icons
└── scripts/                  dev.mjs, doctor.mjs
```

## Where to add things

| Adding | Goes in |
|---|---|
| An external provider | `server/<name>.ts` as an adapter with a simulation, registered in `config.ts` |
| A workflow state | `server/workflow.ts` **and** the `complaint_status` enum |
| A permission | `server/rbac.ts`, then the transitions that need it |
| A notification | A template in `notifications.ts`; nothing else changes |
| A citizen screen | `src/pages/`, lazy-routed in `main.tsx` |
| A staff screen | `src/components/staff/`, wrapped in `RequireRole` + `StaffShell` |
| A translated string | `en` in `src/i18n/strings.ts`; others fall back key by key |

## Ignore

`_to_delete/` holds files the development sandbox could not unlink. Safe to
delete the whole folder.
