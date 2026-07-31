#!/usr/bin/env python3
"""
CIVIC GEOMETRY — Plate 01
Identity specimen for a horizontal CIVIC AI lockup.

Everything is drawn from a single unit U. No magic numbers: each radius,
interval and stroke is a stated multiple, so the composition reads as
inevitable rather than arranged.
"""
import math
import cairo

W, H = 2400, 2820
FONTS = "/sessions/wizardly-brave-lovelace/mnt/.claude/skills/canvas-design/canvas-fonts"

# ── palette ───────────────────────────────────────────────────────────
# Every hue survives conversion to a single grey channel and stays legible.
GROUND = (0xF4/255, 0xF2/255, 0xED/255)
INK    = (0x16/255, 0x26/255, 0x3F/255)   # stamp-pad indigo
GREEN  = (0x2F/255, 0x5D/255, 0x50/255)   # oxidised public bronze
BRICK  = (0x8C/255, 0x3B/255, 0x2E/255)   # institutional stone
RULE   = (0xC9/255, 0xC4/255, 0xB8/255)
FAINT  = (0xDE/255, 0xDA/255, 0xD1/255)

M = 220                      # margin
CW = W - 2 * M               # content width
CX = W / 2

srf = cairo.ImageSurface(cairo.FORMAT_ARGB32, W, H)
c = cairo.Context(srf)
c.set_antialias(cairo.ANTIALIAS_BEST)
c.set_source_rgb(*GROUND)
c.paint()

# ── type helpers ──────────────────────────────────────────────────────
_faces = {}
def face(name):
    if name not in _faces:
        _faces[name] = cairo.ToyFontFace(name)
    return _faces[name]

def use(font_path_hint, size):
    """Toy API keyed on family names Cairo resolves from the system."""
    c.select_font_face(font_path_hint, cairo.FONT_SLANT_NORMAL,
                       cairo.FONT_WEIGHT_NORMAL)
    c.set_font_size(size)

def tracked(text, x, y, size, tracking, rgb, family="sans-serif",
            bold=False, align="left"):
    """
    Hand-tracked type. Cairo has no letter-spacing, so glyphs are placed
    individually — which is also what lets tracking stay optically even
    at display size instead of merely mathematically even.
    """
    c.select_font_face(family, cairo.FONT_SLANT_NORMAL,
                       cairo.FONT_WEIGHT_BOLD if bold else cairo.FONT_WEIGHT_NORMAL)
    c.set_font_size(size)
    widths = [c.text_extents(ch).x_advance for ch in text]
    total = sum(widths) + tracking * (len(text) - 1)
    if align == "center":
        x -= total / 2
    elif align == "right":
        x -= total
    c.set_source_rgb(*rgb)
    for ch, adv in zip(text, widths):
        c.move_to(x, y)
        c.show_text(ch)
        x += adv + tracking
    return total

def measure(text, size, tracking, family="sans-serif", bold=False):
    c.select_font_face(family, cairo.FONT_SLANT_NORMAL,
                       cairo.FONT_WEIGHT_BOLD if bold else cairo.FONT_WEIGHT_NORMAL)
    c.set_font_size(size)
    return sum(c.text_extents(ch).x_advance for ch in text) + tracking * (len(text) - 1)

def hairline(x0, y, x1, rgb=RULE, w=1.0):
    c.set_line_width(w)
    c.set_source_rgb(*rgb)
    c.move_to(x0, y); c.line_to(x1, y); c.stroke()

# ── the mark ──────────────────────────────────────────────────────────
def figure(cx, base, u, rgb):
    """
    A person reduced to its shortest notation: a circle above a tapered
    body. Any further detail would be decoration pretending to be clarity.
    """
    head_r = 0.40 * u
    head_cy = base - 1.62 * u
    body_w = 1.00 * u
    body_h = 1.02 * u
    top_r = body_w / 2

    # body — a tombstone form: semicircular shoulders, straight flanks
    left, right = cx - body_w / 2, cx + body_w / 2
    top = base - body_h
    c.new_path()
    c.move_to(left, base)
    c.line_to(left, top + top_r)
    c.arc(cx, top + top_r, top_r, math.pi, 2 * math.pi)
    c.line_to(right, base)
    c.close_path()
    c.set_source_rgb(*rgb)
    c.fill()

    # head — optically reduced 2% so it reads the same weight as the body
    c.new_path()
    c.arc(cx, head_cy, head_r * 0.98, 0, 2 * math.pi)
    c.fill()
    return (cx, head_cy, head_r)


def shield(cx, top, w, h, lw, rgb):
    """
    A civic containing boundary. Invoked structurally, not decoratively:
    shoulders squared to a stated radius, base drawn to a single point.
    """
    r = 0.16 * w
    l, rt = cx - w / 2, cx + w / 2
    shoulder = top + h * 0.575
    c.new_path()
    c.move_to(l + r, top)
    c.line_to(rt - r, top)
    c.arc(rt - r, top + r, r, -math.pi / 2, 0)
    c.line_to(rt, shoulder)
    c.curve_to(rt, top + h * 0.855, cx + w * 0.305, top + h * 0.985, cx, top + h)
    c.curve_to(cx - w * 0.305, top + h * 0.985, l, top + h * 0.855, l, shoulder)
    c.line_to(l, top + r)
    c.arc(l + r, top + r, r, math.pi, 1.5 * math.pi)
    c.close_path()
    c.set_line_width(lw)
    c.set_line_join(cairo.LINE_JOIN_ROUND)
    c.set_source_rgb(*rgb)
    c.stroke()


def mark(cx, top, S, mono=None, wordmark=True):
    """
    S is the master unit. The lockup resolves laterally: three figures on a
    shared baseline, measured at identical intervals — a claim about parity,
    not hierarchy.
    """
    sw, sh = 4.72 * S, 4.92 * S
    ink = mono or INK
    shield(cx, top, sw, sh, 0.135 * S, ink)

    u = 1.00 * S
    base = top + sh * 0.742
    gap = 1.34 * u
    cols = [cx - gap, cx, cx + gap]
    cols_rgb = (GREEN, INK, BRICK) if mono is None else (mono, mono, mono)

    head_cy = base - 1.62 * u
    head_r = 0.40 * u * 0.98

    # The connection is drawn FIRST, so the heads occlude its endpoints and
    # the line reads as passing behind them — a network implied, not drawn.
    # One continuous arc, not two: two curves read as ears.
    c.set_line_width(0.050 * S)
    c.set_line_cap(cairo.LINE_CAP_BUTT)
    c.set_source_rgb(*ink)
    # ONE arc, not two. Two humps scallop; a single span reads as a single
    # connection across all three. Control points are pulled inward so the
    # curve leaves each outer head travelling up-and-in — with vertical
    # tangents it exited sideways and left visible stubs beyond the heads.
    # For a symmetric cubic the midpoint sits at (y0 + 3*yc)/4, so placing
    # yc at head_cy - (4/3)*head_r lands the apex exactly on the crown of
    # the centre head: the arc touches it rather than floating above it.
    head_r = 0.40 * u * 0.98
    yc = head_cy - (4.0 / 3.0) * head_r
    inset = 0.45 * gap
    c.new_path()
    c.move_to(cols[0], head_cy)
    c.curve_to(cols[0] + inset, yc, cols[2] - inset, yc, cols[2], head_cy)
    c.stroke()

    for x, rgb in zip(cols, cols_rgb):
        figure(x, base, u, rgb)

    if wordmark:
        # Horizontal, above the shield, on a shared optical axis.
        size = 1.30 * S
        trk = 0.30 * S
        y = top - 0.90 * S
        tracked("CIVIC AI", cx, y, size, trk, ink,
                family="sans-serif", bold=True, align="center")
    return sh


# ── plate furniture ───────────────────────────────────────────────────
def corner_ticks(inset=118, arm=44, w=1.0):
    c.set_line_width(w)
    c.set_source_rgb(*RULE)
    for sx, x in ((1, inset), (-1, W - inset)):
        for sy, y in ((1, inset), (-1, H - inset)):
            c.move_to(x, y); c.line_to(x + sx * arm, y); c.stroke()
            c.move_to(x, y); c.line_to(x, y + sy * arm); c.stroke()

def ruler(x0, x1, y, n, tall=14, short=8):
    c.set_line_width(1.0)
    c.set_source_rgb(*RULE)
    for i in range(n + 1):
        x = x0 + (x1 - x0) * i / n
        h = tall if i % 5 == 0 else short
        c.move_to(x, y); c.line_to(x, y + h); c.stroke()

MONO = "monospace"
SANS = "sans-serif"

corner_ticks()

# ── header ────────────────────────────────────────────────────────────
tracked("CIVIC GEOMETRY", M, 208, 20, 5.0, INK, MONO)
tracked("PLATE 01 / IDENTITY", W - M, 208, 20, 5.0, INK, MONO, align="right")
hairline(M, 244, W - M, RULE)
tracked("HORIZONTAL LOCKUP — WORDMARK SUPERIOR, FIGURES COPLANAR",
        M, 292, 19, 3.4, (0x6B/255, 0x66/255, 0x5C/255), MONO)
tracked("REV 02", W - M, 292, 19, 3.4, (0x6B/255, 0x66/255, 0x5C/255),
        MONO, align="right")

# ── primary mark ──────────────────────────────────────────────────────
S = 118
MARK_TOP = 620
mark(CX, MARK_TOP, S)

# faint construction axis — invisible at arm's length, absorbing up close
c.set_line_width(1.0)
c.set_source_rgb(*FAINT)
c.set_dash([6, 10])
c.move_to(CX, MARK_TOP - 2.10 * S); c.line_to(CX, MARK_TOP + 5.55 * S); c.stroke()
c.set_dash([])

base_y = MARK_TOP + 4.92 * S * 0.742
c.set_source_rgb(*FAINT)
c.set_dash([6, 10])
c.move_to(CX - 3.45 * S, base_y); c.line_to(CX + 3.45 * S, base_y); c.stroke()
c.set_dash([])
tracked("BASELINE — SHARED", CX + 3.58 * S, base_y + 6, 16, 2.6,
        (0x9A/255, 0x94/255, 0x88/255), MONO)

# ── divider ───────────────────────────────────────────────────────────
Y1 = 1418
hairline(M, Y1, W - M, RULE)
tracked("CONSTRUCTION", M, Y1 + 46, 19, 3.4, INK, MONO)
tracked("Ø 3 UNITS", W - M, Y1 + 46, 19, 3.4,
        (0x6B/255, 0x66/255, 0x5C/255), MONO, align="right")

# ── three studies ─────────────────────────────────────────────────────
cell = CW / 3
sy = 1512
s2 = 40

# 01 — geometry exposed
cx1 = M + cell * 0.5
c.set_line_width(1.0)
c.set_source_rgb(*FAINT)
for k in range(-3, 4):
    c.move_to(cx1 + k * s2 * 0.95, sy + 74)
    c.line_to(cx1 + k * s2 * 0.95, sy + 88 + 4.92 * s2 + 18)
    c.stroke()
mark(cx1, sy + 88, s2, mono=INK, wordmark=False)
tracked("01  GRID", cx1, sy + 4.92 * s2 + 186, 17, 3.0,
        (0x6B/255, 0x66/255, 0x5C/255), MONO, align="center")

# 02 — single ink
cx2 = M + cell * 1.5
mark(cx2, sy + 88, s2, mono=INK, wordmark=False)
tracked("02  MONO", cx2, sy + 4.92 * s2 + 186, 17, 3.0,
        (0x6B/255, 0x66/255, 0x5C/255), MONO, align="center")

# 03 — reversed
cx3 = M + cell * 2.5
c.set_source_rgb(*INK)
c.rectangle(cx3 - cell * 0.36, sy + 44, cell * 0.72, 4.92 * s2 + 96)
c.fill()
mark(cx3, sy + 92, s2 * 0.92, mono=GROUND, wordmark=False)
tracked("03  REVERSED", cx3, sy + 4.92 * s2 + 186, 17, 3.0,
        (0x6B/255, 0x66/255, 0x5C/255), MONO, align="center")

# ── divider ───────────────────────────────────────────────────────────
Y2 = 1990
hairline(M, Y2, W - M, RULE)
tracked("LEGIBILITY UNDER REDUCTION", M, Y2 + 46, 19, 3.4, INK, MONO)
tracked("FOUR REDUCTIONS", W - M, Y2 + 46, 19, 3.4,
        (0x6B/255, 0x66/255, 0x5C/255), MONO, align="right")

# ── scale test — the mark must survive being made small ───────────────
ruler(M, W - M, Y2 + 78, 40)
sizes = [26, 18, 12, 8]
x = M + 96
row_base = 2318
for i, s in enumerate(sizes):
    mark(x + s * 2.6, row_base - s * 4.92, s, mono=INK, wordmark=False)
    tracked(f"{int(s*4.72)} PX", x + s * 2.6, row_base + 42, 15, 2.4,
            (0x9A/255, 0x94/255, 0x88/255), MONO, align="center")
    x += s * 6.4 + 132

# wordmark specimen, right-aligned in the same optical band
wm_y = row_base - 58
tracked("CIVIC AI", W - M, wm_y, 92, 22, INK, SANS, bold=True, align="right")
wm_w = measure("CIVIC AI", 92, 22, SANS, bold=True)
hairline(W - M - wm_w, wm_y + 30, W - M, FAINT)
tracked("WORDMARK / TRACKING +240", W - M, wm_y + 62, 15, 2.4,
        (0x9A/255, 0x94/255, 0x88/255), MONO, align="right")

# ── footer ────────────────────────────────────────────────────────────
YF = 2540
hairline(M, YF, W - M, RULE)
tracked("THREE FIGURES · ONE BOUNDARY · ONE BASELINE", M, YF + 52, 20, 4.2,
        INK, MONO)
tracked("CG—01", W - M, YF + 52, 20, 4.2,
        (0x6B/255, 0x66/255, 0x5C/255), MONO, align="right")

srf.write_to_png("design/civic_ai_plate01.png")
print("wrote design/civic_ai_plate01.png")
