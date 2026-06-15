# Eau Claire Buddhist Sangha Welcome Flyer

This folder contains the editable source and generated print files for the weekly meeting welcome flyer.

## Files

- `source/flyer-content.json` - editable flyer text used by the PDF/PNG build
- `source/welcome-flyer.html` - browser preview markup matching the flyer copy
- `source/welcome-flyer.css` - browser preview styling for letter-size output
- `assets/logo.png` - copied from the site root `assets/logo.png`
- `assets/mailing-list-qr.svg` - generated QR code for the Google Group mailing list
- `assets/mailing-list-qr.png` - generated QR code used in the PDF/PNG render
- `scripts/render_flyer.py` - renders `source/flyer-content.json` to PDF and PNG
- `dist/eau-claire-buddhist-sangha-welcome-flyer.pdf` - printable PDF
- `dist/eau-claire-buddhist-sangha-welcome-flyer.png` - visual proof image

## Update And Rebuild

Edit `source/flyer-content.json`, then run:

```powershell
.\scripts\build.ps1
```

The QR code points to:

```text
https://groups.google.com/g/eauclairebuddhistsangha
```

If the mailing list URL changes, update `MAILING_LIST_URL` in `scripts/make_qr.py`, then rebuild.

## Source Notes

Meeting timing comes from `site/content/about.md` and `site/content/events/weekly-sit.md`.

Room guidance about cushion locations and joining quietly after meditation has begun came from the flyer request.
