/* =====================================================================
   Dashboard (dashboard.html): feed, marketplace, cart and checkout,
   farmers, messages, notifications, orders, saved items,
   analytics. Every list comes from the LavaLust API.
   ===================================================================== */

let me = null;
let currentView = 'feed';
let currentCategory = 'All';
let marketSort = 'newest';
let farmerFilter = 'All';
let searchTerm = '';
let viewBeforeSearch = 'feed';
let searchRequestSequence = 0;
let searchTimer = null;
let detailListingId = null;
let editingListingId = null;
let activeReviewListingId = null;
let activeSalesListingId = null;
let activeReportPostId = null;
let farmerApplicationLoaded = false;
let editPostPreviewUrls = [];
let activeContactId = null;
let activeContactDetails = null;
let activeContactUserIds = [];
let conversationRequestSequence = 0;
let editingPostId = null;
let messageFilter = 'all';
let paymentReturnPending = new URLSearchParams(location.search).get('payment') === 'return';
let paymentReturnOrderId = new URLSearchParams(location.search).get('order') || '';
let paymentReconciliation = null;
let paymentTraceRedirecting = false;
let state = { posts: [], listings: [], saved: new Set(), farmers: [], contacts: [], orders: [], notifications: [], traceability: null, searchResults: null };
const pendingUpload = { video: null, product: null };

/* ---------- cart (kept in this browser per account until checkout) ---------- */
function cartKey() { return 'cart:' + me.id; }
function getCart() {
    try { return JSON.parse(localStorage.getItem(cartKey()) || '[]'); } catch (e) { return []; }
}
function saveCart(cart) {
    localStorage.setItem(cartKey(), JSON.stringify(cart));
    updateCartUI();
}

/* ---------- product cards ---------- */
function listingById(id) {
    return state.listings.find((l) => String(l.listing_id) === String(id)) || null;
}
function publicFarmLocation(farm) {
    return [farm.municipality, farm.province].filter(Boolean).join(', ') || farm.location || 'Location not set';
}
function publicFarmLabel(farm) {
    return `${farm.farm_name || 'Registered farm'} · ${publicFarmLocation(farm)}`;
}
function productCardHTML(l) {
    const isDraft = !l.batch_id;
    const sellerOwnsListing = me && String(l.seller_id) === String(me.id);
    const image = mediaUrl(l.image_url, DEFAULT_PRODUCT_IMG);
    return `<div class="market-card product-item" data-category="${escapeHtml(l.category)}">
        <img src="${escapeHtml(image)}" onerror="this.onerror=null;this.src='${DEFAULT_PRODUCT_IMG}'" alt="${escapeHtml(l.product_name)}" data-view-image tabindex="0" role="button">
        <div class="market-card-info">
            <h4>${escapeHtml(l.product_name)}</h4>
            <div class="product-meta">
                <span><i class="fa-solid fa-tractor"></i> ${escapeHtml(l.username)}</span>
                <span class="distance-tag"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(publicFarmLabel(l))}</span>
            </div>
            ${isDraft ? '<p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 4px;">Not available yet</p>' : `<p style="font-size: 1.1rem; color: var(--primary); font-weight: bold; margin-bottom: 4px;">${money(l.price)} <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: normal;">/ ${escapeHtml(sellingUnitLabel(l))}</span></p>`}
            <p class="product-rating"><span class="review-stars" aria-label="${Number(l.average_rating || 0).toFixed(1)} out of 5 stars">${'★'.repeat(Math.round(Number(l.average_rating) || 0))}${'☆'.repeat(5 - Math.round(Number(l.average_rating) || 0))}</span> ${Number(l.average_rating || 0).toFixed(1)} · ${Number(l.review_count) || 0} reviews</p>
            ${!isDraft ? `<p style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 10px;">${Number(l.stock)} ${escapeHtml(sellingUnitLabel(l))} available${l.batch && l.batch.batch_code ? ` · Batch ${escapeHtml(l.batch.batch_code)}` : ''}</p>` : ''}
            <div style="display: flex; gap: 10px;">
                <button data-action="details" data-id="${escapeHtml(l.listing_id)}" style="background: var(--bg-hover); color: var(--text-main); border: 1px solid var(--border-color); flex: 1;">Details</button>
                <button data-action="details" data-id="${escapeHtml(l.listing_id)}" style="flex: 1;" ${isDraft && !sellerOwnsListing ? 'disabled' : ''}>${isDraft ? 'Not Available' : (sellerOwnsListing ? 'Your Product' : 'Choose unit')}</button>
            </div>
        </div>
    </div>`;
}
function matchesSearch(l) {
    return [l.product_name, l.username, l.category, l.farm_name, l.location].some((v) => String(v || '').toLowerCase().includes(searchTerm));
}

/* ---------- feed ---------- */
async function loadFeed() {
    try {
        const data = await api('/posts');
        state.posts = data.data || [];
    } catch (error) {
        toast(error.message, 'error');
    }
    renderFeed();
}
function postAuthor(p) {
    const name = [p.first_name, p.last_name].filter(Boolean).join(' ');
    return name || p.username;
}
function postMediaItems(p) {
    if (!p.media_url) return [];
    try {
        const parsed = JSON.parse(p.media_url);
        if (Array.isArray(parsed)) return parsed.filter((item) => item && item.url);
    } catch (error) { /* legacy single URL */ }
    return [{ url: p.media_url, type: p.media_type || 'image' }];
}
function postCardHTML(p) {
    const isProduct = p.post_type === 'product';
    const mine = String(p.author_id) === String(me.id);
    const mediaItems = postMediaItems(p);
    const media = mediaItems.length
        ? `<div class="post-media-gallery">${mediaItems.map((item) => {
            const image = mediaUrl(item.url, DEFAULT_PRODUCT_IMG);
            return item.type === 'video'
                ? `<video controls preload="metadata" src="${escapeHtml(image)}" class="post-image"></video>`
                : `<img src="${escapeHtml(image)}" onerror="this.onerror=null;this.src='${DEFAULT_PRODUCT_IMG}'" alt="Post media" class="post-image" data-view-image tabindex="0" role="button">`;
        }).join('')}</div>`
        : '';
    const product = isProduct && p.product_name
        ? `<div class="product-chip">
            <div><strong>${escapeHtml(p.product_name)}</strong><p>${money(p.price)} / ${escapeHtml(SELLING_UNIT_LABELS[p.unit] || p.unit || 'unit')} • ${escapeHtml(p.category || '')}${p.batch_code ? ` • Batch ${escapeHtml(p.batch_code)}` : ''}</p>
                <p>${p.batch_expired ? 'Expired' : (Number(p.stock) > 0 ? `${Number(p.stock)} ${escapeHtml(SELLING_UNIT_LABELS[p.unit] || p.unit || 'unit')} available` : 'Sold out')}</p></div>
            <div class="product-chip-actions">
                <span class="review-stars" aria-label="${Number(p.average_rating || 0).toFixed(1)} out of 5 stars">${'★'.repeat(Math.round(Number(p.average_rating) || 0))}${'☆'.repeat(5 - Math.round(Number(p.average_rating) || 0))}</span>
                <span>${Number(p.average_rating || 0).toFixed(1)} (${Number(p.review_count) || 0})</span>
                ${p.listing_id ? `<button type="button" class="btn-muted" data-action="details" data-id="${escapeHtml(p.listing_id)}">View details</button>` : ''}
            </div>
        </div>`
        : '';
    const comments = (p.comments || []).map((c) => `
        <div class="comment">
            <img src="${escapeHtml(mediaUrl(c.profile_pic, DEFAULT_AVATAR))}" alt="${escapeHtml([c.first_name, c.last_name].filter(Boolean).join(' ') || c.username)}">
            <div class="comment-bubble"><h5>${escapeHtml([c.first_name, c.last_name].filter(Boolean).join(' ') || c.username)}</h5><p>${escapeHtml(c.content)}</p></div>
        </div>`).join('');
    return `<div class="post" data-post-id="${escapeHtml(p.post_id)}">
        <div class="post-header">
            <div class="post-user">
                <img src="${escapeHtml(mediaUrl(p.profile_pic, DEFAULT_AVATAR))}" alt="${escapeHtml(postAuthor(p))}">
                <div class="post-user-info">
                    <h4>${escapeHtml(postAuthor(p))} <span class="post-role">${escapeHtml(roleLabel(p.role))}</span> ${p.role === 'farmer' && Number(p.is_verified) === 1 ? '<i class="fa-solid fa-circle-check verified-badge" title="Verified farmer" style="color: var(--primary); font-size: 0.8rem;"></i>' : ''}</h4>
                    <span title="${escapeHtml(formatDateTime(p.created_at))}">${isProduct ? 'Listed a product' : 'Shared a post'} • ${escapeHtml(formatDateTime(p.created_at))} (${timeAgo(p.created_at)})</span>
                </div>
            </div>
        </div>
        <div class="post-content"><p>${escapeHtml(p.content)}</p></div>
        ${media}${product}
        <div class="post-stats">
            <span class="like-count"><i class="fa-solid fa-heart" style="color: var(--danger);"></i> ${Number(p.likes) || 0}</span>
            <span class="comments-count">${Number(p.comment_count) || 0} comment${Number(p.comment_count) === 1 ? '' : 's'}</span>
        </div>
        <div class="post-footer">
            <button class="like-btn ${p.liked_by_me ? 'liked' : ''}" data-action="like" data-id="${escapeHtml(p.post_id)}"><i class="fa-${p.liked_by_me ? 'solid' : 'regular'} fa-heart"></i> Like</button>
            <button data-action="toggle-comments"><i class="fa-regular fa-comment"></i> Comment</button>
            <button data-action="share" data-id="${escapeHtml(p.post_id)}"><i class="fa-solid fa-share"></i> Share</button>
            ${mine ? `<button data-action="edit-post" data-id="${escapeHtml(p.post_id)}"><i class="fa-solid fa-pen"></i> Edit</button>` : ''}
            ${!mine && me.role !== 'admin' ? `<button data-action="report-post" data-id="${escapeHtml(p.post_id)}"><i class="fa-solid fa-flag"></i> Report</button>` : ''}
            ${mine ? `<button data-action="delete-post" data-id="${escapeHtml(p.post_id)}"><i class="fa-solid fa-trash"></i> Delete</button>` : ''}
            ${isProduct && p.listing_id ? `<button data-action="review-product" data-id="${escapeHtml(p.listing_id)}" data-name="${escapeHtml(p.product_name)}"><i class="fa-solid fa-star"></i> Reviews &amp; Ratings</button>` : ''}
        </div>
        <div class="comments-section hidden">
            <div class="comments-list">${comments}</div>
            <div class="comment-input">
                <input type="text" placeholder="Write a comment..." data-enter-action="comment" data-id="${escapeHtml(p.post_id)}">
                <button class="btn-primary" data-action="comment" data-id="${escapeHtml(p.post_id)}">Post</button>
            </div>
        </div>
    </div>`;
}
function renderFeed() {
    const box = document.getElementById('feed-list');
    box.innerHTML = state.posts.length
        ? state.posts.map(postCardHTML).join('')
        : emptyBlock('fa-newspaper', 'No posts yet', 'Share something with the community to get started.');
}
function openPostReport(id) {
    const post = state.posts.find((item) => String(item.post_id) === String(id));
    if (!post || String(post.author_id) === String(me.id)) {
        toast('You cannot report your own post.', 'error');
        return;
    }
    activeReportPostId = String(id);
    document.getElementById('report-post-summary').textContent = `Post by ${postAuthor(post)} · ${post.content}`;
    document.getElementById('report-post-reason').value = '';
    openModal('report-post-modal');
    document.getElementById('report-post-reason').focus();
}
async function submitPostReport(event) {
    event.preventDefault();
    const button = document.getElementById('report-post-submit');
    const reason = document.getElementById('report-post-reason').value.trim();
    if (!activeReportPostId || !reason) return;
    button.disabled = true;
    try {
        const result = await api(`/posts/${encodeURIComponent(activeReportPostId)}/reports`, {
            method: 'POST',
            body: { reason }
        });
        closeModal('report-post-modal');
        toast(result.message || 'Your report was sent to the administrator.');
    } catch (error) {
        toast(error.message, 'error');
    } finally {
        button.disabled = false;
        activeReportPostId = null;
    }
}
function openEditPost(id) {
    const post = state.posts.find((item) => String(item.post_id) === String(id));
    if (!post || String(post.author_id) !== String(me.id)) {
        toast('You can only edit your own posts.', 'error');
        return;
    }
    editingPostId = id;
    document.getElementById('edit-post-avatar').src = avatarOf(me);
    document.getElementById('edit-post-name').textContent = displayName(me);
    document.getElementById('edit-post-text').value = post.content || '';
    const isProduct = post.post_type === 'product';
    const filesInput = document.getElementById('edit-post-files');
    filesInput.value = '';
    filesInput.accept = isProduct ? 'image/*' : 'image/*,video/mp4,video/webm,video/quicktime';
    filesInput.multiple = !isProduct;
    document.getElementById('edit-post-files-label').textContent = isProduct
        ? 'Replace product image'
        : 'Replace post photos or video';
    document.getElementById('edit-post-files-help').textContent = isProduct
        ? 'Choose one image, 8 MB or smaller. It will replace the product image on the marketplace and post.'
        : 'Choose up to 5 files, each 8 MB or smaller. Choosing files replaces the current attachments.';
    document.getElementById('edit-post-remove-label').textContent = isProduct
        ? 'Remove product image'
        : 'Remove current attachments';
    document.getElementById('edit-post-remove-media').checked = false;
    document.getElementById('edit-post-media-preview').innerHTML = renderEditPostMedia(post);
    openModal('edit-post-modal');
    document.getElementById('edit-post-text').focus();
}
function renderEditPostMedia(post) {
    const items = postMediaItems(post);
    if (!items.length && post.post_type === 'product' && post.product_image) {
        items.push({ url: post.product_image, type: 'image' });
    }
    return items.length
        ? `<div class="post-media-gallery">${items.map((item) => {
            const url = escapeHtml(mediaUrl(item.url, DEFAULT_PRODUCT_IMG));
            return item.type === 'video'
                ? `<video controls preload="metadata" src="${url}" class="post-image"></video>`
                : `<img src="${url}" alt="Current post image" class="post-image">`;
        }).join('')}</div>`
        : '<p class="field-help">No attachments on this post.</p>';
}
function previewEditPostFiles(event) {
    editPostPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
    editPostPreviewUrls = [];
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    const preview = document.getElementById('edit-post-media-preview');
    preview.replaceChildren();
    files.forEach((file) => {
        const url = URL.createObjectURL(file);
        editPostPreviewUrls.push(url);
        const media = file.type.startsWith('video/') ? document.createElement('video') : document.createElement('img');
        media.src = url;
        media.className = 'post-image';
        if (media.tagName === 'VIDEO') {
            media.controls = true;
            media.preload = 'metadata';
        } else {
            media.alt = 'Selected replacement image';
        }
        preview.appendChild(media);
    });
}
async function submitEditPost() {
    const content = document.getElementById('edit-post-text').value.trim();
    const button = document.getElementById('edit-post-submit');
    const post = state.posts.find((item) => String(item.post_id) === String(editingPostId));
    const files = Array.from(document.getElementById('edit-post-files').files || []);
    const removeMedia = document.getElementById('edit-post-remove-media').checked;
    if (!editingPostId || !content) {
        toast('Post content cannot be empty.', 'error');
        return;
    }
    if (files.length > (post && post.post_type === 'product' ? 1 : 5)) {
        toast(post && post.post_type === 'product' ? 'Choose one product image.' : 'Choose no more than 5 attachments.', 'error');
        return;
    }
    if (files.some((file) => file.size > MAX_MEDIA_BYTES)) {
        toast('Each attachment must be 8 MB or smaller.', 'error');
        return;
    }
    if (post && post.post_type === 'product' && files.some((file) => !file.type.startsWith('image/'))) {
        toast('Product posts can only use image attachments.', 'error');
        return;
    }
    button.disabled = true;
    try {
        const body = { content };
        if (files.length) {
            const attachments = await Promise.all(files.map(async (file) => {
                const uploaded = await uploadMedia(file, 'community');
                return { url: uploaded.url, type: uploaded.type };
            }));
            body.media_url = attachments.length === 1
                ? attachments[0].url
                : JSON.stringify(attachments);
            body.media_type = attachments.length === 1 ? attachments[0].type : 'image-gallery';
        } else if (removeMedia) {
            body.media_url = '';
            body.media_type = '';
        }
        await api(`/posts/${editingPostId}`, { method: 'PUT', body });
        closeModal('edit-post-modal');
        editingPostId = null;
        await Promise.all([loadFeed(), loadMarketplace()]);
        toast('Post updated successfully.');
    } catch (error) {
        toast(error.message, 'error');
    } finally {
        button.disabled = false;
    }
}
async function likePost(id) {
    try {
        const result = await api(`/posts/${id}/like`, { method: 'POST' });
        const post = state.posts.find((item) => String(item.post_id) === String(id));
        if (post) {
            post.liked_by_me = Boolean(result.liked);
            post.likes = Number(result.likes) || 0;
            renderFeed();
        }
    } catch (error) { toast(error.message, 'error'); }
}
async function commentOn(id, input) {
    const text = input.value.trim();
    if (!text) return;
    try {
        await api(`/posts/${id}/comments`, { method: 'POST', body: { content: text } });
        await loadFeed();
        toast('Comment posted!');
    } catch (error) { toast(error.message, 'error'); }
}
async function withdrawPost(id) {
    if (!confirm('Delete this published post?')) return;
    await removePost(id, false);
}
async function removeEditingPost() {
    if (editingPostId === null) return;
    if (!confirm('Remove this post permanently? This cannot be undone.')) return;
    await removePost(editingPostId, true);
}
async function removePost(id, closeEditModal) {
    const removeButton = document.getElementById('edit-post-remove');
    const saveButton = document.getElementById('edit-post-submit');
    if (closeEditModal && removeButton && saveButton) {
        removeButton.disabled = true;
        saveButton.disabled = true;
    }
    try {
        await api(`/posts/${id}`, { method: 'DELETE' });
        if (closeEditModal) {
            closeModal('edit-post-modal');
            editingPostId = null;
        }
        await Promise.all([loadFeed(), loadMarketplace()]);
        toast(closeEditModal ? 'Post removed.' : 'Post withdrawn.', 'info');
    } catch (error) {
        toast(error.message, 'error');
    } finally {
        if (closeEditModal && removeButton && saveButton) {
            removeButton.disabled = false;
            saveButton.disabled = false;
        }
    }
}
function sharePost(id) {
    const url = location.origin + '/dashboard#post-' + id;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => toast('Post link copied to clipboard.'), () => toast('Share link: ' + url, 'info'));
    } else {
        toast('Share link: ' + url, 'info');
    }
}

/* ---------- create post / sell product ---------- */
function openPostModal() {
    if (!me || !['admin', 'farmer', 'collector'].includes(me.role)) {
        toast('Only farmers, buyers, and administrators can create posts.', 'error');
        return;
    }
    const canListProducts = me.role === 'farmer';
    document.querySelector('.post-tab[data-tab="product"]').classList.toggle('hidden', !canListProducts);
    document.getElementById('post-permission-note').textContent = me.role === 'admin'
        ? 'Administrator posts are published immediately.'
        : me.role === 'farmer'
            ? 'Your posts and product listings are published immediately and visible to the community.'
            : 'Buyers can share text and photo/video posts. Product listings are for farmers only.';
    document.querySelector('.post-tab[data-tab="text"]').click();
    document.getElementById('post-modal-name').textContent = displayName(me);
    document.getElementById('post-modal-avatar').src = avatarOf(me);
    loadProductFarmOptions();
    openModal('post-modal');
}
async function loadProductFarmOptions() {
    if (me.role !== 'farmer') return;
    await loadFarmOptionsInto('product-farm');
}
async function loadFarmOptionsInto(selectId, selectedFarmId = '') {
    const farmSelect = document.getElementById(selectId);
    if (!farmSelect || me.role !== 'farmer') return;
    try {
        if (!state.traceability) {
            const result = await api('/farmer/traceability');
            state.traceability = result.data;
        }
        const farms = state.traceability.farms || [];
        farmSelect.innerHTML = '<option value="">Select your registered farm</option>' + farms.map((farm) =>
            `<option value="${escapeHtml(farm.farm_id)}">${escapeHtml(farm.farm_name)} · ${escapeHtml([farm.municipality, farm.province].filter(Boolean).join(', ') || 'Location not set')}</option>`
        ).join('');
        if (selectedFarmId) farmSelect.value = String(selectedFarmId);
        if (!farms.length) {
            farmSelect.innerHTML = '<option value="">Register a farm in My Traceability first</option>';
        }
    } catch (error) {
        farmSelect.innerHTML = '<option value="">Farm records unavailable</option>';
        toast(error.message, 'error');
    }
}
async function suggestCatalogEntries(value) {
    const select = document.getElementById('product-catalog');
    const match = document.getElementById('catalog-match');
    if (!select || !match || value.trim().length < 2) return;
    try {
        const result = await api(`/catalog/search?name=${encodeURIComponent(value.trim())}`);
        const entries = result.data || [];
        select.innerHTML = '<option value="">Choose a catalog match or submit as new</option>' + entries.map((entry) =>
            `<option value="${escapeHtml(entry.product_id)}">${escapeHtml(entry.product_name)}${entry.match_type === 'alias' ? ' · alias match' : ''}</option>`
        ).join('');
        match.classList.toggle('visible', entries.length > 0);
        match.textContent = entries.length ? `Possible match found: ${entries[0].product_name}. Select it to avoid a duplicate catalog entry.` : '';
    } catch (error) {
        match.classList.remove('visible');
    }
}
function switchPostTab(tab, btn) {
    if (tab === 'product' && (!me || me.role !== 'farmer')) {
        toast('Only farmers can save products for a harvest batch.', 'error');
        return;
    }
    document.querySelectorAll('.post-tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.post-input-area').forEach((a) => a.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('post-area-' + tab).classList.add('active');
}
function openFilePicker(type) { document.getElementById('file-input-' + type).click(); }
async function fileSelected(event, type) {
    const files = Array.from(event.target.files || []);
    const file = files[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_MEDIA_BYTES) { toast('File must be 8 MB or smaller.', 'error'); return; }
    pendingUpload[type] = type === 'product' ? files : file;
    document.getElementById(type + '-upload-label').textContent = type === 'product'
        ? `${files.length} photos selected`
        : 'Selected: ' + file.name;
}
function resetPostForm() {
    ['post-text', 'post-media-desc', 'product-name', 'product-description'].forEach((id) => {
        document.getElementById(id).value = '';
    });
    document.getElementById('product-farm').value = '';
    document.getElementById('product-category').value = CATEGORIES[0];
    pendingUpload.video = null;
    pendingUpload.product = [];
    document.getElementById('video-upload-label').textContent = 'Upload from Device';
    document.getElementById('product-upload-label').textContent = 'Add Photo';
    document.querySelector('.post-tab[data-tab="text"]').click();
}
async function submitPost() {
    const tab = document.querySelector('.post-tab.active').dataset.tab;
    const button = document.getElementById('post-submit');
    const val = (id) => document.getElementById(id).value.trim();
    if (!me || !['admin', 'farmer', 'collector'].includes(me.role)
        || tab === 'product' && me.role !== 'farmer') {
        toast('Your account is not allowed to publish this type of post.', 'error');
        return;
    }
    button.disabled = true;
    try {
        let message;
        if (tab === 'text') {
            const text = val('post-text');
            if (!text) throw new Error('Write something before posting.');
            const result = await api('/posts', { method: 'POST', body: { content: text, post_type: 'text' } });
            message = result.message;
        } else if (tab === 'video') {
            const file = pendingUpload.video;
            if (!file) throw new Error('Choose a photo or video first.');
            const uploaded = await uploadMedia(file);
            const result = await api('/posts', {
                method: 'POST',
                body: { content: val('post-media-desc') || `Shared a new ${uploaded.type}.`, post_type: 'media', media_url: uploaded.url, media_type: uploaded.type }
            });
            message = result.message;
        } else {
            const name = val('product-name');
            const farmId = Number(val('product-farm'));
            if (!name) throw new Error('Enter the product name.');
            if (me.role === 'farmer' && !(farmId > 0)) throw new Error('Select a registered farm before listing this product.');
            const productFile = (pendingUpload.product || [])[0];
            const uploaded = productFile ? await uploadMedia(productFile) : null;
            const result = await api('/marketplace', {
                method: 'POST',
                body: {
                    product_draft: true,
                    product_name: name,
                    category: val('product-category'),
                    farm_id: farmId,
                    description: val('product-description'),
                    image_url: uploaded ? uploaded.url : ''
                }
            });
            message = result.message;
        }
        resetPostForm();
        closeModal('post-modal');
        toast(message || 'Submitted.');
        await Promise.all([loadFeed(), loadMarketplace()]);
    } catch (error) {
        toast(error.message, 'error');
    } finally {
        button.disabled = false;
    }
}

/* ---------- marketplace ---------- */
async function loadMarketplace() {
    try {
        const [publicData, ownData] = await Promise.all([
            api('/marketplace'),
            api('/marketplace?mine=1')
        ]);
        const listings = new Map();
        [...(publicData.data || []), ...(ownData.data || [])].forEach((listing) => {
            listings.set(String(listing.listing_id), listing);
        });
        state.listings = [...listings.values()];
    } catch (error) { toast(error.message, 'error'); }
    renderMarketplace();
    renderRightWidgets();
    updateCartUI();
    renderFarmerProductListings();
}
function renderMarketplace() {
    let list;
    if (currentCategory === 'Not Available') {
        const ownDrafts = state.listings.filter((listing) =>
            me && String(listing.seller_id) === String(me.id) && !listing.batch_id && listing.catalog_id
        );
        const liveProducts = new Set(state.listings.filter(isListingBuyable).map(productGroupKey));
        list = ownDrafts.filter((listing) => !liveProducts.has(productGroupKey(listing)));
    } else {
        list = state.listings.filter(isListingBuyable);
        if (currentCategory !== 'All') list = list.filter((listing) => listing.category === currentCategory);
        const groups = new Map();
        list.forEach((listing) => {
            const key = productGroupKey(listing);
            if (!groups.has(key)) groups.set(key, listing);
        });
        list = [...groups.values()];
    }
    if (searchTerm) list = list.filter(matchesSearch);
    if (marketSort === 'price_asc') list = [...list].sort((a, b) => a.price - b.price);
    if (marketSort === 'price_desc') list = [...list].sort((a, b) => b.price - a.price);
    document.getElementById('marketplace-container').innerHTML = list.length
        ? list.map(productCardHTML).join('')
        : emptyBlock('fa-box-open', currentCategory === 'Not Available' ? 'No unavailable products' : 'No products found',
            currentCategory === 'Not Available' ? 'Products appear here after farmers post them but before a batch is configured.' : 'Only products with an active, unexpired batch appear here.');
}
function isListingBuyable(listing) {
    return Number(listing.is_available) === 1
        && Boolean(listing.batch_id)
        && Number(listing.stock) > 0
        && !listing.batch_expired
        && !['sold', 'rejected', 'expired'].includes(String(listing.batch_status || '').toLowerCase());
}
function productGroupKey(listing) {
    return `${listing.seller_id}:${listing.farm_id || ''}:${listing.catalog_id || listing.product_name}`;
}
function sellingUnitLabel(listing) {
    return listing && listing.selling_unit === 'other'
        ? (listing.unit || 'unit')
        : ((listing && SELLING_UNIT_LABELS[listing.selling_unit]) || (listing && listing.unit) || 'unit');
}
function rememberDashboardPosition() {
    const main = document.querySelector('.main-content');
    if (!main) return;
    sessionStorage.setItem('agritrace-dashboard-position', JSON.stringify({
        hash: location.hash,
        scrollTop: main.scrollTop
    }));
}
function navigateToProfile() {
    rememberDashboardPosition();
    location.href = '/profile';
}
function restoreDashboardPosition() {
    try {
        const saved = JSON.parse(sessionStorage.getItem('agritrace-dashboard-position') || 'null');
        if (!saved) return;
        if (!location.hash && saved.hash) {
            history.replaceState(history.state, '', '/dashboard' + saved.hash);
        }
        routeFromHash();
        const main = document.querySelector('.main-content');
        if (main && Number.isFinite(Number(saved.scrollTop))) {
            main.scrollTop = Number(saved.scrollTop);
        }
    } catch (error) {
        sessionStorage.removeItem('agritrace-dashboard-position');
    }
}
function filterMarket(category, btn) {
    document.querySelectorAll('#view-market .cat-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentCategory = category;
    renderMarketplace();
}
function sortProducts() {
    marketSort = document.getElementById('market-sort').value;
    renderMarketplace();
}
function productListingVariants(listing) {
    if (!listing) return [];
    const variants = state.listings.filter((candidate) => productGroupKey(candidate) === productGroupKey(listing)
        && isListingBuyable(candidate));
    return variants.length ? variants : [listing];
}
function viewProductDetails(id) {
    const l = listingById(id);
    if (!l) return;
    document.getElementById('detail-image').src = mediaUrl(l.image_url, DEFAULT_PRODUCT_IMG);
    document.getElementById('detail-image').alt = l.product_name;
    document.getElementById('detail-name').textContent = l.product_name;
    document.getElementById('detail-farmer').querySelector('span').textContent = l.username;
    document.getElementById('detail-distance').querySelector('span').textContent =
        publicFarmLabel(l);
    const batchPickerWrap = document.getElementById('detail-batch-picker-wrap');
    const batchPicker = document.getElementById('detail-batch-picker');
    const variants = productListingVariants(l);
    batchPicker.innerHTML = variants.map((variant) => {
        const unit = sellingUnitLabel(variant);
        return `<option value="${escapeHtml(variant.listing_id)}">${escapeHtml(unit)} · ${money(variant.price)} · ${Number(variant.stock)} available</option>`;
    }).join('');
    batchPickerWrap.classList.toggle('hidden', variants.length < 2);
    const selected = variants.find((variant) => String(variant.listing_id) === String(id)) || variants[0];
    batchPicker.value = String(selected.listing_id);
    updateProductDetailsVariant(selected.listing_id);
    openModal('product-details-modal');
}
function updateProductDetailsVariant(id) {
    const listing = listingById(id);
    if (!listing) return;
    detailListingId = String(listing.listing_id);
    document.getElementById('detail-price').textContent = listing.batch_id
        ? money(listing.price) + ' / ' + sellingUnitLabel(listing)
        : 'Create a batch to set price and availability.';
    document.getElementById('detail-rating').innerHTML = `<span class="review-stars" aria-label="${Number(listing.average_rating || 0).toFixed(1)} out of 5 stars">${'★'.repeat(Math.round(Number(listing.average_rating) || 0))}${'☆'.repeat(5 - Math.round(Number(listing.average_rating) || 0))}</span> ${Number(listing.average_rating || 0).toFixed(1)} (${Number(listing.review_count) || 0} reviews)`;
    document.getElementById('detail-desc').textContent = listing.batch_id
        ? `${listing.description || 'No description provided.'} (${listing.batch_expired ? 'Expired' : `Available stock: ${Number(listing.stock)} ${sellingUnitLabel(listing)}`})`
        : (listing.description || 'No description provided.');
    const quantity = document.getElementById('detail-quantity');
    quantity.max = String(Math.max(0, Number(listing.stock) || 0));
    if (Number(quantity.value) > Number(quantity.max) || Number(quantity.value) <= 0) quantity.value = '1';
    const saved = state.saved.has(String(listing.listing_id));
    document.getElementById('detail-save-btn').innerHTML = `<i class="fa-${saved ? 'solid' : 'regular'} fa-heart"></i> ${saved ? 'Saved' : 'Save'}`;
    const cartBtn = document.getElementById('detail-cart-btn');
    const unavailable = Number(listing.is_available) !== 1;
    const sellerOwnsListing = me && String(listing.seller_id) === String(me.id);
    cartBtn.disabled = !listing.batch_id || (!sellerOwnsListing && (Number(listing.stock) <= 0 || unavailable || listing.batch_expired));
    cartBtn.textContent = !listing.batch_id ? 'Not Available' : (sellerOwnsListing ? 'Your Product' : (listing.batch_expired ? 'Expired' : (Number(listing.stock) <= 0 ? 'Sold out' : (unavailable ? 'Unavailable' : 'Add to Cart'))));
    document.getElementById('detail-edit-product-btn').classList.toggle('hidden', !sellerOwnsListing);
}
async function openProductEdit(listingId) {
    const listing = listingById(listingId);
    if (!listing || String(listing.seller_id) !== String(me.id)) {
        toast('You can only edit your own product listings.', 'error');
        return;
    }
    editingListingId = String(listing.listing_id);
    document.getElementById('edit-product-name').value = listing.product_name || '';
    document.getElementById('edit-product-category').value = listing.category || CATEGORIES[0];
    document.getElementById('edit-product-description').value = listing.description || '';
    document.getElementById('edit-product-image').value = '';
    document.getElementById('edit-product-image-preview').src = mediaUrl(listing.image_url, DEFAULT_PRODUCT_IMG);
    closeModal('product-details-modal');
    openModal('edit-product-modal');
}
async function saveProductEdit() {
    const listing = listingById(editingListingId);
    const button = document.getElementById('edit-product-save');
    const imageFile = document.getElementById('edit-product-image').files[0];
    if (!listing || String(listing.seller_id) !== String(me.id)) {
        toast('You can only edit your own product listings.', 'error');
        return;
    }
    const productName = document.getElementById('edit-product-name').value.trim();
    const category = document.getElementById('edit-product-category').value.trim();
    if (!productName || !category) {
        toast('Enter a product name and category.', 'error');
        return;
    }
    button.disabled = true;
    try {
        let imageUrl = listing.image_url || '';
        if (imageFile) {
            if (!imageFile.type.startsWith('image/')) {
                throw new Error('Choose an image file for the product.');
            }
            imageUrl = (await uploadMedia(imageFile)).url;
        }
        await api(`/marketplace/${encodeURIComponent(editingListingId)}`, {
            method: 'PUT',
            body: {
                product_details_only: true,
                product_name: productName,
                category,
                description: document.getElementById('edit-product-description').value.trim(),
                image_url: imageUrl
            }
        });
        editingListingId = null;
        closeModal('edit-product-modal');
        await Promise.all([loadMarketplace(), loadFeed(), loadAnalytics()]);
        toast('Product updated successfully.');
    } catch (error) {
        toast(error.message, 'error');
    } finally {
        button.disabled = false;
    }
}
function handleDetailProductAction() {
    const listing = listingById(detailListingId);
    if (listing && me && String(listing.seller_id) === String(me.id)) {
        if (!listing.batch_id) {
            closeModal('product-details-modal');
            switchView('farmer-trace');
            return;
        }
        openSellerSales(detailListingId);
        return;
    }
    addToCartFromDetails();
}
async function openSellerSales(listingId) {
    activeSalesListingId = String(listingId);
    const listing = listingById(listingId);
    document.getElementById('product-sales-title').textContent = `${listing ? listing.product_name : 'Product'} sales`;
    document.getElementById('product-sales-content').textContent = 'Loading sales...';
    openModal('product-sales-modal');
    try {
        const data = await api(`/marketplace/${encodeURIComponent(listingId)}/sales`);
        if (String(activeSalesListingId) !== String(listingId)) return;
        const sales = data.sales || [];
        const paidSales = sales.filter((sale) => sale.payment_status === 'paid');
        const paidQuantity = paidSales.reduce((total, sale) => total + Number(sale.quantity), 0);
        const paidRevenue = paidSales.reduce((total, sale) => total + Number(sale.quantity) * Number(sale.unit_price), 0);
        document.getElementById('product-sales-content').innerHTML = sales.length
            ? `<div class="stat-tiles" style="margin-bottom: 16px;">
                <div class="stat-tile"><h3>${paidSales.length}</h3><p>Paid orders</p></div>
                <div class="stat-tile"><h3>${paidQuantity} ${escapeHtml(listing && listing.unit || '')}</h3><p>Units sold</p></div>
                <div class="stat-tile"><h3>${money(paidRevenue)}</h3><p>Paid revenue</p></div>
            </div>
            <div class="stack-list">${sales.map((sale) => `
                <article class="order-card">
                    <div class="order-head">
                        <strong>Order #${escapeHtml(sale.order_id)}</strong>
                        <span class="status-pill ${sale.payment_status === 'paid' ? 'ok' : ''}">${escapeHtml(sale.payment_status)}</span>
                    </div>
                    <p><strong>Buyer:</strong> ${escapeHtml(sale.buyer_name || sale.buyer_username)}</p>
                    <p><strong>Purchased:</strong> ${Number(sale.quantity)} ${escapeHtml(sale.unit)} × ${money(sale.unit_price)}</p>
                    <p><strong>Order date:</strong> ${escapeHtml(formatDateTime(sale.created_at))}${sale.paid_at ? ` · <strong>Paid:</strong> ${escapeHtml(formatDateTime(sale.paid_at))}` : ''}</p>
                    ${sale.trace_code ? `<p><strong>Product trace:</strong> <a href="/trace?code=${encodeURIComponent(sale.trace_code)}" style="color: var(--primary);">${escapeHtml(sale.trace_code)}</a></p>` : '<p style="color: var(--text-muted);">Trace code becomes available after payment is confirmed.</p>'}
                </article>`).join('')}</div>`
            : emptyBlock('fa-chart-line', 'No sales yet', 'Orders for this product will appear here.');
    } catch (error) {
        if (String(activeSalesListingId) === String(listingId)) {
            document.getElementById('product-sales-content').textContent = 'Sales could not be loaded.';
            toast(error.message, 'error');
        }
    }
}

function openDashboardImage(image) {
    const viewer = document.getElementById('image-viewer-image');
    viewer.src = image.currentSrc || image.src;
    viewer.alt = image.alt || 'Expanded image';
    openModal('image-viewer-modal');
}
async function openProductReviews(listingId, productName) {
    closeModal('product-details-modal');
    activeReviewListingId = String(listingId);
    document.getElementById('product-reviews-title').textContent = `Reviews: ${productName}`;
    document.getElementById('product-review-summary').textContent = 'Loading reviews...';
    document.getElementById('product-review-form-container').innerHTML = '';
    document.getElementById('product-review-list').innerHTML = '';
    openModal('product-reviews-modal');
    await loadProductReviews(activeReviewListingId);
}
async function loadProductReviews(listingId) {
    try {
        const data = await api(`/marketplace/${encodeURIComponent(listingId)}/reviews`);
        if (String(activeReviewListingId) !== String(listingId)) return;
        const average = Number(data.average_rating) || 0;
        const count = Number(data.review_count) || 0;
        document.getElementById('product-review-summary').innerHTML = `
            <strong>${average.toFixed(1)} / 5</strong>
            <span class="review-stars" aria-label="${average.toFixed(1)} out of 5 stars">${'★'.repeat(Math.round(average))}${'☆'.repeat(5 - Math.round(average))}</span>
            <span>${count} review${count === 1 ? '' : 's'}</span>`;
        const own = data.own_review;
        document.getElementById('product-review-form-container').innerHTML = data.can_review
            ? `<form id="product-review-form" class="product-review-form">
                <h3>${own ? 'Update your review' : 'Rate this product'}</h3>
                <label for="product-review-rating">Rating</label>
                <select id="product-review-rating" required>
                    <option value="5" ${Number(own && own.rating) === 5 || !own ? 'selected' : ''}>5 stars - Excellent</option>
                    <option value="4" ${Number(own && own.rating) === 4 ? 'selected' : ''}>4 stars - Good</option>
                    <option value="3" ${Number(own && own.rating) === 3 ? 'selected' : ''}>3 stars - Okay</option>
                    <option value="2" ${Number(own && own.rating) === 2 ? 'selected' : ''}>2 stars - Poor</option>
                    <option value="1" ${Number(own && own.rating) === 1 ? 'selected' : ''}>1 star - Bad</option>
                </select>
                <label for="product-review-text">Review (optional)</label>
                <textarea id="product-review-text" maxlength="1000" placeholder="Share your experience with this product">${escapeHtml(own && own.review || '')}</textarea>
                <button class="btn-primary" type="submit">${own ? 'Update Review' : 'Submit Review'}</button>
            </form>`
            : '<p class="review-purchase-note">You can rate this product after completing payment for an order. You can still comment on existing reviews.</p>';
        document.getElementById('product-review-list').innerHTML = data.reviews.length
            ? data.reviews.map((review) => {
                const author = [review.first_name, review.last_name].filter(Boolean).join(' ') || review.username;
                const comments = review.comments || [];
                return `<article class="product-review">
                    <div class="product-review-heading"><strong>${escapeHtml(author)}</strong><span class="review-stars" aria-label="${Number(review.rating)} out of 5 stars">${'★'.repeat(Number(review.rating))}${'☆'.repeat(5 - Number(review.rating))}</span></div>
                    <time>${escapeHtml(formatDateTime(review.created_at))}</time>
                    ${review.review ? `<p>${escapeHtml(review.review)}</p>` : ''}
                    <div class="review-comments">
                        ${comments.map((comment) => {
                            const commentAuthor = [comment.first_name, comment.last_name].filter(Boolean).join(' ') || comment.username;
                            return `<p><strong>${escapeHtml(commentAuthor)}:</strong> ${escapeHtml(comment.comment)}</p>`;
                        }).join('')}
                    </div>
                    <form class="product-review-comment-form" data-review-id="${escapeHtml(review.review_id)}">
                        <label for="review-comment-${escapeHtml(review.review_id)}">Comment on this review</label>
                        <textarea id="review-comment-${escapeHtml(review.review_id)}" name="comment" rows="2" maxlength="1000" required placeholder="Write a helpful comment"></textarea>
                        <button class="btn-muted" type="submit">Post comment</button>
                    </form>
                </article>`;
            }).join('')
            : '<p class="review-empty">No reviews yet. Be the first to rate this product after purchasing.</p>';
    } catch (error) {
        if (String(activeReviewListingId) === String(listingId)) {
            document.getElementById('product-review-summary').textContent = 'Reviews could not be loaded.';
            toast(error.message, 'error');
        }
    }
}
async function submitReviewComment(event) {
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector('button[type="submit"]');
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Posting...';
    try {
        const result = await api(`/marketplace/${encodeURIComponent(activeReviewListingId)}/reviews/${encodeURIComponent(form.dataset.reviewId)}/comments`, {
            method: 'POST',
            body: { comment: form.elements.comment.value }
        });
        toast(result.message, 'success');
        await loadProductReviews(activeReviewListingId);
    } catch (error) {
        toast(error.message, 'error');
    } finally {
        if (button.isConnected) {
            button.disabled = false;
            button.textContent = originalText;
        }
    }
}
async function submitComplaint(event) {
    event.preventDefault();
    const form = event.target;
    const button = document.getElementById('complaint-submit');
    button.disabled = true;
    button.textContent = 'Sending...';
    try {
        const result = await api('/support/complaints', {
            method: 'POST',
            body: { message: document.getElementById('complaint-message').value }
        });
        toast(result.message, 'success');
        document.getElementById('complaint-message').value = '';
    } catch (error) {
        if (error.status === 401) {
            toast('Your sign-in session has expired. Please sign in again before sending your complaint.', 'error');
        } else {
            toast(error.message, 'error');
        }
    } finally {
        button.disabled = false;
        button.textContent = 'Submit complaint';
    }
}
async function submitProductReview(event) {
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector('button[type="submit"]');
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Submitting...';
    try {
        const result = await api(`/marketplace/${encodeURIComponent(activeReviewListingId)}/reviews`, {
            method: 'POST',
            body: {
                rating: Number(document.getElementById('product-review-rating').value),
                review: document.getElementById('product-review-text').value
            }
        });
        toast(result.message, 'success');
        await loadProductReviews(activeReviewListingId);
    } catch (error) {
        toast(error.message, 'error');
    } finally {
        if (button.isConnected) {
            button.disabled = false;
            button.textContent = originalText;
        }
    }
}
async function toggleSaveFromDetails() {
    if (!detailListingId) return;
    try {
        const result = await api(`/saved/${detailListingId}/toggle`, { method: 'POST' });
        await loadSaved();
        viewProductDetails(detailListingId);
        toast(result.saved ? 'Saved to your list.' : 'Removed from saved items.', 'info');
    } catch (error) { toast(error.message, 'error'); }
}
async function loadSaved() {
    try {
        const data = await api('/saved');
        state.saved = new Set((data.data || []).map((l) => String(l.listing_id)));
        renderSaved(data.data || []);
    } catch (error) { toast(error.message, 'error'); }
}
function renderSaved(list) {
    document.getElementById('saved-container').innerHTML = list.length
        ? list.map(productCardHTML).join('')
        : emptyBlock('fa-heart', 'No saved items', 'Open a product and press Save to keep it here.');
}

/* ---------- cart & checkout ---------- */
function addToCart(id, selectedBatchId = null, quantity = 1) {
    const l = listingById(id);
    if (!l) return;
    if (me && String(l.seller_id) === String(me.id)) {
        toast('You cannot add your own product to the cart.', 'error');
        return;
    }
    const cart = getCart();
    const batches = l.batches || (l.batch ? [l.batch] : []);
    const batch = batches.find((entry) => String(entry.batch_id) === String(selectedBatchId || l.batch_id))
        || batches[0]
        || l.batch;
    if (!batch) {
        toast('No harvest batch is currently available for this product.', 'error');
        return;
    }
    const batchId = String(batch.batch_id);
    const item = cart.find((i) => String(i.id) === String(id) && String(i.batch_id) === batchId);
    const current = item ? item.qty : 0;
    const amount = Number(quantity);
    if (!Number.isFinite(amount) || amount <= 0) {
        toast('Enter a quantity greater than zero.', 'error');
        return false;
    }
    const batchStock = Number(batch.available_quantity ?? batch.quantity ?? 0);
    if (current + amount > batchStock) { toast(`Only ${batchStock} ${sellingUnitLabel(l)} remain in this batch.`, 'error'); return false; }
    if (item) item.qty += amount;
    else cart.push({ id: l.listing_id, batch_id: batch.batch_id, batch_code: batch.batch_code, name: l.product_name, price: Number(l.price), qty: amount, checked: true, img: l.image_url, farmer: l.username, unit: sellingUnitLabel(l), stock: batchStock, added_at: new Date().toISOString() });
    saveCart(cart);
    toast(`${l.product_name} added to cart.`);
    return true;
}
function addToCartFromDetails() {
    if (!detailListingId) return;
    const listing = listingById(document.getElementById('detail-batch-picker').value || detailListingId);
    if (!listing) return;
    const quantity = Number(document.getElementById('detail-quantity').value);
    if (addToCart(listing.listing_id, listing.batch_id, quantity)) closeModal('product-details-modal');
}
function openCart() {
    updateCartUI();
    const address = document.getElementById('checkout-delivery-address');
    if (!address.value.trim() && me && me.address) address.value = me.address;
    openModal('cart-modal');
}
function updateCartUI() {
    if (!me) return;
    const cart = getCart();
    document.getElementById('cart-badge').textContent = cart.reduce((s, i) => s + i.qty, 0);
    const box = document.getElementById('cart-items-container');
    box.innerHTML = cart.length
        ? cart.map((it, i) => {
            const live = listingById(it.id);
            const batch = live && (live.batches || []).find((entry) => String(entry.batch_id) === String(it.batch_id));
            const stock = batch ? Number(batch.available_quantity) : Number(it.stock);
            const displayUnit = live ? (SELLING_UNIT_LABELS[live.selling_unit] || live.unit) : it.unit;
            const warning = batch && stock < it.qty ? `<p style="color: var(--danger); font-size: 0.75rem;">Only ${stock} left in ${escapeHtml(batch.batch_code || 'this batch')}</p>` : '';
            return `<div class="cart-item">
                <input type="checkbox" ${it.checked ? 'checked' : ''} onchange="toggleItemCheck(${i})">
                <img src="${escapeHtml(mediaUrl(it.img, DEFAULT_PRODUCT_IMG))}" onerror="this.onerror=null;this.src='${DEFAULT_PRODUCT_IMG}'" alt="Item">
                <div class="cart-item-info">
                    <h4>${escapeHtml(it.name)}</h4>
                    <p>Sold by: ${escapeHtml(it.farmer || 'AgriTrace seller')}</p>
                    <p>Batch ${escapeHtml(it.batch_code || (it.batch_id ? `#${it.batch_id}` : 'selected harvest batch'))}</p>
                    <div class="price">${money(live ? live.price : it.price)} / ${escapeHtml(displayUnit || '')} · Line total ${money((live ? Number(live.price) : Number(it.price)) * it.qty)}</div>
                    ${warning}
                </div>
                <div class="cart-item-actions">
                    <i class="fa-solid fa-trash delete-btn" onclick="removeFromCart(${i})" title="Remove item"></i>
                    <div class="qty-control">
                        <button onclick="updateQty(${i}, -1)">-</button>
                        <input type="number" min="0.01" step="0.01" max="${escapeHtml(stock)}" value="${escapeHtml(it.qty)}" aria-label="Quantity of ${escapeHtml(it.name)}" onchange="setCartQty(${i}, this.value)">
                        <button onclick="updateQty(${i}, 1)" ${it.qty >= stock ? 'disabled' : ''}>+</button>
                    </div>
                </div>
            </div>`;
        }).join('')
        : '<p style="text-align:center; padding: 20px; color: var(--text-muted);">Your cart is empty.</p>';
    const total = cart.filter((i) => i.checked).reduce((s, i) => {
        const live = listingById(i.id);
        return s + (live ? Number(live.price) : Number(i.price)) * i.qty;
    }, 0);
    document.getElementById('cart-total').textContent = 'Total: ' + money(total);
    document.getElementById('select-all').checked = cart.length > 0 && cart.every((i) => i.checked);
}
function updateQty(index, delta) {
    const cart = getCart();
    const it = cart[index];
    if (!it) return;
    const live = listingById(it.id);
    const batch = live && (live.batches || []).find((entry) => String(entry.batch_id) === String(it.batch_id));
    const max = batch ? Number(batch.available_quantity) : Number(it.stock);
    const next = it.qty + delta;
    if (next < 1) return;
    if (next > max) { toast(`Only ${max} ${it.unit || ''} available.`, 'error'); return; }
    it.qty = next;
    saveCart(cart);
}
function setCartQty(index, value) {
    const cart = getCart();
    const item = cart[index];
    const quantity = Number(value);
    if (!item || !Number.isFinite(quantity) || quantity <= 0) {
        updateCartUI();
        return;
    }
    const live = listingById(item.id);
    const batch = live && (live.batches || []).find((entry) => String(entry.batch_id) === String(item.batch_id));
    const max = batch ? Number(batch.available_quantity) : Number(item.stock);
    if (quantity > max) {
        toast(`Only ${max} ${item.unit || ''} available.`, 'error');
        updateCartUI();
        return;
    }
    item.qty = quantity;
    saveCart(cart);
}
function removeFromCart(index) {
    if (!confirm('Remove this item from your cart?')) return;
    const cart = getCart();
    cart.splice(index, 1);
    saveCart(cart);
}
function toggleItemCheck(index) {
    const cart = getCart();
    if (cart[index]) cart[index].checked = !cart[index].checked;
    saveCart(cart);
}
function toggleSelectAll(checkbox) {
    saveCart(getCart().map((i) => ({ ...i, checked: checkbox.checked })));
}
async function checkout() {
    const cart = getCart();
    const chosen = cart.filter((i) => i.checked);
    if (!chosen.length) { toast('Select at least one item to check out.', 'error'); return; }
    if (chosen.some((item) => {
        const listing = listingById(item.id);
        return listing && me && String(listing.seller_id) === String(me.id);
    })) {
        toast('Remove your own products from the cart before checking out.', 'error');
        return;
    }
    const button = document.getElementById('checkout-btn');
    const paymentMethod = document.getElementById('checkout-payment-method').value;
    const deliveryAddress = document.getElementById('checkout-delivery-address').value.trim();
    if (!deliveryAddress) { toast('Enter a delivery address before placing your order.', 'error'); return; }
    const checkoutItems = chosen.map((item) => ({
        listing_id: item.id,
        batch_id: item.batch_id,
        quantity: item.qty,
        cart_added_at: item.added_at || new Date().toISOString()
    }));
    const fingerprint = JSON.stringify({
        items: checkoutItems.map(({ listing_id, batch_id, quantity }) => ({ listing_id, batch_id, quantity })),
        paymentMethod,
        deliveryAddress
    });
    const keyStorage = `agritrace-checkout:${me.id}`;
    let savedKey = null;
    try { savedKey = JSON.parse(sessionStorage.getItem(keyStorage) || 'null'); } catch (error) { savedKey = null; }
    const idempotencyKey = savedKey && savedKey.fingerprint === fingerprint
        ? savedKey.key
        : (window.crypto && window.crypto.randomUUID
            ? window.crypto.randomUUID()
            : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);
    sessionStorage.setItem(keyStorage, JSON.stringify({ fingerprint, key: idempotencyKey }));
    button.disabled = true;
    rememberDashboardPosition();
    try {
        const result = await api('/orders', {
            method: 'POST',
            body: {
                items: checkoutItems,
                idempotency_key: idempotencyKey,
                payment_method: paymentMethod,
                delivery_address: deliveryAddress
            }
        });
        sessionStorage.removeItem(keyStorage);
        saveCart(cart.filter((i) => !i.checked));
        closeModal('cart-modal');
        toast(result.message || 'Order placed and waiting for farmer review.', 'success');
        switchView('orders');
        await Promise.all([loadMarketplace(), loadOrders(), loadNotifications(), loadAnalytics()]);
    } catch (error) {
        toast(error.message, 'error');
        await loadMarketplace();
    } finally {
        button.disabled = false;
    }
}
function orderPaymentBadge(order) {
    if (order.payment_status === 'paid') return '<span class="status-pill ok"><i class="fa-solid fa-circle-check"></i> Paid</span>';
    if (order.payment_status === 'failed') return '<span class="status-pill" style="background: rgba(239,68,68,0.15); color: var(--danger);">Payment failed</span>';
    if (order.payment_status === 'refunded') return '<span class="status-pill">Refunded</span>';
    if (order.payment_method === 'cod') return '<span class="status-pill"><i class="fa-solid fa-truck"></i> Unpaid · COD</span>';
    if (['pending', 'awaiting_farmer_acceptance'].includes(order.status)) return '<span class="status-pill"><i class="fa-solid fa-clock"></i> Payment after farmer review</span>';
    if (order.payment_status === 'payment_processing') return '<span class="status-pill"><i class="fa-solid fa-spinner"></i> Payment processing</span>';
    return '<span class="status-pill"><i class="fa-solid fa-clock"></i> Awaiting payment</span>';
}
function traceBlock(item) {
    if (!item.trace_code) return '';
    const qr = item.qr_url
        ? `<img src="${escapeHtml(item.qr_url)}" alt="QR code for ${escapeHtml(item.trace_code)}" style="width: 72px; height: 72px; border-radius: 8px; background: #fff; padding: 4px;">`
        : '';
    return `<div style="display: flex; gap: 12px; align-items: center; margin: 6px 0 2px; flex-wrap: wrap;">
        ${qr}
        <div style="font-size: 0.8rem; color: var(--text-muted);">
            Trace code <b style="font-family: monospace; color: var(--text-main);">${escapeHtml(item.trace_code)}</b><br>
            <a href="/trace?code=${encodeURIComponent(item.trace_code)}" style="color: var(--primary);">View product trace</a>
        </div></div>`;
}
function farmerOrderActions(order) {
    if (!me || me.role !== 'farmer') return '';
    const id = escapeHtml(order.order_id);
    if (['pending', 'awaiting_farmer_acceptance'].includes(order.status)) {
        return `<div class="order-actions"><button type="button" class="btn-primary" data-action="order-accept" data-id="${id}">Accept order</button>
            <button type="button" class="btn-muted" data-action="order-reject" data-id="${id}">Reject</button></div>`;
    }
    if (['accepted', 'confirmed'].includes(order.status)) {
        return `<button type="button" class="btn-primary" data-action="order-status" data-status="preparing" data-id="${id}">Start preparing</button>`;
    }
    if (order.status === 'preparing' || order.status === 'ready_for_shipment') {
        return `<button type="button" class="btn-primary" data-action="order-status" data-status="shipped" data-id="${id}">Mark shipped</button>`;
    }
    if (['shipped', 'in_transit'].includes(order.status)) {
        return `<button type="button" class="btn-primary" data-action="order-status" data-status="out_for_delivery" data-id="${id}">Out for delivery</button>`;
    }
    if (order.status === 'out_for_delivery' && order.payment_method === 'cod' && order.payment_status !== 'paid') {
        return `<button type="button" class="btn-primary" data-action="collect-cod" data-id="${id}">Record COD payment</button>`;
    }
    if (order.status === 'out_for_delivery' && order.payment_status === 'paid') {
        return `<button type="button" class="btn-primary" data-action="order-status" data-status="delivered" data-id="${id}">Confirm delivered</button>`;
    }
    if (order.status === 'delivered') {
        return `<button type="button" class="btn-primary" data-action="order-status" data-status="completed" data-id="${id}">Complete order</button>`;
    }
    return '';
}

function orderDateTime(value) {
    if (!value) return '';
    const date = new Date(String(value).replace(' ', 'T'));
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}
function orderProgressHTML(order) {
    if (['rejected', 'cancelled'].includes(order.status)) {
        return `<div class="order-terminal ${order.status}"><strong>${escapeHtml(order.status === 'rejected' ? 'Order rejected' : 'Order cancelled')}</strong> · ${escapeHtml(order.payment_status || 'unpaid')}</div>`;
    }
    const history = order.history || [];
    const hasStatus = (...statuses) => history.some((event) => statuses.includes(event.status));
    const eventTime = (...statuses) => {
        const event = history.find((item) => statuses.includes(item.status));
        return event ? orderDateTime(event.created_at) : '';
    };
    const paymentTime = (() => {
        const event = history.find((item) => item.status === 'payment_paid' || item.payment_status === 'paid');
        return event ? orderDateTime(event.created_at) : orderDateTime(order.paid_at);
    })();
    const online = order.payment_method === 'xendit';
    const shippingStatuses = ['shipped', 'in_transit', 'out_for_delivery', 'delivered', 'completed'];
    const reviewDone = hasStatus('accepted', 'awaiting_payment', ...shippingStatuses) || ['accepted', 'awaiting_payment', 'preparing', 'ready_for_shipment', ...shippingStatuses].includes(order.status);
    const shippingDone = hasStatus(...shippingStatuses) || shippingStatuses.includes(order.status);
    const paymentDone = order.payment_status === 'paid';
    const deliveredDone = ['delivered', 'completed'].includes(order.status) || hasStatus('delivered', 'completed');
    const cartAddedAt = (order.items || []).map((item) => item.cart_added_at).filter(Boolean).sort()[0] || order.created_at;
    const steps = online ? [
        ['Add to cart', true, cartAddedAt],
        ['Order', true, order.created_at],
        ['Review', reviewDone, eventTime('accepted', 'awaiting_payment')],
        ['Payment', paymentDone, paymentTime],
        ['Shipping', shippingDone, eventTime('shipped', 'in_transit', 'out_for_delivery')],
        ['Delivered', deliveredDone, eventTime('delivered', 'completed')]
    ] : [
        ['Add to cart', true, cartAddedAt],
        ['Order', true, order.created_at],
        ['Review', reviewDone, eventTime('accepted')],
        ['Shipping', shippingDone, eventTime('shipped', 'in_transit', 'out_for_delivery')],
        ['Payment', paymentDone, paymentTime],
        ['Delivered', deliveredDone, eventTime('delivered', 'completed')]
    ];
    const currentIndex = steps.findIndex((step) => !step[1]);
    const nextAction = order.status === 'pending' || order.status === 'awaiting_farmer_acceptance'
        ? 'Next: farmer reviews the order.'
        : order.status === 'awaiting_payment' ? 'Next: buyer completes online payment.'
            : order.status === 'accepted' ? 'Next: farmer prepares the order.'
                : order.status === 'preparing' || order.status === 'ready_for_shipment' ? 'Next: farmer ships the order.'
                    : order.status === 'shipped' || order.status === 'in_transit' ? 'Next: delivery is in progress.'
                        : order.status === 'out_for_delivery' && order.payment_method === 'cod' && !paymentDone ? 'Next: collect COD payment, then confirm delivery.'
                            : order.status === 'out_for_delivery' ? 'Next: confirm delivery.' : 'Order progress updated.';
    return `<div class="order-progress" aria-label="${online ? 'Online payment' : 'Cash on delivery'} order progress">
        <ol>${steps.map((step, index) => `<li class="${step[1] ? 'done' : index === currentIndex ? 'current' : 'pending'}">
            <span class="order-progress-icon">${step[1] ? '<i class="fa-solid fa-check"></i>' : index + 1}</span>
            <span class="order-progress-label">${escapeHtml(step[0])}</span>
            ${step[2] ? `<time>${escapeHtml(orderDateTime(step[2]))}</time>` : ''}
        </li>`).join('')}</ol>
        <p>${escapeHtml(nextAction)}</p>
    </div>`;
}
async function updateOrderStatus(orderId, status, extra = {}) {
    await api(`/orders/${encodeURIComponent(orderId)}/status`, { method: 'PUT', body: { status, ...extra } });
    await Promise.all([loadOrders(), loadNotifications(), loadMarketplace()]);
}
async function startOnlinePayment(orderId) {
    const result = await api(`/orders/${encodeURIComponent(orderId)}/payment`, {
        method: 'POST', body: { frontend_origin: location.origin }
    });
    if (!result.invoice_url) throw new Error('The payment gateway did not return a payment link.');
    location.assign(result.invoice_url);
}
async function openBatchAllocation(orderId) {
    const result = await api(`/orders/${orderId}/batch-options`);
    const items = result.data || [];
    const modal = document.createElement('div');
    modal.className = 'modal-overlay active';
    modal.id = 'batch-allocation-modal';
    modal.innerHTML = `<div class="modal" style="max-width:760px;">
        <div class="modal-header"><h2>Assign batches for Order #${escapeHtml(orderId)}</h2>
            <button class="close-btn" type="button" aria-label="Close">&times;</button></div>
        <p style="color:var(--text-muted);">Allocate the complete ordered quantity before accepting. Only your matching batches are shown.</p>
        <form id="batch-allocation-form">
            ${items.map((item) => `<fieldset style="border:1px solid var(--border-color);border-radius:8px;padding:12px;margin:10px 0;">
                <legend>${escapeHtml(item.product_name)} · ${Number(item.quantity)} ${escapeHtml(item.unit)}</legend>
                <div data-allocation-item="${escapeHtml(item.item_id)}">
                    ${(item.batches || []).map((batch) => `<label style="display:grid;grid-template-columns:1fr 120px;gap:8px;align-items:center;margin:6px 0;">
                        <span>${escapeHtml(batch.batch_code)} · ${Number(batch.available_quantity)} ${escapeHtml(batch.unit)}${batch.harvest_reference ? ` · ${escapeHtml(batch.harvest_reference)}` : ''}</span>
                        <input type="number" min="0" max="${escapeHtml(batch.available_quantity)}" step="0.01" value="0"
                            data-item-id="${escapeHtml(item.item_id)}" data-batch-id="${escapeHtml(batch.batch_id)}" data-unit="${escapeHtml(batch.unit)}">
                    </label>`).join('') || '<span style="color:var(--danger);">No matching available batches.</span>'}
                </div>
            </fieldset>`).join('')}
            <label>Shipping provider
                <select name="shipping_provider" required>
                    <option value="">Select provider</option><option>J&amp;T Express</option><option>LBC Express</option><option>Other</option>
                </select>
            </label>
            <button class="btn-primary" type="submit" style="width:100%;margin-top:12px;">Save allocation and accept order</button>
        </form>
    </div>`;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector('.close-btn').addEventListener('click', close);
    modal.addEventListener('click', (event) => { if (event.target === modal) close(); });
    modal.querySelector('form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const allocations = Array.from(modal.querySelectorAll('input[data-batch-id]'))
            .map((input) => ({ order_item_id: Number(input.dataset.itemId), batch_id: Number(input.dataset.batchId), quantity: Number(input.value), unit: input.dataset.unit }))
            .filter((allocation) => allocation.quantity > 0);
        const shippingProvider = modal.querySelector('[name="shipping_provider"]').value;
        if (!allocations.length || !shippingProvider) {
            toast('Select a shipping provider and allocate each ordered item.', 'error');
            return;
        }
        try {
            await api(`/orders/${orderId}/allocate-batches`, { method: 'POST', body: { allocations, shipping_provider: shippingProvider } });
            close();
            toast('Batches allocated and order accepted.', 'success');
            await Promise.all([loadOrders(), loadNotifications(), loadMarketplace()]);
        } catch (error) { toast(error.message, 'error'); }
    });
}
async function loadOrders() {
    try {
        const data = await api('/orders');
        state.orders = data.data || [];
        if (paymentReturnPending || currentView === 'orders') {
            if (!paymentReconciliation) {
                paymentReconciliation = (async () => {
                    const pending = (paymentReturnOrderId
                        ? state.orders.filter((order) => String(order.order_id) === String(paymentReturnOrderId))
                        : state.orders
                    ).filter((order) => ['unpaid', 'awaiting_payment', 'payment_processing'].includes(order.payment_status)
                        && order.xendit_invoice_url).slice(0, 10);
                    const results = await Promise.all(pending.map(async (order) => {
                        try {
                            return await api(`/orders/${order.order_id}/payment-status`);
                        } catch (error) {
                            toast(error.message, 'error');
                            return null;
                        }
                    }));
                    if (results.some((result) => result && result.payment_status !== 'unpaid')) {
                        const refreshed = await api('/orders');
                        state.orders = refreshed.data || [];
                    }
                    const paidOrder = state.orders.find((order) => String(order.order_id) === String(paymentReturnOrderId));
                    const trace = paidOrder && paidOrder.items.find((item) => item.trace_code);
                    if (paidOrder && paidOrder.payment_status === 'paid' && trace) {
                        paymentTraceRedirecting = true;
                        location.replace(`/trace?code=${encodeURIComponent(trace.trace_code)}`);
                        return;
                    }
                    paymentReturnPending = false;
                    paymentReturnOrderId = '';
                    history.replaceState(null, '', '/dashboard' + location.hash);
                })().catch((error) => {
                    paymentReturnPending = false;
                    toast(error.message, 'error');
                });
            }
            await paymentReconciliation;
            paymentReconciliation = null;
            if (paymentTraceRedirecting) return;
        }
    } catch (error) { toast(error.message, 'error'); }
    document.getElementById('orders-container').innerHTML = state.orders.length
        ? state.orders.map((o) => `
            <div class="order-card">
                <div class="order-head">
                    <span><b style="color: var(--text-main);">Order #${escapeHtml(o.order_id)}</b> • ${new Date(String(o.created_at).replace(' ', 'T')).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}<br><span class="status-pill">${escapeHtml(String(o.status || '').replace(/_/g, ' '))}</span></span>
                    ${orderPaymentBadge(o)}
                </div>
                ${orderProgressHTML(o)}
                ${me && me.role === 'farmer' ? `<p>Buyer: <b>${escapeHtml([o.buyer_first, o.buyer_last].filter(Boolean).join(' ') || o.buyer || 'Buyer')}</b> · ${escapeHtml(o.buyer_email || '')}</p>${farmerOrderActions(o)}` : ''}
                ${o.payment_method === 'xendit' && o.status === 'awaiting_payment' && o.payment_status !== 'paid'
                    ? `<button type="button" class="btn-primary" data-action="pay-order" data-id="${escapeHtml(o.order_id)}">Complete online payment</button>` : ''}
                ${me && ['seller', 'buyer', 'user'].includes(me.role) && ['pending', 'awaiting_farmer_acceptance', 'awaiting_payment', 'accepted'].includes(o.status)
                    ? `<button type="button" class="btn-muted" data-action="cancel-order" data-id="${escapeHtml(o.order_id)}">Cancel order</button>` : ''}
                ${o.delivery_address ? `<p><strong>Deliver to:</strong> ${escapeHtml(o.delivery_address)}</p>` : ''}
                ${o.shipping_provider ? `<p><strong>Delivery:</strong> ${escapeHtml(o.shipping_provider)}${o.tracking_number ? ` · Tracking ${escapeHtml(o.tracking_number)}` : ''}</p>` : ''}
                ${o.items.map((it) => `
                    <div class="order-line">
                        <div class="order-line-info"><h4>${escapeHtml(it.product_name)}</h4><p>${Number(it.quantity)} ${escapeHtml(it.selling_unit && it.selling_unit !== 'other' ? it.selling_unit : it.unit)} × ${money(it.unit_price)}</p>
                            ${it.batch_code ? `<p>Batch ${escapeHtml(it.batch_code)} · ${escapeHtml(it.farm_name || 'Registered farm')}${it.harvest_date ? ` · Harvested ${escapeHtml(it.harvest_date)}` : ''}${it.expiration_date ? ` · Expires ${escapeHtml(it.expiration_date)}` : ''}</p>` : ''}
                            ${traceBlock(it)}
                            ${o.payment_status === 'paid' && it.listing_id ? `<button type="button" class="btn-muted review-order-button" data-action="review-product" data-id="${escapeHtml(it.listing_id)}" data-name="${escapeHtml(it.product_name)}"><i class="fa-solid fa-star"></i> Review product</button>` : ''}
                        </div>
                        <strong>${money(it.quantity * it.unit_price)}</strong>
                    </div>`).join('')}
                <div class="order-total">Total: ${money(o.total_amount)}</div>
            </div>`).join('')
        : emptyBlock('fa-box-open', 'No orders yet', 'Items you check out from your cart will appear here.');
}

/* ---------- home map: the signed-in user's own location ---------- */
async function renderHomeMap() {
    const label = document.getElementById('home-location-label');
    const box = document.getElementById('home-map');
    if (!label || !box || !me) return;
    if (me.latitude === null || me.latitude === undefined || me.latitude === '') {
        label.textContent = 'No location set';
        document.getElementById('home-map-hint').textContent = 'Add your map location in My Profile.';
        return;
    }
    label.textContent = me.location_label || 'Your location';
    document.getElementById('home-map-hint').textContent = 'Showing products nearby.';
    try {
        const { map, L } = await createMap('home-map', Number(me.latitude), Number(me.longitude), 14);
        L.marker([Number(me.latitude), Number(me.longitude)]).addTo(map).bindPopup('You are here');
    } catch (error) {
        document.getElementById('home-map-hint').textContent = error.message;
    }
}

/* ---------- farmers ---------- */
async function loadFarmers() {
    try {
        const data = await api('/farmers');
        state.farmers = data.data || [];
    } catch (error) { toast(error.message, 'error'); }
    renderFarmers();
    renderSuggested();
    renderRightWidgets();
}
function farmerName(f) { return [f.first_name, f.middle_name, f.last_name].filter(Boolean).join(' ') || f.username; }
function farmerFarmLocation(f) {
    return [f.municipality, f.province].filter(Boolean).join(', ') || 'Farm location not set';
}
function farmerCardHTML(f) {
    return `<div class="farmer-card" data-action="farmer-profile" data-id="${escapeHtml(f.id)}" tabindex="0" role="button" aria-label="View ${escapeHtml(farmerName(f))}'s profile">
        <img src="${escapeHtml(mediaUrl(f.profile_pic, DEFAULT_AVATAR))}" alt="${escapeHtml(farmerName(f))}" style="object-position: center;">
        <h4>${escapeHtml(farmerName(f))}</h4>
        <p style="color: var(--text-muted); font-size: 0.75rem; margin-bottom: 5px;">${Number(f.followers)} follower${Number(f.followers) === 1 ? '' : 's'}</p>
        <p><i class="fa-solid fa-location-dot"></i> ${escapeHtml(farmerFarmLocation(f))}</p>
        <div style="display: flex; gap: 8px; margin-top: 10px;">
            <button data-action="contact" data-id="${escapeHtml(f.id)}" data-name="${escapeHtml(farmerName(f))}" style="flex: 1;">Contact</button>
            <button data-action="follow" data-id="${escapeHtml(f.id)}" class="follow-btn ${f.following ? 'following' : ''}" style="flex: 1;">${f.following ? 'Following' : 'Follow'}</button>
        </div>
    </div>`;
}
function renderFarmers() {
    let list = state.farmers.filter((f) => farmerFilter === 'All' || (farmerFilter === 'Following' ? f.following : false));
    if (searchTerm) list = list.filter((f) =>
        [farmerName(f), f.farm_name, farmerFarmLocation(f)]
            .some((value) => String(value || '').toLowerCase().includes(searchTerm))
    );
    document.getElementById('farmer-container').innerHTML = list.length
        ? list.map(farmerCardHTML).join('')
        : emptyBlock('fa-user-slash', 'No farmers found', 'Registered farmers appear here after an admin approves their account.');
}
async function openFarmerProfile(id) {
    const content = document.getElementById('farmer-profile-content');
    const title = document.getElementById('farmer-profile-title');
    content.innerHTML = '<div class="empty-block"><i class="fa-solid fa-circle-notch fa-spin"></i><p>Loading farmer profile...</p></div>';
    openModal('farmer-profile-modal');
    try {
        const farmer = await api(`/members/${encodeURIComponent(id)}`);
        const name = farmerName(farmer);
        title.textContent = `${name}'s farm`;
        const products = farmer.products || [];
        state.posts = [...new Map([...state.posts, ...(farmer.posts || [])].map((post) => [String(post.post_id), post])).values()];
        state.listings = [...new Map([...state.listings, ...products].map((listing) => [String(listing.listing_id), listing])).values()];
        const reviews = farmer.review_summary || {};
        content.innerHTML = `
            <section class="widget">
                <div class="farmer-profile-header">
                    <img src="${escapeHtml(mediaUrl(farmer.profile_pic, DEFAULT_AVATAR))}" alt="${escapeHtml(name)}">
                    <div><h3 style="margin:0 0 5px;">${escapeHtml(name)} ${Number(farmer.is_verified) === 1 ? '<i class="fa-solid fa-circle-check verified-badge" title="Verified farmer"></i>' : ''}</h3>
                    <p style="color:var(--text-muted);"><i class="fa-solid fa-location-dot"></i> ${escapeHtml((farmer.farms || []).map((farm) => publicFarmLocation(farm)).join(' · ') || 'Farm location not set')}</p></div>
                </div>
                <div class="stat-tiles">
                    <div class="stat-tile"><h3>${Number(farmer.followers) || 0}</h3><p>Followers</p></div>
                    <div class="stat-tile"><h3>${Number(reviews.average_rating || 0).toFixed(1)} ★</h3><p>Overall rating · ${Number(reviews.review_count) || 0} reviews</p></div>
                    <div class="stat-tile"><h3>${products.length}</h3><p>Products</p></div>
                </div>
            </section>
            <section class="widget">
                <div class="widget-header"><h3><i class="fa-solid fa-seedling"></i> Registered farm</h3></div>
                ${(farmer.farms || []).length ? farmer.farms.map((farm) => `
                    <div style="padding: 12px 0; border-bottom: 1px solid var(--border-color);">
                        <h4>${escapeHtml(farm.farm_name)}</h4>
                        <p style="color: var(--text-muted);"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(publicFarmLocation(farm))}</p>
                        ${farm.farm_description ? `<p style="margin-top: 8px; line-height: 1.5;">${escapeHtml(farm.farm_description)}</p>` : ''}
                        ${farm.farm_size ? `<p style="color: var(--text-muted); margin-top: 6px;">${escapeHtml(String(farm.farm_size))} ${escapeHtml(farm.farm_size_unit || 'units')}</p>` : ''}
                    </div>`).join('') : '<p style="color: var(--text-muted);">No registered farm information is available.</p>'}
            </section>
            <section class="widget"><div class="widget-header"><h3>Products for sale</h3></div>
                <div class="market-grid-layout">${products.length ? products.map(productCardHTML).join('') : emptyBlock('fa-box-open', 'No products listed', 'This farmer has not listed products yet.')}</div>
            </section>
            <section class="widget"><div class="widget-header"><h3>Community posts</h3></div>
                <div class="stack-list">${farmer.posts && farmer.posts.length ? farmer.posts.map(postCardHTML).join('') : emptyBlock('fa-newspaper', 'No posts yet', 'This farmer has not shared a post yet.')}</div>
            </section>`;
    } catch (error) {
        content.innerHTML = emptyBlock('fa-triangle-exclamation', 'Unable to load farmer profile', 'Please try again in a moment.');
        toast(error.message, 'error');
    }
}
function filterFarmers(category, btn) {
    document.querySelectorAll('#view-farmer-hub .cat-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    farmerFilter = category;
    renderFarmers();
}
function renderSuggested() {
    const list = state.farmers.filter((f) => !f.following).slice(0, 3);
    document.getElementById('suggested-list').innerHTML = list.length
        ? list.map((f) => `<div class="widget-list-item">
            <img src="${escapeHtml(mediaUrl(f.profile_pic, DEFAULT_AVATAR))}" alt="${escapeHtml(farmerName(f))}">
            <div class="widget-list-item-info"><h4>${escapeHtml(farmerName(f))}</h4><p>${escapeHtml(farmerFarmLocation(f))}</p></div>
            <button class="btn-primary follow-btn" style="padding: 5px 10px; font-size: 0.7rem;" data-action="follow" data-id="${escapeHtml(f.id)}">Follow</button>
        </div>`).join('')
        : '<p style="font-size: 0.8rem; color: var(--text-muted);">No suggestions right now.</p>';
}
function renderPopularFarmers() {
    const list = state.farmers.slice(0, 3);
    document.getElementById('popular-farmers-list').innerHTML = list.length
        ? list.map((farmer) => `<div class="widget-list-item">
            <img src="${escapeHtml(mediaUrl(farmer.profile_pic, DEFAULT_AVATAR))}" alt="${escapeHtml(farmerName(farmer))}">
            <div class="widget-list-item-info"><h4>${escapeHtml(farmerName(farmer))}</h4><p>${Number(farmer.followers)} followers</p></div>
            ${Number(farmer.is_verified) === 1 ? '<i class="fa-solid fa-circle-check verified-badge" title="Verified farmer"></i>' : ''}
        </div>`).join('')
        : '<p style="font-size: 0.8rem; color: var(--text-muted);">No farmers to show yet.</p>';
}
function renderLatestProducts() {
    const list = state.listings.filter((listing) => Number(listing.is_available) === 1 && Number(listing.stock) > 0)
        .sort((a, b) => Number(b.listing_id) - Number(a.listing_id)).slice(0, 4);
    document.getElementById('latest-products-list').innerHTML = list.length
        ? list.map((listing) => `<div class="widget-list-item latest-product-item">
            <img src="${escapeHtml(mediaUrl(listing.image_url, DEFAULT_PRODUCT_IMG))}" alt="${escapeHtml(listing.product_name)}">
            <div class="widget-list-item-info"><h4>${escapeHtml(listing.product_name)}</h4><p>${money(listing.price)} / ${escapeHtml(listing.unit)}</p><p><i class="fa-solid fa-location-dot"></i> ${escapeHtml(publicFarmLabel(listing))}</p></div>
            <button type="button" class="btn-muted" data-action="details" data-id="${escapeHtml(listing.listing_id)}">View</button>
        </div>`).join('')
        : '<p style="font-size: 0.8rem; color: var(--text-muted);">No approved products are available.</p>';
}
async function toggleFollow(id) {
    try {
        const result = await api(`/follows/${id}/toggle`, { method: 'POST' });
        toast(result.following ? 'You are now following this farmer.' : 'Unfollowed.', 'info');
        await loadFarmers();
    } catch (error) { toast(error.message, 'error'); }
}

/* ---------- messages ---------- */
async function loadContacts() {
    try {
        const data = await api('/messages/contacts');
        const contactsById = new Map();
        for (const contact of data.data || []) {
            const id = String(contact.user_id);
            const existing = contactsById.get(id);
            if (!existing) {
                contactsById.set(id, contact);
                continue;
            }
            const latest = String(contact.last_at || '') > String(existing.last_at || '') ? contact : existing;
            contactsById.set(id, { ...latest, unread: Math.max(Number(existing.unread) || 0, Number(contact.unread) || 0) });
        }
        state.contacts = [...contactsById.values()];
    } catch (error) {
        state.contacts = [];
        toast(error.message, 'error');
    }
    renderConversationList();
    setBadge('messages-badge', state.contacts.reduce((s, c) => s + Number(c.unread || 0), 0));
}
function searchConversations(value) {
    renderConversationList();
}
function setMessageFilter(filter, button) {
    messageFilter = filter;
    document.querySelectorAll('#msg-filter-bar .cat-btn').forEach((item) => item.classList.toggle('active', item === button));
    renderConversationList();
}
function contactName(c) { return [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username; }
function contactSearchText(c) { return `${contactName(c)} ${c.username || ''}`.toLocaleLowerCase(); }
function normalizedContactName(c) { return contactName(c).trim().replace(/\s+/g, ' ').toLocaleLowerCase(); }
function conversationGroups() {
    const groups = new Map();
    const seenUserIds = new Set();
    for (const contact of state.contacts) {
        const userId = Number(contact.user_id);
        if (seenUserIds.has(userId)) continue;
        seenUserIds.add(userId);
        const name = normalizedContactName(contact);
        const key = name || `user:${contact.user_id}`;
        if (!groups.has(key)) {
            groups.set(key, {
                ...contact,
                user_id: userId,
                user_ids: [],
                contacts: [],
                unread: 0
            });
        }
        const group = groups.get(key);
        group.user_ids.push(userId);
        group.contacts.push(contact);
        group.unread += Number(contact.unread) || 0;
        if (String(contact.last_at || '') > String(group.last_at || '')) {
            Object.assign(group, contact, {
                user_id: userId,
                user_ids: group.user_ids,
                contacts: group.contacts,
                unread: group.unread
            });
        }
    }
    for (const group of groups.values()) group.user_ids.sort((a, b) => a - b);
    return [...groups.values()].sort((a, b) => String(b.last_at || '').localeCompare(String(a.last_at || '')));
}
function renderConversationList() {
    const q = (document.getElementById('msg-search')?.value || '').trim().toLowerCase();
    const list = conversationGroups().filter((group) => {
        const searchableText = group.contacts.map(contactSearchText).join(' ');
        if (q && !q.split(/\s+/).every((term) => searchableText.includes(term))) return false;
        if (messageFilter === 'unread') return group.unread > 0;
        return true;
    });
    const listElement = document.getElementById('conv-list');
    listElement.innerHTML = list.length ? list.map((c) => {
        const preview = escapeHtml(c.last_body || '');
        const unread = c.unread > 0;
        const ids = c.user_ids.join(',');
        return `<div class="msg-contact ${ids === activeContactUserIds.join(',') ? 'active' : ''} ${unread ? 'unread' : ''}" data-contact="${escapeHtml(ids)}">
            <img src="${escapeHtml(mediaUrl(c.profile_pic, DEFAULT_AVATAR))}" alt="${escapeHtml(contactName(c))}">
            <div><h4>${escapeHtml(contactName(c))}</h4><p>${preview}</p></div>
            ${unread ? `<span class="unread-dot" title="${c.unread} unread message${c.unread === 1 ? '' : 's'}"></span>` : ''}
        </div>`;
    }).join('') : `<p style="padding: 15px; color: var(--text-muted); font-size: 0.85rem;">${messageFilter === 'unread' ? 'No unread conversations.' : q ? 'No conversations found.' : 'No conversations yet.'}</p>`;
}
async function selectContact(id, fallbackContact = null) {
    const requestedIds = (Array.isArray(id) ? id : String(id).split(','))
        .map((value) => Number(value))
        .filter((value) => Number.isSafeInteger(value) && value > 0);
    const matchingContacts = conversationGroups().find((group) =>
        group.user_ids.length === requestedIds.length
        && group.user_ids.every((userId) => requestedIds.includes(userId))
    );
    const contact = matchingContacts || (activeContactDetails
        && activeContactUserIds.length === requestedIds.length
        && activeContactUserIds.every((userId) => requestedIds.includes(userId)) ? activeContactDetails : fallbackContact);
    if (!contact) return;
    const requestSequence = ++conversationRequestSequence;
    activeContactUserIds = contact.user_ids || requestedIds;
    activeContactId = String(contact.user_id);
    activeContactDetails = contact;
    document.getElementById('chat-header-img').src = mediaUrl(contact?.profile_pic, DEFAULT_AVATAR);
    document.getElementById('chat-header-name').textContent = contactName(contact);
    document.getElementById('chat-header-status').innerHTML = '<i class="fa-solid fa-circle" style="color: var(--primary); font-size: 0.6rem;"></i> Direct message';
    document.getElementById('chat-history').innerHTML = '<div style="margin: auto; color: var(--text-muted); text-align: center;">Loading conversation...</div>';
    try {
        const histories = await Promise.all(activeContactUserIds.map((userId) => api(`/messages/${userId}`)));
        if (requestSequence !== conversationRequestSequence) return;
        const messages = new Map();
        histories.flatMap((history) => history.data || []).forEach((message) => {
            messages.set(String(message.message_id), message);
        });
        renderChatHistory([...messages.values()].sort((a, b) =>
            String(a.created_at).localeCompare(String(b.created_at))
            || Number(a.message_id) - Number(b.message_id)
        ));
    } catch (error) {
        if (requestSequence !== conversationRequestSequence) return;
        renderChatHistory([]);
        toast(error.message, 'error');
    }
    await loadContacts();
    if (requestSequence !== conversationRequestSequence) return;
    const updatedContact = conversationGroups().find((group) =>
        group.user_ids.length === activeContactUserIds.length
        && group.user_ids.every((userId) => activeContactUserIds.includes(userId))
    );
    if (updatedContact) {
        activeContactDetails = updatedContact;
        activeContactId = String(updatedContact.user_id);
        document.getElementById('chat-header-img').src = mediaUrl(updatedContact.profile_pic, DEFAULT_AVATAR);
        document.getElementById('chat-header-name').textContent = contactName(updatedContact);
    }
    renderConversationList();
}
function renderChatHistory(messages) {
    const h = document.getElementById('chat-history');
    h.innerHTML = messages.length
        ? messages.map((m) => {
            const sent = String(m.sender_id) === String(me.id);
            const avatar = mediaUrl(m.sender_profile_pic, sent ? avatarOf(me) : DEFAULT_AVATAR);
            return `<div class="chat-message-row ${sent ? 'sent' : 'received'}">
                <img src="${escapeHtml(avatar)}" alt="" class="chat-message-avatar">
                <div class="msg-bubble ${sent ? 'sent' : 'received'}">${escapeHtml(m.body)}</div>
            </div>`;
        }).join('')
        : '<div style="margin: auto; color: var(--text-muted); text-align: center;">No messages yet. Say hello!</div>';
    h.scrollTop = h.scrollHeight;
}
async function openMessenger(contactId) {
    openModal('messenger-modal');
    await loadContacts();
    const activeContactExists = conversationGroups().some((contact) =>
        contact.user_ids.length === activeContactUserIds.length
        && contact.user_ids.every((userId) => activeContactUserIds.includes(userId))
    );
    const target = contactId || (activeContactExists ? activeContactUserIds.join(',') : null) || (conversationGroups()[0]?.user_ids.join(','));
    if (target) await selectContact(target);
    else {
        conversationRequestSequence++;
        activeContactId = null;
        activeContactDetails = null;
        activeContactUserIds = [];
        document.getElementById('chat-header-img').src = DEFAULT_AVATAR;
        document.getElementById('chat-header-name').textContent = 'No conversations yet';
        document.getElementById('chat-header-status').textContent = '';
        document.getElementById('chat-history').innerHTML = emptyBlock('fa-comments', 'No conversations', 'Contact a farmer from the Farmer Hub to start chatting.');
    }
}
async function openConversation(id, name) {
    const farmer = state.farmers.find((item) => String(item.id) === String(id));
    const existingGroup = conversationGroups().find((group) => group.user_ids.includes(Number(id)));
    const contact = existingGroup || {
        user_id: id,
        user_ids: [Number(id)],
        contacts: [],
        unread: 0,
        username: farmer?.username || name,
        first_name: farmer?.first_name || name,
        last_name: farmer?.last_name || '',
        profile_pic: farmer?.profile_pic || ''
    };
    openModal('messenger-modal');
    renderConversationList();
    await selectContact(id, contact);
}
async function sendMessage() {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text) return;
    if (!activeContactId) { toast('Select a conversation first.', 'error'); return; }
    try {
        await api('/messages', { method: 'POST', body: { receiver_id: Number(activeContactId), body: text } });
        input.value = '';
        await selectContact(activeContactUserIds);
    } catch (error) { toast(error.message, 'error'); }
}
function handleMsgEnter(event) { if (event.key === 'Enter') sendMessage(); }

/* ---------- notifications ---------- */
async function loadNotifications() {
    try {
        const data = await api('/notifications');
        state.notifications = data.data || [];
        setBadge('notif-badge', Number(data.unread) || 0);
    } catch (error) {
        state.notifications = [];
        setBadge('notif-badge', 0);
    }
}
async function openNotifications() {
    await loadNotifications();
    document.getElementById('notif-list').innerHTML = state.notifications.length
        ? state.notifications.map((n) => `<div class="notif-item ${Number(n.is_unread) ? 'unread' : ''}">
            <div style="width: 50px; height: 50px; border-radius: 50%; background: var(--bg-hover); display: flex; align-items: center; justify-content: center; color: var(--primary); flex-shrink: 0;"><i class="fa-solid fa-bell"></i></div>
            <div><h4>${escapeHtml(n.title)}</h4><p>${escapeHtml(n.message)}</p><p style="font-size: 0.75rem;">${timeAgo(n.created_at)}</p></div>
        </div>`).join('')
        : emptyBlock('fa-bell-slash', 'No notifications', 'You are all caught up.');
    openModal('notif-modal');
    if (state.notifications.some((n) => Number(n.is_unread))) {
        try {
            await api('/notifications/read', { method: 'PUT' });
            setBadge('notif-badge', 0);
        } catch (error) { /* non-critical */ }
    }
}

/* ---------- analytics ---------- */
async function loadAnalytics() {
    const salesReports = me.role === 'farmer';
    document.getElementById('farmer-sales-report').classList.toggle('hidden', !salesReports);
    document.getElementById('farmer-buyers-report').classList.toggle('hidden', !salesReports);
    document.getElementById('farmer-product-listings').classList.toggle('hidden', !salesReports);
    renderFarmerProductListings();
    try {
        const a = await api('/analytics');
        document.getElementById('analytics-tiles').innerHTML = [
            [a.active_listings, 'Active listings'],
            [a.farmers, 'Registered farmers'],
            [a.my_orders, 'My orders'],
            [money(a.my_spend), 'My total spend'],
            [a.my_posts, 'Published posts'],
            [a.my_products, 'My products'],
            [a.my_product_reviews, 'Product reviews'],
            [`${Number(a.my_product_average_rating || 0).toFixed(1)} ★`, 'Average product rating'],
            ...(salesReports ? [
                [a.my_buyer_count, 'Unique buyers'],
                [a.my_paid_orders, 'Paid orders'],
                [Number(a.my_units_sold || 0), 'Units sold'],
                [money(a.my_sales_revenue), 'Sales revenue']
            ] : [])
        ].map(([v, l]) => `<div class="stat-tile"><h3>${v}</h3><p>${l}</p></div>`).join('');
        if (salesReports) {
            const salesByMonth = new Map((a.my_monthly_sales || []).map((month) => [month.month, month]));
            const months = [];
            const today = new Date();
            for (let offset = 11; offset >= 0; offset--) {
                const date = new Date(today.getFullYear(), today.getMonth() - offset, 1);
                const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                months.push({ key, label: date.toLocaleDateString(undefined, { month: 'short' }), ...(salesByMonth.get(key) || {}) });
            }
            const maxRevenue = Math.max(1, ...months.map((month) => Number(month.revenue) || 0));
            document.getElementById('analytics-sales-chart').innerHTML = months.map((month) => {
                const revenue = Number(month.revenue) || 0;
                const height = revenue ? Math.max(4, Math.round(revenue / maxRevenue * 100)) : 2;
                return `<div class="sales-chart-column" title="${escapeHtml(month.key)} · ${money(revenue)} · ${Number(month.units_sold || 0)} units">
                    <span class="sales-chart-value">${revenue ? money(revenue) : '—'}</span>
                    <div class="sales-chart-bar" style="height:${height}%"></div>
                    <span class="sales-chart-label">${escapeHtml(month.label)}</span>
                </div>`;
            }).join('');
            document.getElementById('analytics-buyers').innerHTML = a.my_product_buyers && a.my_product_buyers.length
                ? a.my_product_buyers.map((buyer) => `<article class="order-card">
                    <div class="order-head"><strong>${escapeHtml(buyer.product_name)}</strong><span>${money(buyer.revenue)}</span></div>
                    <p><strong>Buyer:</strong> ${escapeHtml(buyer.buyer_name || buyer.buyer_username)}</p>
                    <p><strong>Purchased:</strong> ${Number(buyer.quantity)} · ${Number(buyer.order_count)} paid order${Number(buyer.order_count) === 1 ? '' : 's'}</p>
                    <p style="color:var(--text-muted);"><strong>Latest purchase:</strong> ${escapeHtml(formatDateTime(buyer.last_purchase))}</p>
                </article>`).join('')
                : emptyBlock('fa-users', 'No paid product sales yet', 'Buyer and product details will appear here after a customer completes payment.');
        }
        const total = a.categories.reduce((s, c) => s + Number(c.count), 0);
        document.getElementById('analytics-bars').innerHTML = a.categories.length
            ? a.categories.map((c) => {
                const pct = total ? Math.round((Number(c.count) / total) * 100) : 0;
                return `<div class="bar-row"><span>${escapeHtml(c.category)}</span><div class="bar-track"><div class="bar-fill" style="width: ${pct}%;"></div></div><span>${Number(c.count)}</span></div>`;
            }).join('')
            : emptyBlock('fa-chart-simple', 'No listings yet', 'Category totals appear once products are approved.');
        document.getElementById('analytics-products').innerHTML = a.my_top_products && a.my_top_products.length
            ? `<div class="stack-list">${a.my_top_products.map((product) => {
                const reviewCount = Number(product.review_count) || 0;
                const averageRating = Number(product.average_rating) || 0;
                const ratingSummary = reviewCount
                    ? `<span class="analytics-product-rating"><span class="review-stars" aria-label="${averageRating.toFixed(1)} out of 5 stars">${'★'.repeat(Math.round(averageRating))}${'☆'.repeat(5 - Math.round(averageRating))}</span> <strong>${averageRating.toFixed(1)}</strong> · ${reviewCount} review${reviewCount === 1 ? '' : 's'}</span>`
                    : '<span class="analytics-product-unrated">No reviews yet</span>';
                return `<div class="widget-list-item analytics-product-item">
                    <div class="widget-list-item-info"><h4>${escapeHtml(product.product_name)}</h4><p>${escapeHtml(product.category)}</p></div>
                    ${ratingSummary}
                    <button type="button" class="btn-muted analytics-review-button" data-action="review-product" data-id="${escapeHtml(product.listing_id)}" data-name="${escapeHtml(product.product_name)}"><i class="fa-solid fa-star"></i> Reviews</button>
                </div>`;
            }).join('')}</div>`
            : emptyBlock('fa-box-open', 'No product reviews yet', 'Ratings for products you list will appear here.');
        renderFarmerProductListings();
        window.__analytics = a;
    } catch (error) {
        document.getElementById('analytics-tiles').innerHTML = emptyBlock('fa-chart-line', 'Analytics temporarily unavailable', 'Please try again shortly.');
        document.getElementById('analytics-bars').innerHTML = '';
        document.getElementById('analytics-products').innerHTML = '';
        document.getElementById('analytics-sales-chart').innerHTML = '';
        document.getElementById('analytics-buyers').innerHTML = '';
        toast(error.message, 'error');
    }
}
function renderFarmerProductListings() {
    const container = document.getElementById('analytics-product-listings');
    if (!container || !me || me.role !== 'farmer') return;
    const groups = new Map();
    state.listings.filter((listing) => String(listing.seller_id) === String(me.id)).forEach((listing) => {
        const key = productGroupKey(listing);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(listing);
    });
    const products = [...groups.values()].map((listings) => {
        const product = listings[0];
        const available = listings.filter(isListingBuyable);
        const expiredOnly = listings.some((listing) => listing.batch_id)
            && listings.filter((listing) => listing.batch_id).every((listing) => listing.batch_expired);
        const soldOutOnly = listings.some((listing) => listing.batch_id)
            && listings.filter((listing) => listing.batch_id).every((listing) => Number(listing.stock) <= 0);
        return {
            product,
            available,
            status: available.length ? 'Available on Marketplace'
                : (expiredOnly ? 'Not available · all batches expired'
                    : (soldOutOnly ? 'Not available · sold out' : 'Not available · create a batch'))
        };
    });
    container.innerHTML = products.length
        ? `<div class="stack-list">${products.map(({ product, available, status }) => `<div class="widget-list-item analytics-product-item">
            <img src="${escapeHtml(mediaUrl(product.image_url, DEFAULT_PRODUCT_IMG))}" alt="${escapeHtml(product.product_name)}" style="width:54px;height:54px;object-fit:cover;border-radius:8px;">
            <div class="widget-list-item-info"><h4>${escapeHtml(product.product_name)}</h4><p>${escapeHtml(product.category)} · ${escapeHtml(status)}</p>
                <p>${available.length ? available.map((listing) => `${escapeHtml(sellingUnitLabel(listing))}: ${Number(listing.stock)} available at ${money(listing.price)}`).join(' · ') : 'Not currently available to buyers'}</p>
            </div>
            <button type="button" class="btn-muted" data-action="edit-product" data-id="${escapeHtml(product.listing_id)}"><i class="fa-solid fa-pen"></i> Edit</button>
        </div>`).join('')}</div>`
        : emptyBlock('fa-box-open', 'No products posted yet', 'Post a product to see its marketplace availability here.');
}
function renderRightWidgets() {
    const a = window.__analytics;
    document.getElementById('stat-listings').textContent = (a ? a.active_listings : state.listings.filter((l) => Number(l.stock) > 0).length) + ' Active';
    document.getElementById('stat-verified').textContent = (a ? a.farmers : state.farmers.length) + ' Farmers';
    document.getElementById('trending-list').innerHTML = '<p style="font-size: 0.8rem; color: var(--text-muted);">No trending topics yet.</p>';
    renderPopularFarmers();
    renderLatestProducts();
}

/* ---------- farmer traceability ---------- */
let farmPickerMap = null;
let farmPickerMarker = null;
let farmerTraceabilityRequest = null;

function setTraceButtonLoading(button, loading, message = 'Loading...') {
    if (!button) return;
    if (loading) {
        if (button.dataset.traceLoading === 'true') return;
        button.dataset.traceLoading = 'true';
        button.dataset.traceOriginalHtml = button.innerHTML;
        button.dataset.traceWasDisabled = button.disabled ? 'true' : 'false';
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.innerHTML = `<span class="farmer-trace-button-spinner" aria-hidden="true"></span><span>${escapeHtml(message)}</span>`;
        return;
    }
    if (button.dataset.traceLoading !== 'true') return;
    button.innerHTML = button.dataset.traceOriginalHtml || '';
    button.disabled = button.dataset.traceWasDisabled === 'true';
    button.removeAttribute('aria-busy');
    delete button.dataset.traceLoading;
    delete button.dataset.traceOriginalHtml;
    delete button.dataset.traceWasDisabled;
}

async function runTraceButton(button, message, action) {
    if (!button || button.dataset.traceLoading === 'true') return;
    setTraceButtonLoading(button, true, message);
    try {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        return await action();
    } finally {
        setTraceButtonLoading(button, false);
    }
}

function traceDate(value) {
    if (!value) return 'Not set';
    const date = new Date(String(value).replace(' ', 'T'));
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}
function farmerTraceCard(title, details, actions = '') {
    return `<article class="widget-list-item" style="align-items:flex-start; flex-wrap:wrap; gap:12px;">
        <div class="widget-list-item-info" style="min-width:180px; flex:1;"><h4>${escapeHtml(title)}</h4>
            ${details.map(([label, value]) => `<p>${escapeHtml(label)}: ${escapeHtml(value || '—')}</p>`).join('')}
        </div><div style="display:flex; flex-wrap:wrap; gap:8px;">${actions}</div>
    </article>`;
}
async function loadFarmerTraceability() {
    if (farmerTraceabilityRequest) return farmerTraceabilityRequest;
    const buttons = Array.from(document.querySelectorAll('#view-farmer-trace [data-trace-action]'));
    buttons.forEach((button) => setTraceButtonLoading(button, true, 'Loading...'));
    const loadingMarkup = '<p class="farmer-trace-loading" role="status"><span class="farmer-trace-button-spinner" aria-hidden="true"></span> Loading traceability records...</p>';
    ['farms', 'batches', 'harvests', 'shipments'].forEach((section) => {
        const element = document.getElementById(`farmer-trace-${section}`);
        if (element) element.innerHTML = loadingMarkup;
    });
    farmerTraceabilityRequest = api('/farmer/traceability')
        .then((result) => {
            state.traceability = result.data;
            renderFarmerTraceability();
        })
        .catch((error) => {
            state.traceability = null;
            const errorMarkup = `<div class="farmer-trace-loading" role="alert">Traceability records could not be loaded. <button class="btn-muted" type="button" data-trace-reload>Try again</button></div>`;
            ['farms', 'batches', 'harvests', 'shipments'].forEach((section) => {
                const element = document.getElementById(`farmer-trace-${section}`);
                if (element) element.innerHTML = errorMarkup;
            });
            toast(error.message, 'error');
        })
        .finally(() => {
            buttons.forEach((button) => setTraceButtonLoading(button, false));
            farmerTraceabilityRequest = null;
        });
    return farmerTraceabilityRequest;
}
function renderFarmerTraceability() {
    const data = state.traceability;
    if (!data) return;
    const farms = data.farms || [];
    const batches = data.batches || [];
    const harvests = data.harvests || [];
    const shipments = data.shipments || [];
    const stat = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
    stat('trace-stat-farms', farms.length);
    stat('trace-stat-catalog', new Set(batches.map((batch) => batch.product_id).filter(Boolean)).size);
    stat('trace-stat-batches', batches.filter((batch) =>
        !['sold', 'rejected'].includes(batch.current_status)
        && Number(batch.available_quantity ?? batch.quantity ?? 0) > 0
        && (!batch.expiration_date || batch.expiration_date >= new Date().toISOString().slice(0, 10))
    ).length);
    stat('trace-stat-stock', batches.reduce((total, batch) => total + Number(batch.available_quantity ?? batch.quantity ?? 0), 0).toLocaleString('en-PH'));
    const farmsElement = document.getElementById('farmer-trace-farms');
    const batchesElement = document.getElementById('farmer-trace-batches');
    const harvestsElement = document.getElementById('farmer-trace-harvests');
    const shipmentsElement = document.getElementById('farmer-trace-shipments');
    if (farmsElement) farmsElement.innerHTML = farms.length
        ? farms.map((farm) => farmerTraceCard(farm.farm_name, [
            ['Farm ID', farm.farm_id],
            ['Location', [farm.barangay, farm.municipality, farm.province].filter(Boolean).join(', ') || 'Not set']
        ], `<button type="button" class="btn-muted" data-trace-action="edit-farm" data-id="${escapeHtml(farm.farm_id)}">Edit farm</button>`)).join('')
        : '<p style="color:var(--text-muted);">No farms registered yet. Register your farm before creating a batch.</p>';
    if (batchesElement) batchesElement.innerHTML = batches.length
        ? batches.map((batch) => {
            const expired = Boolean(batch.expiration_date) && batch.expiration_date < new Date().toISOString().slice(0, 10);
            return farmerTraceCard(batch.batch_code, [
            ['Batch ID', batch.batch_id],
            ['Quantity', `${batch.quantity} ${batch.unit}`],
            ['Unit price', batch.unit_price ? `${money(batch.unit_price)} / ${batch.selling_unit === 'other' ? batch.unit : batch.selling_unit}` : 'Not set'],
            ['Product status', expired ? 'Expired' : 'Good'],
            ['Inventory status', String(batch.current_status || '').replace(/_/g, ' ')],
            ['Harvest date', batch.harvest_date || 'Not set'],
            ['Expiration date', batch.expiration_date || 'Not set']
        ], `${batch.qr_url ? `<img src="${escapeHtml(batch.qr_url)}" alt="QR code for ${escapeHtml(batch.batch_code)}" style="width:72px;height:72px;object-fit:contain;background:#fff;padding:4px;border-radius:6px;">` : '<span class="field-help">QR will appear after creation.</span>'}
            <a class="btn-muted" href="/trace?batch=${encodeURIComponent(batch.batch_code)}" target="_blank" rel="noopener">Public trace</a>
            <button type="button" class="btn-muted" data-trace-action="batch-shipment" data-id="${escapeHtml(batch.batch_id)}">Add shipment</button>
            <button type="button" class="btn-muted" data-trace-action="edit-batch" data-id="${escapeHtml(batch.batch_id)}">Update status</button>
            <button type="button" class="btn-muted" data-trace-action="delete-batch" data-id="${escapeHtml(batch.batch_id)}" style="color:var(--danger);">Delete batch</button>`);
        }).join('')
        : '<p style="color:var(--text-muted);">No batches yet. Create a batch after registering a farm.</p>';
    if (harvestsElement) harvestsElement.innerHTML = harvests.length
        ? harvests.map((harvest) => {
            const batch = batches.find((item) => String(item.batch_id) === String(harvest.batch_id));
            return farmerTraceCard(batch ? batch.batch_code : `Batch #${harvest.batch_id}`, [
                ['Harvest date', harvest.harvest_date],
                ['Quantity', harvest.quantity_harvested],
                ['Quality', harvest.quality_grade || 'Not graded'],
                ['Approval', harvest.approval_status || 'pending'],
                ['Notes', harvest.notes || '—']
            ], `<button type="button" class="btn-muted" data-trace-action="edit-harvest" data-id="${escapeHtml(harvest.harvest_id)}">Edit harvest</button>
                <button type="button" class="btn-muted" data-trace-action="delete-harvest" data-id="${escapeHtml(harvest.harvest_id)}" style="color:var(--danger);">Delete harvest</button>`);
        }).join('')
        : '<p style="color:var(--text-muted);">No harvest records yet. Add one to a batch; an administrator must approve it for public provenance.</p>';
    if (shipmentsElement) shipmentsElement.innerHTML = shipments.length
        ? shipments.map((shipment) => {
            const batch = batches.find((item) => String(item.batch_id) === String(shipment.batch_id));
            return farmerTraceCard(batch ? batch.batch_code : `Batch #${shipment.batch_id}`, [
                ['Route', `${shipment.origin} → ${shipment.destination}`],
                ['Status', String(shipment.shipment_status || '').replace(/_/g, ' ')],
                ['Dispatched', traceDate(shipment.dispatch_time)],
                ['Delivered', traceDate(shipment.delivery_time)],
                ['Notes', shipment.remarks || '—']
            ], `<button type="button" class="btn-muted" data-trace-action="edit-shipment" data-id="${escapeHtml(shipment.shipment_id)}">Update shipment</button>`);
        }).join('')
        : '<p style="color:var(--text-muted);">No shipments recorded yet.</p>';
}

async function deleteFarmerTraceRecord(resource, recordId) {
    const typeLabel = resource === 'batches' ? 'batch' : 'harvest record';
    const warning = resource === 'batches'
        ? 'Deleting this batch removes its marketplace/feed post and unlinks its product listing. Batches linked to orders cannot be deleted.'
        : 'Delete this harvest record? Records linked to an order allocation cannot be deleted.';
    if (!confirm(warning)) return;
    await api(`/${resource}/${encodeURIComponent(recordId)}`, { method: 'DELETE' });
    if (resource === 'batches') {
        await Promise.all([loadFarmerTraceability(), loadMarketplace(), loadFeed()]);
    } else {
        await loadFarmerTraceability();
    }
    toast(`${typeLabel[0].toUpperCase()}${typeLabel.slice(1)} deleted.`, 'success');
}

async function updateFarmPickerLocation(lat, lng) {
    const latitude = document.getElementById('farmer-trace-latitude');
    const longitude = document.getElementById('farmer-trace-longitude');
    const address = document.getElementById('farmer-trace-farm_address');
    const status = document.getElementById('farm-location-status');
    if (!latitude || !longitude || !status) return;

    latitude.value = String(lat);
    longitude.value = String(lng);
    status.textContent = `Selected location: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    if (farmPickerMarker) farmPickerMarker.setLatLng([lat, lng]);
    if (farmPickerMap) farmPickerMap.setView([lat, lng], 16);

    if (address) {
        try {
            const location = await geoReverseDetails(lat, lng);
            if (location && latitude.value === String(lat) && longitude.value === String(lng)) {
                if (location.label) address.value = location.label;
                [
                    ['province', location.province],
                    ['municipality', location.municipality],
                    ['barangay', location.barangay]
                ].forEach(([name, value]) => {
                    const input = document.getElementById(`farmer-trace-${name}`);
                    if (input && value) input.value = value;
                });
                status.textContent = `Selected location: ${location.label || `${lat.toFixed(5)}, ${lng.toFixed(5)}`}`;
            }
        } catch (error) {
            toast(error.message || 'The address could not be looked up. The map location was saved.', 'error');
        }
    }
}

async function initializeFarmPicker() {
    const mapElement = document.getElementById('farm-location-map');
    const status = document.getElementById('farm-location-status');
    if (!mapElement || !status) return;

    if (farmPickerMap) {
        farmPickerMap.remove();
        farmPickerMap = null;
        farmPickerMarker = null;
    }
    try {
        const latitudeField = document.getElementById('farmer-trace-latitude');
        const longitudeField = document.getElementById('farmer-trace-longitude');
        const latitude = Number(latitudeField.value);
        const longitude = Number(longitudeField.value);
        const hasLocation = latitudeField.value !== '' && longitudeField.value !== ''
            && Number.isFinite(latitude) && Number.isFinite(longitude);
        const center = hasLocation ? [latitude, longitude] : [13.6218, 123.1948];
        const { map, L } = await createMap('farm-location-map', center[0], center[1], hasLocation ? 15 : 6);
        farmPickerMap = map;
        farmPickerMarker = L.marker(center, { draggable: true }).addTo(map);
        map.on('click', (event) => updateFarmPickerLocation(event.latlng.lat, event.latlng.lng));
        farmPickerMarker.on('dragend', (event) => {
            const point = event.target.getLatLng();
            updateFarmPickerLocation(point.lat, point.lng);
        });
        if (hasLocation) {
            status.textContent = `Selected location: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
        }
        window.setTimeout(() => map.invalidateSize(), 100);
    } catch (error) {
        status.textContent = error.message || 'The map could not be loaded.';
        toast(status.textContent, 'error');
    }
}

function useFarmCurrentLocation() {
    if (!navigator.geolocation) {
        return Promise.reject(new Error('Your browser does not support location access. Select a point on the map instead.'));
    }
    return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                try {
                    await updateFarmPickerLocation(position.coords.latitude, position.coords.longitude);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            },
            (error) => {
                const message = error.code === error.PERMISSION_DENIED
                    ? 'Location permission was denied. Allow location access or select a point on the map.'
                    : 'Could not get your location. Check your device location settings or select a point on the map.';
                reject(new Error(message));
            },
            { enableHighAccuracy: true, timeout: 15000 }
        );
    });
}

async function openFarmerTraceForm(type, recordId = '', batchId = '') {
    if (!me || !['admin', 'farmer'].includes(me.role)) {
        toast('Only farmers and administrators can manage traceability records.', 'error');
        return;
    }
    if (!state.traceability) {
        toast('Traceability data is still loading. Please try again.', 'error');
        return;
    }
    if (type === 'batches' && me.role === 'farmer') {
        await loadMarketplace();
    }
    const data = state.traceability;
    const choose = (items, id, label) => items.map((item) => [
        item[id],
        label(item)
    ]);
    const batchOptions = choose(data.batches || [], 'batch_id', (batch) => `${batch.batch_code} (#${batch.batch_id})`);
    const productDrafts = (state.listings || []).filter((listing) =>
        me.role === 'farmer'
        && String(listing.seller_id) === String(me.id)
        && !listing.batch_id
        && listing.catalog_id
    );
    const batchProductOptions = choose(productDrafts, 'listing_id', (listing) =>
        `${listing.product_name} · ${listing.farm_name || 'Registered farm'}`
    );
    const config = {
        farms: {
            title: 'farm',
            heading: 'Register farm',
            resource: 'farms',
            help: 'Farm details and exact coordinates are private in the public trace.',
            fields: [
                { name: 'farm_name', label: 'Farm name', required: true },
                { name: 'farm_address', label: 'Full address', type: 'textarea', full: true },
                { name: 'province', label: 'Province' },
                { name: 'municipality', label: 'Municipality' },
                { name: 'barangay', label: 'Barangay' },
                { name: 'farm_size', label: 'Farm size', type: 'number', min: '0', step: '0.01' },
                { name: 'farm_size_unit', label: 'Size unit', placeholder: 'hectares, acres…' }
            ]
        },
        batches: {
            title: 'batch',
            heading: 'Create batch',
            resource: 'batches',
            help: 'Set the batch quantity, price, and selling unit. This publishes the selected product to the marketplace and feed.',
            fields: [
                { name: 'product_listing_id', label: 'Product', type: 'select', required: true, options: batchProductOptions },
                { name: 'farm_id', label: 'Your farm', type: 'hidden' },
                { name: 'farm_display', label: 'Your farm', type: 'readonly', value: '' },
                { name: 'quantity', label: 'Quantity', type: 'number', required: true, min: '0.01', step: '0.01' },
                { name: 'unit_price', label: 'Unit price (₱)', type: 'number', required: true, min: '0.01', step: '0.01' },
                { name: 'selling_unit', label: 'Selling unit', type: 'select', required: true, options: [
                    ['kg', 'Per kilogram'], ['piece', 'Per piece'], ['bundle', 'Per bundle'], ['pack', 'Per pack'],
                    ['sack', 'Per sack'], ['box', 'Per box'], ['dozen', 'Per dozen'], ['set', 'Per set'],
                    ['liter', 'Per liter'], ['other', 'Other']
                ] },
                { name: 'unit', label: 'Unit', required: true, value: 'kg', placeholder: 'kg, bundles, bunches…' },
                { name: 'harvest_date', label: 'Harvest date', type: 'date', required: true },
                { name: 'expiration_date', label: 'Expiration date (optional)', type: 'date' }
            ]
        },
        harvests: {
            title: 'harvest record',
            heading: 'Add harvest record',
            resource: 'harvests',
            help: 'The record will be pending until an administrator approves it.',
            fields: [
                { name: 'batch_id', label: 'Batch', type: 'select', required: true, options: batchOptions },
                { name: 'harvest_reference', label: 'Harvest reference', placeholder: 'Generated when left blank' },
                { name: 'product_id', label: 'Product catalog', type: 'select', required: true, options: choose(data.products || [], 'product_id', (product) => product.product_name) },
                { name: 'harvest_date', label: 'Harvest date', type: 'date', required: true },
                { name: 'quantity_harvested', label: 'Quantity harvested', type: 'number', required: true, min: '0.01', step: '0.01' },
                { name: 'unit_of_measure', label: 'Unit of measurement', required: true, placeholder: 'kg, crates, bunches…' },
                { name: 'quality_grade', label: 'Quality grade' },
                { name: 'harvest_status', label: 'Harvest status', type: 'select', required: true, value: 'harvested', options: [
                    ['planned', 'Planned'], ['harvested', 'Harvested'], ['available', 'Available'], ['depleted', 'Depleted'], ['cancelled', 'Cancelled']
                ] },
                { name: 'description', label: 'Harvest description', type: 'textarea', full: true },
                { name: 'notes', label: 'Notes', type: 'textarea', full: true }
            ]
        },
        shipments: {
            title: 'shipment',
            heading: 'Record shipment',
            resource: 'shipments',
            help: 'Record the dispatch and delivery times to add movement events to the public supply-chain timeline.',
            fields: [
                { name: 'batch_id', label: 'Batch', type: 'select', required: true, options: batchOptions },
                { name: 'transporter_id', label: 'Assigned transporter', type: 'select', required: true, options: choose(data.transporters || [], 'id', (person) => `${[person.first_name, person.last_name].filter(Boolean).join(' ') || person.username} (#${person.id})`) },
                { name: 'origin', label: 'Origin', required: true },
                { name: 'destination', label: 'Destination', required: true },
                { name: 'vehicle_number', label: 'Vehicle number' },
                { name: 'shipment_status', label: 'Status', type: 'select', required: true, value: 'pending', options: [
                    ['pending', 'Pending'], ['in_transit', 'In transit'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled']
                ] },
                { name: 'dispatch_time', label: 'Dispatch time', type: 'datetime-local' },
                { name: 'delivery_time', label: 'Delivery time', type: 'datetime-local' },
                { name: 'remarks', label: 'Shipment notes', type: 'textarea', full: true }
            ]
        }
    }[type];
    if (!config) return;
    if (type === 'batches' && me.role === 'admin' && !recordId) {
        config.fields = [
            { name: 'batch_code', label: 'Batch code (optional)', placeholder: 'Generated when left blank' },
            { name: 'harvest_reference', label: 'Harvest reference', placeholder: 'For example, HAR-20261104-001' },
            { name: 'product_id', label: 'Product', type: 'select', required: true, options: choose(data.products || [], 'product_id', (product) => product.product_name) },
            { name: 'farm_id', label: 'Farm', type: 'select', required: true, options: choose(data.farms || [], 'farm_id', (farm) => `${farm.farm_name} (#${farm.farm_id})`) },
            { name: 'quantity', label: 'Quantity', type: 'number', required: true, min: '0.01', step: '0.01' },
            { name: 'unit', label: 'Unit', required: true, placeholder: 'kg, crates, bunches…' },
            { name: 'harvest_date', label: 'Harvest date', type: 'date', required: true },
            { name: 'expiration_date', label: 'Expiration date (optional)', type: 'date' },
            { name: 'current_status', label: 'Status', type: 'select', required: true, value: 'harvested', options: [
                ['harvested', 'Harvested'], ['collected', 'Collected'], ['in_transit', 'In transit'],
                ['received', 'Received'], ['available_at_market', 'Available at market'], ['sold', 'Sold'], ['rejected', 'Rejected']
            ] },
            { name: 'trace_code', label: 'Paid order trace code (optional)', full: true }
        ];
    }
    if (type === 'batches' && recordId) {
        config.fields = [
            { name: 'current_status', label: 'Status', type: 'select', required: true, options: [
                ['harvested', 'Harvested'], ['collected', 'Collected'], ['in_transit', 'In transit'],
                ['received', 'Received'], ['available_at_market', 'Available at market'], ['sold', 'Sold'], ['rejected', 'Rejected']
            ] },
            { name: 'expiration_date', label: 'Expiration date (optional)', type: 'date' }
        ];
    }
    const missing = config.fields.filter((field) => field.required && field.type === 'select' && !field.options.length);
    if (missing.length) {
        toast(`No ${missing.map((field) => field.label.toLowerCase()).join(' or ')} available. Ask an administrator to set it up first.`, 'error');
        return;
    }
    const recordKey = { farms: 'farm_id', batches: 'batch_id', harvests: 'harvest_id', shipments: 'shipment_id' }[type];
    const record = recordId
        ? (data[type] || []).find((item) => String(item[recordKey]) === String(recordId))
        : null;
    if (recordId && !record) {
        toast('Record not found. Refresh and try again.', 'error');
        return;
    }
    document.getElementById('farmer-trace-form').reset();
    document.getElementById('farmer-trace-form-title').textContent = record ? `Update ${config.title}` : config.heading;
    document.getElementById('farmer-trace-form-help').textContent = config.help;
    const form = document.getElementById('farmer-trace-form');
    form.dataset.resource = config.resource;
    form.dataset.recordId = record ? String(recordId) : '';
    document.getElementById('farmer-trace-form-fields').style.gridTemplateColumns = 'repeat(auto-fit, minmax(220px, 1fr))';
    document.getElementById('farmer-trace-form-fields').innerHTML = config.fields.map((field) => {
        const required = field.required ? ' required' : '';
        const full = field.full ? ' full-width' : '';
        const label = `<label for="farmer-trace-${field.name}">${escapeHtml(field.label)}${field.required ? ' *' : ''}</label>`;
        if (field.type === 'hidden') {
            return `<input id="farmer-trace-${field.name}" name="${field.name}" type="hidden">`;
        }
        if (field.type === 'readonly') {
            return `<div class="input-group${full}">${label}<input id="farmer-trace-${field.name}" type="text" readonly value="${escapeHtml(field.value || '')}"></div>`;
        }
        if (field.type === 'select') {
            const options = field.options.map(([value, name]) =>
                `<option value="${escapeHtml(value)}"${String(value) === String(field.value || '') ? ' selected' : ''}>${escapeHtml(name)}</option>`
            ).join('');
            return `<div class="input-group${full}">${label}<select id="farmer-trace-${field.name}" name="${field.name}"${required}><option value="">Select ${escapeHtml(field.label.toLowerCase())}</option>${options}</select></div>`;
        }
        if (field.type === 'textarea') {
            return `<div class="input-group${full}">${label}<textarea id="farmer-trace-${field.name}" name="${field.name}" rows="3"${required}></textarea></div>`;
        }
        return `<div class="input-group${full}">${label}<input id="farmer-trace-${field.name}" name="${field.name}" type="${field.type || 'text'}" value="${escapeHtml(field.value || '')}" placeholder="${escapeHtml(field.placeholder || '')}"${field.min ? ` min="${field.min}"` : ''}${field.step ? ` step="${field.step}"` : ''}${field.readonly ? ' readonly' : ''}${required}></div>`;
    }).join('');
    if (type === 'batches' && me.role === 'farmer' && !record) {
        document.getElementById('farmer-trace-form-fields').insertAdjacentHTML('beforeend', `
            <p class="field-help full-width">Batch code is generated automatically when you create this batch.</p>
            <div id="farmer-trace-product-preview" class="full-width hidden" style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--bg-main);border-radius:8px;">
                <img id="farmer-trace-product-image" src="${DEFAULT_PRODUCT_IMG}" alt="Selected product" style="width:72px;height:72px;object-fit:cover;border-radius:8px;">
                <div><strong id="farmer-trace-product-name"></strong><p id="farmer-trace-product-date" class="field-help"></p></div>
            </div>`);
    }
    if (batchId) {
        const select = document.getElementById('farmer-trace-batch_id');
        if (select) select.value = String(batchId);
    }
    if (record) {
        config.fields.forEach((field) => {
            const input = document.getElementById(`farmer-trace-${field.name}`);
            if (!input || record[field.name] === null || record[field.name] === undefined) return;
            const value = String(record[field.name]);
            input.value = input.type === 'datetime-local' ? value.replace(' ', 'T').slice(0, 16) : value;
        });
        if (type === 'batches') {
            const batchCode = document.getElementById('farmer-trace-batch_code');
            if (batchCode) batchCode.readOnly = true;
        }
    }
    if (type === 'farms') {
        const picker = document.createElement('section');
        picker.className = 'farm-location-picker full-width';
        picker.innerHTML = `
            <label for="farm-location-map">Farm location</label>
            <p class="farm-location-help">Select a point on the map, drag the pin, or allow your device to use your current location. The address field will be filled in when available.</p>
            <div class="farm-location-controls">
                <button id="farm-location-current" class="btn-muted" type="button" data-trace-location><i class="fa-solid fa-location-crosshairs"></i> Use my location</button>
                <span id="farm-location-status" role="status">No map location selected.</span>
            </div>
            <div id="farm-location-map" class="farm-location-map" role="application" aria-label="Select farm location on map"></div>
            <input id="farmer-trace-latitude" name="latitude" type="hidden">
            <input id="farmer-trace-longitude" name="longitude" type="hidden">`;
        document.getElementById('farmer-trace-form-fields').prepend(picker);
        document.getElementById('farmer-trace-latitude').value = record && record.latitude != null ? String(record.latitude) : '';
        document.getElementById('farmer-trace-longitude').value = record && record.longitude != null ? String(record.longitude) : '';
    } else if (farmPickerMap) {
        farmPickerMap.remove();
        farmPickerMap = null;
        farmPickerMarker = null;
    }
    document.getElementById('farmer-trace-submit').textContent = record ? `Save ${config.title}` : config.heading;
    openModal('farmer-trace-modal');
    if (type === 'batches' && !record) {
        const unit = document.getElementById('farmer-trace-unit');
        if (unit) unit.readOnly = true;
        const selectedProduct = document.getElementById('farmer-trace-product_listing_id');
        if (selectedProduct) updateBatchProductPreview(selectedProduct.value);
    }
    if (type === 'farms') await initializeFarmPicker();
}
function updateBatchProductPreview(listingId) {
    const listing = state.listings.find((item) => String(item.listing_id) === String(listingId));
    const preview = document.getElementById('farmer-trace-product-preview');
    const image = document.getElementById('farmer-trace-product-image');
    const name = document.getElementById('farmer-trace-product-name');
    const date = document.getElementById('farmer-trace-product-date');
    if (!preview || !image || !name || !date) return;
    preview.classList.toggle('hidden', !listing);
    if (!listing) return;
    image.src = mediaUrl(listing.image_url, DEFAULT_PRODUCT_IMG);
    name.textContent = listing.product_name;
    date.textContent = `Posted ${formatDateTime(listing.created_at)} · ${listing.farm_name || 'Registered farm'}`;
}
async function saveFarmerTraceRecord(event) {
    event.preventDefault();
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.id !== 'farmer-trace-form') {
        return;
    }
    const body = {};
    new FormData(form).forEach((value, name) => {
        if (value === '') return;
        const field = form.elements.namedItem(name);
        if (field.type === 'number' || ['batch_id', 'product_id', 'product_listing_id', 'farm_id', 'transporter_id'].includes(name)) {
            body[name] = Number(value);
        } else if (field.type === 'datetime-local') {
            body[name] = value.replace('T', ' ') + ':00';
        } else {
            body[name] = value.trim();
        }
    });
    const submit = document.getElementById('farmer-trace-submit');
    return runTraceButton(submit, 'Saving...', async () => {
        try {
            const recordId = form.dataset.recordId;
            const result = await api(`/${form.dataset.resource}${recordId ? `/${encodeURIComponent(recordId)}` : ''}`, {
                method: recordId ? 'PUT' : 'POST',
                body
            });
            toast(result.qr_error ? `${result.message} ${result.qr_error}` : (result.message || 'Traceability record saved.'), result.qr_error ? 'error' : 'success');
            closeModal('farmer-trace-modal');
            if (form.dataset.resource === 'batches' && !recordId) {
                await Promise.all([loadFarmerTraceability(), loadMarketplace(), loadFeed()]);
            } else {
                await loadFarmerTraceability();
            }
        } catch (error) {
            toast(error.message, 'error');
        }
    });
}

/* ---------- search & navigation ---------- */
function onSearch(value) {
    searchTerm = value.trim().toLowerCase();
    clearTimeout(searchTimer);
    const requestId = ++searchRequestSequence;
    renderMarketplace();
    renderFarmers();
    if (searchTerm.length < 2) {
        state.searchResults = null;
        if (currentView === 'search-results') switchView(viewBeforeSearch);
        return;
    }
    if (currentView !== 'search-results') {
        viewBeforeSearch = currentView;
        switchView('search-results');
    }
    document.getElementById('search-results-summary').textContent = `Searching Marketplace, FarmerHub, and registered farms for "${value.trim()}"...`;
    document.getElementById('search-products').innerHTML = emptyBlock('fa-circle-notch fa-spin', 'Searching products', '');
    document.getElementById('search-farmers').innerHTML = emptyBlock('fa-circle-notch fa-spin', 'Searching FarmerHub', '');
    document.getElementById('search-registered-farms').innerHTML = emptyBlock('fa-circle-notch fa-spin', 'Searching farms', '');
    searchTimer = setTimeout(async () => {
        try {
            const result = await api(`/search?q=${encodeURIComponent(value.trim())}`);
            if (requestId !== searchRequestSequence) return;
            state.searchResults = result.data;
            renderSearchResults(value.trim());
        } catch (error) {
            if (requestId !== searchRequestSequence) return;
            document.getElementById('search-results-summary').textContent = 'Search could not be completed.';
            document.getElementById('search-products').innerHTML = emptyBlock('fa-triangle-exclamation', 'Search unavailable', error.message);
            document.getElementById('search-farmers').innerHTML = '';
            document.getElementById('search-registered-farms').innerHTML = '';
            toast(error.message, 'error');
        }
    }, 250);
}
function renderSearchResults(query) {
    const results = state.searchResults || {};
    const products = results.products || [];
    const farmers = results.farmers || [];
    const farms = results.farms || [];
    const total = products.length + farmers.length + farms.length;
    document.getElementById('search-results-summary').textContent = `${total} related result${total === 1 ? '' : 's'} for "${query}"`;
    document.getElementById('search-products').innerHTML = products.length
        ? products.map(productCardHTML).join('')
        : emptyBlock('fa-box-open', 'No related products', 'Available Marketplace products connected to this search will appear here.');
    document.getElementById('search-farmers').innerHTML = farmers.length
        ? farmers.map(farmerCardHTML).join('')
        : emptyBlock('fa-user-slash', 'No related farmers', 'Farmers who match or sell related products will appear here.');
    document.getElementById('search-registered-farms').innerHTML = farms.length
        ? farms.map((farm) => {
            const ownerName = [farm.first_name, farm.middle_name, farm.last_name].filter(Boolean).join(' ') || farm.username || 'Farmer profile';
            const location = [farm.municipality, farm.province].filter(Boolean).join(', ') || 'Location not set';
            return `<article class="search-farm-card" data-action="farmer-profile" data-id="${escapeHtml(farm.farmer_id)}" tabindex="0" role="button" aria-label="View ${escapeHtml(farm.farm_name)} farm and farmer profile">
                <h4><i class="fa-solid fa-seedling"></i> ${escapeHtml(farm.farm_name)}</h4>
                <p><i class="fa-solid fa-location-dot"></i> ${escapeHtml(location)}</p>
                <p><i class="fa-solid fa-user"></i> ${escapeHtml(ownerName)}</p>
                ${farm.farm_description ? `<p style="margin-top:8px;">${escapeHtml(farm.farm_description)}</p>` : ''}
                <button type="button" class="btn-muted" data-action="farmer-profile" data-id="${escapeHtml(farm.farmer_id)}">View farmer &amp; products</button>
            </article>`;
        }).join('')
        : emptyBlock('fa-seedling', 'No registered farms', 'Registered farms connected to this search will appear here.');
}
function switchView(name, opts = {}) {
    if (!document.getElementById('view-' + name)) return;
    currentView = name;
    document.querySelectorAll('.view-section').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
    const navKey = opts.navKey || name;
    document.querySelectorAll('.sidebar .nav-item[data-view]').forEach((n) => n.classList.toggle('active', n.dataset.view === navKey));
    document.querySelector('.app-container').classList.toggle('no-right', name !== 'feed');
    const routeHash = Object.keys(HASH_ROUTES).find((key) => HASH_ROUTES[key][0] === name);
    if (routeHash && location.hash !== `#${routeHash}`) {
        history.replaceState(history.state, '', '/dashboard#' + routeHash);
    }
    if (name === 'orders') loadOrders();
    if (name === 'saved') loadSaved();
    if (name === 'analytics') loadAnalytics();
    if (name === 'market') renderMarketplace();
    if (name === 'farmer-hub') renderFarmers();
    if (name === 'farmer-trace') loadFarmerTraceability();
    if (name === 'farmer-application') loadFarmerApplication();
    document.querySelector('.main-content').scrollTop = 0;
    window.scrollTo(0, 0);
    if (window.innerWidth <= 900) toggleSidebar(false);
}
const HASH_ROUTES = {
    feed: ['feed'], market: ['market'], 'farmer-hub': ['farmer-hub'], 'farmer-application': ['farmer-application'], 'farmer-trace': ['farmer-trace'], analytics: ['analytics'],
    orders: ['orders'], saved: ['saved'], help: ['help']
};

async function loadFarmerApplication() {
    if (farmerApplicationLoaded || !me || me.role !== 'collector') return;
    const status = document.getElementById('farmer-application-status');
    const form = document.getElementById('farmer-application-form');
    try {
        const result = await api('/farmer-applications/mine');
        const application = result.data;
        farmerApplicationLoaded = true;
        if (!application) {
            status.textContent = 'No application submitted yet.';
            return;
        }
        status.textContent = application.status === 'rejected'
            ? `Rejected: ${application.rejection_reason || 'No reason provided.'} You may submit a new application.`
            : `Application status: ${application.status}.`;
        if (application.status === 'pending') {
            form.querySelectorAll('input, textarea, button').forEach((element) => { element.disabled = true; });
        }
    } catch (error) {
        status.textContent = error.message;
    }
}

async function submitFarmerApplication(event) {
    event.preventDefault();
    const form = event.target;
    const submit = document.getElementById('farmer-application-submit');
    submit.disabled = true;
    try {
        const body = {};
        new FormData(form).forEach((value, name) => { if (String(value).trim() !== '') body[name] = String(value).trim(); });
        const result = await api('/farmer-applications', { method: 'POST', body });
        toast(result.message || 'Application submitted.', 'success');
        form.reset();
        farmerApplicationLoaded = false;
        await loadFarmerApplication();
    } catch (error) {
        toast(error.message, 'error');
    } finally {
        submit.disabled = false;
    }
}
function routeFromHash() {
    const route = HASH_ROUTES[location.hash.replace('#', '')] || HASH_ROUTES.feed;
    switchView(route[0], route[1] || {});
}

/* ---------- settings ---------- */
function toggleDarkMode() {
    localStorage.setItem('theme', document.getElementById('darkmode-toggle').checked ? 'dark' : 'light');
    document.body.classList.toggle('light-mode', localStorage.getItem('theme') === 'light');
}
function changeLanguage() {
    const lang = document.getElementById('language-select').value;
    localStorage.setItem('language', lang);
    toast(`Language preference saved (${lang.toUpperCase()}). Full translations are not available yet.`, 'info');
}
function savePreferences() {
    closeModal('settings-modal');
    toast('Preferences saved.');
}

/* ---------- start-up ---------- */
async function initPage() {
    installModalBehaviour();
    const user = await requireSession();
    if (!user) return;
    me = user;
    initShell(me);
    document.getElementById('complaint-name').value = fullName(me);
    document.getElementById('complaint-email').value = me.email || '';
    document.getElementById('post-placeholder').placeholder = `What's on your mind, ${me.first_name || 'there'}?`;
    document.getElementById('post-avatar').src = avatarOf(me);
    document.getElementById('darkmode-toggle').checked = localStorage.getItem('theme') !== 'light';
    document.getElementById('language-select').value = localStorage.getItem('language') || 'en';
    document.getElementById('product-category').innerHTML = CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('');
    document.getElementById('edit-product-category').innerHTML = CATEGORIES.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    listen(document.getElementById('edit-post-files'), 'change', previewEditPostFiles);
    listen(document.getElementById('edit-product-image'), 'change', (event) => {
        const file = event.target.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            event.target.value = '';
            toast('Choose an image file for the product.', 'error');
            return;
        }
        document.getElementById('edit-product-image-preview').src = URL.createObjectURL(file);
    });

    listen(document, 'click', (e) => {
        const image = e.target.closest('[data-view-image]');
        if (image) {
            openDashboardImage(image);
            return;
        }
        const traceAction = e.target.closest('[data-trace-action]');
        if (traceAction) {
            const action = traceAction.dataset.traceAction;
            const id = traceAction.dataset.id || '';
            const actions = {
                'batch-shipment': () => openFarmerTraceForm('shipments', '', id),
                'edit-batch': () => openFarmerTraceForm('batches', id),
                'edit-farm': () => openFarmerTraceForm('farms', id),
                'edit-harvest': () => openFarmerTraceForm('harvests', id),
                'edit-shipment': () => openFarmerTraceForm('shipments', id),
                'delete-batch': () => deleteFarmerTraceRecord('batches', id),
                'delete-harvest': () => deleteFarmerTraceRecord('harvests', id)
            };
            const handler = actions[action];
            if (handler) runTraceButton(traceAction, 'Opening...', handler).catch((error) => toast(error.message, 'error'));
            return;
        }
        const traceOpen = e.target.closest('[data-trace-open]');
        if (traceOpen) {
            openFarmerTraceForm(traceOpen.dataset.traceOpen)
                .catch((error) => toast(error.message, 'error'));
            return;
        }
        const traceReload = e.target.closest('[data-trace-reload]');
        if (traceReload) {
            runTraceButton(traceReload, 'Loading...', loadFarmerTraceability)
                .catch((error) => toast(error.message, 'error'));
            return;
        }
        const traceLocation = e.target.closest('[data-trace-location]');
        if (traceLocation) {
            runTraceButton(traceLocation, 'Locating...', useFarmCurrentLocation)
                .catch((error) => toast(error.message, 'error'));
            return;
        }
        const el = e.target.closest('[data-action]');
        if (!el) {
            const link = e.target.closest('a[href]');
            if (link) {
                try {
                    const target = new URL(link.href, location.href);
                    if (target.origin === location.origin && target.pathname !== '/dashboard') {
                        rememberDashboardPosition();
                    }
                } catch (error) { /* Ignore malformed non-navigation links. */ }
            }
            return;
        }
        const id = el.dataset.id;
        switch (el.dataset.action) {
            case 'details': viewProductDetails(id); break;
            case 'edit-product': openProductEdit(id || detailListingId); break;
            case 'review-product': openProductReviews(id, el.dataset.name); break;
            case 'report-post': openPostReport(id); break;
            case 'farmer-profile': openFarmerProfile(id); break;
            case 'detail-reviews':
                openProductReviews(detailListingId, document.getElementById('detail-name').textContent);
                break;
            case 'seller-sales': openSellerSales(id); break;
            case 'batch-allocation': openBatchAllocation(id).catch((error) => toast(error.message, 'error')); break;
            case 'order-accept':
                updateOrderStatus(id, 'accepted').then(() => toast('Order accepted.', 'success')).catch((error) => toast(error.message, 'error'));
                break;
            case 'order-reject':
                if (confirm('Reject this order? Its reserved batch quantity will be returned to inventory.')) {
                    updateOrderStatus(id, 'rejected').then(() => toast('Order rejected and inventory released.', 'success')).catch((error) => toast(error.message, 'error'));
                }
                break;
            case 'cancel-order':
                if (confirm('Cancel this order? Reserved batch quantity will be returned if cancellation is allowed.')) {
                    updateOrderStatus(id, 'cancelled').then(() => toast('Order cancelled.', 'success')).catch((error) => toast(error.message, 'error'));
                }
                break;
            case 'pay-order':
                startOnlinePayment(id).catch((error) => toast(error.message, 'error'));
                break;
            case 'collect-cod':
                if (confirm('Confirm that the buyer paid the COD amount?')) {
                    api(`/orders/${encodeURIComponent(id)}/collect-payment`, { method: 'POST' })
                        .then(() => Promise.all([loadOrders(), loadNotifications()]))
                        .then(() => toast('COD payment recorded.', 'success'))
                        .catch((error) => toast(error.message, 'error'));
                }
                break;
            case 'order-status': {
                const status = el.dataset.status;
                let extra = {};
                if (status === 'shipped') {
                    const shippingProvider = prompt('Shipping provider (required):', '');
                    if (!shippingProvider || !shippingProvider.trim()) break;
                    const trackingNumber = prompt('Tracking number (optional):', '') || '';
                    extra = { shipping_provider: shippingProvider.trim(), tracking_number: trackingNumber.trim() };
                }
                updateOrderStatus(id, status, extra).then(() => toast('Order status updated.', 'success')).catch((error) => toast(error.message, 'error'));
                break;
            }
            case 'cart': {
                const listing = listingById(id);
                if (listing && (listing.batches || []).length > 1) viewProductDetails(id);
                else addToCart(id);
                break;
            }
            case 'like': likePost(id); break;
            case 'edit-post': openEditPost(id); break;
            case 'toggle-comments': el.closest('.post').querySelector('.comments-section').classList.toggle('hidden'); break;
            case 'comment': commentOn(el.closest('.post').dataset.postId, el.closest('.comment-input').querySelector('input')); break;
            case 'share': sharePost(id); break;
            case 'delete-post': withdrawPost(id); break;
            case 'contact': openConversation(id, el.dataset.name); break;
            case 'follow': toggleFollow(id); break;
        }
    });
    listen(document, 'keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-view-image]')) {
            e.preventDefault();
            openDashboardImage(e.target);
            return;
        }
        if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.farmer-card[data-action="farmer-profile"], .search-farm-card[data-action="farmer-profile"]')) {
            e.preventDefault();
            openFarmerProfile(e.target.dataset.id);
            return;
        }
        if (e.key === 'Enter' && e.target.dataset && e.target.dataset.enterAction === 'comment') {
            commentOn(e.target.closest('.post').dataset.postId, e.target);
        }
    });
    listen(document, 'submit', (e) => {
        if (e.target.id === 'product-review-form') submitProductReview(e);
        if (e.target.matches('.product-review-comment-form')) submitReviewComment(e);
        if (e.target.id === 'report-post-form') submitPostReport(e);
        if (e.target.id === 'complaint-form') submitComplaint(e);
    });
    listen(document.getElementById('farmer-trace-form'), 'submit', saveFarmerTraceRecord);
    listen(document.getElementById('farmer-trace-form'), 'change', (event) => {
        if (event.target.id === 'farmer-trace-product_listing_id') {
            const listing = state.listings.find((item) => String(item.listing_id) === String(event.target.value));
            const farmId = document.getElementById('farmer-trace-farm_id');
            const farmDisplay = document.getElementById('farmer-trace-farm_display');
            if (farmId) farmId.value = listing ? String(listing.farm_id || '') : '';
            if (farmDisplay) farmDisplay.value = listing ? (listing.farm_name || 'Registered farm') : '';
            updateBatchProductPreview(event.target.value);
        }
        if (event.target.id === 'farmer-trace-selling_unit') {
            const unit = document.getElementById('farmer-trace-unit');
            if (!unit) return;
            unit.readOnly = event.target.value !== 'other';
            unit.value = event.target.value === 'other' ? '' : event.target.value;
        }
    });
    listen(document.getElementById('detail-batch-picker'), 'change', (event) => {
        updateProductDetailsVariant(event.target.value);
    });
    listen(document.getElementById('conv-list'), 'click', (e) => {
        const el = e.target.closest('[data-contact]');
        if (el) selectContact(el.dataset.contact);
    });
    listen(window, 'hashchange', routeFromHash);
    listen(window, 'pagehide', rememberDashboardPosition);
    listen(document.querySelector('.main-content'), 'scroll', rememberDashboardPosition);

    // Keep the initial API load serialized. This avoids transient 500 responses
    // from the shared PHP request/database stack during login.
    for (const load of [loadFeed, loadMarketplace, loadSaved, loadFarmers, loadContacts, loadNotifications, loadOrders, loadAnalytics]) {
        await load();
        if (paymentTraceRedirecting) return;
    }
    updateCartUI();
    restoreDashboardPosition();
    history.replaceState(null, '', '/dashboard' + location.hash);
}

const dashboardInitPage = initPage;
initPage = async function () {
    await dashboardInitPage();
    if (!paymentTraceRedirecting) await renderHomeMap();
};
