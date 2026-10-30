/* Public product trace (trace.html?code=AGT-...). No sign-in required. */
function traceRow(label, value) {
    return `<div class="trace-row"><span>${escapeHtml(label)}</span><span>${value}</span></div>`;
}
function formatDate(value) {
    return value ? new Date(String(value).replace(' ', 'T')).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

async function initPage() {
    const code = new URLSearchParams(location.search).get('code') || '';
    const box = document.getElementById('trace-content');
    if (!/^AGT-[A-F0-9]{10}$/i.test(code)) {
        box.innerHTML = `<div class="trace-card"><h3>Trace code</h3><p>Enter or scan a valid AgriTrace trace code.</p></div>`;
        return;
    }
    try {
        const t = await api(`/trace/${encodeURIComponent(code.toUpperCase())}`, { auth: false });
        const hasMap = t.farmer.latitude !== null && t.farmer.longitude !== null;
        box.innerHTML = `
            <div class="trace-card">
                <h3>Verification</h3>
                ${t.verified
                    ? '<p class="verified"><i class="fa-solid fa-circle-check"></i> Payment confirmed. This product is part of a paid AgriTrace order.</p>'
                    : '<p class="unverified"><i class="fa-solid fa-clock"></i> This trace code exists, but its payment is not confirmed yet.</p>'}
                <div class="trace-row" style="margin-top: 10px;"><span>Trace code</span><span style="font-family: monospace;">${escapeHtml(t.trace_code)}</span></div>
            </div>
            <div class="trace-card">
                <h3>Product</h3>
                ${traceRow('Name', escapeHtml(t.product.name))}
                ${traceRow('Category', escapeHtml(t.product.category || '—'))}
                ${traceRow('Quantity', `${escapeHtml(String(t.product.quantity))} ${escapeHtml(t.product.unit)}`)}
                ${traceRow('Unit price', money(t.product.unit_price))}
            </div>
            <div class="trace-card">
                <h3>Farmer</h3>
                ${traceRow('Name', escapeHtml(t.farmer.name))}
                ${traceRow('Location', escapeHtml(t.farmer.location || 'Not set'))}
                ${hasMap ? '<div id="trace-map" style="height: 220px; border-radius: 10px; margin-top: 12px;"></div>' : ''}
            </div>
            <div class="trace-card">
                <h3>Order</h3>
                ${traceRow('Ordered by', escapeHtml(t.buyer.name))}
                ${traceRow('Order number', `#${escapeHtml(String(t.order.order_id))}`)}
                ${traceRow('Ordered on', formatDate(t.order.ordered_at))}
                ${traceRow('Paid on', formatDate(t.order.paid_at))}
            </div>
            ${t.qr_url ? `<div class="trace-card" style="text-align: center;"><h3>QR code</h3><img src="${escapeHtml(t.qr_url)}" alt="QR code" style="width: 180px; height: 180px; background: #fff; border-radius: 10px; padding: 8px;"></div>` : ''}`;
        if (hasMap) {
            try {
                const { map, L } = await createMap('trace-map', t.farmer.latitude, t.farmer.longitude, 13);
                L.marker([t.farmer.latitude, t.farmer.longitude]).addTo(map).bindPopup(escapeHtml(t.farmer.name));
            } catch (error) { /* the map is optional on this page */ }
        }
    } catch (error) {
        box.innerHTML = `<div class="trace-card"><h3>Trace code</h3><p>${escapeHtml(error.message)}</p></div>`;
    }
}
