/* Public product trace (trace.html?code=AGT-...). No sign-in required. */
function traceRow(label, value) {
    return `<div class="trace-row"><span>${escapeHtml(label)}</span><span>${value}</span></div>`;
}
function formatDate(value) {
    return value ? new Date(String(value).replace(' ', 'T')).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

async function initPage() {
    const params = new URLSearchParams(location.search);
    const batchCode = params.get('batch') || '';
    const code = params.get('code') || '';
    const box = document.getElementById('trace-content');
    if (batchCode && !/^[A-Z0-9][A-Z0-9._-]{0,49}$/i.test(batchCode)) {
        box.innerHTML = `<div class="trace-card"><h3>Batch code</h3><p>Enter or scan a valid AgriTrace batch code.</p></div>`;
        return;
    }
    if (!batchCode && !/^AGT-[A-F0-9]{10}$/i.test(code)) {
        box.innerHTML = `<div class="trace-card"><h3>Trace code</h3><p>Enter or scan a valid AgriTrace trace code.</p></div>`;
        return;
    }
    try {
        const t = batchCode
            ? await api(`/trace/batch/${encodeURIComponent(batchCode)}`, { auth: false })
            : await api(`/trace/${encodeURIComponent(code.toUpperCase())}`, { auth: false });
        const harvestRows = (t.harvest || []).length
            ? t.harvest.map((record) => `
                <div class="trace-row"><span>${formatDate(record.harvest_date)}</span><span>${escapeHtml(record.quality_grade || 'Grade not recorded')}</span></div>
                ${record.expiration_date ? `<div class="trace-row"><span>Expires</span><span>${escapeHtml(record.expiration_date)}</span></div>` : ''}
                ${record.notes ? `<p style="color: var(--text-muted); padding: 4px 0 10px;">${escapeHtml(record.notes)}</p>` : ''}`).join('')
            : '<p style="color: var(--text-muted);">No approved harvest records are available.</p>';
        const supplyRows = (t.supply_chain || []).length
            ? t.supply_chain.map((event) => `
                <div class="trace-row"><span>${escapeHtml(event.event || event.type || 'Supply-chain update')}</span><span>${formatDate(event.date)}</span></div>
                ${event.location ? `<div class="trace-row"><span>Location</span><span>${escapeHtml(event.location)}</span></div>` : ''}
                ${event.remarks ? `<p style="color: var(--text-muted); padding: 4px 0 10px;">${escapeHtml(event.remarks)}</p>` : ''}`).join('')
            : '<p style="color: var(--text-muted);">No movement events have been recorded yet.</p>';
        box.innerHTML = `
            <div class="trace-card">
                <h3>Payment</h3>
                ${t.verified
                    ? '<p class="verified"><i class="fa-solid fa-circle-check"></i> Payment confirmed. This product is part of a paid AgriTrace order.</p>'
                    : t.trace_code
                        ? '<p class="unverified"><i class="fa-solid fa-clock"></i> This trace code exists, but its payment is not confirmed yet.</p>'
                        : '<p class="unverified"><i class="fa-solid fa-clock"></i> No paid order is linked to this batch.</p>'}
                ${t.provenance_verified ? '<p class="verified" style="margin-top: 8px;"><i class="fa-solid fa-seedling"></i> Provenance verified</p>' : ''}
                <div class="trace-row" style="margin-top: 10px;"><span>${batchCode ? 'Batch code' : 'Trace code'}</span><span style="font-family: monospace;">${escapeHtml(batchCode || t.trace_code)}</span></div>
            </div>
            <div class="trace-card">
                <h3>Product</h3>
                ${traceRow('Name', escapeHtml(t.product.name))}
                ${traceRow('Category', escapeHtml(t.product.category || '—'))}
                ${traceRow('Quantity', `${escapeHtml(String(t.product.quantity))} ${escapeHtml(t.product.unit)}`)}
                ${t.product.unit_price !== undefined ? traceRow('Unit price', money(t.product.unit_price)) : ''}
                ${t.batch ? traceRow('Batch status', escapeHtml(t.batch.status)) : ''}
                ${t.batch && t.batch.harvest_date ? traceRow('Harvest date', escapeHtml(t.batch.harvest_date)) : ''}
                ${t.batch && t.batch.expiration_date ? traceRow('Expiration date', escapeHtml(t.batch.expiration_date)) : ''}
            </div>
            <div class="trace-card">
                <h3>Origin</h3>
                ${traceRow('Farmer', escapeHtml(t.farmer.name))}
                ${t.farmer.registered_farm ? traceRow('Registered farm', escapeHtml(t.farmer.registered_farm)) : ''}
                ${traceRow('General location', escapeHtml(t.farmer.location || 'Not set'))}
            </div>
            <div class="trace-card"><h3>Harvest</h3>${harvestRows}</div>
            <div class="trace-card"><h3>Supply Chain</h3>${supplyRows}</div>
            ${t.order ? `<div class="trace-card">
                <h3>Order</h3>
                ${traceRow('Ordered by', escapeHtml(t.buyer.name))}
                ${traceRow('Order number', `#${escapeHtml(String(t.order.order_id))}`)}
                ${traceRow('Ordered on', formatDate(t.order.ordered_at))}
                ${traceRow('Paid on', formatDate(t.order.paid_at))}
            </div>` : ''}
            ${t.qr_url || t.order && ['ready_for_shipment', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'completed'].includes(t.order.status)
                ? `<div class="trace-card" style="text-align: center;"><h3>QR code</h3><img id="public-trace-qr" ${t.qr_url ? `src="${escapeHtml(t.qr_url)}"` : ''} alt="QR code" style="width: 180px; height: 180px; background: #fff; border-radius: 10px; padding: 8px;"></div>`
                : '<div class="trace-card"><h3>QR code</h3><p>The farmer will generate the QR code when the order is prepared.</p></div>'}`;
        if (document.getElementById('public-trace-qr')) {
            const traceUrl = new URL('/trace', location.origin);
            if (batchCode) {
                traceUrl.searchParams.set('batch', batchCode);
            } else {
                traceUrl.searchParams.set('code', t.trace_code || code.toUpperCase());
            }
            const qrImage = document.getElementById('public-trace-qr');
            const generateFallbackQr = async () => {
                qrImage.onerror = null;
                qrImage.src = await window.generateQrCode(traceUrl.href);
            };
            qrImage.onerror = () => generateFallbackQr().catch((error) => {
                qrImage.alt = `QR code could not be generated: ${error.message}`;
            });
            if (!t.qr_url) {
                qrImage.src = await window.generateQrCode(traceUrl.href);
            }
        }
    } catch (error) {
        box.innerHTML = `<div class="trace-card"><h3>Trace code</h3><p>${escapeHtml(error.message)}</p></div>`;
    }
}
