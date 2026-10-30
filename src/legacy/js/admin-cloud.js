/* Cloud storage management (admin only). */
function formatBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
}

function formatStorageDate(value) {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp > 0
        ? new Date(timestamp * 1000).toLocaleString()
        : '—';
}

async function loadCloudFiles() {
    const status = document.getElementById('cloud-driver');
    const table = document.getElementById('cloud-files');
    try {
        status.textContent = 'Checking Puter…';
        const client = await window.getPuterClient();
        if (!client || !client.auth.isSignedIn()) {
            status.textContent = 'Not connected';
            table.innerHTML = '<tr><td colspan="4" style="text-align:center; color: var(--text-muted);">Connect your Puter account to view its files.</td></tr>';
            return false;
        }

        const user = await client.auth.getUser();
        const { files, errors } = await listPuterFiles('.');
        status.textContent = `Connected: ${user.username || 'Puter'}`;
        const fileRows = files.map((f) => `<tr>
                <td style="font-family: monospace; font-size: 0.8rem;">${escapeHtml(f.path)}</td>
                <td>${formatBytes(f.size)}</td>
                <td>${escapeHtml(formatStorageDate(f.modified))}</td>
                <td><button class="action-btn" data-cloud-action="open" data-cloud-path="${escapeHtml(f.path)}" style="color: var(--primary);">Open</button>
                    <button class="action-btn btn-delete" data-cloud-action="delete" data-cloud-path="${escapeHtml(f.path)}"><i class="fa-solid fa-trash"></i></button></td>
            </tr>`);
        const errorRows = errors.map((item) => `<tr>
                <td colspan="4" style="color: var(--danger);">Could not list ${escapeHtml(item.path)}: ${escapeHtml(item.message)}</td>
            </tr>`);
        table.innerHTML = [...fileRows, ...errorRows].join('')
            || '<tr><td colspan="4" style="text-align:center; color: var(--text-muted);">No files yet.</td></tr>';
        return true;
    } catch (error) {
        status.textContent = 'Puter error';
        table.innerHTML = `<tr><td colspan="4" style="text-align:center; color: var(--danger);">${escapeHtml(error.message || 'Could not load Puter files.')}</td></tr>`;
        toast(error.message || 'Could not load Puter files.', 'error');
        return false;
    }
}

async function listPuterFiles(directory) {
    const client = await requirePuterSignIn();
    let entries;
    const errors = [];
    try {
        entries = await client.fs.readdir(directory);
    } catch (error) {
        if (directory === '/') throw error;
        errors.push({
            path: directory,
            message: error && error.message ? error.message : String(error)
        });
        return { files: [], errors };
    }

    const files = [];
    for (const entry of entries) {
        if (entry.is_dir || entry.isDir) {
            const nested = await listPuterFiles(entry.path);
            files.push(...nested.files);
            errors.push(...nested.errors);
        } else {
            files.push({
                path: entry.path,
                size: entry.size,
                modified: entry.modified
            });
        }
    }
    return { files, errors };
}

async function openPuterFile(path) {
    try {
        const client = await requirePuterSignIn();
        const url = await client.fs.getReadURL(path);
        window.open(url, '_blank', 'noopener');
    } catch (error) { toast(error.message, 'error'); }
}

async function connectPuter() {
    try {
        const client = await window.getPuterClient();
        await client.auth.signIn({ request_auth: true });
        if (!client.auth.isSignedIn()) throw new Error('Puter sign-in did not complete.');
        if (await loadCloudFiles()) toast('Puter account connected.');
    } catch (error) { toast(error.message, 'error'); }
}

async function uploadCloudFile() {
    const input = document.getElementById('cloud-file');
    const file = input.files[0];
    if (!file) { toast('Choose a file first.', 'error'); return; }
    if (file.size > 8 * 1024 * 1024) { toast('Files must be 8 MB or smaller.', 'error'); return; }
    const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'application/pdf': 'pdf' };
    if (!extensions[file.type]) { toast('Only JPG, PNG, GIF, WEBP and PDF files can be uploaded here.', 'error'); return; }
    try {
        const client = await requirePuterSignIn();
        const path = `admin/${new Date().toISOString().slice(0, 10).replace(/-/g, '')}/${crypto.randomUUID()}.${extensions[file.type]}`;
        await client.fs.write(path, file, { overwrite: false, createMissingParents: true });
        input.value = '';
        toast('File uploaded.');
        await loadCloudFiles();
    } catch (error) { toast(error.message, 'error'); }
}

async function deleteCloudFile(path) {
    if (!confirm('Delete this file from cloud storage?')) return;
    try {
        const client = await requirePuterSignIn();
        await client.fs.delete(path);
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
                <td style="font-family: monospace; font-size: 0.8rem;">${b.file_url ? `<a href="${escapeHtml(b.file_url)}" target="_blank" rel="noopener" style="color: var(--primary);">${escapeHtml(b.file_path)}</a>` : escapeHtml(b.file_path)}</td>
                <td>${formatBytes(b.size_bytes)}</td>
                <td>${escapeHtml(b.storage_driver)}</td>
                <td>${b.status === 'completed' ? '<span class="status-pill ok">Completed</span>' : `<span class="status-pill" title="${escapeHtml(b.error_message || '')}" style="background: rgba(239,68,68,0.15); color: var(--danger);">Failed</span>`}</td>
            </tr>`).join('')
            : '<tr><td colspan="5" style="text-align:center; color: var(--text-muted);">No backups yet.</td></tr>';
    } catch (error) { toast(error.message, 'error'); }
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
        if (button.dataset.cloudAction === 'open') openPuterFile(path);
        if (button.dataset.cloudAction === 'delete') deleteCloudFile(path);
    });
    await Promise.all([loadCloudFiles(), loadBackups()]);
}
