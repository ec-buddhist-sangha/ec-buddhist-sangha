import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


PAGE_W, PAGE_H = letter
SCALE = 2

NAVY = colors.HexColor("#1B3B5A")
GOLD = colors.HexColor("#C59D45")
BRAND_GOLD = colors.HexColor("#9B7428")
LIGHT = colors.HexColor("#F5F5F0")
PAPER = colors.HexColor("#FAFAF8")
INK = colors.HexColor("#233548")
LINE = colors.HexColor("#DFD7C6")
WHITE = colors.white

HEX = {
    "navy": "#1B3B5A",
    "gold": "#C59D45",
    "brand_gold": "#9B7428",
    "light": "#F5F5F0",
    "paper": "#FAFAF8",
    "ink": "#233548",
    "line": "#DFD7C6",
    "white": "#FFFFFF",
}


def register_fonts() -> dict[str, str]:
    font_dir = Path("C:/Windows/Fonts")
    fonts = {
        "serif_bold": ("StreamlinedFlyerSerifBold", font_dir / "georgiab.ttf", "Times-Bold"),
        "sans": ("StreamlinedFlyerSans", font_dir / "arial.ttf", "Helvetica"),
        "sans_bold": ("StreamlinedFlyerSansBold", font_dir / "arialbd.ttf", "Helvetica-Bold"),
    }
    resolved = {}
    for key, (name, path, fallback) in fonts.items():
        if path.exists():
            pdfmetrics.registerFont(TTFont(name, str(path)))
            resolved[key] = name
        else:
            resolved[key] = fallback
    return resolved


def pdf_wrap(text: str, font: str, size: float, width: float) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if pdfmetrics.stringWidth(candidate, font, size) <= width or not current:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def draw_pdf_text(c, text, x, y, width, font, size, leading, color=INK, center=False):
    c.setFillColor(color)
    c.setFont(font, size)
    for paragraph_index, paragraph in enumerate(str(text).splitlines()):
        if paragraph_index > 0:
            y -= leading * 0.12
        for line in pdf_wrap(paragraph, font, size, width):
            draw_x = x
            if center:
                draw_x = x + (width - pdfmetrics.stringWidth(line, font, size)) / 2
            c.drawString(draw_x, y, line)
            y -= leading
    return y


def draw_page_background(c):
    c.setFillColor(PAPER)
    c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    c.setStrokeColor(NAVY)
    c.setLineWidth(2.2)
    c.rect(7, 7, PAGE_W - 14, PAGE_H - 14, stroke=1, fill=0)
    c.setStrokeColor(colors.Color(27 / 255, 59 / 255, 90 / 255, alpha=0.16))
    c.setLineWidth(0.8)
    c.rect(16, 16, PAGE_W - 32, PAGE_H - 32, stroke=1, fill=0)


def render_pdf(content: dict, root: Path, fonts: dict[str, str]) -> Path:
    dist = root / "dist"
    dist.mkdir(parents=True, exist_ok=True)
    output = dist / "eau-claire-buddhist-sangha-welcome-flyer-streamlined.pdf"
    logo = root / "assets" / "logo.png"
    qr = root / "assets" / "website-qr.png"

    c = canvas.Canvas(str(output), pagesize=letter)
    draw_page_background(c)

    lockup_logo_size = 102
    lockup_left = 46
    lockup_top = 666
    c.drawImage(ImageReader(str(logo)), lockup_left, lockup_top, width=lockup_logo_size, height=lockup_logo_size, mask="auto")
    c.setFillColor(BRAND_GOLD)
    c.setFont(fonts["sans_bold"], 32.0)
    c.drawString(lockup_left + lockup_logo_size + 40, lockup_top + 58, "EAU CLAIRE")
    c.drawString(lockup_left + lockup_logo_size + 40, lockup_top + 22, "BUDDHIST SANGHA")

    c.setFillColor(NAVY)
    c.setFont(fonts["serif_bold"], 40.8)
    c.drawCentredString(PAGE_W / 2, 616, content["headline"])
    draw_pdf_text(c, content["intro"], 46, 587, PAGE_W - 92, fonts["sans"], 16.0, 17.2, INK, center=True)

    content_x = 71
    content_w = PAGE_W - 142

    c.setFillColor(LIGHT)
    c.rect(content_x, 392, content_w, 144, stroke=0, fill=1)
    c.setFillColor(GOLD)
    c.rect(content_x, 392, 7, 144, stroke=0, fill=1)
    c.setFillColor(NAVY)
    c.setFont(fonts["serif_bold"], 23.5)
    c.drawString(content_x + 27, 505, content["arrival_heading"])
    draw_pdf_text(c, content["arrival_body"], content_x + 27, 473, content_w - 54, fonts["sans"], 15.0, 17.0, INK)

    y = 343
    c.setLineWidth(0.8)
    for item in content["schedule"]:
        c.setStrokeColor(LINE)
        c.line(content_x, y + 18, content_x + content_w, y + 18)
        c.setFillColor(GOLD)
        c.setFont(fonts["sans_bold"], 17.4)
        c.drawString(content_x, y, item["time"])
        c.setFillColor(INK)
        c.setFont(fonts["sans"], 17.0)
        c.drawString(content_x + 108, y, item["text"])
        y -= 36
    c.setStrokeColor(LINE)
    c.line(content_x, y + 18, content_x + content_w, y + 18)

    card_x = 46
    card_y = 42
    card_w = PAGE_W - 92
    card_h = 160
    c.setFillColor(WHITE)
    c.setStrokeColor(LINE)
    c.rect(card_x, card_y, card_w, card_h, stroke=1, fill=1)

    qr_size = 104
    qr_x = card_x + card_w - qr_size - 28
    qr_y = card_y + 28
    c.drawImage(ImageReader(str(qr)), qr_x, qr_y, width=qr_size, height=qr_size, mask="auto")

    text_x = card_x + 28
    text_w = qr_x - text_x - 30
    c.setFillColor(NAVY)
    c.setFont(fonts["serif_bold"], 28.5)
    c.drawString(text_x, card_y + 116, content["website_heading"])
    draw_pdf_text(c, content["website_body"], text_x, card_y + 82, text_w, fonts["sans"], 15.0, 17.2, INK)
    c.setFillColor(BRAND_GOLD)
    c.setFont(fonts["sans_bold"], 28.5)
    c.drawString(text_x, card_y + 27, content["website_url_display"])

    c.save()
    print(f"Wrote {output}")
    return output


def pil_wrap(draw: ImageDraw.ImageDraw, text: str, font, width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if draw.textlength(candidate, font=font) <= width or not current:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def draw_pil_text(draw, text, x, y, width, font, fill, leading, center=False):
    for paragraph_index, paragraph in enumerate(str(text).splitlines()):
        if paragraph_index > 0:
            y += int(leading * 0.12)
        for line in pil_wrap(draw, paragraph, font, width):
            draw_x = x
            if center:
                draw_x = x + (width - draw.textlength(line, font=font)) / 2
            draw.text((draw_x, y), line, font=font, fill=fill)
            y += leading
    return y


def render_png(content: dict, root: Path) -> Path:
    dist = root / "dist"
    output = dist / "eau-claire-buddhist-sangha-welcome-flyer-streamlined.png"
    img = Image.new("RGB", (int(PAGE_W * SCALE), int(PAGE_H * SCALE)), HEX["paper"])
    draw = ImageDraw.Draw(img)

    def p(value):
        return int(round(value * SCALE))

    draw.rectangle([p(7), p(7), p(PAGE_W - 7), p(PAGE_H - 7)], outline=HEX["navy"], width=p(2.2))
    draw.rectangle([p(16), p(16), p(PAGE_W - 16), p(PAGE_H - 16)], outline="#D3CBBE", width=p(1))

    logo = Image.open(root / "assets" / "logo.png").convert("RGBA").resize((p(102), p(102)))
    lockup_left = p(46)
    lockup_top = p(30)
    img.paste(logo, (lockup_left, lockup_top), logo)
    org_font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", p(32.0))
    draw.text((lockup_left + p(142), lockup_top + p(17)), "EAU CLAIRE", font=org_font, fill=HEX["brand_gold"])
    draw.text((lockup_left + p(142), lockup_top + p(55)), "BUDDHIST SANGHA", font=org_font, fill=HEX["brand_gold"])

    headline = ImageFont.truetype("C:/Windows/Fonts/georgiab.ttf", p(40.8))
    title_w = draw.textlength(content["headline"], font=headline)
    draw.text((p(PAGE_W / 2) - title_w / 2, p(128)), content["headline"], font=headline, fill=HEX["navy"])
    draw_pil_text(
        draw,
        content["intro"],
        p(46),
        p(188),
        p(PAGE_W - 92),
        ImageFont.truetype("C:/Windows/Fonts/arial.ttf", p(16.0)),
        HEX["ink"],
        p(25),
        center=True,
    )

    content_x = p(71)
    content_w = p(PAGE_W - 142)
    draw.rectangle([content_x, p(256), content_x + content_w, p(400)], fill=HEX["light"])
    draw.rectangle([content_x, p(256), content_x + p(7), p(400)], fill=HEX["gold"])
    draw.text((content_x + p(27), p(274)), content["arrival_heading"], font=ImageFont.truetype("C:/Windows/Fonts/georgiab.ttf", p(23.5)), fill=HEX["navy"])
    draw_pil_text(
        draw,
        content["arrival_body"],
        content_x + p(27),
        p(307),
        content_w - p(54),
        ImageFont.truetype("C:/Windows/Fonts/arial.ttf", p(15.0)),
        HEX["ink"],
        p(20),
    )

    y = p(431)
    for item in content["schedule"]:
        draw.line([content_x, y - p(10), content_x + content_w, y - p(10)], fill=HEX["line"], width=p(1))
        draw.text((content_x, y), item["time"], font=ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", p(17.4)), fill=HEX["gold"])
        draw.text((content_x + p(108), y), item["text"], font=ImageFont.truetype("C:/Windows/Fonts/arial.ttf", p(17.0)), fill=HEX["ink"])
        y += p(36)
    draw.line([content_x, y - p(10), content_x + content_w, y - p(10)], fill=HEX["line"], width=p(1))

    card_x = p(46)
    card_y = p(590)
    card_w = p(PAGE_W - 92)
    card_h = p(160)
    draw.rectangle([card_x, card_y, card_x + card_w, card_y + card_h], fill=HEX["white"], outline=HEX["line"], width=p(1))

    qr_size = p(104)
    qr = Image.open(root / "assets" / "website-qr.png").convert("RGBA").resize((qr_size, qr_size), Image.Resampling.NEAREST)
    qr_x = card_x + card_w - qr_size - p(28)
    qr_y = card_y + p(28)
    img.paste(qr, (qr_x, qr_y), qr)

    text_x = card_x + p(28)
    text_w = qr_x - text_x - p(30)
    draw.text((text_x, card_y + p(20)), content["website_heading"], font=ImageFont.truetype("C:/Windows/Fonts/georgiab.ttf", p(28.5)), fill=HEX["navy"])
    draw_pil_text(
        draw,
        content["website_body"],
        text_x,
        card_y + p(60),
        text_w,
        ImageFont.truetype("C:/Windows/Fonts/arial.ttf", p(15.0)),
        HEX["ink"],
        p(20),
    )
    draw.text((text_x, card_y + p(116)), content["website_url_display"], font=ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", p(28.5)), fill=HEX["brand_gold"])

    img.save(output)
    print(f"Wrote {output}")
    return output


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    content = json.loads((root / "source" / "flyer-content.json").read_text(encoding="utf-8"))
    fonts = register_fonts()
    render_pdf(content, root, fonts)
    render_png(content, root)


if __name__ == "__main__":
    main()
