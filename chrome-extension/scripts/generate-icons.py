#!/usr/bin/env python3
"""Generate extension icons using PIL."""
import os
from PIL import Image, ImageDraw

ICONS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'icons')
os.makedirs(ICONS_DIR, exist_ok=True)

def create_icon(size, path):
    img = Image.new('RGBA', (size, size), (26, 26, 46, 255))  # #1a1a2e
    draw = ImageDraw.Draw(img)

    padding = max(1, size // 8)
    ring_color = (77, 184, 255, 255)  # #4db8ff
    draw.ellipse(
        [padding, padding, size - padding, size - padding],
        outline=ring_color, width=max(1, size // 16)
    )

    dot_size = max(2, size // 8)
    cx = cy = size // 2
    draw.ellipse(
        [cx - dot_size, cy - dot_size, cx + dot_size, cy + dot_size],
        fill=ring_color
    )

    accent_pad = size // 4
    draw.line(
        [(size - accent_pad, accent_pad), (size - padding, padding)],
        fill=ring_color, width=max(1, size // 24)
    )

    img.save(path, 'PNG')
    print(f'  ✓ Generated {os.path.basename(path)} ({size}x{size})')

if __name__ == '__main__':
    print('Generating extension icons...')
    for s in [16, 48, 128]:
        create_icon(s, os.path.join(ICONS_DIR, f'icon{s}.png'))
    print('Done.')
