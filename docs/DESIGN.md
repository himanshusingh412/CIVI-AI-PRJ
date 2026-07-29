# CivicAI Design System

Style: **Accessible & Ethical** — the pattern recommended for government / public-sector
products. Target is WCAG AAA, because a civic portal must work for every citizen,
including those using screen readers, keyboard-only navigation, or older devices.

## Typography

| Role | Font | Why |
|------|------|-----|
| Headings | **Lexend** | Designed to reduce visual stress and improve reading proficiency |
| Body | **Source Sans 3** | Highly legible at small sizes, wide language coverage |

Body text is 16px minimum with 1.6 line-height. Headings use 1.25 line-height and
−0.01em tracking.

## Color

Every text color was chosen to clear 4.5:1 against its background; most clear 7:1 (AAA).

| Token | Hex | Contrast on white |
|-------|-----|-------------------|
| `--color-navy` | `#0F172A` | 16.9:1 |
| `--color-navy-light` | `#334155` | 9.7:1 |
| `--color-text-muted` | `#475569` | 7.5:1 |
| `--color-cta` | `#0369A1` | 6.4:1 |
| `--color-saffron` | `#C2410C` | 5.9:1 |
| `--color-success` | `#15803D` | 5.2:1 |
| `--color-danger` | `#B91C1C` | 6.2:1 |

The original brand saffron `#FF6B00` sits at 2.9:1 — below the minimum — so it was
darkened to `#C2410C` for text and kept bright only for large decorative elements.
Dark mode lightens accents (`#FB923C`, `#38BDF8`) to preserve contrast on dark surfaces.

## Interaction rules

- **Focus rings** — 3px `#0369A1` outline with 2px offset on every `:focus-visible`
- **Touch targets** — 44×44px minimum on coarse pointers
- **Cursor** — `pointer` on all enabled interactive elements, `not-allowed` when disabled
- **Transitions** — 200ms `cubic-bezier(0.4, 0, 0.2, 1)`, within the 150–300ms band
- **Motion** — `prefers-reduced-motion: reduce` collapses all animation to 0.01ms
- **Skip link** — first tab stop jumps to main content

## Forms

Every input has a real `<label for>`, an `aria-describedby` hint, and `aria-invalid`
when validation fails. Errors render in a `role="alert"` live region so screen readers
announce them immediately; status messages use `role="status"`. Buttons disable and show
a spinner during async work so the action can't be double-fired.

## Anti-patterns avoided

Per the design-system guidance for this product category:

- No emoji used as functional icons (Lucide SVG instead)
- No low-contrast gray-on-gray text
- No AI-purple/pink gradients
- No motion effects that can't be disabled
- No ornate decoration competing with the content
