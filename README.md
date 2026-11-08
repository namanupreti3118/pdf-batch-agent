# PDF Batch Agent

A small web app for submitting a single batch of up to 500 PDFs, extracting selectable text into Excel workbooks, and downloading the results as one ZIP.

## Run locally

Requires Node.js 18 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000.

## Batch behavior

- Select and upload up to 500 PDFs in one batch.
- Files are processed sequentially in the background so the server does not try to parse all PDFs at once.
- Each PDF gets its own workbook; `combined.xlsx` contains extracted text from the batch.
- Failed files are reported in job status; successful results are still available in the ZIP.
- The backend currently limits each individual PDF to 100 MB. Actual throughput depends on file size, PDF complexity, server resources, and whether PDFs contain selectable text.
- Scanned/image-only PDFs need OCR; OCR and structured table recognition are not implemented yet. This initial version extracts PDF text lines and is not guaranteed to preserve table layout.

Jobs are held in memory and uploaded files are stored locally, so this starter is intended for a single server instance rather than production multi-user deployment.
