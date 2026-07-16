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
PAPER = colors.HexColor("#FAFAF8")
INK = colors.HexColor("#233548")
MUTED = colors.HexColor("#65717E")
LINE = colors.HexColor("#DFD7C6")
WHITE = colors.white

HEX = {
    "navy": "#1B3B5A",
    "gold": "#C59D45",
    "brand_gold": "#9B7428",
    "paper": "#FAFAF8",
    "ink": "#233548",
    "muted": "#65717E",
    "line": "#DFD7C6",
    "white": "#FFFFFF",
}


def register_fonts() -> dict[str, str]:
    font_dir = Path("C:/Windows/Fonts")
    fonts = {
        "serif": ("DanaFlyerSerif", font_dir / "georgia.ttf", "Times-Roman"),
        "serif_bold": ("DanaFlyerSerifBold", font_dir / "georgiab.ttf", "Times-Bold"),
        "sans": ("DanaFlyerSans", font_dir / "arial.ttf", "Helvetica"),
        "sans_bold": ("DanaFlyerSansBold", font_dir / "arialbd.ttf", "Helvetica-Bold"),
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


def draw_pdf_page_background(c):
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
    output = dist / "eau-claire-buddhist-sangha-dana-donation-flyer.pdf"
    logo = root / "assets" / "logo.png"
    qr = root / "assets" / "paypal-dana-qr.png"

    c = canvas.Canvas(str(output), pagesize=letter)
    draw_pdf_page_background(c)

    lockup_logo_size = 102
    lockup_left = 46
    lockup_top = 666
    c.drawImage(ImageReader(str(logo)), lockup_left, lockup_top, width=lockup_logo_size, height=lockup_logo_size, mask="auto")
    c.setFillColor(BRAND_GOLD)
    c.setFont(fonts["sans_bold"], 32.0)
    c.drawString(lockup_left + lockup_logo_size + 40, lockup_top + 58, "EAU CLAIRE")
    c.drawString(lockup_left + lockup_logo_size + 40, lockup_top + 22, "BUDDHIST SANGHA")

    c.setFillColor(NAVY)
    c.setFont(fonts["serif_bold"], 39.0)
    c.drawCentredString(PAGE_W / 2, 616, content["headline"])
    draw_pdf_text(c, content["intro"], 46, 582, PAGE_W - 92, fonts["sans"], 17.0, 19.0, INK, center=True)

    qr_size = 350
    qr_x = (PAGE_W - qr_size) / 2
    qr_y = 203
    c.drawImage(ImageReader(str(qr)), qr_x, qr_y, width=qr_size, height=qr_size, mask="auto")

    statement_x = 28
    statement_y = 36
    statement_w = PAGE_W - 56
    statement_h = 122
    c.setFillColor(WHITE)
    c.setStrokeColor(LINE)
    c.setLineWidth(0.8)
    c.rect(statement_x, statement_y, statement_w, statement_h, stroke=1, fill=1)
    c.setFillColor(NAVY)
    c.setFont(fonts["serif_bold"], 24.5)
    c.drawCentredString(PAGE_W / 2, statement_y + 82, content["statement_heading"])
    draw_pdf_text(c, content["statement_body"], statement_x + 44, statement_y + 56, statement_w - 88, fonts["sans"], 13.5, 15.2, INK, center=True)
    c.setFillColor(MUTED)
    c.setFont(fonts["sans"], 9.5)
    c.drawCentredString(PAGE_W / 2, statement_y + 19, content["url_display"])

    c.save()
    print(f"Wrote {output}")
    return output


def pil_font(path_name: str, size: int, fallback: str):
    font_dir = Path("C:/Windows/Fonts")
    path = font_dir / path_name
    if path.exists():
        return ImageFont.truetype(str(path), size)
    return ImageFont.truetype(fallback, size) if Path(fallback).exists() else ImageFont.load_default()


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
    output = dist / "eau-claire-buddhist-sangha-dana-donation-flyer.png"
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

    headline = ImageFont.truetype("C:/Windows/Fonts/georgiab.ttf", p(39.0))
    title_w = draw.textlength(content["headline"], font=headline)
    draw.text((p(PAGE_W / 2) - title_w / 2, p(131)), content["headline"], font=headline, fill=HEX["navy"])
    draw_pil_text(
        draw,
        content["intro"],
        p(46),
        p(187),
        p(PAGE_W - 92),
        ImageFont.truetype("C:/Windows/Fonts/arial.ttf", p(17.0)),
        HEX["ink"],
        p(28),
        center=True,
    )

    qr_size = p(350)
    qr = Image.open(root / "assets" / "paypal-dana-qr.png").convert("RGBA").resize((qr_size, qr_size), Image.Resampling.NEAREST)
    qr_x = p((PAGE_W - 350) / 2)
    qr_y = p(239)
    img.paste(qr, (qr_x, qr_y), qr)

    statement_x = p(28)
    statement_y = p(634)
    statement_w = p(PAGE_W - 56)
    statement_h = p(122)
    draw.rectangle([statement_x, statement_y, statement_x + statement_w, statement_y + statement_h], fill=HEX["white"], outline=HEX["line"], width=p(1))
    heading_font = ImageFont.truetype("C:/Windows/Fonts/georgiab.ttf", p(24.5))
    heading_w = draw.textlength(content["statement_heading"], font=heading_font)
    draw.text((p(PAGE_W / 2) - heading_w / 2, statement_y + p(21)), content["statement_heading"], font=heading_font, fill=HEX["navy"])
    draw_pil_text(
        draw,
        content["statement_body"],
        statement_x + p(44),
        statement_y + p(52),
        statement_w - p(88),
        ImageFont.truetype("C:/Windows/Fonts/arial.ttf", p(13.5)),
        HEX["ink"],
        p(21),
        center=True,
    )
    url_font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", p(9.5))
    url_w = draw.textlength(content["url_display"], font=url_font)
    draw.text((p(PAGE_W / 2) - url_w / 2, statement_y + p(95)), content["url_display"], font=url_font, fill=HEX["muted"])

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
