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
let detailListingId = null;
let activeReviewListingId = null;
let activeSalesListingId = null;
let activeContactId = null;
let editingPostId = null;
let messageUsers = [];
let messageFilter = 'all';
let messageSearchTimer = null;
let messageSearchSequence = 0;
let messageSearchLoading = false;
let paymentReturnPending = new URLSearchParams(location.search).get('payment') === 'return';
let paymentReturnOrderId = new URLSearchParams(location.search).get('order') || '';
let paymentReconciliation = null;
let paymentTraceRedirecting = false;
let state = { posts: [], listings: [], saved: new Set(), farmers: [], contacts: [], orders: [], notifications: [] };
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
function productCardHTML(l) {
    const outOfStock = Number(l.stock) <= 0;
    const unavailable = Number(l.is_available) !== 1;
    const sellerOwnsListing = me && String(l.seller_id) === String(me.id);
    const cannotBuy = sellerOwnsListing || outOfStock || unavailable;
    const image = mediaUrl(l.image_url, DEFAULT_PRODUCT_IMG);
    return `<div class="market-card product-item" data-category="${escapeHtml(l.category)}">
        <img src="${escapeHtml(image)}" onerror="this.onerror=null;this.src='${DEFAULT_PRODUCT_IMG}'" alt="${escapeHtml(l.product_name)}" data-view-image tabindex="0" role="button">
        <div class="market-card-info">
            <h4>${escapeHtml(l.product_name)}</h4>
            <div class="product-meta">
                <span><i class="fa-solid fa-tractor"></i> ${escapeHtml(l.username)}</span>
                <span class="distance-tag"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(l.location || 'Location not set')}</span>
            </div>
            <p style="font-size: 1.1rem; color: var(--primary); font-weight: bold; margin-bottom: 4px;">${money(l.price)} <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: normal;">/ ${escapeHtml(l.unit)}</span></p>
            <p class="product-rating"><span class="review-stars" aria-label="${Number(l.average_rating || 0).toFixed(1)} out of 5 stars">${'★'.repeat(Math.round(Number(l.average_rating) || 0))}${'☆'.repeat(5 - Math.round(Number(l.average_rating) || 0))}</span> ${Number(l.average_rating || 0).toFixed(1)} · ${Number(l.review_count) || 0} reviews</p>
            <p style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 10px;">${outOfStock ? 'Sold out' : `${Number(l.stock)} ${escapeHtml(l.unit)} available`}</p>
            <div style="display: flex; gap: 10px;">
                <button data-action="details" data-id="${escapeHtml(l.listing_id)}" style="background: var(--bg-hover); color: var(--text-main); border: 1px solid var(--border-color); flex: 1;">Details</button>
                <button data-action="${sellerOwnsListing ? 'seller-sales' : 'cart'}" data-id="${escapeHtml(l.listing_id)}" style="flex: 1;" ${!sellerOwnsListing && cannotBuy ? 'disabled' : ''}>${sellerOwnsListing ? 'Your Product' : (outOfStock ? 'Sold out' : (unavailable ? 'Unavailable' : 'Add to Cart'))}</button>
            </div>
        </div>
    </div>`;
}
function matchesSearch(l) {
    return [l.product_name, l.username, l.category, l.location].some((v) => String(v || '').toLowerCase().includes(searchTerm));
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
    renderPendingBadge();
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
            <div><strong>${escapeHtml(p.product_name)}</strong><p>${money(p.price)} / ${escapeHtml(p.unit || 'unit')} • ${escapeHtml(p.category || '')}</p></div>
            <div class="product-chip-actions">
                <span class="review-stars" aria-label="${Number(p.average_rating || 0).toFixed(1)} out of 5 stars">${'★'.repeat(Math.round(Number(p.average_rating) || 0))}${'☆'.repeat(5 - Math.round(Number(p.average_rating) || 0))}</span>
                <span>${Number(p.average_rating || 0).toFixed(1)} (${Number(p.review_count) || 0})</span>
                ${p.listing_id && p.status === 'approved' ? `<button type="button" class="btn-muted" data-action="details" data-id="${escapeHtml(p.listing_id)}">View details</button>` : '<span class="status-pill">Pending approval</span>'}
            </div>
        </div>`
        : '';
    const pending = p.status === 'pending'
        ? `<span class="status-pill" style="margin-left: 8px;"><i class="fa-solid fa-clock"></i> Pending review</span>` : '';
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
                    <span title="${escapeHtml(formatDateTime(p.created_at))}">${isProduct ? 'Listed a product' : 'Shared a post'} • ${escapeHtml(formatDateTime(p.created_at))} (${timeAgo(p.created_at)})${pending}</span>
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
            ${mine && p.status === 'pending' ? `<button data-action="delete-post" data-id="${escapeHtml(p.post_id)}"><i class="fa-solid fa-trash"></i> Withdraw</button>` : ''}
            ${isProduct && p.listing_id && p.status === 'approved' ? `<button data-action="review-product" data-id="${escapeHtml(p.listing_id)}" data-name="${escapeHtml(p.product_name)}"><i class="fa-solid fa-star"></i> Reviews &amp; Ratings</button>` : ''}
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
    openModal('edit-post-modal');
    document.getElementById('edit-post-text').focus();
}
async function submitEditPost() {
    const content = document.getElementById('edit-post-text').value.trim();
    const button = document.getElementById('edit-post-submit');
    if (!editingPostId || !content) {
        toast('Post content cannot be empty.', 'error');
        return;
    }
    button.disabled = true;
    try {
        await api(`/posts/${editingPostId}`, { method: 'PUT', body: { content } });
        closeModal('edit-post-modal');
        editingPostId = null;
        await loadFeed();
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
    if (!confirm('Withdraw this post from review?')) return;
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
    document.getElementById('post-modal-name').textContent = displayName(me);
    document.getElementById('post-modal-avatar').src = avatarOf(me);
    openModal('post-modal');
}
function switchPostTab(tab, btn) {
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
    ['post-text', 'post-media-desc', 'product-name', 'product-price', 'product-stock', 'product-description'].forEach((id) => {
        document.getElementById(id).value = '';
    });
    document.getElementById('product-unit').value = 'kg';
    document.getElementById('product-category').value = CATEGORIES[0];
    pendingUpload.video = null;
    pendingUpload.product = [];
    document.getElementById('video-upload-label').textContent = 'Upload from Device';
    document.getElementById('product-upload-label').textContent = 'Add Product Photos';
    document.querySelector('.post-tab[data-tab="text"]').click();
}
async function submitPost() {
    const tab = document.querySelector('.post-tab.active').dataset.tab;
    const button = document.getElementById('post-submit');
    const val = (id) => document.getElementById(id).value.trim();
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
            const price = Number(val('product-price'));
            const stock = Number(val('product-stock'));
            const unit = val('product-unit') || 'kg';
            if (!name) throw new Error('Enter the product name.');
            if (!(price > 0)) throw new Error('Enter a price greater than zero.');
            if (!(stock > 0)) throw new Error('Enter the stock quantity.');
            const productMedia = await Promise.all((pendingUpload.product || []).map(async (file) => {
                const uploaded = await uploadMedia(file);
                return { url: uploaded.url, type: uploaded.type };
            }));
            const imageUrl = productMedia[0] ? productMedia[0].url : '';
            const listing = await api('/marketplace', {
                method: 'POST',
                body: {
                    product_name: name, category: document.getElementById('product-category').value, unit, price, stock,
                    description: val('product-description'), location: displayName(me) + ' farm', image_url: imageUrl
                }
            });
            const post = await api('/posts', {
                method: 'POST',
                body: {
                    content: `${name} is now available on the AgriTrace Marketplace.`,
                    post_type: 'product',
                    listing_id: listing.id,
                    media_url: JSON.stringify(productMedia),
                    media_type: 'image-gallery'
                }
            });
            message = post.message;
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
function renderPendingBadge() {
    const mine = state.posts.filter((p) => String(p.author_id) === String(me.id) && p.status === 'pending');
    setBadge('pending-count', mine.length);
}
function openPendingModal() {
    const mine = state.posts.filter((p) => String(p.author_id) === String(me.id) && p.status === 'pending');
    document.getElementById('pending-list').innerHTML = mine.length
        ? mine.map((p) => `<div class="pending-item">
            <div style="width: 60px; height: 60px; border-radius: 8px; background: var(--bg-hover); display: flex; align-items: center; justify-content: center; color: var(--text-muted); flex-shrink: 0;"><i class="fa-solid ${p.post_type === 'product' ? 'fa-box' : (p.media_type === 'video' ? 'fa-video' : 'fa-text-width')}" style="font-size: 1.4rem;"></i></div>
            <div style="min-width: 0;">
                <h4 style="color: var(--text-main); font-size: 0.95rem; margin-bottom: 3px;">${escapeHtml(p.product_name || p.content)}</h4>
                <p style="font-size: 0.8rem; color: var(--text-muted);">${p.post_type === 'product' ? `Category: ${escapeHtml(p.category)} • Price: ${money(p.price)}` : escapeHtml(p.post_type)}</p>
                <div class="pending-status"><i class="fa-solid fa-clock"></i> Under Review by Admin</div>
            </div></div>`).join('')
        : emptyBlock('fa-inbox', 'Nothing waiting', 'Posts you submit will appear here until an admin reviews them.');
    openModal('pending-posts-modal');
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
}
function renderMarketplace() {
    let list = state.listings.filter((l) => Number(l.is_available) === 1 || String(l.seller_id) === String(me.id));
    if (currentCategory !== 'All') list = list.filter((l) => l.category === currentCategory);
    if (searchTerm) list = list.filter(matchesSearch);
    if (marketSort === 'price_asc') list = [...list].sort((a, b) => a.price - b.price);
    if (marketSort === 'price_desc') list = [...list].sort((a, b) => b.price - a.price);
    document.getElementById('marketplace-container').innerHTML = list.length
        ? list.map(productCardHTML).join('')
        : emptyBlock('fa-box-open', 'No products found', 'Products appear here once a seller lists them and an admin approves them.');
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
function viewProductDetails(id) {
    const l = listingById(id);
    if (!l) return;
    detailListingId = id;
    document.getElementById('detail-image').src = mediaUrl(l.image_url, DEFAULT_PRODUCT_IMG);
    document.getElementById('detail-image').alt = l.product_name;
    document.getElementById('detail-name').textContent = l.product_name;
    document.getElementById('detail-price').textContent = money(l.price) + ' / ' + l.unit;
    document.getElementById('detail-rating').innerHTML = `<span class="review-stars" aria-label="${Number(l.average_rating || 0).toFixed(1)} out of 5 stars">${'★'.repeat(Math.round(Number(l.average_rating) || 0))}${'☆'.repeat(5 - Math.round(Number(l.average_rating) || 0))}</span> ${Number(l.average_rating || 0).toFixed(1)} (${Number(l.review_count) || 0} reviews)`;
    document.getElementById('detail-farmer').querySelector('span').textContent = l.username;
    document.getElementById('detail-distance').querySelector('span').textContent = l.location || 'Location not set';
    document.getElementById('detail-desc').textContent = `${l.description || 'No description provided.'} (Available stock: ${Number(l.stock)} ${l.unit})`;
    const saved = state.saved.has(String(id));
    document.getElementById('detail-save-btn').innerHTML = `<i class="fa-${saved ? 'solid' : 'regular'} fa-heart"></i> ${saved ? 'Saved' : 'Save'}`;
    const cartBtn = document.getElementById('detail-cart-btn');
    const unavailable = Number(l.is_available) !== 1;
    const sellerOwnsListing = me && String(l.seller_id) === String(me.id);
    cartBtn.disabled = !sellerOwnsListing && (Number(l.stock) <= 0 || unavailable);
    cartBtn.textContent = sellerOwnsListing ? 'Your Product' : (Number(l.stock) <= 0 ? 'Sold out' : (unavailable ? 'Unavailable' : 'Add to Cart'));
    openModal('product-details-modal');
}
function handleDetailProductAction() {
    const listing = listingById(detailListingId);
    if (listing && me && String(listing.seller_id) === String(me.id)) {
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
function addToCart(id) {
    const l = listingById(id);
    if (!l) return;
    if (me && String(l.seller_id) === String(me.id)) {
        toast('You cannot add your own product to the cart.', 'error');
        return;
    }
    const cart = getCart();
    const item = cart.find((i) => String(i.id) === String(id));
    const current = item ? item.qty : 0;
    if (current + 1 > Number(l.stock)) { toast(`Only ${Number(l.stock)} ${l.unit} of ${l.product_name} left.`, 'error'); return; }
    if (item) item.qty += 1;
    else cart.push({ id: l.listing_id, name: l.product_name, price: Number(l.price), qty: 1, checked: true, img: l.image_url, farmer: l.username, unit: l.unit, stock: Number(l.stock) });
    saveCart(cart);
    toast(`${l.product_name} added to cart!`);
}
function addToCartFromDetails() {
    if (!detailListingId) return;
    addToCart(detailListingId);
    closeModal('product-details-modal');
}
function openCart() { updateCartUI(); openModal('cart-modal'); }
function updateCartUI() {
    if (!me) return;
    const cart = getCart();
    document.getElementById('cart-badge').textContent = cart.reduce((s, i) => s + i.qty, 0);
    const box = document.getElementById('cart-items-container');
    box.innerHTML = cart.length
        ? cart.map((it, i) => {
            const live = listingById(it.id);
            const stock = live ? Number(live.stock) : it.stock;
            const warning = live && Number(live.stock) < it.qty ? `<p style="color: var(--danger); font-size: 0.75rem;">Only ${Number(live.stock)} left</p>` : '';
            return `<div class="cart-item">
                <input type="checkbox" ${it.checked ? 'checked' : ''} onchange="toggleItemCheck(${i})">
                <img src="${escapeHtml(mediaUrl(it.img, DEFAULT_PRODUCT_IMG))}" onerror="this.onerror=null;this.src='${DEFAULT_PRODUCT_IMG}'" alt="Item">
                <div class="cart-item-info">
                    <h4>${escapeHtml(it.name)}</h4>
                    <p>Sold by: ${escapeHtml(it.farmer || 'AgriTrace seller')}</p>
                    <div class="price">${money(it.price)} / ${escapeHtml(it.unit || '')}</div>
                    ${warning}
                </div>
                <div class="cart-item-actions">
                    <i class="fa-solid fa-trash delete-btn" onclick="removeFromCart(${i})" title="Remove item"></i>
                    <div class="qty-control">
                        <button onclick="updateQty(${i}, -1)">-</button>
                        <input type="text" value="${it.qty}" readonly>
                        <button onclick="updateQty(${i}, 1)" ${it.qty >= stock ? 'disabled' : ''}>+</button>
                    </div>
                </div>
            </div>`;
        }).join('')
        : '<p style="text-align:center; padding: 20px; color: var(--text-muted);">Your cart is empty.</p>';
    const total = cart.filter((i) => i.checked).reduce((s, i) => s + i.price * i.qty, 0);
    document.getElementById('cart-total').textContent = 'Total: ' + money(total);
    document.getElementById('select-all').checked = cart.length > 0 && cart.every((i) => i.checked);
}
function updateQty(index, delta) {
    const cart = getCart();
    const it = cart[index];
    if (!it) return;
    const live = listingById(it.id);
    const max = live ? Number(live.stock) : it.stock;
    const next = it.qty + delta;
    if (next < 1) return;
    if (next > max) { toast(`Only ${max} ${it.unit || ''} available.`, 'error'); return; }
    it.qty = next;
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
    button.disabled = true;
    rememberDashboardPosition();
    const paymentTab = window.open('about:blank', '_blank');
    try {
        const result = await api('/orders', {
            method: 'POST',
            body: {
                items: chosen.map((i) => ({ listing_id: i.id, quantity: i.qty })),
                frontend_origin: location.origin
            }
        });
        saveCart(cart.filter((i) => !i.checked));
        closeModal('cart-modal');
        if (result.invoice_url) {
            toast('Order created. Opening the payment page...');
            if (paymentTab) {
                paymentTab.opener = null;
                paymentTab.location.replace(result.invoice_url);
            } else {
                window.location.assign(result.invoice_url);
            }
            return;
        }
        if (paymentTab) paymentTab.close();
        toast(`${result.message} Total ${money(result.total)}.`);
        await Promise.all([loadMarketplace(), loadOrders(), loadNotifications(), loadAnalytics()]);
    } catch (error) {
        if (paymentTab) paymentTab.close();
        toast(error.message, 'error');
        await loadMarketplace();
    } finally {
        button.disabled = false;
    }
}
function orderPaymentBadge(order) {
    if (order.payment_status === 'paid') return '<span class="status-pill ok"><i class="fa-solid fa-circle-check"></i> Paid</span>';
    if (order.payment_status === 'expired') return '<span class="status-pill" style="background: rgba(239,68,68,0.15); color: var(--danger);">Expired</span>';
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
                    ).filter((order) => order.payment_status === 'unpaid' && order.xendit_invoice_url).slice(0, 10);
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
                    <span><b style="color: var(--text-main);">Order #${escapeHtml(o.order_id)}</b> • ${new Date(String(o.created_at).replace(' ', 'T')).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                    ${orderPaymentBadge(o)}
                </div>
                ${o.payment_status === 'unpaid' && o.xendit_invoice_url
                    ? `<a class="btn-primary" href="${escapeHtml(o.xendit_invoice_url)}" target="_blank" rel="noopener noreferrer" style="text-align: center; text-decoration: none;">Pay now</a>` : ''}
                ${o.items.map((it) => `
                    <div class="order-line">
                        <div class="order-line-info"><h4>${escapeHtml(it.product_name)}</h4><p>${Number(it.quantity)} ${escapeHtml(it.unit)} × ${money(it.unit_price)}</p>${traceBlock(it)}
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
function farmerName(f) { return [f.first_name, f.last_name].filter(Boolean).join(' ') || f.username; }
function renderFarmers() {
    let list = state.farmers.filter((f) => farmerFilter === 'All' || (farmerFilter === 'Following' ? f.following : false));
    if (searchTerm) list = list.filter((f) => farmerName(f).toLowerCase().includes(searchTerm) || String(f.address || '').toLowerCase().includes(searchTerm));
    document.getElementById('farmer-container').innerHTML = list.length
        ? list.map((f) => `<div class="farmer-card">
            <img src="${escapeHtml(mediaUrl(f.profile_pic, DEFAULT_AVATAR))}" alt="${escapeHtml(farmerName(f))}" style="object-position: center;">
            <h4>${escapeHtml(farmerName(f))}</h4>
            <p style="color: var(--text-muted); font-size: 0.75rem; margin-bottom: 5px;">${Number(f.followers)} follower${Number(f.followers) === 1 ? '' : 's'}</p>
            <p>${escapeHtml(f.address || 'Location not set')}</p>
            <div style="display: flex; gap: 8px; margin-top: 10px;">
                <button data-action="contact" data-id="${escapeHtml(f.id)}" data-name="${escapeHtml(farmerName(f))}" style="flex: 1;">Contact</button>
                <button data-action="follow" data-id="${escapeHtml(f.id)}" class="follow-btn ${f.following ? 'following' : ''}" style="flex: 1;">${f.following ? 'Following' : 'Follow'}</button>
            </div>
        </div>`).join('')
        : emptyBlock('fa-user-slash', 'No farmers found', 'Registered farmers appear here after an admin approves their account.');
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
            <div class="widget-list-item-info"><h4>${escapeHtml(farmerName(f))}</h4><p>${escapeHtml(f.address || 'Farmer')}</p></div>
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
            <div class="widget-list-item-info"><h4>${escapeHtml(listing.product_name)}</h4><p>${money(listing.price)} / ${escapeHtml(listing.unit)}</p></div>
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
        state.contacts = data.data || [];
    } catch (error) { toast(error.message, 'error'); }
    renderConversationList();
    setBadge('messages-badge', state.contacts.reduce((s, c) => s + Number(c.unread || 0), 0));
}
async function loadMessageUsers(search = '', filter = messageFilter) {
    const sequence = ++messageSearchSequence;
    messageSearchLoading = true;
    renderConversationList();
    try {
        const data = await api(`/messages/users?q=${encodeURIComponent(search)}&filter=${encodeURIComponent(filter)}`);
        if (sequence === messageSearchSequence) {
            messageUsers = data.data || [];
        }
    } catch (error) {
        if (sequence === messageSearchSequence) {
            messageUsers = [];
            toast(error.message, 'error');
        }
    } finally {
        if (sequence === messageSearchSequence) {
            messageSearchLoading = false;
            renderConversationList();
        }
    }
}
function searchMessageUsers(value) {
    clearTimeout(messageSearchTimer);
    const search = value.trim();
    messageSearchLoading = true;
    renderConversationList();
    messageSearchTimer = setTimeout(() => loadMessageUsers(search), 250);
}
function setMessageFilter(filter, button) {
    messageFilter = filter;
    document.querySelectorAll('#msg-filter-bar .cat-btn').forEach((item) => item.classList.toggle('active', item === button));
    renderConversationList();
    loadMessageUsers(document.getElementById('msg-search').value.trim());
}
function contactName(c) { return [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username; }
function renderConversationList() {
    const q = (document.getElementById('msg-search')?.value || '').trim().toLowerCase();
    const contactsById = new Map(state.contacts.map((contact) => [String(contact.user_id), contact]));
    const usersById = new Map();
    messageUsers.forEach((user) => {
        const contact = contactsById.get(String(user.user_id));
        usersById.set(String(user.user_id), {
            ...user,
            ...(contact || {}),
            following: Boolean(user.following),
            unread: contact ? Number(contact.unread) || 0 : Number(user.unread) || 0,
            profile_pic: contact?.profile_pic || user.profile_pic
        });
    });
    state.contacts.forEach((contact) => {
        const id = String(contact.user_id);
        if (usersById.has(id)) return;
        const searchableText = `${contactName(contact)} ${contact.username || ''}`.toLowerCase();
        if (q && !searchableText.includes(q)) return;
        usersById.set(id, contact);
    });
    const list = [...usersById.values()].filter((contact) => {
        const searchableText = `${contactName(contact)} ${contact.username || ''}`.toLowerCase();
        if (q && !q.split(/\s+/).every((term) => searchableText.includes(term))) return false;
        if (messageFilter === 'unread') return Number(contact.unread) > 0;
        if (messageFilter === 'following') return Boolean(contact.following);
        return true;
    });
    const listElement = document.getElementById('conv-list');
    if (messageSearchLoading) {
        listElement.innerHTML = '<p style="padding: 15px; color: var(--text-muted); font-size: 0.85rem;">Searching users...</p>';
        return;
    }
    document.getElementById('conv-list').innerHTML = list.length ? list.map((c) => {
        const preview = c.last_body ? escapeHtml(c.last_body) : 'Start a conversation';
        const unread = Number(c.unread) > 0;
        return `<div class="msg-contact ${String(c.user_id) === String(activeContactId) ? 'active' : ''} ${unread ? 'unread' : ''}" data-contact="${escapeHtml(c.user_id)}">
            <img src="${escapeHtml(mediaUrl(c.profile_pic, DEFAULT_AVATAR))}" alt="${escapeHtml(contactName(c))}">
            <div><h4>${escapeHtml(contactName(c))}</h4><p>${preview}</p></div>
            ${unread ? `<span class="unread-dot" title="${Number(c.unread)} unread message${Number(c.unread) === 1 ? '' : 's'}"></span>` : ''}
        </div>`;
    }).join('') : `<p style="padding: 15px; color: var(--text-muted); font-size: 0.85rem;">${messageFilter === 'unread' ? 'No unread messages.' : messageFilter === 'following' ? 'No followed users found.' : q ? 'No users found.' : 'No users available.'}</p>`;
}
async function selectContact(id) {
    activeContactId = String(id);
    const contact = state.contacts.find((c) => String(c.user_id) === String(id))
        || messageUsers.find((user) => String(user.user_id) === String(id));
    document.getElementById('chat-header-img').src = mediaUrl(contact?.profile_pic, DEFAULT_AVATAR);
    document.getElementById('chat-header-name').textContent = contact ? contactName(contact) : 'Conversation';
    document.getElementById('chat-header-status').innerHTML = '<i class="fa-solid fa-circle" style="color: var(--primary); font-size: 0.6rem;"></i> Direct message';
    try {
        const data = await api(`/messages/${id}`);
        renderChatHistory(data.data || []);
    } catch (error) {
        toast(error.message, 'error');
    }
    await loadContacts();
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
    await Promise.all([loadContacts(), loadMessageUsers(document.getElementById('msg-search').value.trim())]);
    const target = contactId || activeContactId || (state.contacts[0] && state.contacts[0].user_id);
    if (target) await selectContact(target);
    else {
        document.getElementById('chat-header-name').textContent = 'No conversations yet';
        document.getElementById('chat-history').innerHTML = emptyBlock('fa-comments', 'No conversations', 'Contact a farmer from the Farmer Hub to start chatting.');
    }
}
async function openConversation(id, name) {
    if (!state.contacts.some((c) => String(c.user_id) === String(id))) {
        const user = messageUsers.find((item) => String(item.user_id) === String(id));
        state.contacts.unshift({
            ...(user || {}), user_id: id, username: name, first_name: name, last_name: '',
            last_body: '', unread: 0
        });
    }
    openModal('messenger-modal');
    renderConversationList();
    await selectContact(id);
}
async function sendMessage() {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text) return;
    if (!activeContactId) { toast('Select a conversation first.', 'error'); return; }
    try {
        await api('/messages', { method: 'POST', body: { receiver_id: Number(activeContactId), body: text } });
        input.value = '';
        await selectContact(activeContactId);
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
    try {
        const a = await api('/analytics');
        document.getElementById('analytics-tiles').innerHTML = [
            [a.active_listings, 'Active listings'],
            [a.farmers, 'Registered farmers'],
            [a.my_orders, 'My orders'],
            [money(a.my_spend), 'My total spend'],
            [a.my_pending_posts, 'My pending posts'],
            [a.my_products, 'My products'],
            [a.my_product_reviews, 'Product reviews'],
            [`${Number(a.my_product_average_rating || 0).toFixed(1)} ★`, 'Average product rating']
        ].map(([v, l]) => `<div class="stat-tile"><h3>${v}</h3><p>${l}</p></div>`).join('');
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
        window.__analytics = a;
    } catch (error) {
        document.getElementById('analytics-tiles').innerHTML = emptyBlock('fa-chart-line', 'Analytics temporarily unavailable', 'Please try again shortly.');
        document.getElementById('analytics-bars').innerHTML = '';
        document.getElementById('analytics-products').innerHTML = '';
        toast(error.message, 'error');
    }
}
function renderRightWidgets() {
    const a = window.__analytics;
    document.getElementById('stat-listings').textContent = (a ? a.active_listings : state.listings.filter((l) => Number(l.stock) > 0).length) + ' Active';
    document.getElementById('stat-verified').textContent = (a ? a.farmers : state.farmers.length) + ' Farmers';
    document.getElementById('trending-list').innerHTML = '<p style="font-size: 0.8rem; color: var(--text-muted);">No trending topics yet.</p>';
    renderPopularFarmers();
    renderLatestProducts();
}

/* ---------- search & navigation ---------- */
function onSearch(value) {
    searchTerm = value.trim().toLowerCase();
    if (searchTerm && currentView !== 'market' && currentView !== 'farmer-hub') switchView('market');
    renderMarketplace();
    renderFarmers();
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
    document.querySelector('.main-content').scrollTop = 0;
    window.scrollTo(0, 0);
    if (window.innerWidth <= 900) toggleSidebar(false);
}
const HASH_ROUTES = {
    feed: ['feed'], market: ['market'], 'farmer-hub': ['farmer-hub'], analytics: ['analytics'],
    orders: ['orders'], saved: ['saved'], help: ['help']
};
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

    listen(document, 'click', (e) => {
        const image = e.target.closest('[data-view-image]');
        if (image) {
            openDashboardImage(image);
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
            case 'review-product': openProductReviews(id, el.dataset.name); break;
            case 'detail-reviews':
                openProductReviews(detailListingId, document.getElementById('detail-name').textContent);
                break;
            case 'seller-sales': openSellerSales(id); break;
            case 'cart': addToCart(id); break;
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
        if (e.key === 'Enter' && e.target.dataset && e.target.dataset.enterAction === 'comment') {
            commentOn(e.target.closest('.post').dataset.postId, e.target);
        }
    });
    listen(document, 'submit', (e) => {
        if (e.target.id === 'product-review-form') submitProductReview(e);
        if (e.target.matches('.product-review-comment-form')) submitReviewComment(e);
        if (e.target.id === 'complaint-form') submitComplaint(e);
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
