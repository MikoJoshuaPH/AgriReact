/* My Profile (profile.html): details, photo, password */
let profileUser = null;
let profilePosts = [];
let profileProducts = [];
let editingProfilePost = null;
let viewingOwnProfile = true;

function setProfileButtonLoading(button, loading, message = 'Saving...') {
    if (!button) return;
    if (loading) {
        if (button.dataset.loading === 'true') return;
        button.dataset.loading = 'true';
        button.dataset.originalHtml = button.innerHTML;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.innerHTML = `<span class="farmer-trace-button-spinner" aria-hidden="true"></span> ${escapeHtml(message)}`;
    } else if (button.dataset.loading === 'true') {
        button.innerHTML = button.dataset.originalHtml || '';
        button.disabled = false;
        button.removeAttribute('aria-busy');
        delete button.dataset.loading;
        delete button.dataset.originalHtml;
    }
}

function publicFarmLocation(farm) {
    return [farm.municipality, farm.province].filter(Boolean).join(', ') || 'Location not set';
}

let profileFarmMap = null;
async function renderProfileFarmMap() {
    const element = document.getElementById('profile-farm-map');
    if (profileFarmMap) {
        profileFarmMap.remove();
        profileFarmMap = null;
    }
    if (!element || !profileUser || profileUser.role !== 'farmer') {
        if (element) element.classList.add('hidden');
        return;
    }
    const farms = (profileUser.farms || []).filter((farm) => validMapCoordinates(farm.latitude, farm.longitude));
    element.classList.toggle('hidden', farms.length === 0);
    if (!farms.length) return;

    try {
        const first = farms[0];
        const { map, L } = await createMap('profile-farm-map', Number(first.latitude), Number(first.longitude), farms.length > 1 ? 10 : 14);
        profileFarmMap = map;
        const markers = farms.map((farm) => L.marker([Number(farm.latitude), Number(farm.longitude)])
            .addTo(map)
            .bindPopup(escapeHtml(farm.farm_name || 'Registered farm')));
        if (markers.length > 1) {
            map.fitBounds(L.featureGroup(markers).getBounds().pad(0.15), { maxZoom: 14 });
        }
    } catch (error) {
        element.textContent = `Farm map unavailable: ${error.message}`;
    }
}

function validMapCoordinates(latitude, longitude) {
    const lat = Number(latitude);
    const lng = Number(longitude);
    return latitude !== null && latitude !== '' && longitude !== null && longitude !== ''
        && Number.isFinite(lat) && Number.isFinite(lng)
        && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function renderProfileFarm() {
    const card = document.getElementById('profile-farm-card');
    const details = document.getElementById('profile-farm-details');
    if (!card || !details || !profileUser || profileUser.role !== 'farmer') {
        if (card) card.classList.add('hidden');
        return;
    }
    const farms = profileUser.farms || [];
    card.classList.remove('hidden');
    details.innerHTML = farms.length ? farms.map((farm) => `
        <article style="padding: 12px 0; border-bottom: 1px solid var(--border-color);">
            <h4>${escapeHtml(farm.farm_name)}</h4>
            <p style="color: var(--text-muted); margin-top: 5px;"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(publicFarmLocation(farm))}</p>
            ${farm.farm_description ? `<p style="line-height: 1.5; margin-top: 8px;">${escapeHtml(farm.farm_description)}</p>` : ''}
            ${farm.farm_size ? `<p style="color: var(--text-muted); margin-top: 6px;">${escapeHtml(String(farm.farm_size))} ${escapeHtml(farm.farm_size_unit || 'units')}</p>` : ''}
        </article>`).join('') : '<p style="color: var(--text-muted);">No registered farm information is available.</p>';
}

function renderProfileProducts() {
    const card = document.getElementById('profile-products-card');
    const container = document.getElementById('profile-products');
    if (!card || !container || !profileUser || profileUser.role !== 'farmer') {
        if (card) card.classList.add('hidden');
        return;
    }
    card.classList.remove('hidden');
    const available = profileProducts.filter((product) => Number(product.is_available) === 1 && Number(product.stock) > 0);
    container.innerHTML = available.length ? available.map((product) => `
        <article class="market-card">
            <img src="${escapeHtml(mediaUrl(product.image_url, DEFAULT_PRODUCT_IMG))}" alt="${escapeHtml(product.product_name)}">
            <div class="market-card-info">
                <h4>${escapeHtml(product.product_name)}</h4>
                <p class="product-meta"><span><i class="fa-solid fa-location-dot"></i> ${escapeHtml(product.farm_name || 'Registered farm')}</span></p>
                <p style="font-size: .8rem; color: var(--text-muted);">${escapeHtml([product.municipality, product.province].filter(Boolean).join(', ') || 'Location not set')}</p>
                <p style="font-size: 1.05rem; color: var(--primary); font-weight: bold;">${money(product.price)} / ${escapeHtml(product.unit || 'unit')}</p>
                <p style="font-size: .8rem; color: var(--text-muted);">${escapeHtml(String(product.stock))} available</p>
            </div>
        </article>`).join('') : emptyBlock('fa-box-open', 'No products listed', 'Available products will appear here.');
}

function renderProfileHeader() {
    const u = profileUser;
    document.getElementById('profile-avatar').src = avatarOf(u);
    const movePhotoButton = document.getElementById('move-avatar-to-cloud');
    if (movePhotoButton) {
        movePhotoButton.classList.toggle('hidden', !isLegacyLocalPhoto(u.profile_pic));
    }
    document.getElementById('profile-fullname').textContent = fullName(u);
    const joined = u.created_at ? new Date(String(u.created_at).replace(' ', 'T')).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
    document.getElementById('profile-meta').textContent = viewingOwnProfile
        ? `${roleLabel(u.role)} • ${u.email} • Joined ${joined}`
        : `${roleLabel(u.role)} • Joined ${joined}`;
    const roleEl = document.getElementById('profile-role');
    roleEl.innerHTML = isAdmin(u) ? '<i class="fa-solid fa-shield-halved"></i> Administrator' : roleLabel(u.role);
    const active = Number(u.is_active) === 1;
    const statusEl = document.getElementById('profile-status');
    statusEl.className = 'status-pill' + (active ? ' ok' : '');
    statusEl.innerHTML = `<i class="fa-solid ${active ? 'fa-circle-check' : 'fa-circle-exclamation'}"></i> ${active ? 'Active' : 'Inactive'}`;
}

function fillProfileForm() {
    const u = profileUser;
    document.getElementById('p-first').value = u.first_name || '';
    document.getElementById('p-middle').value = u.middle_name || '';
    document.getElementById('p-last').value = u.last_name || '';
    document.getElementById('p-age').value = u.age || '';
    document.getElementById('p-gender').value = u.gender || 'Other';
    document.getElementById('p-contact').value = u.contact_number || '';
    document.getElementById('p-address').value = u.address || '';
    document.getElementById('p-email').value = u.email || '';
    document.getElementById('p-type').innerHTML = `<option value="${u.role}">${escapeHtml(roleLabel(u.role))}</option>`;
    const roleField = document.getElementById('p-type').closest('.field');
    roleField.classList.toggle('hidden', !isAdmin(u));
    document.getElementById('p-type').disabled = !isAdmin(u);
    const transporterFields = document.getElementById('transporter-profile-fields');
    if (transporterFields) {
        const isTransporter = u.role === 'transporter';
        transporterFields.classList.toggle('hidden', !isTransporter);
        document.getElementById('transporter-name').value = fullName(u);
        document.getElementById('transport-origin').value = u.transport_origin || '';
        document.getElementById('vehicle-number').value = u.vehicle_number || '';
        document.getElementById('vehicle-type').value = u.vehicle_type || '';
    }
}

async function refreshProfile() {
    profileUser = await api('/profile');
    cacheUser(profileUser);
    initShell(profileUser);
    fillProfileForm();
    renderProfileHeader();
    renderProfileFarm();
    await renderProfileFarmMap();
    renderProfileProducts();
    await renderProfileQr();
    await loadProfilePosts();
}

async function renderProfileQr() {
    const status = document.getElementById('profile-qr-status');
    if (!profileUser || !status) return;
    const profileUrl = new URL('/profile', location.origin);
    profileUrl.searchParams.set('user', profileUser.id);
    try {
        document.getElementById('profile-qr-code').src = await window.generateQrCode(profileUrl.href);
        status.textContent = '';
    } catch (error) {
        status.textContent = 'Your QR code could not be generated. Please refresh and try again.';
        toast(error.message, 'error');
    }
}

function copyProfileLink() {
    const profileUrl = new URL('/profile', location.origin);
    profileUrl.searchParams.set('user', profileUser.id);
    navigator.clipboard.writeText(profileUrl.href)
        .then(() => toast('Profile link copied.'))
        .catch((error) => toast(error.message || 'Could not copy the profile link.', 'error'));
}

async function toggleProfileFollow() {
    const button = document.getElementById('profile-follow-button');
    if (!profileUser || !button) return;
    button.disabled = true;
    try {
        const result = await api(`/follows/${encodeURIComponent(profileUser.id)}/toggle`, { method: 'POST' });
        profileUser.following = Boolean(result.following);
        button.textContent = profileUser.following ? 'Following' : 'Add friend';
        button.setAttribute('aria-pressed', String(profileUser.following));
        toast(profileUser.following ? 'You are now following this member.' : 'Member removed from your following list.', 'info');
    } catch (error) {
        toast(error.message, 'error');
    } finally {
        button.disabled = false;
    }
}

function profilePostMedia(post) {
    const items = profilePostMediaItems(post);
    return items.map((item) => {
        const url = escapeHtml(mediaUrl(item.url));
        return item.type === 'video'
            ? `<a href="${url}" target="_blank" rel="noopener" style="display: block; margin-top: 10px;"><video controls preload="metadata" src="${url}" style="width: 100%; max-height: 360px; border-radius: 8px;"></video></a>`
            : `<a href="${url}" target="_blank" rel="noopener" style="display: block; margin-top: 10px;"><img src="${url}" alt="Post attachment (open full size)" onerror="this.onerror=null;this.style.display='none';this.nextElementSibling.hidden=false;" style="width: 100%; max-height: 360px; object-fit: contain; border-radius: 8px; cursor: zoom-in;"><p hidden style="padding: 16px; color: var(--text-muted);">This attachment is no longer available. Edit the post to upload a replacement.</p></a>`;
    }).join('');
}

function profilePostMediaItems(post) {
    if (!post.media_url) {
        return post.post_type === 'product' && post.product_image
            ? [{ url: post.product_image, type: 'image' }]
            : [];
    }
    try {
        const parsed = JSON.parse(post.media_url);
        return (Array.isArray(parsed) ? parsed : [{ url: post.media_url, type: post.media_type }])
            .filter((item) => item && item.url);
    } catch (error) {
        return [{ url: post.media_url, type: post.media_type || 'image' }];
    }
}

async function loadProfilePosts() {
    const container = document.getElementById('profile-posts');
    if (!container || !profileUser) return;
    try {
        const response = await api('/posts');
        const posts = (response.data || []).filter((post) => String(post.author_id) === String(profileUser.id));
        profilePosts = posts;
        container.innerHTML = posts.length
            ? posts.map((post) => `
                <article data-profile-post-id="${escapeHtml(post.post_id)}" style="background: var(--bg-main); border: 1px solid var(--border-color); border-radius: 12px; padding: 16px;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <img src="${escapeHtml(mediaUrl(post.profile_pic, avatarOf(profileUser)))}" alt="${escapeHtml(fullName(profileUser))}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover;">
                        <div style="min-width: 0;">
                            <strong style="color: var(--text-main);">${escapeHtml(fullName(profileUser))}</strong>
                            <p title="${escapeHtml(formatDateTime(post.created_at))}" style="font-size: 0.8rem; color: var(--text-muted);">${escapeHtml(formatDateTime(post.created_at))} (${escapeHtml(timeAgo(post.created_at))})</p>
                        </div>
                    </div>
                    <p style="color: var(--text-main); line-height: 1.5; margin-top: 12px; white-space: pre-wrap; overflow-wrap: anywhere;">${escapeHtml(post.content)}</p>
                    ${profilePostMedia(post)}
                    ${viewingOwnProfile ? `<div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px;">
                        <button type="button" class="btn-muted" onclick="openProfilePostEdit('${escapeHtml(post.post_id)}')"><i class="fa-solid fa-pen"></i> Edit</button>
                        <button type="button" class="btn-muted" style="color: var(--danger);" onclick="deleteProfilePost('${escapeHtml(post.post_id)}')"><i class="fa-solid fa-trash"></i> Delete</button>
                    </div>` : ''}
                </article>`).join('')
            : emptyBlock('fa-newspaper', 'No posts yet', 'Posts you share will appear here on your profile.');
    } catch (error) {
        container.innerHTML = emptyBlock('fa-circle-exclamation', 'Posts unavailable', 'Your posts could not be loaded. Please try again.');
        toast(error.message, 'error');
    }
}

function openProfilePostEdit(postId) {
    const card = document.querySelector(`[data-profile-post-id="${CSS.escape(String(postId))}"]`);
    if (!card) {
        toast('This post is no longer available. Refresh and try again.', 'error');
        return;
    }
    const post = profilePosts.find((item) => String(item.post_id) === String(postId));
    if (!post || String(post.author_id) !== String(profileUser.id)) {
        toast('You can only edit your own posts.', 'error');
        return;
    }
    editingProfilePost = post;
    document.getElementById('profile-post-edit-content').value = post.content || '';
    document.getElementById('profile-post-edit-media').innerHTML = profilePostMedia(post)
        || '<p class="field-help">No attachments on this post.</p>';
    document.getElementById('profile-post-edit-files').value = '';
    document.getElementById('profile-post-edit-files').accept = post.post_type === 'product'
        ? 'image/*'
        : 'image/*,video/mp4,video/webm,video/quicktime';
    document.getElementById('profile-post-edit-files').multiple = post.post_type !== 'product';
    document.getElementById('profile-post-edit-files-label').textContent = post.post_type === 'product'
        ? 'Replace product image'
        : 'Replace post photos or video';
    document.getElementById('profile-post-edit-files-help').textContent = post.post_type === 'product'
        ? 'Choose one image, 8 MB or smaller. It will replace the product image on the marketplace and post.'
        : 'Choose up to 5 files, each 8 MB or smaller. Choosing files replaces the current attachments.';
    document.getElementById('profile-post-edit-remove-label').textContent = post.post_type === 'product'
        ? 'Remove product image'
        : 'Remove current attachments';
    document.getElementById('profile-post-edit-remove-media').checked = false;
    openModal('profile-post-edit-modal');
    document.getElementById('profile-post-edit-content').focus();
}

async function saveProfilePostEdit() {
    if (!editingProfilePost) return;
    const content = document.getElementById('profile-post-edit-content').value.trim();
    const files = Array.from(document.getElementById('profile-post-edit-files').files || []);
    const removeMedia = document.getElementById('profile-post-edit-remove-media').checked;
    const button = document.getElementById('profile-post-edit-save');
    if (!content) {
        toast('Post content cannot be empty.', 'error');
        return;
    }
    const maxFiles = editingProfilePost.post_type === 'product' ? 1 : 5;
    if (files.length > maxFiles) {
        toast(editingProfilePost.post_type === 'product'
            ? 'Choose one product image.'
            : 'Choose no more than 5 attachments.', 'error');
        return;
    }
    if (files.some((file) => file.size > MAX_MEDIA_BYTES)) {
        toast('Each attachment must be 8 MB or smaller.', 'error');
        return;
    }
    if (editingProfilePost.post_type === 'product' && files.some((file) => !file.type.startsWith('image/'))) {
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
            body.media_type = attachments.length === 1
                ? attachments[0].type
                : 'image-gallery';
        } else if (removeMedia) {
            body.media_url = '';
            body.media_type = '';
        }
        await api(`/posts/${editingProfilePost.post_id}`, { method: 'PUT', body });
        closeModal('profile-post-edit-modal');
        editingProfilePost = null;
        await loadProfilePosts();
        toast('Post updated successfully.');
    } catch (error) {
        toast(error.message, 'error');
    } finally {
        button.disabled = false;
    }
}

async function deleteProfilePost(postId) {
    if (!confirm('Delete this post permanently? This cannot be undone.')) return;
    try {
        await api(`/posts/${postId}`, { method: 'DELETE' });
        await loadProfilePosts();
        toast('Post deleted.', 'info');
    } catch (error) {
        toast(error.message, 'error');
    }
}

async function saveProfile(event) {
    event.preventDefault();
    const get = (id) => document.getElementById(id).value.trim();
    const age = Number(get('p-age'));
    if (!get('p-first') || !get('p-last')) { toast('First and last name are required.', 'error'); return; }
    if (!(age >= 18)) { toast('Age must be 18 or older.', 'error'); return; }
    const button = document.getElementById('profile-save-button');
    const body = {
        first_name: get('p-first'),
        middle_name: get('p-middle'),
        last_name: get('p-last'),
        age,
        gender: document.getElementById('p-gender').value,
        contact_number: get('p-contact'),
        address: get('p-address')
    };
    if (profileUser.role === 'transporter') {
        body.transport_origin = get('transport-origin');
        body.vehicle_number = get('vehicle-number');
        body.vehicle_type = document.getElementById('vehicle-type').value;
        if (!body.transport_origin || !body.vehicle_number || !body.vehicle_type) {
            toast('Complete your logistics origin, vehicle number, and vehicle type.', 'error');
            return;
        }
    }
    setProfileButtonLoading(button, true, 'Saving...');
    try {
        await api(`/update/${profileUser.id}`, {
            method: 'PUT',
            body
        });
        await refreshProfile();
        toast('Profile saved.');
    } catch (error) {
        toast(error.message, 'error');
    } finally {
        setProfileButtonLoading(button, false);
    }
}

async function changePassword(event) {
    event.preventDefault();
    const current = document.getElementById('pw-current').value;
    const next = document.getElementById('pw-new').value;
    const confirmPassword = document.getElementById('pw-confirm').value;
    if (next.length < 8) { toast('New password must be at least 8 characters.', 'error'); return; }
    if (next !== confirmPassword) { toast('New passwords do not match.', 'error'); return; }
    if (next === current) { toast('New password must be different from the current one.', 'error'); return; }
    try {
        await api(`/update/${profileUser.id}`, { method: 'PUT', body: { password: next, current_password: current } });
        event.target.reset();
        toast('Password updated.');
    } catch (error) {
        toast(error.message, 'error');
    }
}

async function handleAvatarChange(input) {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Please choose an image file.', 'error'); return; }
    try {
        const uploaded = await uploadMedia(file, 'profiles');
        await api(`/update/${profileUser.id}`, { method: 'PUT', body: { profile_pic: uploaded.url } });
        await refreshProfile();
        toast('Profile photo updated.');
    } catch (error) {
        toast(error.message, 'error');
    }
}

function isLegacyLocalPhoto(value) {
    return typeof value === 'string' && value.startsWith('/uploads/');
}

async function moveProfilePhotoToCloud() {
    if (!profileUser || !isLegacyLocalPhoto(profileUser.profile_pic)) return;
    const button = document.getElementById('move-avatar-to-cloud');
    button.disabled = true;
    try {
        const response = await fetch(mediaUrl(profileUser.profile_pic), { credentials: 'same-origin' });
        if (!response.ok) {
            throw new Error(`Could not load the current profile photo (${response.status}).`);
        }
        const blob = await response.blob();
        const file = new File([blob], 'profile-photo', { type: blob.type });
        const uploaded = await uploadMedia(file, 'profiles');
        await api(`/update/${profileUser.id}`, { method: 'PUT', body: { profile_pic: uploaded.url } });
        await refreshProfile();
        toast('Profile photo moved to cloud storage.');
    } catch (error) {
        toast(error.message, 'error');
    } finally {
        button.disabled = false;
    }
}

async function initPage() {
    installModalBehaviour();
    const user = await requireSession();
    if (!user) return;
    const targetUserId = new URLSearchParams(location.search).get('user');
    viewingOwnProfile = !targetUserId || String(targetUserId) === String(user.id);
    history.replaceState(null, '', viewingOwnProfile ? '/profile' : `/profile?user=${encodeURIComponent(targetUserId)}`);
    initShell(user);
    if (!viewingOwnProfile) {
        document.querySelectorAll('.owner-only').forEach((element) => element.classList.add('hidden'));
        const followButton = document.getElementById('profile-follow-button');
        followButton.classList.remove('hidden');
        try {
            profileUser = await api(`/members/${encodeURIComponent(targetUserId)}`);
            renderProfileHeader();
            renderProfileFarm();
            await renderProfileFarmMap();
            profileProducts = profileUser.products || [];
            renderProfileProducts();
            followButton.textContent = profileUser.following ? 'Following' : 'Add friend';
            followButton.setAttribute('aria-pressed', String(Boolean(profileUser.following)));
            document.querySelector('.topbar-left h2').textContent = 'Member Profile';
            await loadProfilePosts();
        } catch (error) {
            toast(error.message, 'error');
            document.getElementById('profile-fullname').textContent = 'Profile unavailable';
            document.getElementById('profile-meta').textContent = error.message;
        }
        return;
    }
    profileUser = user;
    initShell(user);
    fillProfileForm();
    renderProfileHeader();
    renderProfileFarm();
    await renderProfileFarmMap();
    profileProducts = profileUser.products || [];
    renderProfileProducts();
    await renderProfileQr();
    await loadProfilePosts();
    listen(document.getElementById('avatar-input'), 'change', (e) => handleAvatarChange(e.target));
    document.querySelectorAll('.sidebar .nav-item').forEach((n) => n.classList.toggle('active', n.dataset.view === 'profile'));
}

/* ---------- map location: drag the pin, search, or use the device location ---------- */
let profileMap = null;
let profileMarker = null;
let profileLocation = null;   // { lat, lng, label }

function placeProfilePin(lat, lng, label) {
    profileLocation = { lat, lng, label: label || '' };
    if (profileMap && profileMarker) {
        profileMarker.setLatLng([lat, lng]);
        profileMap.setView([lat, lng], 16);
    }
    document.getElementById('loc-label').textContent = label || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    if (profileUser && profileUser.role === 'transporter' && label) {
        document.getElementById('p-address').value = label;
    }
}

async function pinFromCoordinates(lat, lng) {
    let label = '';
    try { label = await geoReverse(lat, lng); } catch (e) { label = ''; }
    placeProfilePin(lat, lng, label);
}

async function searchLocation() {
    const input = document.getElementById('loc-search');
    const button = document.getElementById('loc-search-submit');
    const text = input.value.trim();
    if (!text) { toast('Type an address to search.', 'error'); return; }
    input.disabled = true;
    setProfileButtonLoading(button, true, 'Searching...');
    try {
        const found = await geoSearch(text);
        if (!found) { toast('No place matched that address. Try a nearby landmark.', 'error'); return; }
        placeProfilePin(found.lat, found.lng, found.label);
    } catch (error) {
        toast(error.message || 'The address search is not available right now.', 'error');
    } finally {
        input.disabled = false;
        setProfileButtonLoading(button, false);
    }
}

function useMyLocation() {
    if (!navigator.geolocation) { toast('Your browser cannot share its location.', 'error'); return; }
    const button = document.getElementById('use-profile-location');
    setProfileButtonLoading(button, true, 'Locating...');
    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            try {
                await pinFromCoordinates(pos.coords.latitude, pos.coords.longitude);
            } finally {
                setProfileButtonLoading(button, false);
            }
        },
        () => {
            setProfileButtonLoading(button, false);
            toast('Location access was denied. Drag the pin to set your location.', 'error');
        },
        { enableHighAccuracy: true, timeout: 15000 }
    );
}

async function saveLocation() {
    if (!profileLocation) { toast('Place the pin on the map first.', 'error'); return; }
    const button = document.getElementById('save-location-button');
    setProfileButtonLoading(button, true, 'Saving location...');
    try {
        const body = {
            latitude: profileLocation.lat,
            longitude: profileLocation.lng,
            location_label: profileLocation.label || null
        };
        if (profileUser.role === 'transporter' && profileLocation.label) {
            body.address = document.getElementById('p-address').value.trim() || profileLocation.label;
        }
        await api(`/update/${profileUser.id}`, {
            method: 'PUT',
            body
        });
        await refreshProfile();
        toast('Location saved. It now appears on your dashboard map.');
    } catch (error) {
        toast(error.message, 'error');
    } finally {
        setProfileButtonLoading(button, false);
    }
}

const profileInitPage = initPage;
initPage = async function () {
    onPageTeardown(() => {
        if (profileFarmMap) profileFarmMap.remove();
        if (profileMap) profileMap.remove();
        profileFarmMap = null;
        profileMap = null;
        profileMarker = null;
    });
    await profileInitPage();
    if (!profileUser || !viewingOwnProfile) return;
    listen(document.getElementById('loc-search'), 'keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            searchLocation();
        }
    });
    const u = profileUser;
    try {
        const { map, L } = await createMap('profile-map', Number(u.latitude || 13.6218), Number(u.longitude || 123.1948), u.latitude ? 15 : 12);
        profileMap = map;
        profileMarker = L.marker([Number(u.latitude || 13.6218), Number(u.longitude || 123.1948)], { draggable: true }).addTo(map);
        profileMarker.on('dragend', (e) => {
            const p = e.target.getLatLng();
            pinFromCoordinates(p.lat, p.lng);
        });
        if (u.latitude) {
            profileLocation = { lat: Number(u.latitude), lng: Number(u.longitude), label: u.location_label || '' };
            document.getElementById('loc-label').textContent = u.location_label || 'Pinned location';
        }
    } catch (error) {
        document.getElementById('loc-label').textContent = error.message;
    }
};
