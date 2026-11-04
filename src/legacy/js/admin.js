/* =====================================================================
   Admin Database (admin-dashboard.html): live stats and record cards from
   GET /api/admin/database and GET /api/admin/queues, plus account,
   approval, moderation and report actions. Administrators only.
   ===================================================================== */

let adminUser = null;
let snapshot = null;
let queues = { reports: [], complaints: [] };
let activeTab = 'accounts';
let recordSets = {};
let recordColumns = {};
let recordActions = {};
const recordPages = {};
const RECORDS_PER_PAGE = 6;
const REFRESH_INTERVAL_MS = 15000;
let refreshTimer = null;
let loadingAll = false;
let reloadAfterCurrent = false;

function fmtDate(value) {
    if (!value) return '—';
    return new Date(String(value).replace(' ', 'T')).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}
async function approveHarvest(id) {
    try {
        await api(`/harvests/${encodeURIComponent(id)}`, {
            method: 'PUT',
            body: { approval_status: 'approved' }
        });
        toast('Harvest approved. Provenance is now visible on its public batch trace.');
        await loadAll();
    } catch (error) {
        toast(error.message, 'error');
    }
}
function compactMoney(n) {
    return Number(n) >= 1000 ? '₱' + (Number(n) / 1000).toFixed(1) + 'k' : money(n);
}
function cellValue(column, value) {
    if (value === null || value === undefined || value === '') return '—';
    if (column === 'is_active') return Number(value) === 1 ? badge('Active', 'var(--primary)', 'rgba(16,185,129,0.2)') : badge('Inactive', 'var(--warning)', 'rgba(245,158,11,0.2)');
    if (column === 'role') return badge(roleLabel(value), 'white', value === 'admin' ? 'var(--danger)' : 'var(--primary)');
    if (column === 'available' || column === 'is_available') return Number(value) === 1 ? 'Yes' : 'No';
    if (column === 'is_verified') return Number(value) === 1 ? badge('Verified', 'var(--primary)', 'rgba(16,185,129,0.2)') : 'Not verified';
    if (column === 'approval_status') {
        const approved = value === 'approved';
        const rejected = value === 'rejected';
        return badge(value.charAt(0).toUpperCase() + value.slice(1), approved ? 'var(--primary)' : rejected ? 'var(--danger)' : 'var(--warning)', approved ? 'rgba(16,185,129,0.2)' : rejected ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.2)');
    }
    if (/_at$|date$|time$|recorded_at$|dispatch_time$|delivery_time$/.test(column)) return fmtDate(value);
    if (column === 'password') return '••••••••';
    return escapeHtml(value);
}
function badge(text, color, background) {
    return `<span class="badge" style="background: ${background}; color: ${color};">${escapeHtml(text)}</span>`;
}

function renderTable(tabId, columns, rows, actions) {
    recordSets[tabId] = rows;
    recordColumns[tabId] = columns;
    recordActions[tabId] = actions;
    const table = document.querySelector(`#table-${tabId} table`);
    if (!table) return;
    const head = columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('') + (actions ? '<th>Actions</th>' : '');
    const body = rows.length
        ? rows.map((row) => `<tr>${columns.map((c) => `<td>${cellValue(c.field, row[c.field])}</td>`).join('')}${actions ? `<td>${actions(row)}</td>` : ''}</tr>`).join('')
        : `<tr><td colspan="${columns.length + (actions ? 1 : 0)}" style="text-align:center; color: var(--text-muted);">No records.</td></tr>`;
    table.innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;
    renderRecordCards(tabId, columns, rows, actions);
}
function recordImage(row, tabId) {
    let mediaUrlValue = row.media_url;
    if (tabId === 'reports' && row.post_media_url_snapshot) {
        try {
            const media = JSON.parse(row.post_media_url_snapshot);
            if (Array.isArray(media)) {
                mediaUrlValue = media.find((item) => item && item.type !== 'video' && item.url)?.url || '';
            } else if (typeof media === 'string') {
                mediaUrlValue = media;
            } else if (media && typeof media === 'object') {
                mediaUrlValue = media.url || '';
            }
        } catch (error) {
            mediaUrlValue = row.post_media_url_snapshot;
        }
    }
    const image = row.profile_pic || row.image_url || mediaUrlValue || row.qr_url || row.qr_image_path;
    const fallback = tabId === 'accounts'
        ? avatarOf(row)
        : tabId === 'products' ? DEFAULT_PRODUCT_IMG : '';
    const source = image || fallback;
    const isQr = tabId === 'qrcodes';
    const icon = tabId === 'accounts' ? 'fa-user'
        : tabId === 'qrcodes' ? 'fa-qrcode'
        : tabId === 'complaints' || tabId === 'reports' ? 'fa-comment-dots'
        : tabId === 'orders' ? 'fa-bag-shopping'
        : tabId === 'notifications' ? 'fa-bell'
        : tabId === 'logs' ? 'fa-clipboard-list'
        : 'fa-seedling';
    return `<div class="db-record-image${isQr ? ' qr-image' : ''}">
        ${source ? `<img src="${escapeHtml(mediaUrl(source))}" alt="${escapeHtml(recordTitle(row, recordColumns[tabId] || []))}" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><i class="fa-solid ${icon}" hidden aria-hidden="true"></i>` : `<i class="fa-solid ${icon}" aria-hidden="true"></i>`}
    </div>`;
}
function recordTitle(row, columns) {
    if (row.first_name || row.last_name) return [row.first_name, row.last_name].filter(Boolean).join(' ');
    const titleFields = ['product_name', 'farm_name', 'market_name', 'title', 'batch_code', 'preview', 'author', 'reported_user', 'reporter_name', 'username', 'email', 'trace_code', 'status', 'action'];
    const field = titleFields.find((name) => row[name] !== null && row[name] !== undefined && String(row[name]).trim());
    if (field) return row[field];
    const firstValue = columns.find((column) => !/(^id$|_id$|_at$|date$)/i.test(column.field) && row[column.field] !== null && row[column.field] !== undefined && String(row[column.field]).trim());
    return firstValue ? row[firstValue.field] : 'Record';
}
function renderRecordCards(tabId, columns, rows, actions, options = {}) {
    const grid = document.getElementById(options.gridId || `cards-${tabId}`);
    if (!grid) return;
    recordSets[tabId] = rows;
    recordColumns[tabId] = columns;
    recordActions[tabId] = actions;
    const query = options.ignoreFilters ? '' : document.getElementById('db-record-search')?.value.trim().toLocaleLowerCase() || '';
    const fromDate = options.ignoreFilters ? '' : document.getElementById('db-date-from')?.value || '';
    const toDate = options.ignoreFilters ? '' : document.getElementById('db-date-to')?.value || '';
    const category = options.ignoreFilters ? '' : document.getElementById('db-review-category')?.value || '';
    const dateField = 'created_at';
    const matches = rows.map((row, index) => ({ row, index })).filter(({ row }) => {
        const matchesSearch = !query || Object.values(row).some((value) => String(value ?? '').toLocaleLowerCase().includes(query));
        if (!matchesSearch) return false;
        if ((tabId === 'reports' || tabId === 'complaints') && category && row.status !== category) return false;
        if (tabId !== 'reports' && tabId !== 'complaints' && tabId !== 'logs' && tabId !== 'notifications') return true;
        const date = String(row[dateField] || '').slice(0, 10);
        return (!fromDate || date >= fromDate) && (!toDate || date <= toDate);
    });
    const pageCount = Math.max(1, Math.ceil(matches.length / RECORDS_PER_PAGE));
    recordPages[tabId] = Math.min(Math.max(1, recordPages[tabId] || 1), pageCount);
    const page = recordPages[tabId];
    const start = (page - 1) * RECORDS_PER_PAGE;
    const pageRows = options.limit ? matches.slice(0, options.limit) : matches.slice(start, start + RECORDS_PER_PAGE);
    if (!options.gridId && tabId === activeTab) {
        document.getElementById('db-result-count').textContent = matches.length
            ? `${start + 1}–${Math.min(start + RECORDS_PER_PAGE, matches.length)} of ${matches.length} records`
            : `0 of ${rows.length} records`;
    }

    if (!pageRows.length) {
        const hasFilter = query || fromDate || toDate || category;
        grid.innerHTML = `<div class="db-empty-state"><i class="fa-solid ${hasFilter ? 'fa-filter-circle-xmark' : 'fa-folder-open'}"></i>${escapeHtml(options.emptyMessage || (hasFilter ? 'No records match your filters.' : 'No records in this section yet.'))}</div>`;
        if (!options.gridId) renderPagination(tabId, 0, page);
        return;
    }

    grid.innerHTML = pageRows.map(({ row, index }) => {
        const title = recordTitle(row, columns);
        const idColumn = columns.find((column) => /(^id$|_id$)/i.test(column.field));
        const detailColumns = columns.filter((column) => column.field !== idColumn?.field && column.field !== 'password' && !/(image|photo|picture|qr_url|media_url)/i.test(column.field)).slice(0, 4);
        return `<article class="db-record-card">
            ${recordImage(row, tabId)}
            <div class="db-record-body">
            <div class="db-record-heading">
                <div style="min-width: 0;">
                    <h3 title="${escapeHtml(title)}">${escapeHtml(title)}</h3>
                    ${idColumn && row[idColumn.field] !== undefined ? `<span class="db-record-id">${escapeHtml(idColumn.label)}: ${cellValue(idColumn.field, row[idColumn.field])}</span>` : ''}
                </div>
            </div>
            <dl class="db-record-fields">${detailColumns.map((column) => `<div><dt>${escapeHtml(column.label)}</dt><dd title="${escapeHtml(row[column.field] ?? '')}">${cellValue(column.field, row[column.field])}</dd></div>`).join('')}</dl>
            <div class="db-record-actions">
                ${actions ? actions(row) : ''}
                <button class="action-btn btn-edit" type="button" data-act="view" data-section="${tabId}" data-index="${index}"><i class="fa-solid fa-eye"></i> View</button>
            </div>
            </div>
        </article>`;
    }).join('');
    if (!options.gridId) renderPagination(tabId, matches.length, page);
}
function renderPagination(tabId, total, currentPage) {
    let pagination = document.getElementById(`pagination-${tabId}`);
    const section = document.getElementById(`table-${tabId}`);
    if (!pagination && section) {
        pagination = document.createElement('nav');
        pagination.id = `pagination-${tabId}`;
        pagination.className = 'db-pagination';
        pagination.setAttribute('aria-label', `${tabId} pages`);
        section.insertBefore(pagination, section.querySelector('.data-export-source'));
    }
    if (!pagination) return;
    const pages = Math.ceil(total / RECORDS_PER_PAGE);
    pagination.innerHTML = '';
    pagination.classList.toggle('hidden', pages < 2);
    if (pages < 2) return;
    const addButton = (label, page, disabled = false, active = false, ariaLabel = label) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `db-page-btn${active ? ' active' : ''}`;
        button.textContent = label;
        button.setAttribute('aria-label', ariaLabel);
        if (active) button.setAttribute('aria-current', 'page');
        button.disabled = disabled;
        button.addEventListener('click', () => {
            recordPages[tabId] = page;
            renderRecordCards(tabId, recordColumns[tabId] || [], recordSets[tabId] || [], recordActions[tabId]);
        });
        pagination.appendChild(button);
    };
    addButton('‹', currentPage - 1, currentPage === 1, false, 'Previous page');
    let visiblePages = Array.from({ length: pages }, (_, index) => index + 1);
    if (pages > 7) {
        const start = Math.max(2, currentPage - 1);
        const end = Math.min(pages - 1, currentPage + 1);
        visiblePages = [1, ...Array.from({ length: end - start + 1 }, (_, index) => start + index), pages];
    }
    visiblePages.forEach((page, index) => {
        if (index && page - visiblePages[index - 1] > 1) {
            const ellipsis = document.createElement('span');
            ellipsis.className = 'db-page-ellipsis';
            ellipsis.textContent = '…';
            pagination.appendChild(ellipsis);
        }
        addButton(String(page), page, false, page === currentPage, `Page ${page}`);
    });
    addButton('›', currentPage + 1, currentPage === pages, false, 'Next page');
}
function openRecordDetails(section, index) {
    const row = recordSets[section]?.[index];
    const columns = recordColumns[section] || [];
    if (!row) return;
    const title = recordTitle(row, columns);
    document.getElementById('record-detail-title').textContent = title;
    document.getElementById('record-detail-list').innerHTML = columns.map((column) => `
        <div class="db-detail-item">
            <dt>${escapeHtml(column.label)}</dt>
            <dd>${cellValue(column.field, row[column.field])}</dd>
        </div>`).join('');
    openModal('record-detail-modal');
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
    document.getElementById('stat-open-complaints').innerText = queues.complaints.filter((complaint) => complaint.status === 'open').length;
    document.getElementById('stat-reports').innerText = queues.reports.filter((report) => report.status === 'open').length;
    document.getElementById('stat-products').innerText = s.listings;
    document.getElementById('stat-orders').innerText = s.orders;
    document.getElementById('stat-revenue').innerText = compactMoney(s.revenue);
}

/* ---------- record cards ---------- */
function renderAll() {
    const t = snapshot.tables;
    renderStats();

    renderTable('accounts', columnsFrom(t.users), rowsFrom(t.users), (u) => `
        ${u.role === 'farmer' ? `<button class="action-btn ${Number(u.is_verified) === 1 ? 'btn-approve' : 'btn-edit'}" data-act="verify-user" data-id="${escapeHtml(u.id)}" data-verified="${Number(u.is_verified) === 1 ? 'false' : 'true'}"><i class="fa-solid fa-circle-check"></i> ${Number(u.is_verified) === 1 ? 'Unverify' : 'Verify'}</button>` : ''}
        <button class="action-btn btn-edit" data-act="edit" data-id="${escapeHtml(u.id)}"><i class="fa-solid fa-pen"></i></button>
        <button class="action-btn btn-delete" data-act="delete" data-id="${escapeHtml(u.id)}"><i class="fa-solid fa-trash"></i></button>`);

    const reportRows = queues.reports.map((report) => ({ ...report, record_type: 'User report' }));
    const reportColumns = [
        { field: 'report_id', label: 'Report / Complaint ID' },
        { field: 'record_type', label: 'Type' },
        { field: 'reported_user', label: 'Reported User' },
        { field: 'post_id', label: 'Post ID' },
        { field: 'reason', label: 'Issue' },
        { field: 'reported_by', label: 'Submitted By' },
        { field: 'status', label: 'Status' },
        { field: 'created_at', label: 'Submitted' },
        { field: 'resolved_at', label: 'Resolved' }
    ];
    renderTable('reports', reportColumns, reportRows, (report) => report.record_type === 'User report'
        ? (report.status !== 'open' ? '' : report.post_id
            ? `<button class="action-btn btn-approve" data-act="review-post-report" data-id="${escapeHtml(report.report_id)}"><i class="fa-solid fa-eye"></i> Review post</button>`
            : `<button class="action-btn btn-approve" data-act="resolve" data-id="${escapeHtml(report.report_id)}"><i class="fa-solid fa-check"></i> Resolve</button>`)
        : '');

    renderTable('complaints', [
        { field: 'complaint_id', label: 'Complaint ID' }, { field: 'reporter_name', label: 'Name' },
        { field: 'reporter_email', label: 'Email' }, { field: 'message', label: 'Complaint' },
        { field: 'status', label: 'Status' }, { field: 'created_at', label: 'Submitted' }
    ], queues.complaints, (complaint) => complaint.status === 'open' ? `
        <button class="action-btn btn-approve" data-act="resolve-complaint" data-id="${escapeHtml(complaint.complaint_id)}"><i class="fa-solid fa-check"></i> Resolve and email</button>` : '');
    renderTable('farmer-applications', [
        { field: 'application_id', label: 'Application' },
        { field: 'username', label: 'Applicant' },
        { field: 'farm_name', label: 'Farm' },
        { field: 'municipality', label: 'Municipality' },
        { field: 'status', label: 'Status' },
        { field: 'created_at', label: 'Submitted' }
    ], queues.farmerApplications || [], (application) => application.status === 'pending'
        ? `<button class="action-btn btn-approve" data-act="review-farmer-application" data-id="${escapeHtml(application.application_id)}" data-status="approved"><i class="fa-solid fa-check"></i> Approve</button>
           <button class="action-btn btn-delete" data-act="review-farmer-application" data-id="${escapeHtml(application.application_id)}" data-status="rejected"><i class="fa-solid fa-xmark"></i> Reject</button>`
        : '');

    renderTable('products', columnsFrom(t.listings), rowsFrom(t.listings));
    renderTable('farm-registry', columnsFrom(t.farms), rowsFrom(t.farms));
    renderTable('catalog', columnsFrom(t.products), rowsFrom(t.products));
    renderTable('batches', columnsFrom(t.batches), rowsFrom(t.batches), (batch) => `
        <button class="action-btn btn-edit" data-act="edit-traceability" data-resource="batches" data-id="${escapeHtml(batch.batch_id)}"><i class="fa-solid fa-pen"></i> Edit</button>
        <a class="action-btn btn-approve" href="/trace?batch=${encodeURIComponent(batch.batch_code)}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> Public trace</a>`);
    renderTable('harvests', columnsFrom(t.harvests), rowsFrom(t.harvests), (harvest) => harvest.approval_status === 'pending'
        ? `<button class="action-btn btn-approve" data-act="approve-harvest" data-id="${escapeHtml(harvest.harvest_id)}"><i class="fa-solid fa-check"></i> Approve harvest</button>`
        : '');
    renderTable('shipments', columnsFrom(t.shipments), rowsFrom(t.shipments), (shipment) => `
        <button class="action-btn btn-edit" data-act="edit-traceability" data-resource="shipments" data-id="${escapeHtml(shipment.shipment_id)}"><i class="fa-solid fa-pen"></i> Update shipment</button>`);
    renderTable('qrcodes', columnsFrom(t.qrcodes), rowsFrom(t.qrcodes), (qr) => (
        qr.trace_code && !qr.qr_url
            ? `<button class="action-btn btn-approve" data-act="generate-qr" data-id="${escapeHtml(qr.trace_code)}"><i class="fa-solid fa-qrcode"></i> Generate QR</button>`
            : ''
    ));
    renderTable('orders', columnsFrom(t.orders), rowsFrom(t.orders));
    renderTable('notifications', columnsFrom(t.notifications), rowsFrom(t.notifications));
    renderTable('logs', columnsFrom(t.logs), rowsFrom(t.logs));

    // Keep the remaining database reports available for CSV export without showing extra sections.
    ['farms', 'traceability', 'markets', 'weather'].forEach((name) => {
        renderTable(name, columnsFrom(t[name]), rowsFrom(t[name]));
    });
}

async function loadAll(quiet = false) {
    if (loadingAll) {
        if (!quiet) reloadAfterCurrent = true;
        return;
    }
    loadingAll = true;
    try {
        await Promise.all([
            api('/admin/database').then((db) => {
                snapshot = db;
                if (queues) renderAll();
            }),
            api('/admin/queues').then((q) => {
                queues = q;
                if (snapshot) renderAll();
            }),
            api('/admin/farmer-applications?status=pending').then((result) => {
                queues.farmerApplications = result.data || [];
                if (snapshot) renderAll();
            })
        ]);
        document.getElementById('db-live-status').textContent = `Live · updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    } catch (error) {
        document.getElementById('db-live-status').textContent = 'Live update failed · retrying';
        if (!quiet) toast(error.message, 'error');
    } finally {
        loadingAll = false;
        if (reloadAfterCurrent) {
            reloadAfterCurrent = false;
            void loadAll(true);
        }
    }
}

/* ---------- account actions ---------- */
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
async function reviewFarmerApplication(id, status) {
    const reason = status === 'rejected' ? window.prompt('Reason for rejection:') : '';
    if (status === 'rejected' && !reason) return;
    try {
        await api(`/admin/farmer-applications/${encodeURIComponent(id)}`, {
            method: 'PUT',
            body: { status, reason: reason || undefined }
        });
        toast(`Farmer application ${status}.`);
        await loadAll();
    } catch (error) {
        toast(error.message, 'error');
    }
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
function openSelectedAddForm(recordId = null) {
    if (activeTab === 'accounts') {
        openAddAccount();
        return;
    }
    const config = {
        'farm-registry': {
            title: 'Register Farm',
            resource: 'farms',
            help: 'Register the farm first so it can be selected as the batch origin. Coordinates are available only in the authorized partner trace.',
            fields: [
                { name: 'farmer_id', label: 'Farmer', type: 'select', required: true, options: rowsFrom(snapshot.tables.users).filter((row) => row.role === 'farmer').map((row) => [row.id, `${[row.first_name, row.last_name].filter(Boolean).join(' ') || row.username} (#${row.id})`]) },
                { name: 'farm_name', label: 'Farm Name', required: true },
                { name: 'farm_address', label: 'Farm Address', type: 'textarea', full: true },
                { name: 'province', label: 'Province' },
                { name: 'municipality', label: 'Municipality' },
                { name: 'barangay', label: 'Barangay' },
                { name: 'latitude', label: 'Latitude', type: 'number', step: '0.0000001' },
                { name: 'longitude', label: 'Longitude', type: 'number', step: '0.0000001' },
                { name: 'farm_size', label: 'Farm Size', type: 'number', min: '0', step: '0.01' },
                { name: 'farm_size_unit', label: 'Farm Size Unit', placeholder: 'hectares, acres…' }
            ]
        },
        catalog: {
            title: 'Add Catalog Product',
            resource: 'products',
            help: 'This is the product catalog used by batches. Marketplace listings are managed separately in the Marketplace tab.',
            fields: [
                { name: 'product_name', label: 'Product Name', required: true },
                { name: 'category', label: 'Category', required: true, placeholder: 'Vegetables, Fruits, Grains…' },
                { name: 'unit_of_measure', label: 'Unit of Measure', required: true, placeholder: 'kg, bunch, crate…' },
                { name: 'description', label: 'Description', type: 'textarea', full: true }
            ]
        },
        batches: {
            title: 'Create Product Batch',
            resource: 'batches',
            help: 'Choose a product and farm. The QR code is created once and opens this batch’s public trace.',
            fields: [
                { name: 'batch_code', label: 'Batch Code', required: true, placeholder: 'For example, BATCH-2026-001' },
                { name: 'product_id', label: 'Product', type: 'select', required: true, options: rowsFrom(snapshot.tables.products).map((row) => [row.product_id, row.product_name]) },
                { name: 'farm_id', label: 'Origin Farm', type: 'select', required: true, options: rowsFrom(snapshot.tables.farms).map((row) => [row.farm_id, `${row.farm_name} (#${row.farm_id})`]) },
                { name: 'quantity', label: 'Quantity', type: 'number', required: true, min: '0.01', step: '0.01' },
                { name: 'unit', label: 'Unit', required: true, placeholder: 'kg, crates, bunches…' },
                { name: 'harvest_date', label: 'Harvest Date', type: 'date' },
                { name: 'current_status', label: 'Batch Status', type: 'select', required: true, value: 'harvested', options: [
                    ['harvested', 'Harvested'], ['collected', 'Collected'], ['in_transit', 'In transit'],
                    ['received', 'Received'], ['available_at_market', 'Available at market'], ['sold', 'Sold'], ['rejected', 'Rejected']
                ] },
                { name: 'trace_code', label: 'Link Paid Order Trace Code (optional)', placeholder: 'AGT-0123456789', full: true }
            ]
        },
        harvests: {
            title: 'Add Harvest Record',
            resource: 'harvests',
            help: 'Harvests start as pending. Approve the record from the Harvests list to show it in the public provenance timeline.',
            fields: [
                { name: 'batch_id', label: 'Batch', type: 'select', required: true, options: rowsFrom(snapshot.tables.batches).map((row) => [row.batch_id, `${row.batch_code} (#${row.batch_id})`]) },
                { name: 'farmer_id', label: 'Farmer', type: 'select', required: true, options: rowsFrom(snapshot.tables.users).filter((row) => row.role === 'farmer').map((row) => [row.id, `${[row.first_name, row.last_name].filter(Boolean).join(' ') || row.username} (#${row.id})`]) },
                { name: 'harvest_date', label: 'Harvest Date', type: 'date', required: true },
                { name: 'quantity_harvested', label: 'Quantity Harvested', type: 'number', required: true, min: '0.01', step: '0.01' },
                { name: 'quality_grade', label: 'Quality Grade', placeholder: 'For example, Grade A' },
                { name: 'notes', label: 'Harvest Notes', type: 'textarea', full: true }
            ]
        },
        shipments: {
            title: 'Record Shipment',
            resource: 'shipments',
            help: 'Set dispatch and delivery times as they happen. Each shipment status change adds a supply-chain timeline event.',
            fields: [
                { name: 'batch_id', label: 'Batch', type: 'select', required: true, options: rowsFrom(snapshot.tables.batches).map((row) => [row.batch_id, `${row.batch_code} (#${row.batch_id})`]) },
                { name: 'transporter_id', label: 'Transporter', type: 'select', required: true, options: rowsFrom(snapshot.tables.users).filter((row) => row.role === 'transporter').map((row) => [row.id, `${[row.first_name, row.last_name].filter(Boolean).join(' ') || row.username} (#${row.id})`]) },
                { name: 'origin', label: 'Origin', required: true, placeholder: 'Farm or collection point' },
                { name: 'destination', label: 'Destination', required: true, placeholder: 'Market or receiving location' },
                { name: 'vehicle_number', label: 'Vehicle Number' },
                { name: 'shipment_status', label: 'Status', type: 'select', required: true, value: 'pending', options: [
                    ['pending', 'Pending'], ['in_transit', 'In transit'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled']
                ] },
                { name: 'dispatch_time', label: 'Dispatch Time', type: 'datetime-local' },
                { name: 'delivery_time', label: 'Delivery Time', type: 'datetime-local' },
                { name: 'remarks', label: 'Shipment Notes', type: 'textarea', full: true }
            ]
        }
    }[activeTab];
    if (!config) return;
    const missingChoiceFields = config.fields
        .filter((field) => field.type === 'select' && field.required && !field.options.length)
        .map((field) => field.label);
    if (missingChoiceFields.length) {
        toast(`Add the required records first: ${missingChoiceFields.join(', ')}.`, 'error');
        return;
    }

    const existing = recordId
        ? rowsFrom(snapshot.tables[activeTab]).find((row) => String(row[activeTab === 'batches' ? 'batch_id' : 'shipment_id']) === String(recordId))
        : null;
    if (recordId && !existing) {
        toast('The record could not be found. Refresh the table and try again.', 'error');
        return;
    }

    document.getElementById('trace-form').reset();
    document.getElementById('trace-form-title').textContent = existing ? `Update ${config.title}` : config.title;
    document.getElementById('trace-form-help').textContent = config.help;
    document.getElementById('trace-form').dataset.resource = config.resource;
    document.getElementById('trace-form').dataset.recordId = existing ? String(recordId) : '';
    document.getElementById('trace-form-fields').innerHTML = config.fields.map((field) => {
        const required = field.required ? ' required' : '';
        const full = field.full ? ' full-width' : '';
        const label = `<label for="trace-field-${field.name}">${escapeHtml(field.label)}${field.required ? ' *' : ''}</label>`;
        if (field.type === 'select') {
            const options = (field.options || []).map(([value, name]) =>
                `<option value="${escapeHtml(value)}"${String(value) === String(field.value || '') ? ' selected' : ''}>${escapeHtml(name)}</option>`
            ).join('');
            return `<div class="input-group${full}">${label}<select id="trace-field-${field.name}" name="${field.name}"${required}><option value="">Select ${escapeHtml(field.label.toLowerCase())}</option>${options}</select></div>`;
        }
        if (field.type === 'textarea') {
            return `<div class="input-group${full}">${label}<textarea id="trace-field-${field.name}" name="${field.name}" rows="3" placeholder="${escapeHtml(field.placeholder || '')}"${required}></textarea></div>`;
        }
        return `<div class="input-group${full}">${label}<input id="trace-field-${field.name}" name="${field.name}" type="${field.type || 'text'}" placeholder="${escapeHtml(field.placeholder || '')}"${field.min ? ` min="${field.min}"` : ''}${field.step ? ` step="${field.step}"` : ''}${required}></div>`;
    }).join('');
    if (existing) {
        config.fields.forEach((field) => {
            const input = document.getElementById(`trace-field-${field.name}`);
            if (!input || existing[field.name] === null || existing[field.name] === undefined) return;
            const value = String(existing[field.name]);
            input.value = input.type === 'datetime-local' ? value.replace(' ', 'T').slice(0, 16) : value;
            if (activeTab === 'batches' && field.name === 'batch_code') input.readOnly = true;
        });
    }
    document.getElementById('trace-form-submit').textContent = existing ? 'Save changes' : config.title;
    openModal('trace-form-modal');
}
async function saveTraceabilityRecord(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = {};
    new FormData(form).forEach((value, name) => {
        if (value === '') return;
        const field = form.elements.namedItem(name);
        if (field.type === 'number' || field.type === 'select-one' && ['batch_id', 'farmer_id', 'product_id', 'farm_id', 'transporter_id'].includes(name)) {
            body[name] = Number(value);
        } else if (field.type === 'datetime-local') {
            body[name] = value.replace('T', ' ') + ':00';
        } else {
            body[name] = value.trim();
        }
    });
    const submit = document.getElementById('trace-form-submit');
    submit.disabled = true;
    try {
        const recordId = form.dataset.recordId;
        const method = recordId ? 'PUT' : 'POST';
        const path = `/${form.dataset.resource}${recordId ? `/${encodeURIComponent(recordId)}` : ''}`;
        const result = await api(path, { method, body });
        const message = result.qr_error
            ? `${result.message} QR error: ${result.qr_error}`
            : `${result.message || (recordId ? 'Record updated.' : 'Record created.')}${result.qr_url ? ` QR image: ${result.qr_url}` : ''}`;
        toast(message, result.qr_error ? 'error' : 'success');
        closeModal('trace-form-modal');
        await loadAll();
    } catch (error) {
        toast(error.message, 'error');
    } finally {
        submit.disabled = false;
    }
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
function reportMediaHTML(mediaUrlValue, mediaType) {
    if (!mediaUrlValue) return '<p style="color:var(--text-muted);">No image or video attached.</p>';
    let media = [];
    try {
        const parsed = JSON.parse(mediaUrlValue);
        media = Array.isArray(parsed) ? parsed : [typeof parsed === 'string' ? { url: parsed, type: mediaType } : parsed];
    } catch (error) {
        media = [{ url: mediaUrlValue, type: mediaType || 'image' }];
    }
    return media.filter((item) => item && item.url).map((item) => {
        const source = escapeHtml(mediaUrl(item.url));
        return item.type === 'video'
            ? `<video controls preload="metadata" style="max-width:100%;max-height:360px;border-radius:10px;" src="${source}"></video>`
            : `<img src="${source}" alt="Reported post attachment" style="max-width:100%;max-height:360px;object-fit:contain;border-radius:10px;" onerror="this.hidden=true">`;
    }).join('') || '<p style="color:var(--text-muted);">No image or video attached.</p>';
}
function reviewPostReport(id) {
    const report = queues.reports.find((item) => String(item.report_id) === String(id));
    if (!report || !report.post_id) {
        toast('The reported post could not be found in the open report queue.', 'error');
        return;
    }
    let product = null;
    try { product = report.post_product_snapshot ? JSON.parse(report.post_product_snapshot) : null; } catch (error) { product = null; }
    const productDetails = product
        ? `<dl class="db-detail-list">
            <div><dt>Product</dt><dd>${escapeHtml(product.name || '—')}</dd></div>
            <div><dt>Category</dt><dd>${escapeHtml(product.category || '—')}</dd></div>
            <div><dt>Price / Unit</dt><dd>${escapeHtml(product.price === null || product.price === undefined ? '—' : money(product.price))} ${escapeHtml(product.unit || '')}</dd></div>
            <div><dt>Description</dt><dd>${escapeHtml(product.description || '—')}</dd></div>
        </dl>${product.image_url ? reportMediaHTML(product.image_url, 'image') : ''}`
        : '';
    document.getElementById('post-report-modal-content').innerHTML = `
        <p><strong>Report #${escapeHtml(report.report_id)}</strong> · Post #${escapeHtml(report.post_id)}</p>
        <p><strong>Post author:</strong> ${escapeHtml(report.reported_user || 'Unknown')}</p>
        <p><strong>Reported by:</strong> ${escapeHtml(report.reported_by || 'Unknown')}</p>
        <p><strong>Complaint:</strong> ${escapeHtml(report.reason)}</p>
        <p><strong>Post content:</strong></p>
        <div style="white-space:pre-wrap;padding:12px;border-radius:8px;background:var(--bg-main);">${escapeHtml(report.post_content_snapshot || 'Post text unavailable')}</div>
        <div style="display:grid;gap:8px;margin:12px 0;">${reportMediaHTML(report.post_media_url_snapshot, report.post_media_type_snapshot)}</div>
        ${productDetails}`;
    document.getElementById('post-report-actions').innerHTML = `
        <button class="action-btn btn-reject" type="button" data-act="dismiss-post-report" data-id="${escapeHtml(report.report_id)}"><i class="fa-solid fa-circle-check"></i> Dismiss · keep post</button>
        <button class="action-btn btn-delete" type="button" data-act="remove-reported-post" data-id="${escapeHtml(report.report_id)}"><i class="fa-solid fa-trash"></i> Remove post</button>`;
    openModal('post-report-modal');
}
async function reviewReportedPost(id, action) {
    const confirmation = action === 'remove'
        ? 'Remove this post and notify both the reporter and the post author?'
        : 'Dismiss this report? The post will remain unchanged and only the reporter will be notified.';
    if (!confirm(confirmation)) return;
    try {
        const result = await api(`/admin/reports/${encodeURIComponent(id)}/resolve`, {
            method: 'PUT',
            body: { action }
        });
        closeModal('post-report-modal');
        toast(result.message || 'Post report reviewed.');
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
        const result = await api(`/admin/complaints/${id}/resolve`, { method: 'PUT' });
        toast(result.message);
        await loadAll();
        switchTab('complaints');
    } catch (error) { toast(error.message, 'error'); }
}
async function generateQr(traceCode) {
    try {
        const result = await api(`/admin/traces/${encodeURIComponent(traceCode)}/qr`, { method: 'POST' });
        toast(result.message);
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
    document.getElementById('add-btn').style.display = viewId === 'main-db-view' && activeTab === 'accounts' ? '' : 'none';
    document.querySelectorAll('.sidebar .nav-item[data-view]').forEach((n) => n.classList.toggle('active', n.dataset.view === viewId));
    const hashByView = { 'profile-view': 'profile', 'cloud-view': 'cloud', 'report-view': 'reports' };
    history.replaceState(history.state, '', '/admin' + (hashByView[viewId] ? `#${hashByView[viewId]}` : ''));
    if (viewId === 'main-db-view') updateAddButton();
    if (viewId === 'cloud-view') Promise.all([loadCloudFiles(), loadBackups()]);
    if (viewId === 'profile-view') loadAdminProfile();
    if (window.innerWidth <= 900) toggleSidebar(false);
}
function switchTab(tabId, btn) {
    if (tabId !== activeTab) {
        document.getElementById('db-record-search').value = '';
        document.getElementById('db-date-from').value = '';
        document.getElementById('db-date-to').value = '';
        document.getElementById('db-review-category').value = '';
        recordPages[tabId] = 1;
    }
    document.querySelectorAll('.db-section-nav button').forEach((tab) => {
        const active = tab.dataset.tab === tabId;
        tab.classList.toggle('active', active);
        if (active) tab.setAttribute('aria-current', 'page');
        else tab.removeAttribute('aria-current');
    });
    document.querySelectorAll('.db-section').forEach((t) => t.classList.add('hidden'));
    if (btn) {
        btn.classList.add('active');
        btn.setAttribute('aria-current', 'page');
    }
    activeTab = tabId;
    recordPages[tabId] = recordPages[tabId] || 1;
    document.getElementById('table-' + tabId).classList.remove('hidden');
    updateAddButton();
    const dateFilter = document.getElementById('db-date-filters');
    dateFilter.classList.toggle('active', tabId === 'logs' || tabId === 'notifications' || tabId === 'reports' || tabId === 'complaints');
    document.getElementById('db-category-filter').classList.toggle('hidden', tabId !== 'reports' && tabId !== 'complaints');
    const search = document.getElementById('db-record-search');
    search.placeholder = `Search ${tabId === 'accounts' ? 'users' : tabId.replace(/-/g, ' ')}...`;
    renderRecordCards(tabId, recordColumns[tabId] || [], recordSets[tabId] || [], recordActions[tabId]);
}
function updateAddButton() {
    const labels = {
        accounts: 'Add New Account',
        'farm-registry': 'Register Farm',
        catalog: 'Add Catalog Product',
        batches: 'Create Batch',
        harvests: 'Add Harvest',
        shipments: 'Record Shipment'
    };
    const button = document.getElementById('add-btn');
    const label = labels[activeTab];
    button.style.display = label ? '' : 'none';
    document.getElementById('add-btn-label').textContent = label || '';
}
let reportDateRequest = null;
let reportDateButton = null;
function setReportButtonLoading(button, loading, message = 'Generating...') {
    if (!button) return;
    if (loading) {
        if (button.dataset.reportLoading === 'true') return;
        button.dataset.reportLoading = 'true';
        button.dataset.reportOriginalHtml = button.innerHTML;
        button.dataset.reportWasDisabled = button.disabled ? 'true' : 'false';
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.innerHTML = `<span class="report-button-spinner" aria-hidden="true"></span>${message}`;
        return;
    }
    if (button.dataset.reportLoading !== 'true') return;
    button.innerHTML = button.dataset.reportOriginalHtml || '';
    button.disabled = button.dataset.reportWasDisabled === 'true';
    button.removeAttribute('aria-busy');
    delete button.dataset.reportLoading;
}
function closeReportDateDialog() {
    reportDateRequest = null;
    reportDateButton = null;
    document.getElementById('report-date-modal').classList.remove('active');
}
function askReportDates(callback, button) {
    reportDateRequest = callback;
    reportDateButton = button || null;
    document.getElementById('report-date-from').value = '';
    document.getElementById('report-date-to').value = '';
    document.getElementById('report-date-modal').classList.add('active');
    document.getElementById('report-date-from').focus();
}
document.getElementById('report-date-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const from = document.getElementById('report-date-from').value;
    const to = document.getElementById('report-date-to').value;
    if (from && to && from > to) {
        toast('The report start date cannot be after the end date.', 'error');
        return;
    }
    const callback = reportDateRequest;
    const button = reportDateButton;
    closeReportDateDialog();
    setReportButtonLoading(button, true);
    if (callback) callback(from, to);
});
function reportRowDate(row) {
    return String(row.created_at || row.harvest_date || row.paid_at || row.date || '').slice(0, 10);
}
function downloadTableAsCSV(tableId, filename) {
    const button = document.activeElement;
    askReportDates((fromDate, toDate) => exportTableAsCSV(tableId, filename, fromDate, toDate, button), button);
}
function exportTableAsCSV(tableId, filename, fromDate, toDate, button) {
    button = reportDateButton || button;
    setReportButtonLoading(button, true, 'Preparing CSV...');
    const table = document.querySelector('#' + tableId + ' table');
    const key = tableId.replace(/^table-/, '') === 'users' ? 'accounts' : tableId.replace(/^table-/, '');
    const rows = recordSets[key] || [];
    const columns = recordColumns[key] || [];
    if (!table && !columns.length) {
        setReportButtonLoading(button, false);
        toast('No data is available to export.', 'error');
        return;
    }
    const filteredRows = rows.filter((row) => {
        if (!fromDate && !toDate) return true;
        const date = reportRowDate(row);
        return date && (!fromDate || date >= fromDate) && (!toDate || date <= toDate);
    });
    const quote = (value) => `"${String(value ?? '').replace(/[\r\n]+/g, ' ').trim().replace(/"/g, '""')}"`;
    const lines = [
        columns.map((column) => quote(column.label)).join(','),
        ...filteredRows.map((row) => columns.map((column) => quote(row[column.field])).join(','))
    ];
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename + '.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setReportButtonLoading(button, false);
}
async function downloadReportAsPDF(reportKey, filename) {
    const button = document.activeElement;
    if (reportKey === 'introduction-letter') {
        await downloadReportAsPDFForDates(reportKey, filename, '', '', button);
        return;
    }
    askReportDates((fromDate, toDate) => downloadReportAsPDFForDates(reportKey, filename, fromDate, toDate, button), button);
}
async function downloadReportAsPDFForDates(reportKey, filename, fromDate, toDate, button) {
    button = reportDateButton || button;
    setReportButtonLoading(button, true, 'Generating PDF...');
    try {
        const query = new URLSearchParams();
        if (fromDate) query.set('start_date', fromDate);
        if (toDate) query.set('end_date', toDate);
        const endpoint = `${API_BASE}/admin/reports/${encodeURIComponent(reportKey)}/pdf${query.toString() ? '?' + query.toString() : ''}`;
        const request = () => fetch(endpoint, {
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
        link.download = `${filename}${fromDate || toDate ? '_' + (fromDate || 'beginning') + '_to_' + (toDate || 'present') : ''}.pdf`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    } catch (error) {
        toast(error.message, 'error');
    } finally {
        setReportButtonLoading(button, false);
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
            const suffix = key === 'introduction-letter' ? '' : '_Report';
            downloadReportAsPDF(key, `AgriTrace_${name}${suffix}`);
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
    onPageTeardown(() => {
        window.clearInterval(refreshTimer);
        refreshTimer = null;
    });
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
            case 'view': openRecordDetails(b.dataset.section, Number(b.dataset.index)); break;
            case 'edit': editAccount(id); break;
            case 'delete': deleteAccount(id); break;
            case 'review-post-report': reviewPostReport(id); break;
            case 'remove-reported-post': reviewReportedPost(id, 'remove'); break;
            case 'dismiss-post-report': reviewReportedPost(id, 'dismiss'); break;
            case 'resolve': resolveReport(id); break;
            case 'resolve-complaint': resolveComplaint(id); break;
            case 'generate-qr': generateQr(id); break;
            case 'approve-harvest': approveHarvest(id); break;
            case 'edit-traceability': activeTab = b.dataset.resource; openSelectedAddForm(id); break;
            case 'verify-user': setFarmerVerification(id, b.dataset.verified === 'true'); break;
            case 'review-farmer-application': reviewFarmerApplication(id, b.dataset.status); break;
        }
    });
    listen(document.querySelector('.db-section-nav'), 'click', (event) => {
        const button = event.target.closest('[data-tab]');
        if (button) switchTab(button.dataset.tab, button);
    });
    listen(document.getElementById('db-record-search'), 'input', () => {
        recordPages[activeTab] = 1;
        renderRecordCards(activeTab, recordColumns[activeTab] || [], recordSets[activeTab] || [], recordActions[activeTab]);
    });
    ['db-date-from', 'db-date-to'].forEach((id) => listen(document.getElementById(id), 'change', () => {
        recordPages[activeTab] = 1;
        renderRecordCards(activeTab, recordColumns[activeTab] || [], recordSets[activeTab] || [], recordActions[activeTab]);
    }));
    listen(document.getElementById('db-review-category'), 'change', () => {
        recordPages[activeTab] = 1;
        renderRecordCards(activeTab, recordColumns[activeTab] || [], recordSets[activeTab] || [], recordActions[activeTab]);
    });
    listen(document, 'visibilitychange', () => {
        if (!document.hidden) loadAll(true);
    });
    listen(window, 'online', () => loadAll(true));
    document.getElementById('cloud-files').addEventListener('click', (event) => {
        const button = event.target.closest('[data-cloud-action]');
        if (!button) return;
        const bucket = button.dataset.cloudBucket || 'media';
        if (button.dataset.cloudAction === 'open') openCloudFile(button.dataset.cloudUrl, button.dataset.cloudPath, bucket);
        if (button.dataset.cloudAction === 'delete') deleteCloudFile(button.dataset.cloudPath);
    });
    document.getElementById('cloud-backups').addEventListener('click', (event) => {
        const button = event.target.closest('[data-backup-path]');
        if (button) openBackupFile(button.dataset.backupPath);
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
    refreshTimer = window.setInterval(() => {
        if (!document.hidden) loadAll(true);
    }, REFRESH_INTERVAL_MS);
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
