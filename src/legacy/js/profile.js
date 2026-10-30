/* My Profile (profile.html): details, photo, password */
let profileUser = null;
let profilePosts = [];
let editingProfilePost = null;
let viewingOwnProfile = true;

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
    statusEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${active ? 'Active' : 'Pending approval'}`;
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
}

async function refreshProfile() {
    profileUser = await api('/profile');
    cacheUser(profileUser);
    initShell(profileUser);
    fillProfileForm();
    renderProfileHeader();
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
    if (!post.media_url) return [];
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
                        ${post.status === 'pending' ? '<span class="status-pill" style="margin-left: auto;">Pending review</span>' : ''}
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
    if (files.length > 5) {
        toast('Choose no more than 5 attachments.', 'error');
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
    try {
        await api(`/update/${profileUser.id}`, {
            method: 'PUT',
            body: {
                first_name: get('p-first'),
                middle_name: get('p-middle'),
                last_name: get('p-last'),
                age,
                gender: document.getElementById('p-gender').value,
                contact_number: get('p-contact'),
                address: get('p-address')
            }
        });
        await refreshProfile();
        toast('Profile saved.');
    } catch (error) {
        toast(error.message, 'error');
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
        toast('Profile photo moved to Puter.');
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
    button.disabled = true;
    button.textContent = 'Searching...';
    try {
        const found = await geoSearch(text);
        if (!found) { toast('No place matched that address. Try a nearby landmark.', 'error'); return; }
        placeProfilePin(found.lat, found.lng, found.label);
    } catch (error) {
        toast(error.message || 'The address search is not available right now.', 'error');
    } finally {
        input.disabled = false;
        button.disabled = false;
        button.textContent = 'Find';
    }
}

function useMyLocation() {
    if (!navigator.geolocation) { toast('Your browser cannot share its location.', 'error'); return; }
    navigator.geolocation.getCurrentPosition(
        (pos) => pinFromCoordinates(pos.coords.latitude, pos.coords.longitude),
        () => toast('Location access was denied. Drag the pin to set your location.', 'error'),
        { enableHighAccuracy: true, timeout: 15000 }
    );
}

async function saveLocation() {
    if (!profileLocation) { toast('Place the pin on the map first.', 'error'); return; }
    try {
        await api(`/update/${profileUser.id}`, {
            method: 'PUT',
            body: { latitude: profileLocation.lat, longitude: profileLocation.lng, location_label: profileLocation.label || null }
        });
        await refreshProfile();
        toast('Location saved. It now appears on your dashboard map.');
    } catch (error) {
        toast(error.message, 'error');
    }
}

const profileInitPage = initPage;
initPage = async function () {
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
