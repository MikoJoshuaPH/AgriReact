/* Cloud storage management (admin only). */
function formatBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
}

async function loadCloudFiles() {
    const status = document.getElementById('cloud-driver');
    const table = document.getElementById('cloud-files');
    try {
        status.textContent = 'Checking Upstash Blob…';
        const result = await api('/admin/cloud/files');
        const files = result.files || [];
        status.textContent = `Connected: ${result.driver}`;
        const fileRows = files.map((f) => `<tr>
                <td style="font-family: monospace; font-size: 0.8rem;">${escapeHtml(f.path)}</td>
                <td>${formatBytes(f.size)}</td>
                <td>${escapeHtml(f.modified || '—')}</td>
                <td><button class="action-btn" data-cloud-action="open" data-cloud-path="${escapeHtml(f.path)}" data-cloud-bucket="${escapeHtml(f.bucket || 'media')}" data-cloud-url="${escapeHtml(f.url || '')}" style="color: var(--primary);">Open</button>
                    <button class="action-btn btn-delete" data-cloud-action="delete" data-cloud-path="${escapeHtml(f.path)}" data-cloud-bucket="${escapeHtml(f.bucket || 'media')}"><i class="fa-solid fa-trash"></i></button></td>
            </tr>`);
        table.innerHTML = fileRows.join('')
            || '<tr><td colspan="4" style="text-align:center; color: var(--text-muted);">No files yet.</td></tr>';
        return true;
    } catch (error) {
        status.textContent = 'Storage error';
        table.innerHTML = `<tr><td colspan="4" style="text-align:center; color: var(--danger);">${escapeHtml(error.message || 'Could not load cloud files.')}</td></tr>`;
        toast(error.message || 'Could not load cloud files.', 'error');
        return false;
    }
}

async function openCloudFile(url, path, bucket) {
    if (bucket === 'backups') {
        const tab = window.open('about:blank', '_blank');
        if (tab) tab.opener = null;
        try {
            const result = await api(`/admin/cloud/download?path=${encodeURIComponent(path)}`);
            if (tab) tab.location = result.url;
            else window.location.assign(result.url);
        } catch (error) {
            if (tab) tab.close();
            toast(error.message, 'error');
        }
        return;
    }
    if (!url) {
        toast('This file does not have a public URL.', 'error');
        return;
    }
    window.open(url, '_blank', 'noopener');
}

async function uploadCloudFile() {
    const input = document.getElementById('cloud-file');
    const file = input.files[0];
    if (!file) { toast('Choose a file first.', 'error'); return; }
    if (file.size > 8 * 1024 * 1024) { toast('Files must be 8 MB or smaller.', 'error'); return; }
    const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'application/pdf': 'pdf' };
    if (!extensions[file.type]) { toast('Only JPG, PNG, GIF, WEBP and PDF files can be uploaded here.', 'error'); return; }
    try {
        const form = new FormData();
        form.append('file', file);
        const result = await api('/admin/cloud/upload', { method: 'POST', form });
        input.value = '';
        toast(`File uploaded to ${result.driver}.`);
        await loadCloudFiles();
    } catch (error) { toast(error.message, 'error'); }
}

async function deleteCloudFile(path) {
    if (!confirm('Delete this file from cloud storage?')) return;
    try {
        await api(`/admin/cloud/files?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
        toast('File deleted.', 'info');
        await loadCloudFiles();
    } catch (error) { toast(error.message, 'error'); }
}

async function loadBackups() {
    try {
        const data = await api('/admin/backups');
        document.getElementById('cloud-backups').innerHTML = data.data.length
            ? data.data.map((b) => `<tr>
                <td>${escapeHtml(String(b.created_at).replace('T', ' ').slice(0, 16))}</td>
                <td style="font-family: monospace; font-size: 0.8rem;">${b.file_url ? `<a href="${escapeHtml(b.file_url)}" target="_blank" rel="noopener" style="color: var(--primary);">${escapeHtml(b.file_path)}</a>` : b.status === 'completed' ? `<button class="action-btn" data-backup-path="${escapeHtml(b.file_path)}" style="color: var(--primary);">${escapeHtml(b.file_path)}</button>` : escapeHtml(b.file_path)}</td>
                <td>${formatBytes(b.size_bytes)}</td>
                <td>${escapeHtml(b.storage_driver)}</td>
                <td>${b.status === 'completed' ? '<span class="status-pill ok">Completed</span>' : `<span class="status-pill" title="${escapeHtml(b.error_message || '')}" style="background: rgba(239,68,68,0.15); color: var(--danger);">Failed</span>`}</td>
            </tr>`).join('')
            : '<tr><td colspan="5" style="text-align:center; color: var(--text-muted);">No backups yet.</td></tr>';
    } catch (error) { toast(error.message, 'error'); }
}

async function openBackupFile(path) {
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    try {
        const result = await api(`/admin/backups/download?path=${encodeURIComponent(path)}`);
        if (tab) tab.location = result.url;
        else window.location.assign(result.url);
    } catch (error) {
        if (tab) tab.close();
        toast(error.message, 'error');
    }
}

async function createBackupNow() {
    const button = document.getElementById('backup-now');
    button.disabled = true;
    try {
        const data = await api('/admin/backups', { method: 'POST' });
        toast(`Backup created (${formatBytes(data.size)}).`);
        await loadBackups();
    } catch (error) { toast(error.message, 'error'); await loadBackups(); }
    finally { button.disabled = false; }
}

async function initCloudStandalonePage() {
    installModalBehaviour();
    const user = await requireSession(true);
    if (!user) return;
    initShell(user);
    document.getElementById('sidebar-profile-name').textContent = displayName(user);
    document.getElementById('cloud-files').addEventListener('click', (event) => {
        const button = event.target.closest('[data-cloud-action]');
        if (!button) return;
        const path = button.dataset.cloudPath;
        const bucket = button.dataset.cloudBucket || 'media';
        if (button.dataset.cloudAction === 'open') openCloudFile(button.dataset.cloudUrl, path, bucket);
        if (button.dataset.cloudAction === 'delete') deleteCloudFile(path);
    });
    document.getElementById('cloud-backups').addEventListener('click', (event) => {
        const button = event.target.closest('[data-backup-path]');
        if (button) openBackupFile(button.dataset.backupPath);
    });
    await Promise.all([loadCloudFiles(), loadBackups()]);
}
