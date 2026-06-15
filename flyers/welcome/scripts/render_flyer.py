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
LIGHT = colors.HexColor("#F5F5F0")
PAPER = colors.HexColor("#FAFAF8")
INK = colors.HexColor("#233548")
MUTED = colors.HexColor("#65717E")
LINE = colors.HexColor("#DFD7C6")
WHITE = colors.white

HEX = {
    "navy": "#1B3B5A",
    "gold": "#C59D45",
    "light": "#F5F5F0",
    "paper": "#FAFAF8",
    "ink": "#233548",
    "muted": "#65717E",
    "line": "#DFD7C6",
    "white": "#FFFFFF",
}


def register_fonts() -> dict[str, str]:
    font_dir = Path("C:/Windows/Fonts")
    fonts = {
        "serif": ("FlyerSerif", font_dir / "georgia.ttf", "Times-Roman"),
        "serif_bold": ("FlyerSerifBold", font_dir / "georgiab.ttf", "Times-Bold"),
        "sans": ("FlyerSans", font_dir / "arial.ttf", "Helvetica"),
        "sans_bold": ("FlyerSansBold", font_dir / "arialbd.ttf", "Helvetica-Bold"),
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


def render_pdf(content: dict, root: Path, fonts: dict[str, str]) -> Path:
    dist = root / "dist"
    dist.mkdir(parents=True, exist_ok=True)
    output = dist / "eau-claire-buddhist-sangha-welcome-flyer.pdf"
    logo = root / "assets" / "logo.png"
    qr = root / "assets" / "mailing-list-qr.png"

    c = canvas.Canvas(str(output), pagesize=letter)
    c.setFillColor(PAPER)
    c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    c.setStrokeColor(NAVY)
    c.setLineWidth(2.5)
    c.rect(9, 9, PAGE_W - 18, PAGE_H - 18, stroke=1, fill=0)
    c.setStrokeColor(colors.Color(27 / 255, 59 / 255, 90 / 255, alpha=0.16))
    c.setLineWidth(0.8)
    c.rect(22, 22, PAGE_W - 44, PAGE_H - 44, stroke=1, fill=0)

    # Header
    lockup_logo_size = 88
    lockup_left = 178
    lockup_top = 650
    c.drawImage(ImageReader(str(logo)), lockup_left, lockup_top, width=lockup_logo_size, height=lockup_logo_size, mask="auto")
    c.setFillColor(GOLD)
    c.setFont(fonts["sans_bold"], 16.8)
    c.drawString(lockup_left + lockup_logo_size + 14, lockup_top + 46, "EAU CLAIRE")
    c.drawString(lockup_left + lockup_logo_size + 14, lockup_top + 26, "BUDDHIST SANGHA")
    c.setFillColor(NAVY)
    c.setFont(fonts["serif_bold"], 39)
    c.drawCentredString(PAGE_W / 2, 608, content["headline"])
    draw_pdf_text(c, content["intro"], 64, 578, PAGE_W - 128, fonts["sans"], 11.2, 13, INK, center=True)

    # Primary message band
    c.setFillColor(NAVY)
    c.rect(58, 424, PAGE_W - 116, 110, stroke=0, fill=1)
    c.setStrokeColor(colors.Color(1, 1, 1, alpha=0.28))
    c.setLineWidth(0.8)
    c.line(PAGE_W / 2, 443, PAGE_W / 2, 514)
    c.setFillColor(WHITE)
    left_x = 78
    right_x = PAGE_W / 2 + 20
    col_w = PAGE_W / 2 - 98
    c.setFont(fonts["serif_bold"], 16.2)
    c.drawString(left_x, 505, content["primary_heading"])
    draw_pdf_text(c, content["primary_body"], left_x, 482, col_w, fonts["sans"], 8.9, 10.6, WHITE)
    c.setFont(fonts["serif_bold"], 16.2)
    c.drawString(right_x, 505, content["sangha_heading"])
    draw_pdf_text(c, content["sangha_body"], right_x, 482, col_w, fonts["sans"], 8.9, 10.6, WHITE)

    # Schedule
    c.setFillColor(NAVY)
    c.setFont(fonts["serif_bold"], 18)
    schedule_x = 112
    schedule_w = PAGE_W - 224
    c.drawCentredString(schedule_x + schedule_w / 2, 393, content["schedule_heading"])
    c.setFillColor(MUTED)
    c.setFont(fonts["sans_bold"], 9.5)
    c.drawCentredString(schedule_x + schedule_w / 2, 365, content["location"].upper())

    y = 335
    c.setLineWidth(0.8)
    for item in content["schedule"]:
        c.setStrokeColor(LINE)
        c.line(schedule_x, y + 13, schedule_x + schedule_w, y + 13)
        c.setFillColor(GOLD)
        c.setFont(fonts["sans_bold"], 11.3)
        c.drawString(schedule_x, y, item["time"])
        c.setFillColor(INK)
        c.setFont(fonts["sans"], 11.3)
        c.drawString(schedule_x + 88, y, item["text"])
        y -= 21
    c.setStrokeColor(LINE)
    c.line(schedule_x, y + 13, schedule_x + schedule_w, y + 13)

    # Arrival and setup note
    c.setFillColor(LIGHT)
    lower_x = schedule_x
    lower_w = schedule_w
    c.rect(lower_x, 138, lower_w, 119, stroke=0, fill=1)
    c.setFillColor(GOLD)
    c.rect(lower_x, 138, 6, 119, stroke=0, fill=1)
    c.setFillColor(NAVY)
    c.setFont(fonts["serif_bold"], 15.2)
    c.drawString(lower_x + 22, 231, content["arrival_heading"])
    draw_pdf_text(c, content["arrival_body"], lower_x + 22, 208, lower_w - 44, fonts["sans"], 9.6, 12.0, INK)

    # Two-column footer
    c.setFillColor(WHITE)
    c.setStrokeColor(LINE)
    footer_x = 36
    footer_w = PAGE_W - 72
    footer_y = 37
    footer_h = 90
    footer_mid = footer_x + footer_w / 2
    c.rect(footer_x, footer_y, footer_w, footer_h, stroke=1, fill=1)
    c.setStrokeColor(LINE)
    c.setLineWidth(0.7)
    c.line(footer_mid, footer_y + 14, footer_mid, footer_y + footer_h - 14)

    c.setFillColor(NAVY)
    c.setFont(fonts["serif_bold"], 14.2)
    dana_x = footer_x + 28
    c.drawString(dana_x, footer_y + 60, "Dana")
    draw_pdf_text(c, content["dana_note"], dana_x, footer_y + 42, footer_w / 2 - 52, fonts["sans"], 8.8, 10.6, INK)

    qr_size = 62
    qr_x = footer_x + footer_w - qr_size - 24
    qr_y = footer_y + 14
    c.drawImage(ImageReader(str(qr)), qr_x, qr_y, width=qr_size, height=qr_size, mask="auto")
    c.setFillColor(NAVY)
    c.setFont(fonts["serif_bold"], 13.8)
    qr_text_x = footer_mid + 24
    qr_text_w = qr_x - qr_text_x - 14
    c.drawString(qr_text_x, footer_y + 60, content["qr_heading"])
    draw_pdf_text(c, content["qr_body"], qr_text_x, footer_y + 42, qr_text_w, fonts["sans"], 7.2, 8.6, INK)
    c.setFillColor(MUTED)
    c.setFont(fonts["sans"], 5.8)
    c.drawString(qr_text_x, footer_y + 13, content["qr_url_display"])

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
    output = dist / "eau-claire-buddhist-sangha-welcome-flyer.png"
    img = Image.new("RGB", (int(PAGE_W * SCALE), int(PAGE_H * SCALE)), HEX["paper"])
    draw = ImageDraw.Draw(img)

    serif = pil_font("georgia.ttf", 26, "")
    serif_bold = pil_font("georgiab.ttf", 34, "")
    sans = pil_font("arial.ttf", 23, "")
    sans_small = pil_font("arial.ttf", 19, "")
    sans_bold = pil_font("arialbd.ttf", 24, "")
    sans_bold_small = pil_font("arialbd.ttf", 19, "")
    headline = pil_font("georgiab.ttf", 86, "")

    def p(value):
        return int(round(value * SCALE))

    draw.rectangle([p(9), p(9), p(PAGE_W - 9), p(PAGE_H - 9)], outline=HEX["navy"], width=p(2.5))
    draw.rectangle([p(22), p(22), p(PAGE_W - 22), p(PAGE_H - 22)], outline="#D3CBBE", width=p(1))

    logo = Image.open(root / "assets" / "logo.png").convert("RGBA").resize((p(88), p(88)))
    lockup_left = p(178)
    lockup_top = p(54)
    img.paste(logo, (lockup_left, lockup_top), logo)
    org_font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", p(16.8))
    draw.text((lockup_left + p(102), lockup_top + p(30)), "EAU CLAIRE", font=org_font, fill=HEX["gold"])
    draw.text((lockup_left + p(102), lockup_top + p(51)), "BUDDHIST SANGHA", font=org_font, fill=HEX["gold"])
    title_w = draw.textlength(content["headline"], font=headline)
    draw.text((p(PAGE_W / 2) - title_w / 2, p(145)), content["headline"], font=headline, fill=HEX["navy"])
    draw_pil_text(draw, content["intro"], p(64), p(205), p(PAGE_W - 128), ImageFont.truetype("C:/Windows/Fonts/arial.ttf", p(11.2)), HEX["ink"], p(22), center=True)

    draw.rectangle([p(58), p(258), p(PAGE_W - 58), p(368)], fill=HEX["navy"])
    draw.line([p(PAGE_W / 2), p(277), p(PAGE_W / 2), p(349)], fill="#7890A5", width=p(1))
    primary_font = ImageFont.truetype("C:/Windows/Fonts/georgiab.ttf", p(16.2))
    column_font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", p(8.9))
    left_x = p(78)
    right_x = p(PAGE_W / 2 + 20)
    col_w = p(PAGE_W / 2 - 98)
    draw.text((left_x, p(287)), content["primary_heading"], font=primary_font, fill=HEX["white"])
    draw_pil_text(draw, content["primary_body"], left_x, p(314), col_w, column_font, HEX["white"], p(17))
    draw.text((right_x, p(287)), content["sangha_heading"], font=primary_font, fill=HEX["white"])
    draw_pil_text(draw, content["sangha_body"], right_x, p(314), col_w, column_font, HEX["white"], p(17))

    schedule_x = p(112)
    schedule_w = p(PAGE_W - 224)
    heading_w = draw.textlength(content["schedule_heading"], font=serif_bold)
    location_w = draw.textlength(content["location"].upper(), font=sans_bold_small)
    draw.text((schedule_x + (schedule_w - heading_w) / 2, p(388)), content["schedule_heading"], font=serif_bold, fill=HEX["navy"])
    draw.text((schedule_x + (schedule_w - location_w) / 2, p(421)), content["location"].upper(), font=sans_bold_small, fill=HEX["muted"])
    y = p(446)
    for item in content["schedule"]:
        draw.line([schedule_x, y - p(7), schedule_x + schedule_w, y - p(7)], fill=HEX["line"], width=p(1))
        draw.text((schedule_x, y), item["time"], font=ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", p(11.3)), fill=HEX["gold"])
        draw.text((schedule_x + p(88), y), item["text"], font=ImageFont.truetype("C:/Windows/Fonts/arial.ttf", p(11.3)), fill=HEX["ink"])
        y += p(21)
    draw.line([schedule_x, y - p(7), schedule_x + schedule_w, y - p(7)], fill=HEX["line"], width=p(1))

    lower_x = schedule_x
    lower_w = schedule_w
    draw.rectangle([lower_x, p(535), lower_x + lower_w, p(654)], fill=HEX["light"])
    draw.rectangle([lower_x, p(535), lower_x + p(6), p(654)], fill=HEX["gold"])
    draw.text((lower_x + p(22), p(558)), content["arrival_heading"], font=serif, fill=HEX["navy"])
    draw_pil_text(draw, content["arrival_body"], lower_x + p(22), p(588), lower_w - p(44), ImageFont.truetype("C:/Windows/Fonts/arial.ttf", p(9.6)), HEX["ink"], p(20))

    footer_x = p(36)
    footer_w = p(PAGE_W - 72)
    footer_top = p(665)
    footer_bottom = p(755)
    footer_mid = footer_x + footer_w / 2
    draw.rectangle([footer_x, footer_top, footer_x + footer_w, footer_bottom], fill=HEX["white"], outline=HEX["line"], width=p(1))
    draw.line([footer_mid, footer_top + p(14), footer_mid, footer_bottom - p(14)], fill=HEX["line"], width=p(1))

    dana_x = footer_x + p(28)
    draw.text((dana_x, footer_top + p(21)), "Dana", font=ImageFont.truetype("C:/Windows/Fonts/georgiab.ttf", p(14.2)), fill=HEX["navy"])
    draw_pil_text(draw, content["dana_note"], dana_x, footer_top + p(45), footer_w / 2 - p(52), ImageFont.truetype("C:/Windows/Fonts/arial.ttf", p(8.8)), HEX["ink"], p(16))

    qr_size = p(62)
    qr = Image.open(root / "assets" / "mailing-list-qr.png").convert("RGBA").resize((qr_size, qr_size))
    qr_x = footer_x + footer_w - qr_size - p(24)
    qr_y = footer_top + p(14)
    img.paste(qr, (int(qr_x), qr_y), qr)
    qr_text_x = footer_mid + p(24)
    qr_text_w = qr_x - qr_text_x - p(14)
    draw.text((qr_text_x, footer_top + p(21)), content["qr_heading"], font=ImageFont.truetype("C:/Windows/Fonts/georgiab.ttf", p(13.8)), fill=HEX["navy"])
    draw_pil_text(draw, content["qr_body"], qr_text_x, footer_top + p(45), qr_text_w, ImageFont.truetype("C:/Windows/Fonts/arial.ttf", p(7.2)), HEX["ink"], p(11))
    draw.text((qr_text_x, footer_top + p(76)), content["qr_url_display"], font=ImageFont.truetype("C:/Windows/Fonts/arial.ttf", p(5.8)), fill=HEX["muted"])

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
