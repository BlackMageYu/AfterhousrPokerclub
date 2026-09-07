from __future__ import annotations

from pathlib import Path
import random

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "素材" / "图片" / "扑克牌"
QA_PREVIEW = ROOT / "qa" / "poker-contact-sheet.png"

CANVAS_W, CANVAS_H = 600, 840
CARD_BOX = (48, 72, 552, 762)
CARD_COLOR = (249, 249, 247, 255)
RED = (218, 54, 51, 255)
BLACK = (31, 34, 42, 255)
RANK_FONT = Path("C:/Windows/Fonts/seguibl.ttf")

SUITS = (
    ("草花", "club", BLACK),
    ("方片", "diamond", RED),
    ("红桃", "heart", RED),
    ("黑桃", "spade", BLACK),
)
RANKS = ("A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K")


def background() -> Image.Image:
    """Match the reference's deep-blue, lightly textured studio backdrop."""
    base_color = (27, 102, 164)
    image = Image.new("RGB", (CANVAS_W, CANVAS_H), base_color)
    draw = ImageDraw.Draw(image)
    randomizer = random.Random(32026)

    # Fine vertical fabric-like texture, kept intentionally restrained.
    for x in range(0, CANVAS_W, 4):
        shift = randomizer.choice((-3, -2, -1, 0, 0, 1, 2, 3))
        color = tuple(max(0, min(255, channel + shift)) for channel in base_color)
        draw.line((x, 0, x, CANVAS_H), fill=color, width=1)
    for _ in range(36):
        x = randomizer.randrange(CANVAS_W)
        width = randomizer.choice((1, 1, 2, 3))
        shift = randomizer.choice((-7, -6, -5, 4, 5))
        color = tuple(max(0, min(255, channel + shift)) for channel in base_color)
        draw.rectangle((x, 0, x + width, CANVAS_H), fill=color)

    return image.convert("RGBA")


def draw_suit(
    draw: ImageDraw.ImageDraw,
    suit: str,
    center: tuple[float, float],
    scale: float,
    color: tuple[int, int, int, int],
) -> None:
    """Draw a filled, soft-edged card suit with geometry consistent across all ranks."""
    x, y = center

    if suit == "heart":
        lobe = 0.28 * scale
        draw.ellipse((x - 0.52 * scale, y - 0.47 * scale, x - 0.52 * scale + 2 * lobe, y - 0.47 * scale + 2 * lobe), fill=color)
        draw.ellipse((x - 0.04 * scale, y - 0.47 * scale, x - 0.04 * scale + 2 * lobe, y - 0.47 * scale + 2 * lobe), fill=color)
        draw.polygon(((x - 0.50 * scale, y - 0.14 * scale), (x + 0.50 * scale, y - 0.14 * scale), (x, y + 0.62 * scale)), fill=color)
    elif suit == "diamond":
        draw.polygon(((x, y - 0.64 * scale), (x + 0.39 * scale, y), (x, y + 0.64 * scale), (x - 0.39 * scale, y)), fill=color)
    elif suit == "spade":
        lobe = 0.28 * scale
        draw.ellipse((x - 0.52 * scale, y - 0.08 * scale, x - 0.52 * scale + 2 * lobe, y - 0.08 * scale + 2 * lobe), fill=color)
        draw.ellipse((x - 0.04 * scale, y - 0.08 * scale, x - 0.04 * scale + 2 * lobe, y - 0.08 * scale + 2 * lobe), fill=color)
        draw.polygon(((x - 0.50 * scale, y + 0.20 * scale), (x + 0.50 * scale, y + 0.20 * scale), (x, y - 0.64 * scale)), fill=color)
        draw.polygon(((x - 0.20 * scale, y + 0.50 * scale), (x + 0.20 * scale, y + 0.50 * scale), (x, y + 0.08 * scale)), fill=color)
    elif suit == "club":
        radius = 0.28 * scale
        for cx, cy in ((x, y - 0.27 * scale), (x - 0.27 * scale, y + 0.15 * scale), (x + 0.27 * scale, y + 0.15 * scale)):
            draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=color)
        draw.polygon(((x - 0.20 * scale, y + 0.53 * scale), (x + 0.20 * scale, y + 0.53 * scale), (x, y + 0.10 * scale)), fill=color)
    else:
        raise ValueError(f"Unsupported suit: {suit}")


def draw_card(suit_name: str, suit: str, rank: str, color: tuple[int, int, int, int], backdrop: Image.Image) -> Image.Image:
    image = backdrop.copy()

    # Keep the low, diffuse shadow and narrow cool-gray outline seen around each card.
    shadow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle((54, 82, 558, 775), radius=47, fill=(0, 31, 74, 120))
    image.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(13)))

    draw = ImageDraw.Draw(image, "RGBA")
    draw.rounded_rectangle(CARD_BOX, radius=46, fill=CARD_COLOR, outline=(212, 218, 222, 255), width=3)

    # Very light card-stock grain prevents a sterile, flat fill while preserving clarity.
    grain = Image.effect_noise((CARD_BOX[2] - CARD_BOX[0], CARD_BOX[3] - CARD_BOX[1]), 4).convert("L")
    grain = grain.point(lambda value: 255 if value > 129 else 0)
    grain_layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    grain_tint = Image.new("RGBA", grain.size, (115, 128, 143, 8))
    grain_layer.alpha_composite(grain_tint, (CARD_BOX[0], CARD_BOX[1]), (0, 0, grain.size[0], grain.size[1]))
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(CARD_BOX, radius=46, fill=255)
    grain_layer.putalpha(ImageChops.multiply(grain_layer.getchannel("A"), mask))
    image.alpha_composite(grain_layer)

    draw = ImageDraw.Draw(image, "RGBA")
    font = ImageFont.truetype(str(RANK_FONT), 130)
    draw.text((116, 88), rank, font=font, fill=color, anchor="lt", stroke_width=0)
    draw_suit(draw, suit, (166, 378), 96, color)
    draw_suit(draw, suit, (300, 570), 210, color)
    return image.convert("RGB")


def build_contact_sheet(cards: list[tuple[str, Image.Image]]) -> None:
    thumb_size = (150, 210)
    sheet = Image.new("RGB", (thumb_size[0] * 13, thumb_size[1] * 4), (19, 51, 81))
    for index, (_, card) in enumerate(cards):
        suit_index = index // len(RANKS)
        rank_index = index % len(RANKS)
        thumbnail = card.resize(thumb_size, Image.Resampling.LANCZOS)
        sheet.paste(thumbnail, (rank_index * thumb_size[0], suit_index * thumb_size[1]))
    QA_PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(QA_PREVIEW, optimize=True)


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    backdrop = background()
    cards: list[tuple[str, Image.Image]] = []

    for suit_name, suit, color in SUITS:
        for rank in RANKS:
            card = draw_card(suit_name, suit, rank, color, backdrop)
            filename = f"{suit_name}_{rank}.png"
            card.save(OUTPUT / filename, optimize=True)
            cards.append((filename, card))

    build_contact_sheet(cards)
    print(f"Generated {len(cards)} cards in {OUTPUT}")
    print(f"QA contact sheet: {QA_PREVIEW}")


if __name__ == "__main__":
    main()
