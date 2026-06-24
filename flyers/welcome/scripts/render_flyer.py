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
MUTED = colors.HexColor("#65717E")
LINE = colors.HexColor("#DFD7C6")
WHITE = colors.white

HEX = {
    "navy": "#1B3B5A",
    "gold": "#C59D45",
    "brand_gold": "#9B7428",
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
    c.setLineWidth(2.2)
    c.rect(7, 7, PAGE_W - 14, PAGE_H - 14, stroke=1, fill=0)
    c.setStrokeColor(colors.Color(27 / 255, 59 / 255, 90 / 255, alpha=0.16))
    c.setLineWidth(0.8)
    c.rect(16, 16, PAGE_W - 32, PAGE_H - 32, stroke=1, fill=0)

    # Header
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
    draw_pdf_text(c, content["intro"], 46, 587, PAGE_W - 92, fonts["sans"], 14.6, 15.3, INK, center=True)

    # Primary message band
    c.setFillColor(NAVY)
    c.rect(42, 409, PAGE_W - 84, 126, stroke=0, fill=1)
    c.setStrokeColor(colors.Color(1, 1, 1, alpha=0.28))
    c.setLineWidth(0.8)
    c.line(PAGE_W / 2, 425, PAGE_W / 2, 516)
    c.setFillColor(WHITE)
    left_x = 56
    right_x = PAGE_W / 2 + 18
    left_col_w = PAGE_W / 2 - 72
    right_col_w = PAGE_W - 54 - right_x
    c.setFont(fonts["serif_bold"], 21.0)
    c.drawString(left_x, 509, content["primary_heading"])
    draw_pdf_text(c, content["primary_body"], left_x, 481, left_col_w, fonts["sans"], 12.2, 12.4, WHITE)
    c.setFont(fonts["serif_bold"], 21.0)
    c.drawString(right_x, 509, content["sangha_heading"])
    draw_pdf_text(c, content["sangha_body"], right_x, 481, right_col_w, fonts["sans"], 12.2, 12.4, WHITE)

    # Schedule
    c.setFillColor(NAVY)
    c.setFont(fonts["serif_bold"], 22.6)
    schedule_x = 86
    schedule_w = PAGE_W - 172
    c.drawCentredString(schedule_x + schedule_w / 2, 372, content["schedule_heading"])
    c.setFillColor(MUTED)
    c.setFont(fonts["sans_bold"], 10.7)
    c.drawCentredString(schedule_x + schedule_w / 2, 344, content["location"])

    y = 309
    c.setLineWidth(0.8)
    for item in content["schedule"]:
        c.setStrokeColor(LINE)
        c.line(schedule_x, y + 15, schedule_x + schedule_w, y + 15)
        c.setFillColor(GOLD)
        c.setFont(fonts["sans_bold"], 15.2)
        c.drawString(schedule_x, y, item["time"])
        c.setFillColor(INK)
        c.setFont(fonts["sans"], 15.0)
        c.drawString(schedule_x + 102, y, item["text"])
        y -= 24
    c.setStrokeColor(LINE)
    c.line(schedule_x, y + 15, schedule_x + schedule_w, y + 15)

    # Arrival and setup note
    c.setFillColor(LIGHT)
    lower_x = schedule_x
    lower_w = schedule_w
    c.rect(lower_x, 129, lower_w, 87, stroke=0, fill=1)
    c.setFillColor(GOLD)
    c.rect(lower_x, 129, 7, 87, stroke=0, fill=1)
    c.setFillColor(NAVY)
    c.setFont(fonts["serif_bold"], 18.5)
    c.drawString(lower_x + 25, 196, content["arrival_heading"])
    draw_pdf_text(c, content["arrival_body"], lower_x + 25, 172, lower_w - 50, fonts["sans"], 12.6, 13.1, INK)

    # Two-column footer
    c.setFillColor(WHITE)
    c.setStrokeColor(LINE)
    footer_x = 28
    footer_w = PAGE_W - 56
    footer_y = 18
    footer_h = 106
    footer_mid = footer_x + footer_w / 2
    c.rect(footer_x, footer_y, footer_w, footer_h, stroke=1, fill=1)
    c.setStrokeColor(LINE)
    c.setLineWidth(0.7)
    c.line(footer_mid, footer_y + 9, footer_mid, footer_y + footer_h - 9)

    c.setFillColor(NAVY)
    c.setFont(fonts["serif_bold"], 19.0)
    dana_x = footer_x + 20
    c.drawString(dana_x, footer_y + 76, "Dana")
    draw_pdf_text(c, content["dana_note"], dana_x, footer_y + 53, footer_w / 2 - 40, fonts["sans"], 11.7, 12.4, INK)

    qr_size = 60
    qr_x = footer_x + footer_w - qr_size - 18
    qr_y = footer_y + 27
    c.drawImage(ImageReader(str(qr)), qr_x, qr_y, width=qr_size, height=qr_size, mask="auto")
    c.setFillColor(NAVY)
    c.setFont(fonts["serif_bold"], 17.4)
    qr_text_x = footer_mid + 18
    qr_text_w = qr_x - qr_text_x - 10
    heading_bottom = draw_pdf_text(c, content["qr_heading"], qr_text_x, footer_y + 80, qr_text_w, fonts["serif_bold"], 17.4, 17.0, NAVY)
    body_y = min(footer_y + 47, heading_bottom - 2)
    draw_pdf_text(c, content["qr_body"], qr_text_x, body_y, qr_text_w, fonts["sans"], 9.7, 10.0, INK)
    c.setFillColor(MUTED)
    c.setFont(fonts["sans"], 7.5)
    c.drawString(qr_text_x, footer_y + 18, content["qr_url_display"])

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
    headline = pil_font("georgiab.ttf", 88, "")

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
    title_w = draw.textlength(content["headline"], font=headline)
    draw.text((p(PAGE_W / 2) - title_w / 2, p(128)), content["headline"], font=headline, fill=HEX["navy"])
    draw_pil_text(draw, content["intro"], p(46), p(188), p(PAGE_W - 92), ImageFont.truetype("C:/Windows/Fonts/arial.ttf", p(14.6)), HEX["ink"], p(24), center=True)

    draw.rectangle([p(42), p(241), p(PAGE_W - 42), p(367)], fill=HEX["navy"])
    draw.line([p(PAGE_W / 2), p(259), p(PAGE_W / 2), p(351)], fill="#7890A5", width=p(1))
    primary_font = ImageFont.truetype("C:/Windows/Fonts/georgiab.ttf", p(21.0))
    column_font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", p(12.0))
    left_x = p(56)
    right_x = p(PAGE_W / 2 + 18)
    left_col_w = p(PAGE_W / 2 - 72)
    right_col_w = p(PAGE_W - 54) - right_x
    draw.text((left_x, p(265)), content["primary_heading"], font=primary_font, fill=HEX["white"])
    draw_pil_text(draw, content["primary_body"], left_x, p(298), left_col_w, column_font, HEX["white"], p(17))
    draw.text((right_x, p(265)), content["sangha_heading"], font=primary_font, fill=HEX["white"])
    draw_pil_text(draw, content["sangha_body"], right_x, p(298), right_col_w, column_font, HEX["white"], p(17))

    schedule_x = p(86)
    schedule_w = p(PAGE_W - 172)
    schedule_heading_font = ImageFont.truetype("C:/Windows/Fonts/georgiab.ttf", p(22.6))
    schedule_location_font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", p(10.7))
    heading_w = draw.textlength(content["schedule_heading"], font=schedule_heading_font)
    location_w = draw.textlength(content["location"], font=schedule_location_font)
    draw.text((schedule_x + (schedule_w - heading_w) / 2, p(393)), content["schedule_heading"], font=schedule_heading_font, fill=HEX["navy"])
    draw.text((schedule_x + (schedule_w - location_w) / 2, p(425)), content["location"], font=schedule_location_font, fill=HEX["muted"])
    y = p(455)
    for item in content["schedule"]:
        draw.line([schedule_x, y - p(8), schedule_x + schedule_w, y - p(8)], fill=HEX["line"], width=p(1))
        draw.text((schedule_x, y), item["time"], font=ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", p(15.2)), fill=HEX["gold"])
        draw.text((schedule_x + p(102), y), item["text"], font=ImageFont.truetype("C:/Windows/Fonts/arial.ttf", p(15.0)), fill=HEX["ink"])
        y += p(24)
    draw.line([schedule_x, y - p(8), schedule_x + schedule_w, y - p(8)], fill=HEX["line"], width=p(1))

    lower_x = schedule_x
    lower_w = schedule_w
    draw.rectangle([lower_x, p(560), lower_x + lower_w, p(647)], fill=HEX["light"])
    draw.rectangle([lower_x, p(560), lower_x + p(7), p(647)], fill=HEX["gold"])
    arrival_heading_font = ImageFont.truetype("C:/Windows/Fonts/georgiab.ttf", p(19.0))
    draw.text((lower_x + p(25), p(575)), content["arrival_heading"], font=arrival_heading_font, fill=HEX["navy"])
    draw_pil_text(draw, content["arrival_body"], lower_x + p(25), p(601), lower_w - p(50), ImageFont.truetype("C:/Windows/Fonts/arial.ttf", p(12.6)), HEX["ink"], p(16))

    footer_x = p(28)
    footer_w = p(PAGE_W - 56)
    footer_top = p(655)
    footer_bottom = p(762)
    footer_mid = footer_x + footer_w / 2
    draw.rectangle([footer_x, footer_top, footer_x + footer_w, footer_bottom], fill=HEX["white"], outline=HEX["line"], width=p(1))
    draw.line([footer_mid, footer_top + p(9), footer_mid, footer_bottom - p(9)], fill=HEX["line"], width=p(1))

    dana_x = footer_x + p(20)
    draw.text((dana_x, footer_top + p(24)), "Dana", font=ImageFont.truetype("C:/Windows/Fonts/georgiab.ttf", p(18.5)), fill=HEX["navy"])
    draw_pil_text(draw, content["dana_note"], dana_x, footer_top + p(50), footer_w / 2 - p(40), ImageFont.truetype("C:/Windows/Fonts/arial.ttf", p(11.7)), HEX["ink"], p(16))

    qr_size = p(60)
    qr = Image.open(root / "assets" / "mailing-list-qr.png").convert("RGBA").resize((qr_size, qr_size))
    qr_x = footer_x + footer_w - qr_size - p(18)
    qr_y = footer_top + p(27)
    img.paste(qr, (int(qr_x), qr_y), qr)
    qr_text_x = footer_mid + p(18)
    qr_text_w = qr_x - qr_text_x - p(10)
    heading_end = draw_pil_text(
        draw,
        content["qr_heading"],
        qr_text_x,
        footer_top + p(18),
        qr_text_w,
        ImageFont.truetype("C:/Windows/Fonts/georgiab.ttf", p(17.4)),
        HEX["navy"],
        p(17),
    )
    body_start = max(footer_top + p(50), heading_end + p(2))
    draw_pil_text(draw, content["qr_body"], qr_text_x, body_start, qr_text_w, ImageFont.truetype("C:/Windows/Fonts/arial.ttf", p(9.7)), HEX["ink"], p(13))
    draw.text((qr_text_x, footer_top + p(93)), content["qr_url_display"], font=ImageFont.truetype("C:/Windows/Fonts/arial.ttf", p(7.5)), fill=HEX["muted"])

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
