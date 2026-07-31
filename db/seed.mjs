#!/usr/bin/env node
/**
 * Seeds realistic demo data so the app is usable immediately after setup.
 *
 *   node db/seed.mjs                  # uses DATABASE_URL
 *   node db/seed.mjs --dry            # in-memory PGlite, verifies without a DB
 *   node db/seed.mjs --reset          # truncate first
 *
 * Volumes: 500+ citizens, 100+ officers, 1000+ complaints, plus history,
 * media, AI analysis, notifications and feedback.
 *
 * Determinism: a seeded PRNG drives every random choice, so re-running
 * produces identical data. That makes screenshots, demos and bug reports
 * reproducible instead of shifting under you.
 *
 * Inserts are batched with multi-row VALUES — 1000 individual round trips to
 * a hosted Postgres takes minutes; batched it takes seconds.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Load .env the same way the server does.
 *
 * Without this the script only saw variables already exported in the shell,
 * so a perfectly good DATABASE_URL sitting in .env produced "DATABASE_URL is
 * not set" while `npm run dev:full` connected to Postgres fine — the two
 * disagreeing about the same file is a confusing way to fail.
 *
 * Resolved relative to this file, not cwd, so `node db/seed.mjs` works from
 * anywhere in the repo.
 */
import 'dotenv/config';

const DIR = path.dirname(fileURLToPath(import.meta.url));
if (!process.env.DATABASE_URL) {
  const dotenvPath = path.join(DIR, '..', '.env');
  if (fs.existsSync(dotenvPath)) {
    const { config } = await import('dotenv');
    config({ path: dotenvPath });
  }
}
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const RESET = argv.includes('--reset');
/**
 * --drop rebuilds from nothing.
 *
 * Needed because CREATE TABLE IF NOT EXISTS is not a migration: if a table
 * of the same name already exists with a DIFFERENT shape, it is skipped
 * silently and every later statement that assumes the new columns fails.
 * That is exactly how an older `complaints` table lacking `deleted_at`
 * survived and broke the schema apply. TRUNCATE cannot fix a wrong shape.
 */
const DROP = argv.includes('--drop');

// ───────────────────────── deterministic RNG ─────────────────────────
let _s = 20260731;
const rnd = () => ((_s = (_s * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = a => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const chance = p => rnd() < p;

// ───────────────────────── reference data ─────────────────────────
const GEO = {
  Delhi: ['New Delhi', 'South Delhi', 'North Delhi', 'East Delhi', 'Dwarka'],
  Maharashtra: ['Mumbai', 'Pune', 'Nagpur', 'Nashik', 'Thane'],
  Karnataka: ['Bengaluru Urban', 'Mysuru', 'Mangaluru', 'Hubballi'],
  'Tamil Nadu': ['Chennai', 'Coimbatore', 'Madurai', 'Salem'],
  'Uttar Pradesh': ['Lucknow', 'Kanpur', 'Varanasi', 'Noida', 'Agra'],
  Gujarat: ['Ahmedabad', 'Surat', 'Vadodara', 'Rajkot'],
};
const STATES = Object.keys(GEO);

const DEPARTMENTS = [
  ['Police', 'POL', 6], ['Municipal Corporation', 'MUN', 48], ['Water', 'WTR', 24],
  ['Electricity', 'ELE', 12], ['Health', 'HLT', 24], ['Roads', 'RDS', 72],
  ['Transport', 'TRN', 48], ['Education', 'EDU', 96], ['Women Safety', 'WMN', 4],
  ['Disaster Management', 'DIS', 2],
];

const ROLES = [
  ['Citizen', ['complaint:create', 'complaint:read_own']],
  ['Super Admin', ['*']],
  ['State Admin', ['complaint:read', 'complaint:update_status', 'complaint:assign', 'complaint:close', 'analytics:read', 'audit:read']],
  ['District Admin', ['complaint:read', 'complaint:update_status', 'complaint:assign', 'analytics:read']],
  ['Department Officer', ['complaint:read', 'complaint:update_status', 'complaint:note', 'analytics:read']],
  ['Field Officer', ['complaint:read', 'complaint:update_status', 'complaint:upload']],
  ['Auditor', ['complaint:read', 'analytics:read', 'audit:read']],
];

const FIRST = ['Ramesh','Anita','Mohammed','Lakshmi','Gurpreet','Priya','Amit','Sunita','Rajesh','Kavita','Arjun','Deepa','Vikram','Meera','Sanjay','Fatima','Ravi','Neha','Karthik','Pooja','Imran','Divya','Suresh','Anjali'];
const LAST  = ['Sharma','Verma','Iqbal','Nair','Singh','Patel','Reddy','Kumar','Das','Joshi','Menon','Gupta','Chandra','Bose','Khan','Rao','Pillai','Mehta'];

const ISSUES = {
  Water: ['No water supply for {n} days in Sector {s}', 'Contaminated water from the mains near {p}', 'Burst pipeline flooding {p}'],
  Electricity: ['Frequent power cuts every evening in {p}', 'Transformer sparking near {p}', 'Streetlights out on {p} for {n} days'],
  Roads: ['Large pothole on {p} causing accidents', 'Road caved in after rain near {p}', 'No footpath along {p}'],
  Police: ['Repeated theft reports around {p}', 'Illegal parking blocking {p}', 'Noise disturbance late at night near {p}'],
  'Municipal Corporation': ['Garbage uncollected for {n} days near {p}', 'Stray dog menace around {p}', 'Open drain beside {p}'],
  Health: ['Medicine shortage at the {p} clinic', 'Mosquito breeding near {p}', 'Unhygienic conditions at {p}'],
  Transport: ['Bus route {n} skipping the {p} stop', 'Overcrowding on the {p} line', 'Broken shelter at {p}'],
  Education: ['Teacher absent at the {p} school', 'Broken benches at {p}', 'No drinking water at {p} school'],
  'Women Safety': ['Poor lighting on the {p} stretch', 'Harassment reported near {p}', 'No CCTV around {p}'],
  'Disaster Management': ['Waterlogging risk at {p}', 'Tree at risk of falling near {p}', 'Flood warning around {p}'],
};
const PLACES = ['MG Road','Park Street','Sector 14','Gandhi Nagar','Station Road','Lake View','Civil Lines','Ring Road','Market Square','Green Park'];

const STATUSES = ['submitted','ai_verification','department_assigned','officer_assigned','investigation_started','field_visit_scheduled','evidence_uploaded','work_in_progress','resolved','citizen_verification','closed','reopened'];
const OPEN = ['officer_assigned','investigation_started','field_visit_scheduled','evidence_uploaded','work_in_progress','reopened'];
const PRIORITIES = ['Low','Medium','High','Critical'];
const SLA = { Critical: 6, High: 24, Medium: 48, Low: 96 };

const N_CITIZENS = 520;
const N_OFFICERS = 110;
const N_COMPLAINTS = 1050;

const uuid = () => {
  const h = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 32; i++) s += h[Math.floor(rnd() * 16)];
  return `${s.slice(0,8)}-${s.slice(8,12)}-4${s.slice(13,16)}-a${s.slice(17,20)}-${s.slice(20,32)}`;
};
const iso = d => new Date(d).toISOString();
const daysAgo = n => Date.now() - n * 86400_000;
const q = v => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

/** Multi-row INSERT; chunked so no single statement gets pathologically large. */
async function insertBatch(exec, table, cols, rows, chunk = 250) {
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const values = slice.map(r => `(${r.join(',')})`).join(',\n');
    await exec(`INSERT INTO ${table} (${cols.join(',')}) VALUES\n${values}`);
  }
}

async function seed(exec) {
  if (RESET) {
    await exec(`TRUNCATE emergency_alerts, chatbot_history, announcements, citizen_feedback,
      audit_logs, ai_analysis, notifications, complaint_status_history, complaint_media,
      complaints, officers, users, departments, roles RESTART IDENTITY CASCADE`);
  }

  // roles
  const roleIds = {};
  const roleRows = ROLES.map(([name, perms]) => {
    const id = uuid(); roleIds[name] = id;
    return [q(id), q(name), q(JSON.stringify(perms)) + '::jsonb'];
  });
  await insertBatch(exec, 'roles', ['id','role_name','permissions'], roleRows);

  // departments
  const deptIds = {};
  const deptRows = DEPARTMENTS.map(([name, code, sla]) => {
    const id = uuid(); deptIds[name] = id;
    return [q(id), q(name), q(code), String(sla)];
  });
  await insertBatch(exec, 'departments', ['id','name','code','sla_hours'], deptRows);

  // users — citizens + one admin per role so every role is loginable
  const citizens = [];
  const userRows = [];
  for (let i = 0; i < N_CITIZENS; i++) {
    const id = uuid();
    const state = pick(STATES);
    const district = pick(GEO[state]);
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    citizens.push({ id, state, district, name });
    userRows.push([
      q(id), q(name), q(`citizen${i}@example.in`), q(`9${int(100000000, 999999999)}`),
      q(roleIds['Citizen']), q(state), q(district), q(chance(0.3) ? 'hi' : 'en'),
      chance(0.8) ? 'TRUE' : 'FALSE', q('active'), q(iso(daysAgo(int(1, 400)))),
    ]);
  }
  const staff = {};
  for (const [roleName] of ROLES.slice(1)) {
    const id = uuid();
    staff[roleName] = id;
    const slug = roleName.toLowerCase().replace(/\s+/g, '.');
    userRows.push([
      q(id), q(roleName), q(`${slug}@civicai.gov.in`), q(`9${int(100000000, 999999999)}`),
      q(roleIds[roleName]), q('Delhi'), q('New Delhi'), q('en'),
      'TRUE', q('active'), q(iso(daysAgo(1))),
    ]);
  }
  await insertBatch(exec, 'users',
    ['id','full_name','email','phone','role_id','state','district','language','is_verified','status','created_at'],
    userRows);

  // officers
  const officers = [];
  const offRows = [];
  for (let i = 0; i < N_OFFICERS; i++) {
    const id = uuid();
    const state = pick(STATES);
    const district = pick(GEO[state]);
    const dept = pick(DEPARTMENTS)[0];
    officers.push({ id, state, district, dept });
    offRows.push([
      q(id), q(`${pick(FIRST)} ${pick(LAST)}`), q(deptIds[dept]),
      q(pick(['Junior Engineer','Inspector','Assistant Commissioner','Field Supervisor','Section Officer'])),
      q(`9${int(100000000, 999999999)}`), q(`officer${i}@civicai.gov.in`),
      q(state), q(district), String(int(10, 40)),
    ]);
  }
  await insertBatch(exec, 'officers',
    ['id','officer_name','department_id','designation','contact_phone','contact_email','assigned_state','assigned_district','max_workload'],
    offRows);

  // complaints (+ children)
  const cRows = [], hRows = [], mRows = [], aRows = [], nRows = [], fRows = [];
  let refSeq = 0;

  for (let i = 0; i < N_COMPLAINTS; i++) {
    const id = uuid();
    const citizen = pick(citizens);
    const dept = pick(DEPARTMENTS)[0];

    // Officer pool, widening rather than giving up: exact district match is
    // ideal, but with 110 officers across ~270 dept×district combinations
    // most exact pools are empty. Falling back to state-, then
    // department-level keeps ~70% of complaints assigned, which is what a
    // real backlog looks like.
    const exact = officers.filter(o => o.dept === dept && o.district === citizen.district);
    const inState = officers.filter(o => o.dept === dept && o.state === citizen.state);
    const inDept = officers.filter(o => o.dept === dept);
    const pool = exact.length ? exact : inState.length ? inState : inDept;
    const officer = pool.length && chance(0.72) ? pick(pool) : null;

    const priority = pick(PRIORITIES);
    const ageDays = int(0, 180);
    const createdAt = daysAgo(ageDays);

    /**
     * Status correlates with age. Without this, a 6-month-old complaint is as
     * likely to be "submitted" as "closed", which makes the SLA and
     * resolution-time metrics nonsense (the first run showed 98% breached).
     */
    let status;
    if (!officer) {
      // Unassigned work stalls early in the pipeline.
      status = pick(['submitted', 'ai_verification', 'department_assigned']);
    } else if (ageDays > 45) {
      status = chance(0.82) ? pick(['closed', 'closed', 'resolved', 'citizen_verification'])
                            : pick(['work_in_progress', 'reopened']);
    } else if (ageDays > 14) {
      status = chance(0.55) ? pick(['resolved', 'citizen_verification', 'closed'])
                            : pick(['work_in_progress', 'investigation_started', 'evidence_uploaded']);
    } else if (ageDays > 3) {
      status = pick(['officer_assigned', 'investigation_started', 'field_visit_scheduled',
                     'evidence_uploaded', 'work_in_progress']);
    } else {
      status = pick(['submitted', 'ai_verification', 'department_assigned', 'officer_assigned']);
    }
    const template = pick(ISSUES[dept] || ISSUES.Water);
    const desc = template.replace('{n}', String(int(2, 9))).replace('{s}', String(int(1, 40))).replace('{p}', pick(PLACES));
    const closed = status === 'closed';
    // Feedback is collected once a citizen has something to judge.
    const finished = ['closed', 'citizen_verification'].includes(status);
    const rating = finished && chance(0.8) ? int(2, 5) : null;

    refSeq++;
    cRows.push([
      q(id), q(`CIV-${new Date(createdAt).toISOString().slice(0,10).replace(/-/g,'')}-${String(refSeq).padStart(4,'0')}`),
      q(citizen.id), q(deptIds[dept]), officer ? q(officer.id) : 'NULL',
      q(dept), q(desc.slice(0, 60)), q(desc),
      q(`AI summary: ${desc.slice(0, 80)}`), q(priority), q(dept),
      q(status), q(priority),
      String((28 + rnd() * 8).toFixed(4)), String((72 + rnd() * 8).toFixed(4)),
      q(`${pick(PLACES)}, ${citizen.district}`), q(citizen.district), q(citizen.state),
      // Open complaints get a deadline near now (so only a realistic slice is
      // breached); finished ones keep their historical deadline.
      q(iso(
        ['closed','resolved','citizen_verification'].includes(status)
          ? createdAt + SLA[priority] * 3600_000
          : Date.now() + (chance(0.18) ? -1 : 1) * int(1, SLA[priority]) * 3600_000
      )),
      String(chance(0.12) ? int(1, 3) : 0),
      rating === null ? 'NULL' : String(rating),
      closed ? q(iso(createdAt + int(1, 20) * 86400_000)) : 'NULL',
      q(iso(createdAt)), q(citizen.id),
    ]);

    // status history — a plausible walk up to the current status
    const upto = Math.max(1, STATUSES.indexOf(status) + 1);
    for (let s = 0; s < upto; s++) {
      hRows.push([
        q(uuid()), q(id), s === 0 ? 'NULL' : q(STATUSES[s-1]), q(STATUSES[s]),
        q(staff['District Admin']),
        q(`Status moved to ${STATUSES[s].replace(/_/g,' ')}.`),
        chance(0.3) ? q('Internal: verified with field team.') : 'NULL',
        q(iso(createdAt + s * 3600_000 * int(2, 20))),
      ]);
    }

    if (chance(0.45)) {
      const kind = pick(['image','image','video','document','audio']);
      mRows.push([
        q(uuid()), q(id), q(kind),
        q(`https://storage.civicai.gov.in/complaints/${id}/${kind}-1`),
        q(`complaints/${id}/${kind}-1`), q(`evidence.${kind === 'image' ? 'jpg' : kind === 'video' ? 'mp4' : kind === 'audio' ? 'm4a' : 'pdf'}`),
        String(int(50_000, 8_000_000)),
      ]);
    }

    aRows.push([
      q(uuid()), q(id), q(dept), String((0.6 + rnd() * 0.39).toFixed(3)),
      chance(0.07) ? 'TRUE' : 'FALSE',
      String((rnd() * 0.3).toFixed(3)),
      q(deptIds[dept]), q(priority), String(SLA[priority] * int(1, 3)),
      q('gemini-3.1-flash-lite'),
    ]);

    if (chance(0.6)) {
      nRows.push([
        q(uuid()), q(citizen.id), q(id), q('Status update'),
        q(`Your complaint is now "${status.replace(/_/g,' ')}".`),
        q(pick(['in_app','email','sms','whatsapp'])),
        chance(0.5) ? 'TRUE' : 'FALSE', q(pick(['sent','delivered','read'])),
      ]);
    }

    if (rating !== null) {
      fRows.push([
        q(uuid()), q(id), q(citizen.id), String(rating),
        q(pick(['Resolved quickly, thank you.','Took longer than expected.','Officer was helpful.','Issue partially fixed.'])),
        rating >= 4 ? 'TRUE' : 'FALSE',
      ]);
    }
  }

  await insertBatch(exec, 'complaints',
    ['id','reference_no','user_id','department_id','assigned_officer_id','category','title','description',
     'ai_summary','ai_priority','ai_classification','status','priority','latitude','longitude','address',
     'district','state','sla_deadline','escalation_level','citizen_rating','closed_date','created_at','created_by'],
    cRows, 150);

  await insertBatch(exec, 'complaint_status_history',
    ['id','complaint_id','previous_status','new_status','updated_by','public_note','internal_note','created_at'], hRows, 300);
  await insertBatch(exec, 'complaint_media',
    ['id','complaint_id','kind','file_url','storage_key','file_name','file_size'], mRows);
  await insertBatch(exec, 'ai_analysis',
    ['id','complaint_id','ai_classification','confidence_score','is_duplicate','spam_score',
     'suggested_department_id','suggested_priority','estimated_resolution_hrs','model'], aRows, 300);
  await insertBatch(exec, 'notifications',
    ['id','user_id','complaint_id','title','message','channel','is_read','delivery_status'], nRows, 300);
  await insertBatch(exec, 'citizen_feedback',
    ['id','complaint_id','user_id','rating','feedback','resolution_satisfaction'], fRows);

  // announcements + alerts
  await insertBatch(exec, 'announcements', ['id','title','body','state','is_published','published_at'],
    [1,2,3,4].map(i => [
      q(uuid()), q(`Public notice ${i}`),
      q('Scheduled maintenance may affect services in your area this week.'),
      q(pick(STATES)), 'TRUE', q(iso(daysAgo(i * 3))),
    ]));

  await insertBatch(exec, 'emergency_alerts',
    ['id','alert_type','severity','title','message','state','district','is_active'],
    [1,2,3].map(i => {
      const st = pick(STATES);
      return [q(uuid()), q(pick(['flood','fire','storm'])), q(pick(['warning','severe','critical'])),
              q(`Emergency alert ${i}`), q('Residents advised to avoid the affected area.'),
              q(st), q(pick(GEO[st])), 'TRUE'];
    }));

  return {
    roles: roleRows.length, departments: deptRows.length, users: userRows.length,
    officers: offRows.length, complaints: cRows.length, history: hRows.length,
    media: mRows.length, ai: aRows.length, notifications: nRows.length, feedback: fRows.length,
  };
}

import { splitStatements } from './sql-split.mjs';

/** Apply a .sql file one statement at a time. */
async function applySqlFile(file, exec) {
  const statements = splitStatements(fs.readFileSync(file, 'utf8'));
  for (const stmt of statements) await exec(stmt);
  return statements.length;
}

// ───────────────────────── runner ─────────────────────────
const t0 = Date.now();

if (DRY) {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = await new PGlite();
  const n = await applySqlFile(path.join(DIR, '001_schema.sql'), s => db.exec(s));
  console.log(`  schema: ${n} statements applied one at a time (same as the live path)`);
  const counts = await seed(s => db.exec(s));
  console.log('  seeded (dry run, in-memory Postgres):');
  for (const [k, v] of Object.entries(counts)) console.log(`    ${k.padEnd(14)} ${v}`);
  // Distribution checks — volume alone doesn't mean the demo data is usable.
  // A dashboard needs enough closed/rated/overdue rows for every metric to
  // render something meaningful rather than a zero.
  const checks = [
    ['with officer',  "SELECT count(*)::int n FROM complaints WHERE assigned_officer_id IS NOT NULL"],
    ['closed',        "SELECT count(*)::int n FROM complaints WHERE status='closed'"],
    ['resolved+',     "SELECT count(*)::int n FROM complaints WHERE status IN ('resolved','citizen_verification','closed')"],
    ['rated',         "SELECT count(*)::int n FROM complaints WHERE citizen_rating IS NOT NULL"],
    ['SLA breached',  "SELECT count(*)::int n FROM complaints WHERE sla_deadline < now() AND status NOT IN ('closed','rejected_spam','merged')"],
    ['escalated',     "SELECT count(*)::int n FROM complaints WHERE escalation_level > 0"],
  ];
  console.log('  distribution:');
  for (const [label, q] of checks) {
    const r = await db.query(q);
    console.log(`    ${label.padEnd(14)} ${r.rows[0].n}`);
  }
  const byState = await db.query(
    'SELECT state, count(*)::int n FROM complaints GROUP BY 1 ORDER BY 2 DESC');
  console.log('    states         ' + byState.rows.map(r => `${r.state}=${r.n}`).join(' '));
  await db.close();
} else {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Use --dry to verify without a database.');
    process.exit(1);
  }
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(process.env.DATABASE_URL);
  const exec = async s => { await sql.query(s); };
  if (DROP) {
    // public is the only schema this app owns, so recreating it is both the
    // simplest and the most complete reset — views, enums, triggers included.
    await exec('DROP SCHEMA public CASCADE');
    await exec('CREATE SCHEMA public');
    console.log('  dropped and recreated schema "public"');
  }
  const n = await applySqlFile(path.join(DIR, '001_schema.sql'), exec);
  console.log(`  schema: ${n} statements applied`);
  const counts = await seed(exec);
  console.log('  seeded:');
  for (const [k, v] of Object.entries(counts)) console.log(`    ${k.padEnd(14)} ${v}`);
}

console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
