#!/usr/bin/env python3
"""
Generate PNG icons for EasyPrompt from scratch using Pillow.
Output sizes: 16x16 (tray-small), 32x32 (tray), 256x256 (window), 512x512, 1024x1024 (packaging).

Usage:
    python3 scripts/generate-icons.py

Output goes to build/ directory.
"""

import math
import struct
import zlib
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

BUILD = Path(__file__).resolve().parent.parent / "build"
BUILD.mkdir(exist_ok=True)

# ── Colour palette ──────────────────────────────────────────────────────────
BG_START = (79, 70, 229)    # indigo-600
BG_END = (124, 58, 237)     # violet-600
WHITE = (255, 255, 255)
WHITE_95 = (255, 255, 255, 242)
LINE1 = (79, 70, 229, 89)   # indigo ~35%
LINE2 = (124, 58, 237, 64)  # violet ~25%
LINE3 = (99, 102, 241, 77)  # indigo-500 ~30%
SPARKLE = (245, 158, 11)    # amber-500
DOT_COLOR = (251, 191, 36, 153)  # amber-400 ~60%


def gradient_bg(draw, size: int, r: int):
    """Draw a rounded rectangle with a diagonal gradient."""
    # Build gradient pixel by pixel
    img = Image.new("RGBA", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * size - 2)  # diagonal progression
            # Anti-alias the rounded corners
            rr = r
            corner = 1.0
            # top-left
            if x < rr and y < rr:
                dx, dy = rr - x, rr - y
                d = math.sqrt(dx * dx + dy * dy)
                corner = max(0.0, min(1.0, (rr - d) + 0.5))
            # top-right
            elif x >= size - rr and y < rr:
                dx, dy = x - (size - rr - 1), rr - y
                d = math.sqrt(dx * dx + dy * dy)
                corner = max(0.0, min(1.0, (rr - d) + 0.5))
            # bottom-left
            elif x < rr and y >= size - rr:
                dx, dy = rr - x, y - (size - rr - 1)
                d = math.sqrt(dx * dx + dy * dy)
                corner = max(0.0, min(1.0, (rr - d) + 0.5))
            # bottom-right
            elif x >= size - rr and y >= size - rr:
                dx, dy = x - (size - rr - 1), y - (size - rr - 1)
                d = math.sqrt(dx * dx + dy * dy)
                corner = max(0.0, min(1.0, (rr - d) + 0.5))

            alpha = int(255 * corner)
            r_val = int(BG_START[0] + (BG_END[0] - BG_START[0]) * t)
            g_val = int(BG_START[1] + (BG_END[1] - BG_START[1]) * t)
            b_val = int(BG_START[2] + (BG_END[2] - BG_START[2]) * t)
            px[x, y] = (r_val, g_val, b_val, alpha)

    return img


def draw_bubble(draw, size: int, scale: float):
    """Draw the chat bubble + sparkle at the given scale."""
    s = scale  # shorthand

    # Bubble body
    bubble_x = int(120 * s)
    bubble_y = int(140 * s)
    bubble_w = int(500 * s)
    bubble_h = int(360 * s)
    bubble_r = int(72 * s)

    draw.rounded_rectangle(
        [bubble_x, bubble_y, bubble_x + bubble_w, bubble_y + bubble_h],
        radius=bubble_r,
        fill=WHITE_95,
    )

    # Bubble tail
    tail = [
        (int(60 * s) + bubble_x, bubble_y + bubble_h),
        (int(120 * s) + bubble_x, bubble_y + bubble_h),
        (int(60 * s) + bubble_x, bubble_y + bubble_h + int(80 * s)),
    ]
    draw.polygon(tail, fill=WHITE_95)

    # Text lines
    lx = int(56 * s) + bubble_x
    draw.rounded_rectangle(
        [lx, bubble_y + int(72 * s), lx + int(300 * s), bubble_y + int(72 + 44) * s],
        radius=int(22 * s),
        fill=LINE1,
    )
    draw.rounded_rectangle(
        [lx, bubble_y + int(148 * s), lx + int(388 * s), bubble_y + int(148 + 44) * s],
        radius=int(22 * s),
        fill=LINE2,
    )
    draw.rounded_rectangle(
        [lx, bubble_y + int(224 * s), lx + int(260 * s), bubble_y + int(224 + 44) * s],
        radius=int(22 * s),
        fill=LINE3,
    )

    # Sparkle — 4-point star
    sparkle_cx = bubble_x + int(420 * s)
    sparkle_cy = bubble_y + int(272 * s)
    sparkle_r = int(64 * s)
    # Draw as a polygon approximating a 4-point star
    pts = []
    for i in range(8):
        angle = math.pi * i / 4 - math.pi / 2
        r = sparkle_r if i % 2 == 0 else sparkle_r * 0.38
        x = sparkle_cx + math.cos(angle) * r
        y = sparkle_cy + math.sin(angle) * r
        pts.append((x, y))
    draw.polygon(pts, fill=SPARKLE)

    # Decorative dots
    dots = [
        (int(720 * s), int(220 * s), int(18 * s)),
        (int(790 * s), int(160 * s), int(12 * s)),
        (int(740 * s), int(680 * s), int(14 * s)),
        (int(140 * s), int(710 * s), int(16 * s)),
        (int(240 * s), int(750 * s), int(10 * s)),
    ]
    for dx, dy, dr in dots:
        draw.ellipse([dx - dr, dy - dr, dx + dr, dy + dr], fill=DOT_COLOR)


def generate_full_icon(size: int) -> Image.Image:
    """Generate the full icon at the given size."""
    r = int(size * 0.21875)  # 224/1024 proportion

    # Background
    bg = gradient_bg(None, size, r)

    # Draw the content on top
    overlay = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    scale = size / 1024.0
    draw_bubble(draw, size, scale)

    # Composite
    result = Image.alpha_composite(bg, overlay)
    return result


def generate_tray_icon(size: int) -> Image.Image:
    """
    Generate a simplified tray icon — just a sparkle/star on gradient bg
    that reads well at 16-32px. The full chat bubble is too detailed for
    tray sizes, so use a simpler symbol: a sparkle star.
    """
    r = int(size * 0.22)

    # Background
    bg = gradient_bg(None, size, r)

    # Draw a centered sparkle
    overlay = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    cx = size / 2
    cy = size / 2
    sparkle_r = size * 0.32
    inner_r = sparkle_r * 0.35

    pts = []
    for i in range(8):
        angle = math.pi * i / 4 - math.pi / 2
        r_use = sparkle_r if i % 2 == 0 else inner_r
        x = cx + math.cos(angle) * r_use
        y = cy + math.sin(angle) * r_use
        pts.append((x, y))
    draw.polygon(pts, fill=WHITE)

    result = Image.alpha_composite(bg, overlay)
    return result


def png_to_data_uri(png_bytes: bytes) -> str:
    """Encode PNG bytes as a data: URL string for TypeScript embedding."""
    import base64
    b64 = base64.b64encode(png_bytes).decode("ascii")
    return f"data:image/png;base64,{b64}"


def png_to_ts_literal(png_bytes: bytes) -> str:
    """Format PNG bytes as a TypeScript Buffer.from() call with base64."""
    import base64
    b64 = base64.b64encode(png_bytes).decode("ascii")
    # Break into 80-char chunks for readability
    chunks = [b64[i:i+80] for i in range(0, len(b64), 80)]
    lines = [f"  '{chunk}'" for chunk in chunks]
    return "Buffer.from(\n" + " +\n".join(lines) + ",\n  'base64'\n)"


def main():
    print("Generating EasyPrompt icons...\n")

    # Tray icons (simplified sparkle design)
    for tray_size in [16, 32]:
        img = generate_tray_icon(tray_size)
        path = BUILD / f"icon-tray-{tray_size}.png"
        img.save(path, "PNG")
        print(f"  ✓ {path}  ({img.size[0]}x{img.size[1]})")

    # Full app icons
    for app_size in [256, 512, 1024]:
        img = generate_full_icon(app_size)
        path = BUILD / f"icon-{app_size}.png"
        img.save(path, "PNG")
        print(f"  ✓ {path}  ({img.size[0]}x{img.size[1]})")

    # Also save the canonical icon.png (1024x1024) that electron-builder expects
    img_1024 = generate_full_icon(1024)
    canonical = BUILD / "icon.png"
    img_1024.save(canonical, "PNG")
    print(f"  ✓ {canonical}  (1024x1024, canonical for electron-builder)")

    # Generate the TypeScript literal for the tray icon embed
    tray_img = generate_tray_icon(32)
    tray_png = io.BytesIO()
    tray_img.save(tray_png, format="PNG")
    tray_bytes = tray_png.getvalue()

    print(f"\n  Tray icon base64 length: {len(tray_bytes)} bytes")
    print(f"  Tray icon data URI prefix: {png_to_data_uri(tray_bytes)[:60]}...")

    print("\nDone! Icons written to build/")
    print("To use in electron-builder: the icon.png at build/ is auto-detected.")
    print("For macOS .icns and Windows .ico, electron-builder auto-converts from icon.png.")


if __name__ == "__main__":
    import io
    main()
