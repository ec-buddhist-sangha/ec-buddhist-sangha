# Eau Claire Buddhist Sangha Streamlined Welcome Flyer

This folder contains a separate streamlined version of the weekly meeting welcome flyer. The original version remains in `flyers/welcome/`.

## Layout

The streamlined version includes:

- Sangha logo and welcome introduction
- Arrival and seating guidance
- Weekly schedule times without a meeting title or address
- Full-width website callout and QR code

It intentionally omits the two-column welcome explanation and Dana section from the original flyer.

## Files

- `source/flyer-content.json` - editable flyer text used by the PDF/PNG build
- `source/welcome-flyer.html` - browser preview markup
- `source/welcome-flyer.css` - browser preview styling for Letter-size output
- `assets/logo.png` - copied from the current welcome flyer
- `assets/website-qr.svg` - generated QR code for the Sangha website
- `assets/website-qr.png` - generated QR code used in the PDF/PNG render
- `scripts/make_qr.py` - regenerates the website QR code
- `scripts/render_flyer.py` - renders the editable content to PDF and PNG
- `dist/eau-claire-buddhist-sangha-welcome-flyer-streamlined.pdf` - printable PDF
- `dist/eau-claire-buddhist-sangha-welcome-flyer-streamlined.png` - visual proof image

## Update And Rebuild

Edit `source/flyer-content.json`, then run:

```powershell
.\scripts\build.ps1
```

The QR code points to:

```text
https://eauclairesangha.org/
```
