#!/usr/bin/env python3
"""
CIVIC AI — logo asset export.

Emits the mark at production sizes with transparent grounds, plus SVG with
all type converted to outlines (no font dependency at render time).

Two lockups, because they solve different problems:
  stacked     — wordmark above the shield; for splash, print, square crops
  horizontal  — shield beside the wordmark; for navbars and letterheads
"""
import math
import cairo

OUT = "design/assets"

GROUND = (0xF4/255, 0xF2/255, 0xED/255)
INK    = (0x16/255, 0x26/255, 0x3F/255)
GREEN  = (0x2F/255, 0x5D/255, 0x50/255)
BRICK  = (0x8C/255, 0x3B/255, 0x2E/255)
WHITE  = (1, 1, 1)

SANS = "sans-serif"


# ── primitives ────────────────────────────────────────────────────────
def figure(c, cx, base, u, rgb):
    head_r = 0.40 * u * 0.98
    head_cy = base - 1.62 * u
    body_w, body_h = 1.00 * u, 1.02 * u
    top_r = body_w / 2
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

    c.new_path()
    c.arc(cx, head_cy, head_r, 0, 2 * math.pi)
    c.fill()


def shield_path(c, cx, top, w, h):
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


def emblem(c, cx, top, S, mono=None, solid_bg=None):
    """Shield + three figures + the connecting arc. Returns (w, h)."""
    sw, sh = 4.72 * S, 4.92 * S
    ink = mono or INK

    if solid_bg:
        shield_path(c, cx, top, sw, sh)
        c.set_source_rgb(*solid_bg)
        c.fill()

    shield_path(c, cx, top, sw, sh)
    c.set_line_width(0.135 * S)
    c.set_line_join(cairo.LINE_JOIN_ROUND)
    c.set_source_rgb(*ink)
    c.stroke()

    u = S
    base = top + sh * 0.742
    gap = 1.34 * u
    cols = [cx - gap, cx, cx + gap]
    rgbs = (GREEN, INK, BRICK) if mono is None else (mono, mono, mono)

    head_cy = base - 1.62 * u
    head_r = 0.40 * u * 0.98

    # Drawn before the heads so they occlude its ends: the link reads as
    # passing behind the figures rather than sprouting from them.
    # ONE arc, not two. Two humps scallop; a single span reads as a single
    # connection across all three. Control points are pulled inward so the
    # curve leaves each outer head travelling up-and-in — with vertical
    # tangents it exited sideways and left visible stubs beyond the heads.
    # For a symmetric cubic the midpoint sits at (y0 + 3*yc)/4, so placing
    # yc at head_cy - (4/3)*head_r lands the apex exactly on the crown of
    # the centre head: the arc touches it rather than floating above it.
    yc = head_cy - (4.0 / 3.0) * head_r
    inset = 0.45 * gap
    c.set_line_width(0.050 * S)
    c.set_line_cap(cairo.LINE_CAP_BUTT)
    c.set_source_rgb(*ink)
    c.new_path()
    c.move_to(cols[0], head_cy)
    c.curve_to(cols[0] + inset, yc, cols[2] - inset, yc, cols[2], head_cy)
    c.stroke()

    for x, rgb in zip(cols, rgbs):
        figure(c, x, base, u, rgb)

    return sw, sh


def wordmark(c, x, y, size, rgb, align="left", as_path=True):
    """
    Type is drawn as outlines, not glyphs — the asset must render identically
    on a machine that has never heard of this typeface.
    """
    text, trk = "CIVIC AI", size * 0.23
    c.select_font_face(SANS, cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_BOLD)
    c.set_font_size(size)
    widths = [c.text_extents(ch).x_advance for ch in text]
    total = sum(widths) + trk * (len(text) - 1)
    if align == "center":
        x -= total / 2
    elif align == "right":
        x -= total
    c.set_source_rgb(*rgb)
    for ch, adv in zip(text, widths):
        c.move_to(x, y)
        if as_path:
            c.text_path(ch)
            c.fill()
        else:
            c.show_text(ch)
        x += adv + trk
    return total


def wordmark_width(c, size):
    text, trk = "CIVIC AI", size * 0.23
    c.select_font_face(SANS, cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_BOLD)
    c.set_font_size(size)
    return sum(c.text_extents(ch).x_advance for ch in text) + trk * (len(text) - 1)


# ── compositions ──────────────────────────────────────────────────────
def draw_stacked(c, S, pad, mono=None, bg=None):
    wm_size = 1.30 * S
    probe = cairo.Context(cairo.ImageSurface(cairo.FORMAT_ARGB32, 1, 1))
    wm_w = wordmark_width(probe, wm_size)
    sw, sh = 4.72 * S, 4.92 * S

    W = max(wm_w, sw) + pad * 2
    H = wm_size * 0.74 + 0.90 * S + sh + pad * 2
    cx = W / 2
    if bg:
        c.set_source_rgb(*bg); c.paint()
    wm_y = pad + wm_size * 0.74
    wordmark(c, cx, wm_y, wm_size, mono or INK, align="center")
    emblem(c, cx, wm_y + 0.90 * S, S, mono=mono)
    return W, H


def draw_horizontal(c, S, pad, mono=None, bg=None):
    """Shield left, wordmark right, optically centred on the shield's mass."""
    wm_size = 1.62 * S
    probe = cairo.Context(cairo.ImageSurface(cairo.FORMAT_ARGB32, 1, 1))
    wm_w = wordmark_width(probe, wm_size)
    sw, sh = 4.72 * S, 4.92 * S
    gutter = 0.85 * S

    W = sw + gutter + wm_w + pad * 2
    H = sh + pad * 2
    if bg:
        c.set_source_rgb(*bg); c.paint()

    emblem(c, pad + sw / 2, pad, S, mono=mono)
    # Cap-height centring: the optical middle of the shield sits slightly
    # above its geometric middle because of the taper.
    baseline = pad + sh * 0.46 + wm_size * 0.36
    wordmark(c, pad + sw + gutter, baseline, wm_size, mono or INK)
    return W, H


def render(name, fn, S, pad, mono=None, bg=None, svg=True):
    probe = cairo.Context(cairo.ImageSurface(cairo.FORMAT_ARGB32, 1, 1))
    W, H = fn(probe, S, pad, mono=mono, bg=None)
    W, H = int(round(W)), int(round(H))

    srf = cairo.ImageSurface(cairo.FORMAT_ARGB32, W, H)
    c = cairo.Context(srf)
    c.set_antialias(cairo.ANTIALIAS_BEST)
    fn(c, S, pad, mono=mono, bg=bg)
    srf.write_to_png(f"{OUT}/{name}.png")

    if svg:
        vs = cairo.SVGSurface(f"{OUT}/{name}.svg", W, H)
        vc = cairo.Context(vs)
        fn(vc, S, pad, mono=mono, bg=bg)
        vs.finish()
    return W, H


def render_icon(name, S, mono=None, bg=None, radius=None):
    """Square app icon / favicon: emblem only, optically centred."""
    sw, sh = 4.72 * S, 4.92 * S
    side = int(round(sh * 1.44))
    srf = cairo.ImageSurface(cairo.FORMAT_ARGB32, side, side)
    c = cairo.Context(srf)
    c.set_antialias(cairo.ANTIALIAS_BEST)
    if bg:
        r = radius if radius is not None else side * 0.2237  # iOS squircle-ish
        c.new_path()
        c.arc(side - r, r, r, -math.pi / 2, 0)
        c.arc(side - r, side - r, r, 0, math.pi / 2)
        c.arc(r, side - r, r, math.pi / 2, math.pi)
        c.arc(r, r, r, math.pi, 1.5 * math.pi)
        c.close_path()
        c.set_source_rgb(*bg)
        c.fill()
    emblem(c, side / 2, (side - sh) / 2, S, mono=mono)
    srf.write_to_png(f"{OUT}/{name}.png")
    return side, side


import os
os.makedirs(OUT, exist_ok=True)

made = []
made.append(("civicai-stacked",            *render("civicai-stacked", draw_stacked, 96, 40)))
made.append(("civicai-stacked-mono",       *render("civicai-stacked-mono", draw_stacked, 96, 40, mono=INK)))
made.append(("civicai-horizontal",         *render("civicai-horizontal", draw_horizontal, 72, 34)))
made.append(("civicai-horizontal-mono",    *render("civicai-horizontal-mono", draw_horizontal, 72, 34, mono=INK)))
made.append(("civicai-horizontal-reversed",*render("civicai-horizontal-reversed", draw_horizontal, 72, 34,
                                                   mono=GROUND, bg=INK)))
made.append(("civicai-icon",               *render_icon("civicai-icon", 96)))
made.append(("civicai-icon-ink",           *render_icon("civicai-icon-ink", 96, mono=GROUND, bg=INK)))
made.append(("civicai-icon-favicon",       *render_icon("civicai-icon-favicon", 12, mono=INK)))

for n, w, h in made:
    print(f"  {n:<30} {w}×{h}")
