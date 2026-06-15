from pathlib import Path

from PIL import Image, ImageDraw
from reportlab.graphics import renderSVG
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing


MAILING_LIST_URL = "https://groups.google.com/g/eauclairebuddhistsangha"


def main() -> None:
    flyer_root = Path(__file__).resolve().parents[1]
    svg_path = flyer_root / "assets" / "mailing-list-qr.svg"
    png_path = flyer_root / "assets" / "mailing-list-qr.png"
    svg_path.parent.mkdir(parents=True, exist_ok=True)

    qr = QrCodeWidget(MAILING_LIST_URL)
    bounds = qr.getBounds()
    width = bounds[2] - bounds[0]
    height = bounds[3] - bounds[1]
    size = 210
    drawing = Drawing(size, size, transform=[size / width, 0, 0, size / height, 0, 0])
    drawing.add(qr)

    renderSVG.drawToFile(drawing, str(svg_path))

    qr.draw()
    modules = qr.qr.modules
    module_count = qr.qr.getModuleCount()
    quiet_zone = 4
    pixels_per_module = 10
    image_size = (module_count + quiet_zone * 2) * pixels_per_module
    img = Image.new("RGB", (image_size, image_size), "white")
    draw = ImageDraw.Draw(img)

    for row_index, row in enumerate(modules):
        for col_index, is_dark in enumerate(row):
            if is_dark:
                x0 = (col_index + quiet_zone) * pixels_per_module
                y0 = (row_index + quiet_zone) * pixels_per_module
                draw.rectangle(
                    [
                        x0,
                        y0,
                        x0 + pixels_per_module - 1,
                        y0 + pixels_per_module - 1,
                    ],
                    fill="black",
                )

    img.save(png_path)
    print(f"Wrote {svg_path}")
    print(f"Wrote {png_path}")


if __name__ == "__main__":
    main()
