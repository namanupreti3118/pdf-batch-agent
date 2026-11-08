const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const { v4: uuidv4 } = require('uuid');
const XLSX = require('xlsx');
const pdfParse = require('pdf-parse');

const app = express();
const PORT = process.env.PORT || 3000;
const uploadDir = path.join(__dirname, 'uploads');
const outputDir = path.join(__dirname, 'exports');
const publicDir = path.join(__dirname, 'public');
const jobs = new Map();

for (const dir of [uploadDir, outputDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, _file, cb) => cb(null, `${uuidv4()}.pdf`)
});
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024, files: 500 }
});

app.use(express.static(publicDir));
app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'PDF Batch Agent' }));
app.get('/api/jobs', (_req, res) => res.json([...jobs.values()]));

app.post('/api/upload', upload.array('pdfs', 500), (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Select at least one PDF.' });
  if (files.some(file => path.extname(file.originalname).toLowerCase() !== '.pdf')) {
    files.forEach(file => fs.rm(file.path, { force: true }, () => {}));
    return res.status(400).json({ error: 'Every file in the batch must be a PDF.' });
  }

  const id = uuidv4();
  const job = {
    id,
    status: 'queued',
    createdAt: new Date().toISOString(),
    totalFiles: files.length,
    completedFiles: 0,
    failedFiles: 0,
    progress: 0,
    results: [],
    downloadUrl: null
  };
  jobs.set(id, job);
  res.status(202).json({ success: true, jobId: id, message: 'Batch queued.' });
  processJob(job, files).catch(error => {
    console.error(`Job ${id} failed`, error);
    job.status = 'failed';
    job.error = 'The batch could not be completed. Please retry.';
  });
});

app.get('/api/job/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  res.json(job);
});

app.get('/api/download/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  if (job.status !== 'completed') return res.status(409).json({ error: 'The batch is not ready yet.' });
  res.download(path.join(outputDir, `${job.id}.zip`), `${job.id}-results.zip`);
});

app.get('*', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

async function processJob(job, files) {
  job.status = 'processing';
  const jobDir = path.join(outputDir, job.id);
  fs.mkdirSync(jobDir, { recursive: true });
  const rowsForCombinedWorkbook = [];
  const generatedFiles = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const displayName = path.basename(file.originalname, path.extname(file.originalname));
    try {
      const parsed = await pdfParse(fs.readFileSync(file.path));
      const text = (parsed.text || '').trim();
      const rows = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const records = (rows.length ? rows : ['No selectable text found; this PDF may be scanned or image-only.'])
        .map((line, lineIndex) => ({ source_file: file.originalname, row: lineIndex + 1, text: line }));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(records), 'Extracted text');
      const outputName = `${String(index + 1).padStart(3, '0')}-${safeName(displayName)}.xlsx`;
      const outputPath = path.join(jobDir, outputName);
      XLSX.writeFile(workbook, outputPath);
      generatedFiles.push({ outputPath, outputName });
      rowsForCombinedWorkbook.push(...records);
      job.results.push({ file: file.originalname, status: 'completed', rows: records.length, pages: parsed.numpages });
    } catch (error) {
      job.failedFiles += 1;
      job.results.push({ file: file.originalname, status: 'failed', error: error.message || 'PDF could not be read.' });
    } finally {
      fs.rm(file.path, { force: true }, () => {});
      job.completedFiles += 1;
      job.progress = Math.round((job.completedFiles / job.totalFiles) * 100);
    }
  }

  if (rowsForCombinedWorkbook.length) {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rowsForCombinedWorkbook), 'All extracted text');
    const combinedPath = path.join(jobDir, 'combined.xlsx');
    XLSX.writeFile(workbook, combinedPath);
    generatedFiles.push({ outputPath: combinedPath, outputName: 'combined.xlsx' });
  }

  await createZip(generatedFiles, path.join(outputDir, `${job.id}.zip`));
  job.status = job.failedFiles === job.totalFiles ? 'failed' : 'completed';
  job.downloadUrl = job.status === 'completed' ? `/api/download/${job.id}` : null;
}

function safeName(value) {
  return value.replace(/[^a-z0-9._-]+/gi, '_').replace(/^\.+/, '').slice(0, 100) || 'document';
}

function createZip(files, zipPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    output.once('close', resolve);
    output.once('error', reject);
    archive.once('error', reject);
    archive.pipe(output);
    for (const file of files) archive.file(file.outputPath, { name: file.outputName });
    archive.finalize().catch(reject);
  });
}

app.listen(PORT, () => console.log(`PDF Batch Agent listening on port ${PORT}`));
