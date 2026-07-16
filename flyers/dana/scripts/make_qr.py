from pathlib import Path

from PIL import Image, ImageDraw
from reportlab.graphics import renderSVG
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing


DONATION_URL = "https://www.paypal.com/ncp/payment/MKQ3DTAVTUQHW"


def make_logo_overlay(logo_path: Path, target_size: int) -> Image.Image:
    logo = Image.open(logo_path).convert("RGBA")
    bbox = logo.getbbox()
    if bbox:
        logo = logo.crop(bbox)

    logo.thumbnail((target_size, target_size), Image.Resampling.LANCZOS)
    bw_logo = Image.new("RGBA", logo.size, (0, 0, 0, 0))
    bw_logo.putalpha(logo.getchannel("A"))
    return bw_logo


def main() -> None:
    flyer_root = Path(__file__).resolve().parents[1]
    assets_dir = flyer_root / "assets"
    svg_path = assets_dir / "paypal-dana-qr.svg"
    png_path = assets_dir / "paypal-dana-qr.png"
    logo_path = assets_dir / "logo.png"
    assets_dir.mkdir(parents=True, exist_ok=True)

    qr = QrCodeWidget(DONATION_URL, barLevel="H")
    bounds = qr.getBounds()
    width = bounds[2] - bounds[0]
    height = bounds[3] - bounds[1]
    size = 420
    drawing = Drawing(size, size, transform=[size / width, 0, 0, size / height, 0, 0])
    drawing.add(qr)
    renderSVG.drawToFile(drawing, str(svg_path))

    qr.draw()
    modules = qr.qr.modules
    module_count = qr.qr.getModuleCount()
    quiet_zone = 4
    pixels_per_module = 18
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

    backing_size = int(image_size * 0.24)
    backing_x = (image_size - backing_size) // 2
    backing_y = (image_size - backing_size) // 2
    radius = max(8, backing_size // 14)
    draw.rounded_rectangle(
        [backing_x, backing_y, backing_x + backing_size, backing_y + backing_size],
        radius=radius,
        fill="white",
    )

    logo_size = int(backing_size * 0.78)
    logo = make_logo_overlay(logo_path, logo_size)
    logo_x = (image_size - logo.width) // 2
    logo_y = (image_size - logo.height) // 2
    img = img.convert("RGBA")
    img.alpha_composite(logo, (logo_x, logo_y))
    img.convert("RGB").save(png_path)

    print(f"Wrote {svg_path}")
    print(f"Wrote {png_path}")


if __name__ == "__main__":
    main()
