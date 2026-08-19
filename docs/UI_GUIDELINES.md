# UI guidelines

## Tokens

Every colour is a CSS custom property in `src/index.css`. **No component
hardcodes a hex value.** Light and dark are two token sets; nothing else
changes.

Contrast ratios are documented beside each token because they were measured,
not guessed:

```css
--color-navy:        #0F172A;  /* 16.9:1 on white */
--color-saffron:     #C2410C;  /*  5.9:1 — accessible replacement for #FF6B00 */
--color-cta:         #0369A1;  /*  6.4:1 — primary action */
--color-content-3:   #4E5A6B;  /*  replaces gray-400 for real text */
```

`--color-saffron` is not the brand orange. `#FF6B00` fails AA on white, so
the accessible variant is the token and the bright one is reserved for
decoration and large text. That substitution is the single most common
reason a government site fails an audit.

## Hierarchy

- **Surfaces**: `--color-surface` (cards, navbar) → `--color-surface-2`
  (insets, chips) → `--color-surface-3` (pressed, tracks)
- **Text**: `--color-content` (primary) → `--color-content-2` (secondary) →
  `--color-content-3` (tertiary, still ≥4.5:1)
- **Elevation**: `.elev-1` … `.elev-4`. Nothing invents a shadow.

## Rules

**Colour is never the only carrier of meaning.** Priority shows a coloured
dot *and* the word. Critical and High are adjacent oranges in this palette
and are near-identical to a red-green colour-blind reader — and even with
perfect vision, a coloured dot with no legend is a code the user has to have
memorised.

**Text never sits on an animated background.** Backgrounds are
`aria-hidden`, `pointer-events-none`, and every piece of text sits on an
opaque surface above them. Measured contrast therefore still holds.

**Motion is opt-out and compositor-only.** Only `opacity` and `transform`
animate. `prefers-reduced-motion: reduce` disables entrance animation
entirely — which also means reduced-motion users see all content
immediately, so scroll-reveal can never hide anything from the people most
at risk of it.

**Animated backgrounds are opt-in per device.** `PageBackground` rejects a
shader on reduced motion, small viewports, Save-Data, 2g/3g, <4 cores,
<4 GB RAM, or no WebGL2. Each rejection corresponds to a real population,
not a hypothetical one. The static gradient renders first and always; the
canvas fades in over it only where warranted, so there is no flash and no
layout difference.

**Focus is always visible.** A global `:focus-visible` ring. Never
`outline: none` without a replacement.

**Touch targets are ≥44px.** Bottom navigation uses `min-h-[56px]` and
`env(safe-area-inset-bottom)` so it clears the iOS home indicator.

**Every interactive element has an accessible name.** Icon-only buttons
carry `aria-label`; decorative icons carry `aria-hidden="true"`.

## Typography

`font-display` for headings, system stack for body. Sizes are set in `px`
via arbitrary values (`text-[13.5px]`) rather than the default scale —
information-dense administrative screens need finer steps than
`text-sm`/`text-base` provide.

## Language

Twelve languages, each listed in **its own script** in the picker. Someone
who cannot read the interface still has to find their language in it — a
picker written entirely in English is a picker the people who most need it
cannot use.

`<html lang>` and `<html dir>` are set on the document, not a wrapper div,
so native controls and scrollbars flip too. Urdu is RTL and is the reason
`dir` exists on the locale list at all.

## Copy

- Say what happened and what to do about it. "Your session expired. Please
  sign in again." — not "Error 401".
- Never claim more than is true. "Configuration required", not "Coming soon".
- Never use "Connected" for a simulated integration.
- Numbers on the landing page are ones the codebase can be held to: 12 is
  `LOCALES.length`, 14 is `STATUSES.length`.

## Layout

- Content max-width ~64rem for reading, ~42rem for forms and conversation.
- Side panels become overlay drawers below the breakpoint, from **one
  component** — two implementations drift, and the drift is invisible until
  someone opens the phone.
- Sticky footers for wizards; the primary action never scrolls away.

## Density

Staff screens are denser than citizen screens, deliberately. A citizen
filing one complaint a year needs air and large targets. An officer working
eleven cases needs to see eleven rows without scrolling.

The officer queue has **no charts**. An officer with eleven open cases does
not need a pie chart of them; they need to know which one breaches first.
