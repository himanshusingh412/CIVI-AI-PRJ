#!/usr/bin/env python3
"""
Authorisation smoke test against a LIVE deployment.

    python3 scripts/authz-smoke.py <credentials.txt> [base-url]

The credentials file is the sheet written by scripts/provision-prod-staff.mjs.
Nothing is mutated: every call that would write is one the actor is expected
to be refused, and the refusals are verified rather than assumed.

─────────────────────────────────────────────────────────────────────────────
Why this exists when tests/rbac.test.ts already passes
─────────────────────────────────────────────────────────────────────────────
Those tests call authorize() directly. This one goes through the whole stack —
session cookie, CSRF, route guard, scope filter, store — against the
deployment people actually use. The unit tests would keep passing if a route
forgot to call the guard at all.

─────────────────────────────────────────────────────────────────────────────
The trap it is built to avoid
─────────────────────────────────────────────────────────────────────────────
A 403 proves nothing on its own. The CSRF guard returns 403 too, so a check
that forgets the token "passes" having tested nothing about permissions. An
earlier version of this file did exactly that. So every refusal is matched on
the error CODE, not the status alone, and every actor makes at least one call
it SHOULD be allowed — otherwise a blanket-deny bug reads as a clean sweep.

Two shapes of refusal, and the difference matters:

  403 forbidden   you may see this record, but not do that to it
  404 not_found   you may not know whether this record exists

The second is used for anything outside your jurisdiction. A 403 there would
confirm the record exists, which is enough to enumerate other departments'
complaints one id at a time. So "Water head gets 404 for an Electricity
complaint" is the stronger result, not a weaker one — and the control that
proves it is the scope check talking, rather than a genuinely missing row, is
the SAME id returning 200 for the Electricity head.

Note: /api/auth/admin-login allows 10 attempts per 15 minutes per IP. This
script signs in three times. Running it repeatedly will trip that.
"""
import http.cookiejar
import json
import re
import sys
import urllib.error
import urllib.request

CRED_FILE = sys.argv[1] if len(sys.argv) > 1 else None
BASE = sys.argv[2] if len(sys.argv) > 2 else 'https://civi-ai-prj.vercel.app'

if not CRED_FILE:
    sys.exit(f'Usage: {sys.argv[0]} <credentials.txt> [base-url]')


class Actor:
    """One signed-in staff member, holding its own cookie jar and CSRF token."""

    def __init__(self, employee_id, password):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar))
        body = json.dumps({'employeeId': employee_id, 'password': password}).encode()
        req = urllib.request.Request(f'{BASE}/api/auth/admin-login', data=body,
                                     headers={'Content-Type': 'application/json'})
        try:
            res = json.loads(self.opener.open(req).read())
        except urllib.error.HTTPError as e:
            detail = e.read()[:200].decode('utf8', 'replace')
            sys.exit(f'{employee_id} could not sign in: HTTP {e.code} {detail}')
        self.csrf = res['csrfToken']

    def _send(self, req):
        try:
            return 200, json.loads(self.opener.open(req).read())
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                return e.code, json.loads(raw)
            except Exception:
                return e.code, {'raw': raw[:200].decode('utf8', 'replace')}

    def get(self, path):
        return self._send(urllib.request.Request(f'{BASE}{path}'))

    def post(self, path, payload):
        return self._send(urllib.request.Request(
            f'{BASE}{path}', data=json.dumps(payload).encode(),
            headers={'Content-Type': 'application/json', 'x-csrf-token': self.csrf}))


creds = dict(re.findall(r'^(EMP-\d+)\n(?:.*\n)*?  password  (\S+)',
                        open(CRED_FILE).read(), re.M))
for needed in ('EMP-2104', 'EMP-2109', 'EMP-2112'):
    if needed not in creds:
        sys.exit(f'{CRED_FILE} has no password for {needed}')

elec = Actor('EMP-2104', creds['EMP-2104'])      # department_officer, Electricity
water = Actor('EMP-2109', creds['EMP-2109'])     # department_officer, Water
auditor = Actor('EMP-2112', creds['EMP-2112'])   # auditor, nationwide, read-only

# A complaint the Electricity head owns and the Water head must not touch.
_, listing = elec.get('/api/admin/complaints?limit=1')
target = listing['complaints'][0]
cid = target['id']
print(f"target: {cid}  department={target.get('department')}  "
      f"district={target.get('district')}  status={target.get('status')}\n")

results = []


def check(name, expect, code, body):
    """expect: 'forbidden' (403+code) | 'masked' (404+code) | 'ok' (200)."""
    err = body.get('error')
    if expect == 'forbidden':
        ok = code == 403 and err == 'forbidden'
        detail = f'HTTP {code} error={err!r}'
        if code == 403 and err == 'csrf':
            detail += '  <-- CSRF, NOT an authorisation result'
    elif expect == 'masked':
        ok = code == 404 and err == 'not_found'
        detail = f'HTTP {code} error={err!r}'
        if code == 403:
            detail += '  <-- leaks that the record exists'
    else:
        ok = code == 200 and body.get('ok') is not False
        detail = f'HTTP {code}' + (f' error={err!r}' if err else '')
    results.append(ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}\n         {detail}")


print('── auditor is read-only ─────────────────────────────────────────')
check('auditor cannot change a complaint status', 'forbidden',
      *auditor.post(f'/api/admin/complaints/{cid}/status', {'status': 'resolved'}))
check('auditor cannot add a note', 'forbidden',
      *auditor.post(f'/api/admin/complaints/{cid}/note',
                    {'body': 'audit note', 'visibility': 'internal'}))
check('auditor CAN read (control — proves it is not blanket-denied)', 'ok',
      *auditor.get('/api/admin/complaints?limit=5'))

print('\n── scope holds on direct ID access, not just list filtering ─────')
check('Water head cannot READ an Electricity complaint by ID', 'masked',
      *water.get(f'/api/admin/complaints/{cid}'))
check('Water head cannot WRITE to an Electricity complaint', 'masked',
      *water.post(f'/api/admin/complaints/{cid}/status', {'status': 'resolved'}))
check('Water head CAN read its own department (control)', 'ok',
      *water.get('/api/admin/complaints?limit=5'))

print('\n── the owner is genuinely allowed (control) ─────────────────────')
check('Electricity head CAN read its own complaint by ID', 'ok',
      *elec.get(f'/api/admin/complaints/{cid}'))

print('\n' + '=' * 64)
passed, total = sum(results), len(results)
print(f'{passed}/{total} passed' if passed == total
      else f'{passed}/{total} passed — SOMETHING FAILED')
sys.exit(0 if passed == total else 1)
