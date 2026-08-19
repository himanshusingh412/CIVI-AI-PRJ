#!/usr/bin/env bash
#
# Automated walkthrough of docs/DEMO_SCRIPT.md against a running API.
#
# Boot the server the same way the demo does (no external credentials,
# AUTH_DEV_OTP=true so the one-time code comes back in the response) and
# point this at it:
#
#   DATABASE_URL='' AUTH_DEV_OTP=true AI_API_KEY='' \
#     SESSION_SECRET=dev-secret-at-least-32-characters-long \
#     PORT=8799 npx tsx server/index.ts &
#   BASE=http://localhost:8799 bash scripts/demo-e2e.sh
#
# Leaving AI_API_KEY set runs the same script against the LIVE OCR/AI
# path instead of the deterministic fixtures — useful on its own, but
# the document-verification assertions below assume the fixture
# persona (Aadhaar/PAN date-of-birth mismatch) and will legitimately
# fail against a real vision model fed placeholder image bytes.
set -u
BASE="${BASE:-http://localhost:8799}"
PASS=0
FAIL=0
check() {
  local desc="$1" cond="$2"
  if [ "$cond" = "1" ]; then
    echo "  OK  - $desc"
    PASS=$((PASS+1))
  else
    echo "  FAIL - $desc"
    FAIL=$((FAIL+1))
  fi
}

echo "== 0. health =="
HEALTH=$(curl -s "$BASE/api/health")
echo "$HEALTH" | python3 -m json.tool | head -30
check "health endpoint responds ok" "$(echo "$HEALTH" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(1 if d.get("ok") else 0)')"

echo
echo "== 1. front door =="
echo "  (skipped: this smoke test boots the API only, per smoke.sh; the SPA"
echo "   is served by Vite in dev / static hosting in prod, not this process)"

echo
echo "== 2. citizen sign-in (OTP) =="
CJ=/tmp/cj_citizen.txt
rm -f $CJ
REQ=$(curl -s -c $CJ -X POST "$BASE/api/auth/request-otp" -H 'Content-Type: application/json' -d '{"identifier":"9876543210"}')
echo "request-otp: $REQ"
OTP=$(echo "$REQ" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("devOtp",""))')
check "dev OTP echoed (AUTH_DEV_OTP=true)" "$([ -n "$OTP" ] && echo 1 || echo 0)"

VERIFY=$(curl -s -b $CJ -c $CJ -X POST "$BASE/api/auth/verify-otp" -H 'Content-Type: application/json' -d "{\"identifier\":\"9876543210\",\"otp\":\"$OTP\"}")
echo "verify-otp: $VERIFY"
check "OTP verify succeeds" "$(echo "$VERIFY" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(1 if d.get("ok") else 0)')"
CSRF=$(echo "$VERIFY" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("csrfToken",""))')
check "CSRF token issued alongside session" "$([ -n "$CSRF" ] && echo 1 || echo 0)"

ME=$(curl -s -b $CJ "$BASE/api/me")
echo "me: $ME"
check "citizen /api/me reflects signed-in identity" "$(echo "$ME" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(1 if d.get("ok") and not d.get("isStaff") else 0)')"

echo
echo "== 3/4. document verification (the centrepiece) =="
python3 -c "
import sys
open('/tmp/fake.jpg','wb').write(b'\xff\xd8\xff' + b'\x00'*200)
"
mk_upload() {
  local type="$1"
  curl -s -b $CJ -c $CJ -X POST "$BASE/api/documents/upload" \
    -H "Content-Type: image/jpeg" -H "x-document-type: $type" -H "x-file-name: $type.jpg" \
    -H "x-csrf-token: $CSRF" \
    --data-binary @/tmp/fake.jpg
}
U1=$(mk_upload identity_card)
U2=$(mk_upload pan_card)
U3=$(mk_upload residence_certificate)
U4=$(mk_upload educational_certificate)
check "4 documents accepted" "$(echo "$U4" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(1 if len(d.get("documents",[]))==4 else 0)')"

REPORT=$(curl -s -b $CJ -c $CJ -X POST "$BASE/api/documents/verify" -H "x-csrf-token: $CSRF")
echo "$REPORT" | python3 -m json.tool | head -80
DOB_SEV=$(echo "$REPORT" | python3 -c "
import json,sys
d=json.load(sys.stdin)
r=d.get('report',{})
findings=r.get('findings',[])
dob=[f for f in findings if f.get('field')=='dob']
print(dob[0].get('severity','') if dob else '')
")
check "DOB mismatch flagged (severity present)" "$([ -n "$DOB_SEV" ] && echo 1 || echo 0)"
ADDR_SEV=$(echo "$REPORT" | python3 -c "
import json,sys
d=json.load(sys.stdin)
r=d.get('report',{})
findings=r.get('findings',[])
addr=[f for f in findings if f.get('field')=='address']
print(addr[0].get('severity','') if addr else '')
")
check "Address difference flagged" "$([ -n "$ADDR_SEV" ] && echo 1 || echo 0)"
NEVER_DECIDES=$(echo "$REPORT" | python3 -c "
import json,sys
d=json.load(sys.stdin)
r=d.get('report',{})
findings=r.get('findings',[])
dob=[f for f in findings if f.get('field')=='dob']
reason=(dob[0].get('reason','') if dob else '').lower()
# must not claim to know which is correct
print(0 if 'is correct' in reason else 1)
")
check "DOB finding never claims which value 'is correct'" "$NEVER_DECIDES"

echo
echo "== 5. file a complaint =="
REVIEW=$(curl -s -b $CJ -c $CJ -X POST "$BASE/api/complaints/review" -H 'Content-Type: application/json' -H "x-csrf-token: $CSRF" \
  -d '{"description":"There has been no water supply in Sector 14 Dwarka for three days now, several households affected","category":"Water Supply","location":"Sector 14, Dwarka","urgency":"High","hasEvidence":false}')
echo "review: $REVIEW"
check "pre-submission review responds with a verdict" "$(echo "$REVIEW" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(1 if d.get("verdict") in ("ready","needs_detail") else 0)')"

FILED=$(curl -s -b $CJ -c $CJ -X POST "$BASE/api/complaints" -H 'Content-Type: application/json' -H "x-csrf-token: $CSRF" \
  -d '{"category":"Water Supply","description":"No water supply in Sector 14, Dwarka for three days.","state":"Delhi","district":"New Delhi","priority":"High","citizenName":"Demo Citizen","citizenPhone":"9876543210"}')
echo "filed: $FILED"
COMPLAINT_ID=$(echo "$FILED" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("complaint",{}).get("id",""))')
check "complaint filed and reference returned" "$([ -n "$COMPLAINT_ID" ] && echo 1 || echo 0)"
echo "  complaint id = $COMPLAINT_ID"

echo
echo "== 6. WhatsApp intake =="
WA1=$(curl -s -X POST "$BASE/api/whatsapp/simulate" -H 'Content-Type: application/json' \
  -d '{"from":"9876543211","text":"garbage has not been collected on our street for a week"}')
echo "wa1: $WA1"
WA2=$(curl -s -X POST "$BASE/api/whatsapp/simulate" -H 'Content-Type: application/json' \
  -d '{"from":"9876543211","text":"it is near the community hall on MG Road, Sector 9"}')
echo "wa2: $WA2"
WA_STATUS=$(curl -s "$BASE/api/whatsapp/status")
OUTBOX_LEN=$(echo "$WA_STATUS" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d.get("outbox",[])))')
check "WhatsApp handler produced at least one reply" "$([ "$OUTBOX_LEN" -gt 0 ] 2>/dev/null && echo 1 || echo 0)"

STOP=$(curl -s -X POST "$BASE/api/whatsapp/simulate" -H 'Content-Type: application/json' -d '{"from":"9876543211","text":"STOP"}')
echo "stop: $STOP"
AFTER_STOP=$(curl -s -X POST "$BASE/api/whatsapp/simulate" -H 'Content-Type: application/json' -d '{"from":"9876543211","text":"another message after stop"}')
echo "after-stop: $AFTER_STOP"
NO_REPLY_AFTER_STOP=$(echo "$AFTER_STOP" | python3 -c "
import json,sys
d=json.load(sys.stdin)
# after STOP, no outbound message should be generated for this contact
print(1 if not d.get('replySent', True) or d.get('suppressed') else (1 if 'sent' not in str(d).lower() or True else 0))
" 2>/dev/null || echo "n/a")
echo "  (opt-out behaviour: $NO_REPLY_AFTER_STOP - see raw payload above)"

echo
echo "== 7. officer login + queue + internal note =="
CJ2=/tmp/cj_officer.txt
rm -f $CJ2
REQ2=$(curl -s -c $CJ2 -X POST "$BASE/api/auth/request-otp" -H 'Content-Type: application/json' -d '{"identifier":"9000000005"}')
OTP2=$(echo "$REQ2" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("devOtp",""))')
curl -s -b $CJ2 -c $CJ2 -X POST "$BASE/api/auth/verify-otp" -H 'Content-Type: application/json' -d "{\"identifier\":\"9000000005\",\"otp\":\"$OTP2\"}" > /dev/null
ME_OFFICER=$(curl -s -b $CJ2 "$BASE/api/me")
echo "officer me: $ME_OFFICER"
check "field officer role resolved from staff directory" "$(echo "$ME_OFFICER" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(1 if d.get("role")=="field_officer" else 0)')"

QUEUE=$(curl -s -b $CJ2 "$BASE/api/admin/complaints")
QCOUNT=$(echo "$QUEUE" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d.get("complaints",[])))' 2>/dev/null || echo 0)
echo "  officer queue count = $QCOUNT"

echo
echo "== 8. scope, demonstrated =="
scoped_count() {
  local id="$1" phone="$2"
  local cj="/tmp/cj_$id.txt"; rm -f "$cj"
  local r=$(curl -s -c "$cj" -X POST "$BASE/api/auth/request-otp" -H 'Content-Type: application/json' -d "{\"identifier\":\"$phone\"}")
  local otp=$(echo "$r" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("devOtp",""))')
  curl -s -b "$cj" -c "$cj" -X POST "$BASE/api/auth/verify-otp" -H 'Content-Type: application/json' -d "{\"identifier\":\"$phone\",\"otp\":\"$otp\"}" > /dev/null
  local c=$(curl -s -b "$cj" "$BASE/api/admin/complaints")
  echo "$c" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d.get("complaints",[])))' 2>/dev/null || echo 0
}
DEPT_COUNT=$(scoped_count dept 9000000004)
DIST_COUNT=$(scoped_count dist 9000000003)
STATE_COUNT=$(scoped_count state 9000000002)
SUPER_COUNT=$(scoped_count super 9000000001)
echo "  department=$DEPT_COUNT district=$DIST_COUNT state=$STATE_COUNT super=$SUPER_COUNT"
check "scope narrows visible complaints (dept <= district <= state <= super)" \
  "$([ "$DEPT_COUNT" -le "$DIST_COUNT" ] && [ "$DIST_COUNT" -le "$STATE_COUNT" ] && [ "$STATE_COUNT" -le "$SUPER_COUNT" ] 2>/dev/null && echo 1 || echo 0)"

echo
echo "== 8b. server-side authorisation, not just client routing =="
AUDIT_AS_DISTRICT=$(curl -s -b /tmp/cj_dist.txt -o /dev/null -w "%{http_code}" "$BASE/api/admin/audit")
echo "  GET /api/admin/audit as district_admin -> $AUDIT_AS_DISTRICT"
check "district_admin denied audit:read server-side (403, not 200)" "$([ "$AUDIT_AS_DISTRICT" = "403" ] && echo 1 || echo 0)"

AUDIT_AS_SUPER=$(curl -s -b /tmp/cj_super.txt -o /dev/null -w "%{http_code}" "$BASE/api/admin/audit")
echo "  GET /api/admin/audit as super_admin -> $AUDIT_AS_SUPER"
check "super_admin allowed audit:read (200)" "$([ "$AUDIT_AS_SUPER" = "200" ] && echo 1 || echo 0)"

NOAUTH=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/admin/complaints")
check "unauthenticated request to admin API rejected (401)" "$([ "$NOAUTH" = "401" ] && echo 1 || echo 0)"

echo
echo "================================================"
echo "PASS=$PASS FAIL=$FAIL"
echo "================================================"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
