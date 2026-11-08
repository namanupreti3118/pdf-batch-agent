const jobsList = document.getElementById('jobsList');
const fileInput = document.getElementById('pdfUpload');
const submitBtn = document.getElementById('submitBtn');
const combineMode = document.getElementById('combineMode');

function renderJobs(jobs) {
  if (!jobs.length) {
    jobsList.innerHTML = '<div class="job-card">No jobs yet. Select up to 500 PDFs to start a batch.</div>';
    return;
  }
  jobsList.innerHTML = jobs.slice().reverse().map(job => {
    const created = new Date(job.createdAt).toLocaleString();
    const download = job.downloadUrl ? `<a class="link-btn" href="${job.downloadUrl}">Download ZIP</a>` : '';
    return `<article class="job-card">
      <div class="job-header"><strong>${job.id.slice(0, 8)}</strong><span>${job.status}</span></div>
      <div class="job-progress"><div class="job-progress-bar" style="width:${job.progress}%"></div></div>
      <div class="meta"><span>Created: ${created}</span><span>Files: ${job.completedFiles}/${job.totalFiles}</span><span>Failed: ${job.failedFiles}</span></div>
      ${download}
    </article>`;
  }).join('');
}

async function loadJobs() {
  try {
    const response = await fetch('/api/jobs');
    renderJobs(await response.json());
  } catch (error) {
    console.error('Could not load jobs', error);
  }
}

submitBtn.addEventListener('click', async () => {
  const files = Array.from(fileInput.files || []);
  if (!files.length) return alert('Please select at least one PDF.');
  if (files.length > 500) return alert('A batch can contain up to 500 PDFs.');
  if (files.some(file => !file.name.toLowerCase().endsWith('.pdf'))) return alert('Every selected file must be a PDF.');

  const formData = new FormData();
  files.forEach(file => formData.append('pdfs', file));
  formData.append('combine', String(combineMode.checked));
  submitBtn.disabled = true;
  submitBtn.textContent = 'Uploading batch…';
  try {
    const response = await fetch('/api/upload', { method: 'POST', body: formData });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Upload failed.');
    fileInput.value = '';
    await loadJobs();
    alert(`Batch submitted: ${files.length} PDF${files.length === 1 ? '' : 's'}.`);
  } catch (error) {
    alert(error.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Start batch';
  }
});

loadJobs();
setInterval(loadJobs, 2500);
