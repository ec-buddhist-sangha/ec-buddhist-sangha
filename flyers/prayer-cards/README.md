# Eau Claire Buddhist Sangha Prayer Cards

This folder contains the editable source and generated print files for business-card-sized metta prayer cards.

## Files

- `source/prayer-card-content.json` - editable prayer text
- `scripts/render_prayer_cards.py` - renders a duplex US letter PDF and PNG proofs
- `scripts/build.ps1` - convenience build script
- `dist/eau-claire-buddhist-sangha-prayer-cards-duplex.pdf` - two-page duplex print sheet
- `dist/eau-claire-buddhist-sangha-prayer-cards-proof-1.png` - front-side proof
- `dist/eau-claire-buddhist-sangha-prayer-cards-proof-2.png` - back-side proof

## Print Notes

The sheet is US letter size, 8.5 x 11 inches, with ten 3.5 x 2 inch cards per side.
Print double sided at 100% scale. The front side contains the logo and the back side contains the prayer.

## Update And Rebuild

Edit `source/prayer-card-content.json`, then run:

```powershell
.\scripts\build.ps1
```
