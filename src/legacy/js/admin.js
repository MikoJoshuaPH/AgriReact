/* =====================================================================
   Admin Database (admin-dashboard.html): live stats and tables from
   GET /api/admin/database and GET /api/admin/queues, plus account,
   approval, moderation and report actions. Administrators only.
   ===================================================================== */

let adminUser = null;
let snapshot = null;
let queues = { pendingUsers: [], pendingPosts: [], reports: [], complaints: [] };

function fmtDate(value) {
    if (!value) return '—';
    return new Date(String(value).replace(' ', 'T')).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}
function compactMoney(n) {
    return Number(n) >= 1000 ? '₱' + (Number(n) / 1000).toFixed(1) + 'k' : money(n);
}
function cellValue(column, value) {
    if (value === null || value === undefined || value === '') return '—';
    if (column === 'is_active') return Number(value) === 1 ? badge('Active', 'var(--primary)', 'rgba(16,185,129,0.2)') : badge('Pending', 'var(--warning)', 'rgba(245,158,11,0.2)');
    if (column === 'role') return badge(roleLabel(value), 'white', value === 'admin' ? 'var(--danger)' : 'var(--primary)');
    if (column === 'available' || column === 'is_available') return Number(value) === 1 ? 'Yes' : 'No';
    if (column === 'is_verified') return Number(value) === 1 ? badge('Verified', 'var(--primary)', 'rgba(16,185,129,0.2)') : 'Not verified';
    if (/_at$|date$|time$|recorded_at$|dispatch_time$|delivery_time$/.test(column)) return fmtDate(value);
    if (column === 'password') return '••••••••';
    return escapeHtml(value);
}
function badge(text, color, background) {
    return `<span class="badge" style="background: ${background}; color: ${color};">${escapeHtml(text)}</span>`;
}

/**
 * Rebuilds a sample table from a list of columns and rows.
 * actions(row) returns the HTML for an extra "Actions" column.
 */
function renderTable(tabId, columns, rows, actions) {
    const table = document.querySelector(`#table-${tabId} table`);
    if (!table) return;
    const head = columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('') + (actions ? '<th>Actions</th>' : '');
    const body = rows.length
        ? rows.map((row) => `<tr>${columns.map((c) => `<td>${cellValue(c.field, row[c.field])}</td>`).join('')}${actions ? `<td>${actions(row)}</td>` : ''}</tr>`).join('')
        : `<tr><td colspan="${columns.length + (actions ? 1 : 0)}" style="text-align:center; color: var(--text-muted);">No records.</td></tr>`;
    table.innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;
}
function columnsFrom(table) {
    return table ? table.columns : [];
}
function rowsFrom(table) {
    return table ? table.rows : [];
}

/* ---------- statistics ---------- */
function renderStats() {
    const s = snapshot.stats;
    document.getElementById('stat-total-users').innerText = s.activeAccounts;
    document.getElementById('stat-pending-users').innerText = s.pendingAccounts;
    document.getElementById('stat-pending-posts').innerText = queues.pendingPosts.length;
    document.getElementById('stat-reports').innerText = queues.reports.length;
    document.getElementById('stat-products').innerText = s.listings;
    document.getElementById('stat-orders').innerText = s.orders;
    document.getElementById('stat-revenue').innerText = compactMoney(s.revenue);
}

/* ---------- tables ---------- */
function renderAll() {
    const t = snapshot.tables;
    renderStats();

    renderTable('accounts', columnsFrom(t.users), rowsFrom(t.users), (u) => `
        ${u.role === 'farmer' ? `<button class="action-btn ${Number(u.is_verified) === 1 ? 'btn-approve' : 'btn-edit'}" data-act="verify-user" data-id="${escapeHtml(u.id)}" data-verified="${Number(u.is_verified) === 1 ? 'false' : 'true'}"><i class="fa-solid fa-circle-check"></i> ${Number(u.is_verified) === 1 ? 'Unverify' : 'Verify'}</button>` : ''}
        <button class="action-btn btn-edit" data-act="edit" data-id="${escapeHtml(u.id)}"><i class="fa-solid fa-pen"></i></button>
        <button class="action-btn btn-delete" data-act="delete" data-id="${escapeHtml(u.id)}"><i class="fa-solid fa-trash"></i></button>`);

    renderTable('pending-accounts', [
        { field: 'id', label: 'ID' }, { field: 'first_name', label: 'First Name' }, { field: 'last_name', label: 'Last Name' },
        { field: 'email', label: 'Email' }, { field: 'role', label: 'Role' }, { field: 'is_verified', label: 'Verified' }, { field: 'contact_number', label: 'Contact' }
    ], queues.pendingUsers, (u) => `
        <button class="action-btn btn-approve" data-act="approve-acc" data-id="${escapeHtml(u.id)}"><i class="fa-solid fa-check"></i> Approve</button>
        ${u.role === 'farmer' ? `<button class="action-btn ${Number(u.is_verified) === 1 ? 'btn-approve' : 'btn-edit'}" data-act="verify-user" data-id="${escapeHtml(u.id)}" data-verified="${Number(u.is_verified) === 1 ? 'false' : 'true'}"><i class="fa-solid fa-circle-check"></i> ${Number(u.is_verified) === 1 ? 'Unverify' : 'Verify'}</button>` : ''}
        <button class="action-btn btn-reject" data-act="reject-acc" data-id="${escapeHtml(u.id)}"><i class="fa-solid fa-xmark"></i> Reject</button>`);

    renderTable('pending-posts', [
        { field: 'post_id', label: 'Post ID' }, { field: 'author', label: 'Author' },
        { field: 'preview', label: 'Content Preview' }, { field: 'post_type', label: 'Type' }
    ], queues.pendingPosts.map((p) => ({
        ...p,
        preview: p.post_type === 'product' ? `${p.product_name} (${p.category}, ${money(p.price)})` : p.content
    })), (p) => `
        <button class="action-btn btn-approve" data-act="approve-post" data-id="${escapeHtml(p.post_id)}"><i class="fa-solid fa-check"></i> Approve</button>
        <button class="action-btn btn-reject" data-act="reject-post" data-id="${escapeHtml(p.post_id)}"><i class="fa-solid fa-trash"></i> Delete</button>`);

    renderTable('reports', [
        { field: 'report_id', label: 'Report ID' }, { field: 'reported_user', label: 'Reported User' },
        { field: 'reason', label: 'Reason' }, { field: 'reported_by', label: 'Reported By' }
    ], queues.reports, (r) => `
        <button class="action-btn btn-approve" data-act="resolve" data-id="${escapeHtml(r.report_id)}"><i class="fa-solid fa-check"></i> Resolve</button>`);

    renderTable('complaints', [
        { field: 'complaint_id', label: 'Complaint ID' }, { field: 'reporter_name', label: 'Name' },
        { field: 'reporter_email', label: 'Email' }, { field: 'message', label: 'Complaint' },
        { field: 'created_at', label: 'Submitted' }
    ], queues.complaints, (complaint) => `
        <button class="action-btn btn-approve" data-act="resolve-complaint" data-id="${escapeHtml(complaint.complaint_id)}"><i class="fa-solid fa-check"></i> Resolve</button>`);

    renderTable('products', columnsFrom(t.listings), rowsFrom(t.listings));
    renderTable('farms', columnsFrom(t.farms), rowsFrom(t.farms));
    renderTable('batches', columnsFrom(t.batches), rowsFrom(t.batches));
    renderTable('harvests', columnsFrom(t.harvests), rowsFrom(t.harvests));
    renderTable('qrcodes', columnsFrom(t.qrcodes), rowsFrom(t.qrcodes));
    renderTable('traceability', columnsFrom(t.traceability), rowsFrom(t.traceability));
    renderTable('shipments', columnsFrom(t.shipments), rowsFrom(t.shipments));
    renderTable('markets', columnsFrom(t.markets), rowsFrom(t.markets));
    renderTable('notifications', columnsFrom(t.notifications), rowsFrom(t.notifications));
    renderTable('weather', columnsFrom(t.weather), rowsFrom(t.weather));
    renderTable('logs', columnsFrom(t.logs), rowsFrom(t.logs));
}

async function loadAll() {
    try {
        const [db, q] = await Promise.all([api('/admin/database'), api('/admin/queues')]);
        snapshot = db;
        queues = q;
        renderAll();
    } catch (error) {
        toast(error.message, 'error');
    }
}

/* ---------- account actions ---------- */
async function approveAccount(id) {
    try {
        await api(`/admin/users/${id}/approve`, { method: 'PUT' });
        toast('Account approved.');
        await loadAll();
    } catch (error) { toast(error.message, 'error'); }
}
async function setFarmerVerification(id, verified) {
    try {
        const result = await api(`/admin/users/${encodeURIComponent(id)}/verify`, {
            method: 'PUT',
            body: { verified }
        });
        toast(result.message);
        await loadAll();
    } catch (error) { toast(error.message, 'error'); }
}
async function rejectAccount(id) {
    if (!confirm('Reject and delete this account?')) return;
    try {
        await api(`/delete/${id}`, { method: 'DELETE' });
        toast('Account rejected and removed.', 'info');
        await loadAll();
    } catch (error) { toast(error.message, 'error'); }
}
async function deleteAccount(id) {
    if (!confirm('Delete this account? This cannot be undone.')) return;
    try {
        await api(`/delete/${id}`, { method: 'DELETE' });
        toast('Account deleted.', 'info');
        await loadAll();
    } catch (error) { toast(error.message, 'error'); }
}
function resetCrudForm() {
    document.getElementById('crud-form').reset();
    document.getElementById('edit-id').value = '';
    document.getElementById('crud-role').value = 'farmer';
}
function openAddAccount() {
    resetCrudForm();
    document.getElementById('crud-title').innerText = 'Add New Account';
    document.getElementById('crud-pass').required = true;
    document.getElementById('crud-pass').placeholder = 'At least 8 characters';
    openModal('crud-modal');
}
function editAccount(id) {
    const user = rowsFrom(snapshot.tables.users).find((u) => String(u.id) === String(id));
    if (!user) return;
    document.getElementById('crud-title').innerText = 'Edit Account';
    document.getElementById('edit-id').value = user.id;
    document.getElementById('crud-fname').value = user.first_name || '';
    document.getElementById('crud-mname').value = user.middle_name || '';
    document.getElementById('crud-lname').value = user.last_name || '';
    document.getElementById('crud-age').value = user.age || '';
    document.getElementById('crud-gender').value = user.gender || 'Other';
    document.getElementById('crud-address').value = user.address || '';
    document.getElementById('crud-contact').value = user.contact_number || '';
    document.getElementById('crud-email').value = user.email || '';
    document.getElementById('crud-role').value = user.role || 'farmer';
    document.getElementById('crud-pass').value = '';
    document.getElementById('crud-pass').required = false;
    document.getElementById('crud-pass').placeholder = 'Leave blank to keep the current password';
    openModal('crud-modal');
}
async function saveAccount(event) {
    event.preventDefault();
    const get = (id) => document.getElementById(id).value.trim();
    const editId = get('edit-id');
    const password = document.getElementById('crud-pass').value;
    const age = Number(get('crud-age'));
    if (!(age >= 18)) { toast('Age must be 18 or older.', 'error'); return; }
    const body = {
        first_name: get('crud-fname'), middle_name: get('crud-mname'), last_name: get('crud-lname'),
        age, gender: document.getElementById('crud-gender').value, address: get('crud-address'),
        contact_number: get('crud-contact'), email: get('crud-email'), role: document.getElementById('crud-role').value
    };
    try {
        if (editId) {
            if (password) body.password = password;
            await api(`/update/${editId}`, { method: 'PUT', body });
            toast('Account updated.');
        } else {
            await api('/admin/users', {
                method: 'POST',
                body: { ...body, username: get('crud-email').split('@')[0].replace(/[^a-zA-Z0-9]/g, '') + Math.floor(1000 + Math.random() * 9000), password }
            });
            toast('Account created.');
        }
        closeModal('crud-modal');
        resetCrudForm();
        await loadAll();
    } catch (error) { toast(error.message, 'error'); }
}

/* ---------- moderation & reports ---------- */
async function approvePost(id) {
    try {
        await api(`/admin/posts/${id}/approve`, { method: 'PUT' });
        toast('Post approved and published.');
        await loadAll();
    } catch (error) { toast(error.message, 'error'); }
}
async function rejectPost(id) {
    if (!confirm('Reject and delete this post?')) return;
    try {
        await api(`/posts/${id}`, { method: 'DELETE' });
        toast('Post rejected and deleted.', 'info');
        await loadAll();
    } catch (error) { toast(error.message, 'error'); }
}
async function resolveReport(id) {
    try {
        await api(`/admin/reports/${id}/resolve`, { method: 'PUT' });
        toast('Report resolved.');
        await loadAll();
    } catch (error) { toast(error.message, 'error'); }
}
async function resolveComplaint(id) {
    try {
        await api(`/admin/complaints/${id}/resolve`, { method: 'PUT' });
        toast('Complaint resolved.');
        await loadAll();
    } catch (error) { toast(error.message, 'error'); }
}

/* ---------- navigation & export ---------- */
function switchView(viewId) {
    document.querySelectorAll('.view-section').forEach((v) => v.classList.toggle('active', v.id === viewId));
    const titles = {
        'report-view': 'Generate Reports',
        'profile-view': 'My Profile',
        'cloud-view': 'Cloud Storage',
        'main-db-view': 'System Overview'
    };
    document.getElementById('page-title').innerText = titles[viewId] || 'System Overview';
    document.getElementById('add-btn').style.display = viewId === 'main-db-view' ? '' : 'none';
    document.querySelectorAll('.sidebar .nav-item[data-view]').forEach((n) => n.classList.toggle('active', n.dataset.view === viewId));
    const hashByView = { 'profile-view': 'profile', 'cloud-view': 'cloud', 'report-view': 'reports' };
    history.replaceState(history.state, '', '/admin' + (hashByView[viewId] ? `#${hashByView[viewId]}` : ''));
    if (viewId === 'cloud-view') Promise.all([loadCloudFiles(), loadBackups()]);
    if (viewId === 'profile-view') loadAdminProfile();
    if (window.innerWidth <= 900) toggleSidebar(false);
}
function switchTab(tabId, btn) {
    document.querySelectorAll('.db-tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.table-responsive').forEach((t) => t.classList.add('hidden'));
    if (btn) btn.classList.add('active');
    document.getElementById('table-' + tabId).classList.remove('hidden');
}
function downloadTableAsCSV(tableId, filename) {
    const table = document.querySelector('#' + tableId + ' table');
    if (!table) { toast('Table not found.', 'error'); return; }
    const lines = [];
    table.querySelectorAll('tr').forEach((row) => {
        const cells = [...row.querySelectorAll('th, td')].map((cell) => '"' + cell.innerText.replace(/[\r\n]+/g, ' ').trim().replace(/"/g, '""') + '"');
        lines.push(cells.join(','));
    });
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename + '.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
async function downloadReportAsPDF(reportKey, filename) {
    try {
        const request = () => fetch(`${API_BASE}/admin/reports/${encodeURIComponent(reportKey)}/pdf`, {
            headers: { Authorization: `Bearer ${getTokens().access}` }
        });
        let response = await request();
        if (response.status === 401 && await refreshTokens()) response = await request();
        if (!response.ok) {
            let message = 'Could not generate the PDF report.';
            try {
                const error = await response.json();
                message = error.error || error.message || message;
            } catch (parseError) {
                // Keep the readable fallback when the server does not return JSON.
            }
            throw new Error(message);
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${filename}.pdf`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    } catch (error) {
        toast(error.message, 'error');
    }
}
function wirePdfButtons() {
    document.querySelectorAll('#report-view [data-report-key]').forEach((card) => {
        if (card.querySelector('[data-pdf-report]')) return;
        const key = card.dataset.reportKey;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn-export';
        button.dataset.pdfReport = key;
        button.innerHTML = '<i class="fa-solid fa-file-pdf"></i> Download PDF';
        button.addEventListener('click', () => {
            const name = key.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('_');
            downloadReportAsPDF(key, `AgriTrace_${name}_Report`);
        });
        card.appendChild(button);
    });
}
async function loadAdminProfile() {
    try {
        adminUser = await api('/profile');
        document.getElementById('admin-profile-photo').src = avatarOf(adminUser);
        document.getElementById('admin-profile-name').textContent = displayName(adminUser);
        document.getElementById('admin-profile-email').textContent = adminUser.email || '';
        document.getElementById('admin-profile-first').value = adminUser.first_name || '';
        document.getElementById('admin-profile-middle').value = adminUser.middle_name || '';
        document.getElementById('admin-profile-last').value = adminUser.last_name || '';
        document.getElementById('admin-profile-age').value = adminUser.age || '';
        document.getElementById('admin-profile-gender').value = adminUser.gender || 'Other';
        document.getElementById('admin-profile-contact').value = adminUser.contact_number || '';
        document.getElementById('admin-profile-address').value = adminUser.address || '';
        document.getElementById('admin-name').textContent = displayName(adminUser);
        cacheUser(adminUser);
    } catch (error) { toast(error.message, 'error'); }
}
async function saveAdminProfile(event) {
    event.preventDefault();
    try {
        const body = {
            first_name: document.getElementById('admin-profile-first').value.trim(),
            middle_name: document.getElementById('admin-profile-middle').value.trim(),
            last_name: document.getElementById('admin-profile-last').value.trim(),
            gender: document.getElementById('admin-profile-gender').value,
            contact_number: document.getElementById('admin-profile-contact').value.trim(),
            address: document.getElementById('admin-profile-address').value.trim()
        };
        const age = document.getElementById('admin-profile-age').value;
        if (age) body.age = Number(age);
        await api(`/update/${encodeURIComponent(adminUser.id)}`, {
            method: 'PUT',
            body
        });
        await loadAdminProfile();
        document.getElementById('admin-name').textContent = displayName(adminUser);
        toast('Profile saved.');
    } catch (error) { toast(error.message, 'error'); }
}

async function initPage() {
    installModalBehaviour();
    adminUser = await requireSession(true);
    if (!adminUser) return;
    history.replaceState(history.state, '', '/admin' + location.hash);
    initShell(adminUser);
    document.getElementById('admin-name').textContent = displayName(adminUser);
    document.getElementById('admin-avatar').src = avatarOf(adminUser);
    document.getElementById('crud-role').innerHTML = [...SIGNUP_ROLES.map((r) => ({ value: r.role, label: r.label })), { value: 'admin', label: 'Administrator' }]
        .map((o) => `<option value="${o.value}">${o.label}</option>`).join('');

    listen(document, 'click', (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const id = b.dataset.id;
        switch (b.dataset.act) {
            case 'edit': editAccount(id); break;
            case 'delete': deleteAccount(id); break;
            case 'approve-acc': approveAccount(id); break;
            case 'reject-acc': rejectAccount(id); break;
            case 'approve-post': approvePost(id); break;
            case 'reject-post': rejectPost(id); break;
            case 'resolve': resolveReport(id); break;
            case 'resolve-complaint': resolveComplaint(id); break;
            case 'verify-user': setFarmerVerification(id, b.dataset.verified === 'true'); break;
        }
    });
    document.getElementById('cloud-files').addEventListener('click', (event) => {
        const button = event.target.closest('[data-cloud-action]');
        if (!button) return;
        if (button.dataset.cloudAction === 'open') openPuterFile(button.dataset.cloudPath);
        if (button.dataset.cloudAction === 'delete') deleteCloudFile(button.dataset.cloudPath);
    });
    listen(document.getElementById('admin-profile-photo-input'), 'change', async (event) => {
        const input = event.target;
        const file = input.files[0];
        input.value = '';
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            toast('Please choose an image file.', 'error');
            return;
        }
        try {
            const uploaded = await uploadMedia(file, 'profiles');
            await api(`/update/${encodeURIComponent(adminUser.id)}`, {
                method: 'PUT',
                body: { profile_pic: uploaded.url }
            });
            await loadAdminProfile();
            document.getElementById('admin-avatar').src = avatarOf(adminUser);
            toast('Profile photo updated.');
        } catch (error) {
            toast(error.message, 'error');
        }
    });
    wirePdfButtons();
    await loadAll();
    await loadAdminProfile();
    const initialView = {
        '#profile': 'profile-view',
        '#cloud': 'cloud-view',
        '#reports': 'report-view'
    }[location.hash] || 'main-db-view';
    switchView(initialView);
}

/* ---------- emailed sales report ---------- */
async function emailSalesReport() {
    try {
        const data = await api('/admin/reports/email', { method: 'POST' });
        toast(`${data.message} Sent to ${data.sent_to}.`);
    } catch (error) {
        toast(error.message, 'error');
    }
}
