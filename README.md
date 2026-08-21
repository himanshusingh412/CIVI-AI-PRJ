# CivicAI

> AI-powered multilingual civic grievance management and government complaint coordination platform.

CivicAI connects citizens with municipal government authorities. It streamlines civic issue reporting, automates department tagging via AI, provides real-time resolution timelines, and equips administrators and field officers with role-based jurisdiction workflows.

---

## Overview

CivicAI is designed to address fundamental challenges in civic administration. It provides an intuitive interface for citizens to submit grievances by voice, chat, or guided form in **12 Indian languages**, while enforcing strict administrative governance, department-wise isolation, and officer accountability on the backend.

### For Citizens
- **File Civic Complaints:** Submit issues with photos, voice recordings, or text.
- **Real-Time Progress Tracking:** Follow every complaint status change with timestamped audit logs.
- **Multilingual AI Assistance:** Get Instant guidance on municipal schemes and complaint filing in regional languages.
- **Dynamic Profile & Document Verification:** Cross-check identity documents before applying for civic services.

### For Government & Administration
- **Department-Based Workflow:** Scoped queues for Electricity, Water, Roads, Sanitation, Health, and Police.
- **Geographic & Role-Based Isolation:** Access restricted by State, District, Department, Municipal Ward, or Officer ID.
- **Complaint Assignment & Reassignment:** Assign complaints to field officers with deadline tracking and SLA alerts.
- **Tamper-Evident Audit Logging:** Hash-chained activity history for complete administrative transparency.

---

## Problem

Municipal governance frequently suffers from operational bottlenecks:

1. **Unclear Department Jurisdiction:** Citizens often do not know whether an issue falls under the Jal Board, Electricity Board, PWD (Roads), or Municipal Corporation.
2. **Lack of Resolution Visibility:** Complaints disappear into bureaucratic workflows without reference tracking or estimated resolution times.
3. **Application Rejection over Minor Discrepancies:** Citizens discover document mismatches (e.g., name spelling or date formats) weeks after submission.
4. **Language & Accessibility Barriers:** Traditional municipal portals are rarely accessible in native regional Indian languages.
5. **Insecure Access Control:** Legacy administrative systems often lack fine-grained data isolation between different departments and geographic wards.

---

## Solution

CivicAI provides a structured, transparent, and automated resolution pipeline:

```
Citizen Submission
       │
       ▼
AI Classification & Triage
       │
       ▼
Department Identification (e.g., Water, Roads, Electricity)
       │
       ▼
District & Municipal Ward Mapping
       │
       ▼
Local Officer Assignment
       │
       ▼
Field Investigation & Action
       │
       ▼
Resolution Proposal & Evidence
       │
       ▼
Citizen Confirmation & Closure
```

---

## Key Features

### Citizen Features
- **Authentication:** Phone SMS OTP and Google OAuth 2.0.
- **Citizen Dashboard:** Live view of active grievances, resolution updates, and historical complaints.
- **Multi-Modal Reporting:** File complaints via conversational AI assistant, guided wizard, or voice input.
- **Live Complaint Tracking:** Reference ID lookup (`CIV-YYYYMMDD-XXX`) with step-by-step progress timelines.
- **Dynamic Profile:** Displays real user details, registered jurisdiction, and live complaint statistics.
- **Document Mismatch Inspector:** OCR-powered pre-verification of identity documents before scheme submission.
- **Multilingual Support:** 12 Indian languages with dynamic UI translation.

### Administrative Features
- **Dedicated Staff Portal:** Accessible via `/admin/login` and `/staff`.
- **Role-Based Access Control (RBAC):** Fine-grained permission scoping (`super_admin`, `state_admin`, `district_admin`, `department_officer`, `area_officer`, `auditor`).
- **Department Dashboards:** Filtered analytics and queues for specific municipal departments.
- **Geographic Scoping:** Filter complaints by State, District, and Municipal Ward.
- **Officer Assignment:** Assign or reassign complaints to field officers with explicit history tracking.
- **Audit Log:** Tamper-evident hash-chained logs for administrative actions.

### Officer Features
- **Officer Workspace:** Scoped view (`/portal/officer`) showing assigned field complaints.
- **SLA & Deadline Monitoring:** Live countdown indicators for overdue complaints.
- **Investigation & Verification:** Field notes and resolution evidence attachment.
- **Status Updates:** Advance complaints through workflow states (e.g., `INVESTIGATION`, `ACTION_TAKEN`, `RESOLVED`).

---

## How CivicAI Works

1. **Submission:** A citizen reports a problem (e.g., a burst water pipe) using text, voice, or image upload.
2. **AI Triage:** CivicAI's vision/text AI categorizes the issue, determines urgency, and maps it to the correct department (e.g., *Water Supply*).
3. **Geographic Mapping:** The issue is tagged with the citizen's district and municipal ward.
4. **Officer Assignment:** A department administrator assigns the complaint to the designated area officer.
5. **Field Verification & Action:** The assigned officer receives the complaint in their workspace, investigates, updates status, and uploads resolution evidence.
6. **Confirmation & Closure:** The citizen receives a notification, inspects the resolution, and confirms closure.

---

## User Roles

CivicAI enforces 8 distinct system roles defined in `server/staff.ts` & `server/rbac.ts`:

| Role | Scope / Jurisdiction | Primary Capability |
| :--- | :--- | :--- |
| **`citizen`** | Own data only | Submit complaints, track status, view profile & documents |
| **`super_admin`** | System-wide (Nationwide) | Full administrative access, audit logs, global configuration |
| **`state_admin`** | Specific State / UT | Administrative oversight across all districts in a state |
| **`district_admin`** | Specific District | Manage department workflows within a single district |
| **`department_officer`** | Specific Department | Head of department managing state/district departmental queues |
| **`area_officer`** | Department + District + Ward | Local officer managing complaints in a specific municipal ward |
| **`field_officer`** | Assigned Officer ID | Field worker managing explicitly assigned task queues |
| **`auditor`** | System-wide (Read-only) | Compliance auditing with sensitive personal data masked |

---

## Citizen Portal

The Citizen Portal (`/portal`) provides an intuitive mobile-responsive interface:

- **`/portal`**: Main dashboard with quick action tiles, active complaint cards, and AI entry points.
- **`/portal/profile`**: Dynamic profile displaying authenticated user data, phone/email, authentication method, jurisdiction, live complaint counts, and document verification.
- **`/portal/track`**: Public and authenticated reference ID tracker (`CIV-YYYYMMDD-XXX`).
- **`/portal/assistant`**: Full-screen conversational AI assistant supporting text and voice in 12 languages.

---

## Admin Portal

The Administrative Portal (`/portal/admin` & `/portal/department`) provides government officials with high-level oversight and control:

- **Employee Authentication:** Secure Employee ID + Password login via `/admin/login`.
- **Cross-Department Analytics:** Volume distribution, average resolution time, and SLA breach metrics.
- **Audit Log Viewer:** Cryptographically linked log records detailing every status change and assignment.

---

## Officer Portal

The Officer Workspace (`/portal/officer`) is tailored for field officers:

- **Task Queue:** List of assigned complaints sorted by urgency and SLA deadline.
- **Action Drawer:** Tools to update workflow states, add field inspection notes, and upload proof of work.
- **Jurisdiction Boundary:** Officers only see complaints matching their assigned ward and department.

---

## Department-Based Complaint Management

Complaints are strictly partitioned into municipal departments:

- 💧 **Water Supply** (Leaks, contamination, pressure issues)
- ⚡ **Electricity Board** (Power cuts, transformer failures, dangerous wiring)
- 🛣️ **Roads & Infrastructure** (Potholes, broken footpaths, damaged bridges)
- 🏥 **Healthcare** (Hospital hygiene, clinic availability, medical supplies)
- 🗑️ **Sanitation & Waste** (Uncollected garbage, open drains, public toilets)
- 🚓 **Law & Order / Police** (Public safety, street lighting, nuisance reporting)
- 🏛️ **Municipal Corporation** (Property tax, trade licenses, general civic issues)

---

## Complaint Assignment System

When an administrator assigns a complaint, the backend records:

```json
{
  "complaintId": "CIV-20260821-402",
  "department": "Electricity",
  "district": "North Delhi",
  "ward": "MG Road",
  "assignedOfficer": "EMP-2111 (Electricity Officer)",
  "assignedBy": "EMP-2101 (State Administrator)",
  "assignedAt": "2026-08-21T16:45:00Z"
}
```

If a complaint is reassigned, the assignment history maintains a complete record of previous officers, assignment times, and reasons for transfer.

---

## Complaint Lifecycle

CivicAI implements a robust 14-state workflow state machine (`server/complaints.ts`):

```
[SUBMITTED] ──► [TRIAGED] ──► [ASSIGNED] ──► [INVESTIGATION] ──► [IN_PROGRESS]
     │                                                               │
     ├───────────────► [REJECTED]                                    ▼
     │                                                        [ACTION_TAKEN]
     ▼                                                               │
[ESCALATED]                                                          ▼
     ▲                                                       [FIELD_VERIFIED]
     │                                                               │
     │                                                               ▼
[REOPENED] ◄───────────────────────────────────────────── [RESOLUTION_PROPOSED]
     │                                                               │
     │                                                               ▼
     └─────────────────────────────────────────────────── [CITIZEN_CONFIRMATION]
                                                                     │
                                                                     ▼
                                                             [RESOLVED / CLOSED]
```

---

## Verification & Progress Tracking

CivicAI distinguishes between live integrated features and simulated demonstration modes:

| Feature | Production Provider | Demo / Fallback Behavior |
| :--- | :--- | :--- |
| **AI Triage & Chat** | Gemini 3.1 Flash / Claude / Bedrock | Canned responses & heuristic classification |
| **Document OCR** | Gemini 3.1 Vision API | Deterministic field extraction fixtures |
| **Database** | Neon Serverless Postgres | Non-durable in-memory store |
| **Authentication** | Google OAuth 2.0 & Firebase Auth | Echoed OTP codes for local testing (`AUTH_DEV_OTP=true`) |
| **DigiLocker** | Live Partner API | Simulated OAuth authorization flow & sample document parser |
| **WhatsApp Integration** | Meta Cloud API | Simulated outbox event log |

---

## Multilingual Support

CivicAI natively supports **12 Indian languages**:

1. English (`en`)
2. Hindi (`hi`)
3. Bengali (`bn`)
4. Telugu (`te`)
5. Marathi (`mr`)
6. Tamil (`ta`)
7. Urdu (`ur`)
8. Gujarati (`gu`)
9. Kannada (`kn`)
10. Malayalam (`ml`)
11. Punjabi (`pa`)
12. Odia (`or`)

The i18n system (`src/i18n/strings.ts`) ensures that switching language translates the entire user interface—including buttons, headings, statuses, categories, and error messages—while preserving data identifiers (`"electricity"`, `"CIV-10482"`).

---

## AI Capabilities

- **Automated Complaint Classification:** Evaluates issue text and photos to assign department, priority, and category.
- **Document Mismatch Detection:** Extracts fields from uploaded identity documents (Aadhaar, PAN, Voter ID) and highlights discrepancies before scheme submission.
- **Multilingual Assistant:** Answers citizen queries regarding civic services, document requirements, and status updates in regional languages.

---

## Security & Role-Based Access

- **Server-Side Authorization:** Every API endpoint verifies session tokens and checks role capabilities (`server/rbac.ts`). Frontend routing is purely for UX.
- **Credential Storage:** Staff passwords are hashed using Node.js `crypto.scrypt` with random salts.
- **Citizen Data Isolation:** Citizens can only fetch complaints and profile data linked to their authenticated session.
- **Tamper-Evident Audit Log:** Administrative actions (status changes, reassignments) write to a cryptographically hashed audit chain.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Browser / Client                     │
│    (React 18 SPA · Tailwind CSS · Lucide · i18n)        │
└────────────────────────────┬────────────────────────────┘
                             │  HTTPS / Cookie Auth
                             ▼
┌─────────────────────────────────────────────────────────┐
│                    Express API Server                   │
│          (TypeScript · Session Management · RBAC)       │
└──────┬──────────────────────┬────────────────────┬──────┘
       │                      │                    │
       ▼                      ▼                    ▼
┌──────────────┐      ┌──────────────┐     ┌──────────────┐
│ Neon Postgres│      │ AI Providers │     │  Adapters    │
│  (Database)  │      │(Gemini/Claude│     │(Resend/OCR/  │
└──────────────┘      └──────────────┘     │ DigiLocker)  │
                                           └──────────────┘
```

---

## Technology Stack

### Frontend
- **Framework:** React 18 with TypeScript
- **Build Tool:** Vite
- **Styling:** Vanilla CSS design tokens + Tailwind CSS
- **Icons:** Lucide React
- **Routing:** React Router v6

### Backend & API
- **Server:** Node.js + Express
- **Language:** TypeScript (`tsx`)
- **Authentication:** Custom session cookies, Scrypt password hashing, Google OAuth, Firebase Auth
- **Database:** Neon Serverless Postgres (`@neondatabase/serverless`)
- **Real-Time Events:** Server-Sent Events (SSE)

---

## Project Structure

```
civicai/
├── server/                   # Express backend server
│   ├── adminAuth.ts          # Employee ID + Scrypt password auth
│   ├── auth.ts               # Session management & OAuth handlers
│   ├── complaints.ts         # Complaint endpoints & lifecycle logic
│   ├── index.ts              # Express routes & server setup
│   ├── rbac.ts               # Role-based access control engine
│   ├── staff.ts              # Staff directory & role resolution
│   └── store.ts              # Database client & in-memory fallbacks
├── src/                      # React frontend
│   ├── components/           # Reusable UI components (Button, Cards, Drawers)
│   ├── context/              # AuthContext, ThemeContext, I18nContext
│   ├── hooks/                # useLiveComplaints, useVoice
│   ├── i18n/                 # Translation dictionaries (STRINGS for 12 languages)
│   ├── pages/                # CitizenProfilePage, AdminPortalPage, OfficerWorkspace
│   ├── services/             # API services (authService, complaintService)
│   └── types.ts              # Shared TypeScript definitions
├── db/                       # Database migrations & seeds
├── scripts/                  # Administrative CLI scripts (provisioning, hashing)
├── tests/                    # Vitest unit & integration tests
└── README.md
```

---

## Database Schema

Core tables in Neon Postgres (`db/schema.sql`):

- **`users`**: User records, emails, phones, names, roles, jurisdiction scope.
- **`roles`**: System roles (`super_admin`, `district_admin`, `area_officer`, `citizen`).
- **`departments`**: Municipal departments (`Water`, `Electricity`, `Roads`, etc.).
- **`officers`**: Staff postings linked to users, departments, and municipal wards.
- **`complaints`**: Grievance records, locations, statuses, department tags, timestamps.
- **`complaint_assignments`**: Tracking log for officer assignments and reassignments.
- **`complaint_status_history`**: Audit records of workflow state transitions.
- **`audit_log`**: Tamper-evident administrative action log.

---

## Authentication

### Citizen Authentication
- **Methods:** Google OAuth 2.0 or Phone SMS OTP.
- **Session:** Stateless signed session cookie (`civicai_session`).

### Admin & Staff Authentication
- **Endpoint:** `/admin/login`
- **Credentials:** Employee ID (e.g., `EMP-0001`, `EMP-2104`) + Password.
- **Hashing:** `scrypt` with dynamic salt parameters (`server/adminAuth.ts`).

---

## API Endpoints

### Auth & User APIs
- `GET /api/me` — Resolve current authenticated identity and capabilities.
- `POST /api/auth/login` — Authenticate staff via Employee ID + Password.
- `POST /api/auth/logout` — Terminate current session.

### Complaint APIs
- `GET /api/complaints` — List complaints (filtered by user session or RBAC scope).
- `POST /api/complaints` — File a new civic grievance.
- `GET /api/complaints/:id` — Fetch detailed complaint information and history.
- `POST /api/complaints/:id/assign` — Assign or reassign complaint to an officer.
- `PATCH /api/complaints/:id/status` — Advance complaint workflow state.

---

## Environment Variables

Configured in `.env` (sample in `.env.example`):

| Variable | Purpose | Required |
| :--- | :--- | :--- |
| `DATABASE_URL` | Neon Postgres connection string | Recommended (Falls back to in-memory) |
| `SESSION_SECRET` | Secret key for signing session cookies | Yes (>= 32 chars) |
| `AI_API_KEY` | Gemini API key for triage & AI assistant | Optional (Falls back to demo AI) |
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 client ID | Optional |
| `ADMIN_DEMO_PASSWORD`| Default password for demo staff accounts | Optional (Defaults to `123456`) |
| `AUTH_DEV_OTP` | Echo OTP codes in response for dev testing | Development only |

---

## Installation

```bash
# Clone the repository
git clone https://github.com/himanshusingh412/CIVI-AI-PRJ.git
cd civicai

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
```

---

## Local Development

Start the backend API server and frontend Vite development server concurrently:

```bash
npm run dev:full
```

- **Frontend:** `http://localhost:3000`
- **Backend API:** `http://localhost:8787`

---

## Running the Project

To run individual parts of the application:

```bash
# Run backend server only
npm run dev:server

# Run frontend SPA only
npm run dev:web
```

---

## Testing

Execute unit and integration test suites:

```bash
# Run all tests
npm test

# Run linter / TypeScript check
npm run lint
```

---

## Build

Compile frontend assets and verify production server build:

```bash
npm run build
```

The output bundle is written to `dist/`.

---

## Deployment

CivicAI is optimized for deployment on Vercel:

1. Push your changes to GitHub.
2. Connect your repository to Vercel.
3. Configure environment variables in Vercel settings.
4. Deploy!

- **Production URL:** [https://civi-ai-prj.vercel.app](https://civi-ai-prj.vercel.app)
- **Main Branch Preview:** [https://civi-ai-prj-git-main-himanshu-prj.vercel.app](https://civi-ai-prj-git-main-himanshu-prj.vercel.app)

---

## Demo Workflow

1. **Citizen Flow:**
   - Open [https://civi-ai-prj.vercel.app](https://civi-ai-prj.vercel.app).
   - Sign in using Google or any 10-digit phone number.
   - Click **File a Complaint** and report an issue (e.g., Water leakage).
   - View your complaint reference ID and dynamic Citizen Profile.

2. **Admin & Officer Flow:**
   - Open `/admin/login`.
   - Log in with Employee ID `EMP-0001` (Super Admin) or `EMP-2109` (Water Department Head) and password `123456`.
   - View the scoped departmental dashboard.
   - Assign the complaint to a local field officer (`EMP-0008` / `EMP-2111`).
   - Log in as the field officer to update the status to **RESOLVED**.

---

## Screens / Modules

### Citizen Screens
- **Landing Page:** Project overview, service highlights, language picker.
- **Citizen Portal (`/portal`):** Main hub for filing and tracking complaints.
- **Citizen Profile (`/portal/profile`):** Real-time user stats, details, and document verification.
- **AI Assistant (`/portal/assistant`):** Multilingual voice/text chat assistant.

### Administrative & Officer Screens
- **Staff Login (`/admin/login`):** Employee ID + Password credential screen.
- **Admin Dashboard (`/portal/admin`):** Cross-department metrics and audit logs.
- **Department Portal (`/portal/department`):** Department-specific queue and assignment manager.
- **Officer Workspace (`/portal/officer`):** Field officer assigned task list and resolution drawer.

---

## Future Roadmap

- [x] Multilingual support across 12 Indian languages.
- [x] Role-Based Access Control (RBAC) with geographic and departmental scoping.
- [x] Scrypt password authentication for staff.
- [x] Dynamic citizen profile & real-time SSE updates.
- [ ] Integration with official MeitY DigiLocker partner APIs.
- [ ] Automated WhatsApp notifications via Meta Cloud API.
- [ ] GIS mapping for real-time field officer dispatching.
- [ ] Native mobile apps (iOS & Android).

---

## Limitations

- **Demo Integration Modes:** Unconfigured services (such as SMS gateways or DigiLocker partner APIs) operate in transparent demo/simulated modes.
- **In-Memory Store Fallback:** When `DATABASE_URL` is omitted, data persists in memory for the duration of the server process.

---

## Contributing

1. Fork the repository.
2. Create your feature branch (`git checkout -b feature/amazing-feature`).
3. Commit your changes (`git commit -m 'Add amazing feature'`).
4. Push to the branch (`git push origin feature/amazing-feature`).
5. Open a Pull Request.

---

## License

This project is licensed under the MIT License. See [docs/LICENSE.md](docs/LICENSE.md) for details.
