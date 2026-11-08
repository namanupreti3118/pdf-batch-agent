const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const { v4: uuidv4 } = require('uuid');
const XLSX = require('xlsx');
const pdfjsLib = require('pdfjs-dist');
const Tesseract = require('tesseract.js');

const app = express();
const PORT = process.env.PORT || 3000;
const uploadDir = path.join(__dirname, 'uploads');
const outputDir = path.join(__dirname, 'exports');
const publicDir = path.join(__dirname, 'public');

const jobs = {};

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`)
});

const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(publicDir));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, name: 'PDF Batch Agent', status: 'running' });
});

app.get('/api/jobs', (req, res) => {
  res.json(Object.values(jobs));
});

app.post('/api/upload', upload.array('pdfs', 1000), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No PDF files uploaded.' });
  }

  const pdfFiles = req.files.filter(file => file.originalname.toLowerCase().endsWith('.pdf'));
  if (pdfFiles.length === 0) {
    return res.status(400).json({ error: 'Only PDF files are allowed.' });
  }

  const jobId = uuidv4();
  const options = {
    mode: req.body.mode || 'excel',
    ocr: req.body.ocr === 'true',
    combine: req.body.combine === 'true'
  };

  jobs[jobId] = {
    id: jobId,
    status: 'queued',
    createdAt: new Date().toISOString(),
    totalFiles: pdfFiles.length,
    completedFiles: 0,
    progress: 0,
    mode: options.mode,
    ocr: options.ocr,
    combine: options.combine,
    zipName: `${jobId}.zip`,
    results: []
  };

  processJob(jobId, pdfFiles, options);

  res.json({ success: true, jobId, message: 'Batch started successfully.' });
});

app.get('/api/job/:jobId', (req, res) => {
  const { jobId } = req.params;
  if (!jobs[jobId]) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(jobs[jobId]);
});

app.get('/api/download/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs[jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const archivePath = path.join(outputDir, job.zipName);
  if (!fs.existsSync(archivePath)) {
    return res.status(404).json({ error: 'Output archive is not ready yet.' });
  }

  res.download(archivePath, job.zipName);
});

app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

async function processJob(jobId, files, options) {
  const job = jobs[jobId];
  if (!job) return;

  job.status = 'processing';
  job.extracted = [];

  const outputFiles = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = path.join(uploadDir, file.filename);
    const originalName = file.originalname.replace(/\.pdf$/i, '');

    try {
      const parsedData = await extractPdfData(filePath, options.ocr);
      const outputName = `${originalName}.xlsx`;
      const outputPath = path.join(outputDir, outputName);

      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(parsedData.rows);
      XLSX.utils.book_append_sheet(workbook, worksheet, 'ExtractedData');
      XLSX.writeFile(workbook, outputPath);

      outputFiles.push({
        originalName,
        outputName,
        rows: parsedData.rows.length,
        pageCount: parsedData.pageCount
      });

      job.completedFiles = i + 1;
      job.progress = Math.round(((i + 1) / files.length) * 100);
      job.results = outputFiles;
      job.status = i === files.length - 1 ? 'finalizing' : 'processing';
    } catch (error) {
      console.error(`Error processing ${file.originalname}`, error);
      job.results.push({
        originalName,
        error: error.message || 'Processing failed.',
        rows: 0,
        pageCount: 0
      });
    }
  }

  if (options.combine) {
    const combinedRows = [];
    for (const item of job.results) {
      if (item.rows > 0) {
        combinedRows.push({
          file: item.originalName,
          rows: item.rows,
          pageCount: item.pageCount,
          status: 'converted'
        });
      }
    }

    const combinedWorkbook = XLSX.utils.book_new();
    const combinedSheet = XLSX.utils.json_to_sheet(combinedRows);
    XLSX.utils.book_append_sheet(combinedWorkbook, combinedSheet, 'Summary');
    XLSX.writeFile(combinedWorkbook, path.join(outputDir, `${jobId}-summary.xlsx`));
  }

  const zipPath = path.join(outputDir, job.zipName);
  await createZipArchive(outputFiles.map(item => path.join(outputDir, item.outputName)), zipPath);

  job.status = 'completed';
  job.progress = 100;
  job.completedFiles = job.totalFiles;
  job.downloadUrl = `/api/download/${jobId}`;
}

async function extractPdfData(pdfPath, useOcr) {
  const pdfBuffer = fs.readFileSync(pdfPath);
  const data = new Uint8Array(pdfBuffer);
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;
  const rows = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map(item => item.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (text) {
      rows.push({
        page: pageNumber,
        text: text
      });
    }
  }

  if (useOcr && rows.length === 0) {
    const { data: ocrData } = await Tesseract.recognize(pdfPath, 'eng');
    const text = (ocrData?.text || '').trim();
    if (text) {
      rows.push({ page: 1, text });
    }
  }

  return {
    pageCount: pdf.numPages,
    rows: rows.length > 0 ? rows : [{ page: 1, text: 'No extractable text found. PDF may be image-based or protected.' }]
  };
}

function createZipArchive(filePaths, zipPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);

    archive.pipe(output);
    filePaths.forEach(filePath => {
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name: path.basename(filePath) });
      }
    });

    archive.finalize();
  });
}

app.listen(PORT, () => {
  console.log(`PDF Batch Agent is running on http://localhost:${PORT}`);
});
