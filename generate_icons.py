#!/usr/bin/env python3
"""
Generate professional translation extension icons — v7.

Fixes from v6:
- 48px: Font size was way too large (56*4=224pt in 192px canvas). Fixed to proper scaling.
- 16px: Fine-tuned diagonal placement for better balance.
- 128px: Kept as-is (looks good).
"""

from PIL import Image, ImageDraw, ImageFont
import math
import os

OUTPUT_DIR = "/tmp/translate-browser-extension/src/assets/icons"

GRAD_TOP = (52, 120, 246)
GRAD_BOTTOM = (20, 168, 200)
WHITE = (255, 255, 255, 255)
WHITE_80 = (255, 255, 255, 205)
SHADOW = (0, 0, 0, 45)

FONT_LATIN = "/System/Library/Fonts/HelveticaNeue.ttc"
FONT_CJK = "/System/Library/Fonts/Hiragino Sans GB.ttc"
LATIN_BOLD = 1
CJK_BOLD = 2


def rr_mask(w, h, r):
    s = 4
    m = Image.new("L", (w * s, h * s), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, w * s - 1, h * s - 1], radius=r * s, fill=255)
    return m.resize((w, h), Image.LANCZOS)


def make_gradient(w, h, c1, c2, angle=135):
    img = Image.new("RGBA", (w, h))
    px = img.load()
    rad = math.radians(angle)
    ca, sa = math.cos(rad), math.sin(rad)
    ps = [x * ca + y * sa for x, y in [(0, 0), (w, 0), (0, h), (w, h)]]
    lo, hi = min(ps), max(ps)
    sp = hi - lo or 1
    for y in range(h):
        for x in range(w):
            t = max(0.0, min(1.0, ((x * ca + y * sa) - lo) / sp))
            px[x, y] = (
                int(c1[0] + (c2[0] - c1[0]) * t),
                int(c1[1] + (c2[1] - c1[1]) * t),
                int(c1[2] + (c2[2] - c1[2]) * t), 255
            )
    return img


def td(font, text):
    bb = font.getbbox(text)
    return bb[2] - bb[0], bb[3] - bb[1], bb[0], bb[1]


def dc(draw, text, font, cx, cy, fill):
    """Draw text centered at (cx, cy)."""
    w, h, ox, oy = td(font, text)
    draw.text((cx - w / 2 - ox, cy - h / 2 - oy), text, font=font, fill=fill)
    return w, h


def dcs(draw, text, font, cx, cy, fill, sfill, so=2):
    """Draw text with shadow."""
    dc(draw, text, font, cx + so, cy + so, sfill)
    return dc(draw, text, font, cx, cy, fill)


def base(size, r):
    g = make_gradient(size, size, GRAD_TOP, GRAD_BOTTOM, 135)
    m = rr_mask(size, size, r)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(g, mask=m)
    return out


def icon_128():
    """128px: "A → 文" with arrow. Rendered at 512px (4x)."""
    W = 512
    R = 112
    img = base(W, R)
    draw = ImageDraw.Draw(img)

    fa = ImageFont.truetype(FONT_LATIN, 216, index=LATIN_BOLD)   # 54*4
    fc = ImageFont.truetype(FONT_CJK, 192, index=CJK_BOLD)      # 48*4

    aw, ah, _, _ = td(fa, "A")
    cw, ch, _, _ = td(fc, "文")

    arr_w = 88   # 22*4
    gap = 16     # 4*4
    total = aw + gap + arr_w + gap + cw
    sx = (W - total) / 2
    cy = W / 2 + 8  # 2*4

    dcs(draw, "A", fa, sx + aw / 2, cy, WHITE, SHADOW, 8)
    dcs(draw, "文", fc, sx + aw + gap + arr_w + gap + cw / 2, cy, WHITE, SHADOW, 8)

    # Arrow
    ax1 = sx + aw + gap + 12
    ax2 = ax1 + arr_w - 24
    draw.line([(ax1, cy), (ax2 - 38, cy)], fill=WHITE_80, width=12)
    draw.polygon([
        (ax2, cy),
        (ax2 - 40, cy - 28),
        (ax2 - 40, cy + 28),
    ], fill=WHITE_80)

    img = img.resize((128, 128), Image.LANCZOS)
    img.save(os.path.join(OUTPUT_DIR, "icon128.png"))
    print("icon128.png done (512 -> 128)")


def icon_48():
    """48px: "A文" pair. Rendered at 288px (6x) for extra quality."""
    W = 288
    R = 66   # 11*6
    img = base(W, R)
    draw = ImageDraw.Draw(img)

    # At 288px working size, target text that fills ~60% of icon width
    # "A" at ~132px font, "文" at ~116px font
    fa = ImageFont.truetype(FONT_LATIN, 132, index=LATIN_BOLD)
    fc = ImageFont.truetype(FONT_CJK, 116, index=CJK_BOLD)

    aw, _, _, _ = td(fa, "A")
    cw, _, _, _ = td(fc, "文")

    gap = 8
    total = aw + gap + cw
    sx = (W - total) / 2
    cy = W / 2 + 3

    dc(draw, "A", fa, sx + aw / 2, cy, WHITE)
    dc(draw, "文", fc, sx + aw + gap + cw / 2, cy, WHITE)

    img = img.resize((48, 48), Image.LANCZOS)
    img.save(os.path.join(OUTPUT_DIR, "icon48.png"))
    print("icon48.png done (288 -> 48)")


def icon_16():
    """16px: diagonal A + 文. Rendered at 192px (12x)."""
    W = 192
    R = 60
    img = base(W, R)
    draw = ImageDraw.Draw(img)

    fa = ImageFont.truetype(FONT_LATIN, 96, index=LATIN_BOLD)
    fc = ImageFont.truetype(FONT_CJK, 68, index=CJK_BOLD)

    # A in upper-left quadrant, 文 in lower-right quadrant
    # Offset from center for clear diagonal separation
    dc(draw, "A", fa, W * 0.35, W * 0.38, WHITE)
    dc(draw, "文", fc, W * 0.68, W * 0.65, (255, 255, 255, 240))

    img = img.resize((16, 16), Image.LANCZOS)
    img.save(os.path.join(OUTPUT_DIR, "icon16.png"))
    print("icon16.png done (192 -> 16)")


if __name__ == "__main__":
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    icon_128()
    icon_48()
    icon_16()
    print(f"\nAll icons saved to {OUTPUT_DIR}")
