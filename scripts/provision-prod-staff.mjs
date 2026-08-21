#!/usr/bin/env node
/**
 * Provision the production staff roster in one pass.
 *
 *   npx tsx scripts/provision-prod-staff.mjs <outDir>
 *
 * Writes three files into <outDir> and prints NOTHING secret to stdout, so
 * the passwords exist on this machine and nowhere else — not in a terminal
 * recording, not in shell history, not in a chat transcript:
 *
 *   STAFF_DIRECTORY.json      -> paste/upload as the STAFF_DIRECTORY env var
 *   ADMIN_CREDENTIALS.json    -> paste/upload as the ADMIN_CREDENTIALS env var
 *   CREDENTIALS.txt           -> the plaintext sheet, for the operator only
 *
 * Passwords are 4 words from a 1900-word list plus 3 digits: ~62 bits, which
 * is well past what a scrypt-hashed credential behind a 10-per-15-minutes
 * rate limiter needs, and still typeable by someone reading it off a page.
 * They are generated with crypto.randomInt, never Math.random.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { hashPassword } from '../server/adminAuth.ts';

const outDir = process.argv[2];
if (!outDir) {
  console.error('Usage: npx tsx scripts/provision-prod-staff.mjs <outDir>');
  process.exit(1);
}

/**
 * The roster.
 *
 * Departments, districts, states and wards are spelled EXACTLY as they appear
 * in the live complaint records — these values were read back out of
 * production, not guessed. rbac.inScope compares them as plain strings, so a
 * "Water Dept" here against a "Water" in the data is an officer who signs in
 * successfully and then stares at an empty queue forever, with nothing
 * anywhere saying why. The first draft of this file did exactly that.
 *
 * The department heads carry no `state`, deliberately. scopeFor() would turn
 * one into a filter, and the live data is thin enough per state-and-department
 * (Water in Delhi: two complaints) that a state-scoped head would look broken
 * even though it was working. State admins cover the geographic slice instead.
 *
 * The counts in each comment are complaints visible to that account at the
 * time of provisioning, so a queue that comes up empty is a signal something
 * drifted rather than a shrug.
 */
const ROSTER = [
  // ── geographic ────────────────────────────────────────────────────────
  { employeeId: 'EMP-2101', name: 'Delhi State Administrator',
    role: 'state_admin', state: 'Delhi' },                                  // 85
  { employeeId: 'EMP-2102', name: 'Uttar Pradesh State Administrator',
    role: 'state_admin', state: 'Uttar Pradesh' },                          // 100
  { employeeId: 'EMP-2103', name: 'New Delhi District Magistrate',
    role: 'district_admin', state: 'Delhi', district: 'New Delhi' },        // 36

  // ── departmental ──────────────────────────────────────────────────────
  { employeeId: 'EMP-2104', name: 'Electricity Department Head',
    role: 'department_officer', department: 'Electricity' },                // 59
  { employeeId: 'EMP-2105', name: 'Roads Department Head',
    role: 'department_officer', department: 'Roads' },                      // 53
  { employeeId: 'EMP-2106', name: 'Health Department Head',
    role: 'department_officer', department: 'Health' },                     // 50
  { employeeId: 'EMP-2107', name: 'Transport Department Head',
    role: 'department_officer', department: 'Transport' },                  // 49
  { employeeId: 'EMP-2108', name: 'Municipal Corporation Head',
    role: 'department_officer', department: 'Municipal Corporation' },      // 47
  { employeeId: 'EMP-2109', name: 'Water Department Head',
    role: 'department_officer', department: 'Water' },                      // 32
  { employeeId: 'EMP-2110', name: 'Police Department Head',
    role: 'department_officer', department: 'Police' },                     // 50

  // ── local area ────────────────────────────────────────────────────────
  // The narrowest grant the model supports: department AND district AND ward
  // at once. Signing in here and finding the other 498 complaints gone is
  // what makes ward isolation something you can see rather than take on
  // trust.
  { employeeId: 'EMP-2111', name: 'Electricity Officer, MG Road (North Delhi)',
    role: 'area_officer', state: 'Delhi', district: 'North Delhi',
    department: 'Electricity', ward: 'MG Road, North Delhi' },              // 2

  // ── oversight ─────────────────────────────────────────────────────────
  { employeeId: 'EMP-2112', name: 'Read-only Auditor',
    role: 'auditor' },                                                      // 500
];

const WORDS = `ambit anchor anvil apron arbor armada aspen atlas aurora avenue
azure ballad bamboo banner basin beacon beetle bellow birch bishop bison blaze
bloom bolt bonsai border bramble branch brave breeze bridge bristle bronze
brook bugle bunker burrow cactus cadence camber canopy canyon carbon cargo
carve casket cedar cellar cement census chalk chamber charm chasm cherry
chisel cinder circuit citrus clamp clarity cliff cloak clover cobalt cobble
comet compass copper coral cornice cosmos cotton cove crater crest crimson
crystal cypress dagger dahlia damson dapple dawn decoy delta denim dial
diamond dingo divot dolphin domain dorsal dovetail dragon drift dunes dusk
eagle ember emblem ember engine ensign envoy epoch equinox era escarp ether
falcon fathom fennel fern ferry fiber fjord flint flora fluent forge fossil
fountain fresco frost fulcrum furnace gable gallery gambit garnet gauge
gazelle geode ginger glacier glade glean glimmer granite gravel grove guild
gulley gypsum halo hamlet harbor harvest hazel heather helix hemlock herald
hickory hollow horizon hummock hurdle hybrid iceberg impala indigo inlet iris
ironwood island ivory jade jasmine jetty jubilee juniper kelp kernel kestrel
keystone kindle kite lagoon lancet lantern lapis larch lattice lavender ledge
legacy lemon lichen lilac linden lintel lodge lotus lumen lunar lupine lyric
magnet magpie mahogany mallow mangrove mantle maple marble marsh meadow mesa
meteor midden mineral mint mirage mistral moraine mosaic moss mullein myrtle
nectar needle nestle nettle nexus nimbus nomad north nova nutmeg oakwood oasis
obelisk ochre olive onyx opal orbit orchard oriole osprey otter outpost oxbow
paddock palisade papyrus parapet parquet pasture pebble pennant peony pepper
perch pewter pigment pilot pinnacle pioneer pivot placid plateau plinth plover
plume polar pollen pommel poplar portal potash prairie primrose prism privet
prow puffin pumice purslane quarry quartz quill quilt quiver radiant rafter
rampart ravine reef regatta relay relic ridge rill rimrock ripple river rocket
rosemary rowan rudder runnel rustic saffron sage sail salvia sandbar sapphire
satchel savanna scarlet schist scout sedge sentinel sequoia shale shallot
shelter sherbet shingle shore sienna signal silica silver sinew siren sleet
slope sluice smelt sorrel spindle spire splint spruce squall stanza starling
stellar steppe stipple stonecrop stratum stream stucco summit sundial swallow
sycamore syrup taiga tally tamarind tandem tangent tapestry tarn teak tempest
tendril terrace thicket thistle thorn thrush thunder tidal timber tinder
topaz torrent trellis tribune trident trillium trough tundra turret twine
umber upland urchin valley vane vantage vellum velvet verbena verdant vertex
vessel viaduct vine violet vireo vista vortex walnut warbler warren waterway
wattle weald weathervane willow windrow winnow wisteria wolfsbane woodland
wren yarrow yew zenith zephyr zinnia zircon`
  .split(/\s+/)
  .filter(Boolean);

function makePassword() {
  const parts = [];
  for (let i = 0; i < 4; i++) parts.push(WORDS[crypto.randomInt(WORDS.length)]);
  return `${parts.join('-')}-${crypto.randomInt(100, 1000)}`;
}

const staffDirectory = [];
const adminCredentials = [];
const sheet = [];

for (const person of ROSTER) {
  const subject = `${person.employeeId.toLowerCase()}@staff.civicai.local`;
  const password = makePassword();

  const entry = { email: subject, role: person.role, name: person.name };
  for (const k of ['state', 'district', 'department', 'ward']) {
    if (person[k]) entry[k] = person[k];
  }
  staffDirectory.push(entry);

  adminCredentials.push({
    employeeId: person.employeeId,
    subject,
    displayName: person.name,
    passwordHash: await hashPassword(password),
  });

  const scope = ['state', 'district', 'department', 'ward']
    .filter(k => person[k])
    .map(k => person[k])
    .join(' · ') || 'nationwide';

  sheet.push(
    `${person.employeeId}\n` +
      `  who       ${person.name}\n` +
      `  role      ${person.role}\n` +
      `  sees      ${scope}\n` +
      `  password  ${password}\n`,
  );
}

fs.mkdirSync(outDir, { recursive: true });
const write = (file, body) =>
  fs.writeFileSync(path.join(outDir, file), body, { mode: 0o600 });

write('STAFF_DIRECTORY.json', JSON.stringify(staffDirectory));
write('ADMIN_CREDENTIALS.json', JSON.stringify(adminCredentials));
write(
  'CREDENTIALS.txt',
  `CivicAI production staff logins
Sign in at  https://civi-ai-prj.vercel.app/admin/login

These are the only copies of these passwords. The server stores scrypt
hashes and cannot recover them; a lost password is re-provisioned, not
recovered. Delete this file once the passwords are somewhere you trust.

${sheet.join('\n')}
Not listed here: the super admin, which still signs in through
SUPER_ADMIN_EMAIL / SUPER_ADMIN_PHONE and was left untouched.
`,
);

// Only counts reach stdout.
console.log(`wrote ${staffDirectory.length} staff entries to ${outDir}`);
