# Product requirements

## The problem

Two failures make Indian government services hard to use. Neither is a
technology problem, and both are solvable with information the citizen
already has.

**1. A complaint disappears.** It goes into an office and comes out weeks
later, or not at all. There is no reference, no named officer, no deadline,
and no way to find out. The absence of a receipt is the absence of
accountability.

**2. An application is rejected weeks after submission** because two
attached documents disagree — most often a name transliterated differently
or a date of birth in the other convention. The citizen has paid the fee and
taken a day off work, finds out by post, and starts again. The discrepancy
was visible in their own documents the whole time.

## Who this is for

**Primary: the citizen.** Often on a low-end Android phone over metered
data, often not reading English, often filing on behalf of a household or a
street rather than themselves. May never install an app. Frequently already
uses WhatsApp daily.

**Secondary: the field officer.** Eleven open cases, several already late,
working from a phone in the field. Does not want a dashboard; wants to know
what breaches first.

**Tertiary: the district administrator.** Needs both — a queue to work and a
view of where the department is failing.

## What success looks like

| Outcome | How it is measured |
|---|---|
| Every complaint is traceable | 100% have a reference, a department, a deadline and a timeline |
| Nobody waits without knowing | A status change reaches the citizen on a channel they chose |
| Fewer rejected applications | Document mismatches surfaced **before** submission |
| Officers work the right case first | Queue ordered by deadline, overdue counted separately |
| Nothing is closed over a citizen's head | Closure is unreachable without citizen verification |
| Claims are checkable | Every integration reports an honest mode |

## Requirements

### Must
- File a complaint by form, conversation or WhatsApp, in twelve languages
- A reference number, immediately, that survives everything
- Cross-document verification before an application
- Role-based access enforced server-side, per request, by capability **and**
  jurisdiction
- A workflow where illegal transitions are impossible by construction
- An append-only, tamper-evident audit log
- Notifications the citizen opts into, with a working opt-out
- Honest labelling of every simulated integration

### Should
- Voice input, degrading silently to typing
- Live SLA countdowns and automatic escalation
- Duplicate detection that **never** merges without a person deciding
- Evidence attached to a complaint

### Will not (this build)
- Payments, or anything transactional with money
- Automated approval of any application
- Editing a citizen's documents, under any circumstance
- Identity verification against a government registry
- Deciding which of two conflicting values is correct

## Constraints that shaped the design

1. **Low-end Android over metered data.** Animated backgrounds are opt-in
   per device; heavy bundles are split and lazy.
2. **A large share of users do not read English.** Twelve languages, each
   listed in its own script, with RTL support.
3. **The most sensitive data is the least necessary to keep.** Document
   verification persists nothing.
4. **Government trust is fragile.** A single overstated claim discredits
   every other one, so the integration status layer is a product feature
   rather than an implementation detail.

## Explicit non-goals

**This system does not decide anything about a person.** It routes, tracks,
compares and reports. Every judgement — is this the same person, which date
is correct, should this application be approved — belongs to a human, and
the interface is designed to hand those decisions over rather than to
quietly make them.
