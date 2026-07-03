/**
 * Generate extension icons using Python/PIL.
 * Creates simple HN (Honoka) monogram icons at 16x16, 48x48, 128x128.
 */
import { execSync } from 'child_process';
import { mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = resolve(__dirname, '..', 'icons');

if (!existsSync(iconsDir)) mkdirSync(iconsDir, { recursive: true });

const pythonScript = `
from PIL import Image, ImageDraw, ImageFont

def create_icon(size, path):
    img = Image.new('RGBA', (size, size), (26, 26, 46, 255))  # #1a1a2e
    draw = ImageDraw.Draw(img)
    
    # Outer ring
    padding = size // 8
    ring_color = (77, 184, 255, 255)  # #4db8ff
    draw.ellipse([padding, padding, size - padding, size - padding], outline=ring_color, width=max(1, size // 16))
    
    # Center dot
    dot_size = max(2, size // 8)
    cx, cy = size // 2, size // 2
    draw.ellipse([cx - dot_size, cy - dot_size, cx + dot_size, cy + dot_size], fill=ring_color)
    
    # Small accent (P in Publish) - a small line at top-right
    accent_pad = size // 4
    draw.line(
        [(size - accent_pad, accent_pad), (size - padding, padding)],
        fill=ring_color, width=max(1, size // 24)
    )
    
    img.save(path, 'PNG')

sizes = [16, 48, 128]
for s in sizes:
    create_icon(s, f'{icons_dir}/icon{s}.png')
    print(f'Generated icon{s}.png ({s}x{s})')
`;

// Replace template variable
const script = pythonScript.replace(/\${icons_dir}/g, iconsDir);
execSync(`python3 -c "${script.replace(/"/g, '\\"')}"`, { stdio: 'inherit' });
