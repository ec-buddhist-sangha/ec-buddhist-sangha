# Eau Claire Buddhist Sangha Dana Donation Flyer

This folder contains the editable source and generated print files for the dana donation flyer.

## Files

- `source/flyer-content.json` - editable flyer text used by the PDF/PNG build
- `source/dana-flyer.html` - browser preview markup matching the flyer copy
- `source/dana-flyer.css` - browser preview styling for letter-size output
- `assets/logo.png` - copied from the site root `assets/logo.png`
- `assets/paypal-dana-qr.svg` - generated QR code for the PayPal dana donation link
- `assets/paypal-dana-qr.png` - generated QR code with the black-and-white Sangha logo embedded
- `scripts/make_qr.py` - regenerates the QR code assets
- `scripts/render_flyer.py` - renders `source/flyer-content.json` to PDF and PNG
- `dist/eau-claire-buddhist-sangha-dana-donation-flyer.pdf` - printable PDF
- `dist/eau-claire-buddhist-sangha-dana-donation-flyer.png` - visual proof image

## Update And Rebuild

Edit `source/flyer-content.json`, then run:

```powershell
.\scripts\build.ps1
```

The donation QR code points to:

```text
https://www.paypal.com/ncp/payment/MKQ3DTAVTUQHW
```

If the donation URL changes, update `DONATION_URL` in `scripts/make_qr.py` and the URL fields in `source/flyer-content.json`, then rebuild.
