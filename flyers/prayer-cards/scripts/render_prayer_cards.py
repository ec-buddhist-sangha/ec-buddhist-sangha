import json
import shutil
import subprocess
from pathlib import Path

from PIL import Image
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


PAGE_W, PAGE_H = letter
CARD_W = 3.5 * 72
CARD_H = 2.0 * 72
COLUMNS = 2
ROWS = 5
GRID_W = COLUMNS * CARD_W
GRID_H = ROWS * CARD_H
GRID_X = (PAGE_W - GRID_W) / 2
GRID_Y = (PAGE_H - GRID_H) / 2

NAVY = colors.HexColor("#1B3B5A")
GOLD = colors.HexColor("#C59D45")
PAPER = colors.HexColor("#FAFAF8")
INK = colors.HexColor("#233548")
LINE = colors.HexColor("#D8CFBE")
CUT = colors.Color(27 / 255, 59 / 255, 90 / 255, alpha=0.55)
WHITE = colors.white


def register_fonts() -> dict[str, str]:
    font_dir = Path("C:/Windows/Fonts")
    fonts = {
        "serif": ("PrayerCardSerif", font_dir / "georgia.ttf", "Times-Roman"),
        "serif_bold": ("PrayerCardSerifBold", font_dir / "georgiab.ttf", "Times-Bold"),
    }
    resolved = {}
    for key, (name, path, fallback) in fonts.items():
        if path.exists():
            pdfmetrics.registerFont(TTFont(name, str(path)))
            resolved[key] = name
        else:
            resolved[key] = fallback
    return resolved


def wrap_text(text: str, font: str, size: float, width: float) -> list[str]:
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


def fit_prayer(text: str, font: str, max_width: float, max_height: float) -> tuple[float, float, list[str]]:
    for size in [x / 10 for x in range(130, 80, -1)]:
        leading = size * 1.27
        lines = wrap_text(text, font, size, max_width)
        total_height = len(lines) * leading
        if total_height <= max_height:
            return size, leading, lines
    size = 8.0
    return size, size * 1.27, wrap_text(text, font, size, max_width)


def draw_cut_guides(c) -> None:
    c.setStrokeColor(CUT)
    c.setLineWidth(0.45)
    mark = 12

    x_positions = [GRID_X + i * CARD_W for i in range(COLUMNS + 1)]
    y_positions = [GRID_Y + i * CARD_H for i in range(ROWS + 1)]

    for x in x_positions:
        c.line(x, GRID_Y - mark, x, GRID_Y)
        c.line(x, GRID_Y + GRID_H, x, GRID_Y + GRID_H + mark)

    for y in y_positions:
        c.line(GRID_X - mark, y, GRID_X, y)
        c.line(GRID_X + GRID_W, y, GRID_X + GRID_W + mark, y)


def draw_card_border(c, x: float, y: float) -> None:
    c.setStrokeColor(LINE)
    c.setLineWidth(0.35)
    c.rect(x, y, CARD_W, CARD_H, stroke=1, fill=0)


def card_positions():
    for row in range(ROWS):
        for col in range(COLUMNS):
            x = GRID_X + col * CARD_W
            y = GRID_Y + (ROWS - 1 - row) * CARD_H
            yield x, y


def draw_front_page(c, logo_path: Path) -> None:
    c.setFillColor(PAPER)
    c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    logo_reader = ImageReader(str(logo_path))

    for x, y in card_positions():
        draw_card_border(c, x, y)
        logo_w = CARD_W * 0.53
        logo_h = logo_w * 0.82
        logo_x = x + (CARD_W - logo_w) / 2
        logo_y = y + (CARD_H - logo_h) / 2 + 3
        c.drawImage(logo_reader, logo_x, logo_y, width=logo_w, height=logo_h, mask="auto")

    draw_cut_guides(c)


def draw_back_page(c, prayer: str, fonts: dict[str, str]) -> None:
    c.setFillColor(WHITE)
    c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)

    text_margin_x = 17
    text_margin_y = 13
    max_width = CARD_W - text_margin_x * 2
    max_height = CARD_H - text_margin_y * 2
    size, leading, lines = fit_prayer(prayer, fonts["serif"], max_width, max_height)

    for x, y in card_positions():
        draw_card_border(c, x, y)
        c.setFillColor(INK)
        c.setFont(fonts["serif"], size)
        total_height = len(lines) * leading
        start_y = y + (CARD_H + total_height) / 2 - size
        for index, line in enumerate(lines):
            line_w = pdfmetrics.stringWidth(line, fonts["serif"], size)
            line_x = x + (CARD_W - line_w) / 2
            c.drawString(line_x, start_y - index * leading, line)

    draw_cut_guides(c)


def render_pdf(content: dict, root: Path, fonts: dict[str, str]) -> Path:
    dist = root / "dist"
    dist.mkdir(parents=True, exist_ok=True)
    output = dist / "eau-claire-buddhist-sangha-prayer-cards-duplex.pdf"
    logo = root.parents[1] / "assets" / "logo.png"

    c = canvas.Canvas(str(output), pagesize=letter)
    c.setTitle("Eau Claire Buddhist Sangha Prayer Cards")
    c.setAuthor("Eau Claire Buddhist Sangha")

    draw_front_page(c, logo)
    c.showPage()
    draw_back_page(c, content["prayer"], fonts)
    c.save()
    print(f"Wrote {output}")
    return output


def render_png_proofs(pdf_path: Path, root: Path) -> None:
    dist = root / "dist"
    prefix = dist / "eau-claire-buddhist-sangha-prayer-cards-proof"
    bundled_pdftoppm = Path(
        "C:/Users/Ophiuci/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe"
    )
    pdftoppm = str(bundled_pdftoppm if bundled_pdftoppm.exists() else shutil.which("pdftoppm") or "pdftoppm")
    try:
        subprocess.run([pdftoppm, "-png", "-r", "150", str(pdf_path), str(prefix)], check=True)
        print(f"Wrote {prefix}-1.png")
        print(f"Wrote {prefix}-2.png")
    except (FileNotFoundError, subprocess.CalledProcessError) as exc:
        print(f"PNG proof rendering skipped: {exc}")


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    content = json.loads((root / "source" / "prayer-card-content.json").read_text(encoding="utf-8"))
    fonts = register_fonts()
    pdf_path = render_pdf(content, root, fonts)
    render_png_proofs(pdf_path, root)

    for path in sorted((root / "dist").glob("*.png")):
        with Image.open(path) as image:
            print(f"Proof {path.name}: {image.size[0]}x{image.size[1]}")


if __name__ == "__main__":
    main()
