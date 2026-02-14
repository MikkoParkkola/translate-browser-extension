#!/usr/bin/env python3
"""
Generate translation extension icons with speech bubble design.
Left bubble: "A" (source language)
Right bubble: "文" (target language - Chinese character for "text/writing")
"""

from PIL import Image, ImageDraw, ImageFont
import os

def create_gradient_background(size, color1, color2):
    """Create a vertical gradient from color1 to color2."""
    image = Image.new('RGBA', (size, size))
    draw = ImageDraw.Draw(image)

    for y in range(size):
        # Interpolate between the two colors
        ratio = y / size
        r = int(color1[0] * (1 - ratio) + color2[0] * ratio)
        g = int(color1[1] * (1 - ratio) + color2[1] * ratio)
        b = int(color1[2] * (1 - ratio) + color2[2] * ratio)
        draw.line([(0, y), (size, y)], fill=(r, g, b, 255))

    return image

def create_rounded_rectangle_mask(size, corner_radius):
    """Create a rounded rectangle mask."""
    mask = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([(0, 0), (size-1, size-1)], corner_radius, fill=255)
    return mask

def create_speech_bubble(draw, center_x, center_y, radius, fill_color):
    """Draw a rounded speech bubble."""
    # Main circle
    draw.ellipse(
        [center_x - radius, center_y - radius,
         center_x + radius, center_y + radius],
        fill=fill_color
    )

def find_font(font_names, size):
    """Try to find and load a font from a list of possibilities."""
    for font_name in font_names:
        if os.path.exists(font_name):
            try:
                return ImageFont.truetype(font_name, size)
            except:
                continue
    # Fallback to default
    return ImageFont.load_default()

def create_icon(size):
    """Create a translation icon at the specified size."""
    # Colors
    color1 = (79, 70, 229)    # #4F46E5 (indigo)
    color2 = (124, 58, 237)   # #7C3AED (purple)
    white = (255, 255, 255, 255)

    # Create gradient background
    image = create_gradient_background(size, color1, color2)

    # Apply rounded corners
    corner_radius = int(size * 0.15)
    mask = create_rounded_rectangle_mask(size, corner_radius)
    rounded_image = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    rounded_image.paste(image, (0, 0), mask)

    # Draw speech bubbles and text
    draw = ImageDraw.Draw(rounded_image)

    # Calculate bubble sizes based on icon size
    bubble_radius = int(size * 0.22)
    bubble_spacing = int(size * 0.15)

    # Left bubble position
    left_x = int(size * 0.35)
    bubble_y = int(size * 0.5)

    # Right bubble position
    right_x = int(size * 0.65)

    # Draw speech bubbles with semi-transparency
    bubble_color = (255, 255, 255, 200)

    # Left bubble
    create_speech_bubble(draw, left_x, bubble_y, bubble_radius, bubble_color)

    # Right bubble (slightly overlapping)
    create_speech_bubble(draw, right_x, bubble_y, bubble_radius, bubble_color)

    # Add text
    # Font sizes scale with icon size
    text_size = max(int(size * 0.35), 12)

    # Find fonts
    latin_fonts = [
        '/System/Library/Fonts/SFCompact.ttf',
        '/System/Library/Fonts/Helvetica.ttc',
        '/Library/Fonts/Arial.ttf',
    ]

    cjk_fonts = [
        '/System/Library/Fonts/PingFang.ttc',
        '/System/Library/Fonts/Hiragino Sans GB.ttc',
        '/Library/Fonts/Arial Unicode.ttf',
    ]

    latin_font = find_font(latin_fonts, text_size)
    cjk_font = find_font(cjk_fonts, text_size)

    # Draw "A" in left bubble
    text = "A"
    bbox = draw.textbbox((0, 0), text, font=latin_font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    text_x = left_x - text_width // 2
    text_y = bubble_y - text_height // 2 - int(size * 0.02)
    draw.text((text_x, text_y), text, fill=color1, font=latin_font)

    # Draw "文" in right bubble
    text = "文"
    bbox = draw.textbbox((0, 0), text, font=cjk_font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    text_x = right_x - text_width // 2
    text_y = bubble_y - text_height // 2 - int(size * 0.02)
    draw.text((text_x, text_y), text, fill=color2, font=cjk_font)

    return rounded_image

def main():
    """Generate all icon sizes."""
    output_dir = '/tmp/translate-browser-extension/src/assets/icons'
    os.makedirs(output_dir, exist_ok=True)

    sizes = {
        'icon128.png': 128,
        'icon48.png': 48,
        'icon16.png': 16,
    }

    for filename, size in sizes.items():
        print(f"Generating {filename} ({size}x{size})...")
        icon = create_icon(size)
        output_path = os.path.join(output_dir, filename)
        icon.save(output_path, 'PNG')
        print(f"  Saved to {output_path}")

    print("\nAll icons generated successfully!")

if __name__ == '__main__':
    main()
