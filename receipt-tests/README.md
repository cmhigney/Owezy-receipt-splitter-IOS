Receipt Harness

1. Put receipt files in `receipt-tests/receipts/` (jpg, jpeg, png, webp, heic, heif, pdf).
2. Run:

```powershell
npm run test-receipts -- --email "your@email.com" --password "your-password"
```

By default the harness now refuses production-like URLs (`*.a.run.app`, `*.run.app`, `*.cloudfunctions.net`) to avoid accidental OCR/API spend. Use a local/emulator backend when possible.

Optional:

```powershell
npm run test-receipts -- --manifest "receipt-tests/manifest.json" --fail-on-mismatch
```

To benchmark a local Apple-Vision-heavy backend against a known-good cloud OCR run, pass a baseline report:

```powershell
npm run test-receipts -- `
  --base-url "http://127.0.0.1:8788" `
  --manifest "receipt-tests/manifest.all-unique.json" `
  --baseline-report "receipt-tests/reports/all-batches-unique-prod-v2.json" `
  --fail-on-mismatch
```

Recommended workflow for Apple Vision tuning:

1. Run the backend locally with `OWEZY_OCR_ROUTING_MODE=vision_only`.
2. Use `receipt-tests/reports/all-batches-unique-prod-v2.json` as the baseline from the stronger cloud OCR path.
3. Fix parser mismatches until the Vision-only run matches the baseline across the receipt corpus.

If you have raw Apple Vision text captures, you can benchmark the Apple Vision text path directly instead of backend image OCR:

```powershell
npm run test-receipts -- `
  --base-url "http://127.0.0.1:8788" `
  --manifest "receipt-tests/manifest.all-unique.json" `
  --text-dir "receipt-tests/apple-vision-text" `
  --baseline-report "receipt-tests/reports/all-batches-unique-prod-v2.json" `
  --fail-on-mismatch
```

`--text-dir` expects one `.txt` file per receipt image, using the same base filename, for example:

- `receipt-tests/receipts/01_blank_tip_line.png`
- `receipt-tests/apple-vision-text/01_blank_tip_line.txt`

If you intentionally want to test production, explicitly opt in:

```powershell
npm run test-receipts -- --email "your@email.com" --password "your-password" --allow-production
```

The harness also includes a per-run dedupe cache for identical files, so repeated cases do not re-call OCR by default. Disable it with:

```powershell
npm run test-receipts -- --disable-dedupe-cache
```

The report is written to:

- `receipt-tests/reports/receipt-report-<timestamp>.json` (default), or
- your custom `--out` path.

Use `receipt-tests/manifest.example.json` as a template for expectation checks.
