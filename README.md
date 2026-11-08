const jobsList = document.getElementById('jobsList');
const fileInput = document.getElementById('pdfUpload');
const submitBtn = document.getElementById('submitBtn');
const ocrMode = document.getElementById('ocrMode');
const combineMode = document.getElementById('combineMode');

let poller = null;

function renderJobs(jobs) {
  if (!jobs || jobs.length === 0) {
    jobsList.innerHTML = '<div class="job-card">No jobs yet. Upload PDFs to begin.</div>';
    return;
  }

  jobsList.innerHTML = jobs
    .slice()
    .reverse()
    .map(job => {
      const statusText = job.status || 'queued';
      const progress = job.progress || 0;
      const created = new Date(job.createdAt).toLocaleString();
      const downloadLink = job.downloadUrl
        ? `<a class="link-btn" href="${job.downloadUrl}">Download ZIP</a>`
        : '';

      return `
        <div class="job-card">
          <div class="job-header">
            <strong>${job.id.slice(0, 8)}</strong>
            <span>${statusText}</span>
          </div>
          <div class="job-progress">
            <div class="job-progress-bar" style="width:${progress}%"></div>
          </div>
          <div class="meta">
            <span>Created: ${created}</span>
            <span>Files: ${job.completedFiles || 0}/${job.totalFiles || 0}</span>
            <span>Mode: ${job.mode || 'excel'}</span>
          </div>
          ${downloadLink}
        </div>
      `;
    })
    .join('');
}

async function loadJobs() {
  try {
    const response = await fetch('/api/jobs');
    const jobs = await response.json();
    renderJobs(jobs);
  } catch (error) {
    console.error(error);
  }
}

submitBtn.addEventListener('click', async () => {
  const files = Array.from(fileInput.files || []);
  if (files.length === 0) {
    alert('Please select at least one PDF file.');
    return;
  }

  const formData = new FormData();
  files.forEach(file => formData.append('pdfs', file));
  formData.append('mode', 'excel');
  formData.append('ocr', String(ocrMode.checked));
  formData.append('combine', String(combineMode.checked));

  submitBtn.disabled = true;
  submitBtn.textContent = 'Uploading...';

  try {
    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'Upload failed.');
    }

    loadJobs();
    if (poller) clearInterval(poller);
    poller = setInterval(loadJobs, 2500);
    alert('Batch submitted successfully.');
  } catch (error) {
    alert(error.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Start batch';
  }
});

loadJobs();
setInterval(loadJobs, 2500);
