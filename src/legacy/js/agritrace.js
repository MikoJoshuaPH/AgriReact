/* =====================================================================
   AgriTrace shared client: API access, session, UI helpers and page
   lifecycle. Used by every legacy page through the React page loader.
   ===================================================================== */

const API_BASE = (window.AGRITRACE_API_BASE_URL || '/api').replace(/\/$/, '');
const DEFAULT_AVATAR = 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=100&q=80';
const DEFAULT_PRODUCT_IMG = 'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=400&q=80';
const CATEGORIES = ['Fruits', 'Vegetables', 'Meats', 'Grains', 'Dairy'];
// Sign-up choices map onto the roles the backend understands.
const SIGNUP_ROLES = [
    { label: 'Farmer', role: 'farmer' },
    { label: 'Business Owner', role: 'seller' },
    { label: 'Buyer', role: 'collector' },
    { label: 'Transporter', role: 'transporter' }
];
const ROLE_LABELS = { farmer: 'Farmer', seller: 'Business Owner', collector: 'Buyer', transporter: 'Transporter', admin: 'Administrator' };
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;

function mediaUrl(value, fallback = '') {
    const url = String(value || '').trim();
    if (!url) return fallback;
    if (/^(https?:|data:|blob:)/i.test(url)) return url;
    return url.startsWith('/') ? url : '/' + url;
}

/* ---------- formatting helpers ---------- */
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
}
function money(n) {
    return '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function timeAgo(value) {
    if (!value) return '';
    const seconds = Math.max(0, (Date.now() - new Date(String(value).replace(' ', 'T')).getTime()) / 1000);
    if (!Number.isFinite(seconds)) return '';
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
    return Math.floor(seconds / 86400) + 'd ago';
}
function formatDateTime(value) {
    if (!value) return '';
    const date = new Date(String(value).replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('en-PH', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit'
    });
}
function displayName(user) {
    if (!user) return 'AgriTrace member';
    const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
    return name || user.username || user.email || 'AgriTrace member';
}
function fullName(user) {
    const name = [user.first_name, user.middle_name, user.last_name].filter(Boolean).join(' ');
    return name || user.username || user.email || 'AgriTrace member';
}
function roleLabel(role) {
    return ROLE_LABELS[role] || role || 'Member';
}
function avatarOf(user) {
    return mediaUrl(user && user.profile_pic, DEFAULT_AVATAR);
}
function isAdmin(user) {
    return !!user && user.role === 'admin';
}

/* ---------- session ---------- */
function getTokens() {
    return { access: localStorage.getItem('access_token'), refresh: localStorage.getItem('refresh_token') };
}
function storeTokens(tokens) {
    if (tokens.access_token) localStorage.setItem('access_token', tokens.access_token);
    if (tokens.refresh_token) localStorage.setItem('refresh_token', tokens.refresh_token);
}
function clearSession() {
    ['access_token', 'refresh_token', 'agritrace_user'].forEach((key) => localStorage.removeItem(key));
    Object.keys(localStorage)
        .filter((key) => key.startsWith('cart:'))
        .forEach((key) => localStorage.removeItem(key));
}
function cachedUser() {
    try { return JSON.parse(localStorage.getItem('agritrace_user') || 'null'); } catch (e) { return null; }
}
function cacheUser(user) {
    localStorage.setItem('agritrace_user', JSON.stringify(user));
}

/* ---------- API client ---------- */
async function refreshTokens() {
    const { refresh } = getTokens();
    if (!refresh) return false;
    try {
        const response = await fetch(API_BASE + '/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refresh })
        });
        if (!response.ok) return false;
        const data = await response.json();
        storeTokens(data.tokens || data);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Calls the LavaLust API. Sends the access token, retries once after a
 * refresh when the token has expired, and throws an Error with the server
 * message on failure.
 */
async function api(path, options = {}) {
    const { method = 'GET', body, form, auth = true } = options;
    const send = async () => {
        const headers = {};
        let payload;
        if (form) {
            payload = form;
        } else if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
            payload = JSON.stringify(body);
        }
        if (auth) {
            const { access } = getTokens();
            if (access) headers.Authorization = 'Bearer ' + access;
        }
        return fetch(API_BASE + path, { method, headers, body: payload });
    };

    let response = await send();
    // Apache/PHP can briefly return a 5xx while the dashboard services are
    // initializing. Retry safe reads once, but never retry mutations such as
    // likes because they toggle state.
    if (response.status >= 500 && method === 'GET') {
        await new Promise((resolve) => setTimeout(resolve, 250));
        response = await send();
    }
    if (response.status === 401 && auth && (await refreshTokens())) {
        response = await send();
    }
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) {
        const error = new Error(`The server returned an unexpected response (${response.status}). Please check the backend and try again.`);
        error.status = response.status;
        throw error;
    }
    let data;
    try {
        data = await response.json();
    } catch (cause) {
        throw new Error('The server returned invalid JSON. Please check the backend and try again.', { cause });
    }
    if (!response.ok) {
        const error = new Error(data.error || data.message || `Request failed (${response.status})`);
        error.status = response.status;
        throw error;
    }
    return data;
}

async function requirePuterSignIn() {
    const client = typeof window.getPuterClient === 'function'
        ? await window.getPuterClient()
        : window.puter;
    if (!client || !client.auth || !client.fs) {
        throw new Error('Puter.js is unavailable. Reload the page and try again.');
    }
    if (!client.auth.isSignedIn()) {
        await client.auth.signIn();
    }
    if (!client.auth.isSignedIn()) {
        throw new Error('Sign in to Puter to upload files.');
    }
    return client;
}

/** Uploads media to the signed-in user's Puter storage and returns a public URL. */
async function uploadMedia(file, folder = 'community') {
    if (file.size > MAX_MEDIA_BYTES) {
        throw new Error('Media files must be 8 MB or smaller.');
    }
    const extensions = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'video/mp4': 'mp4',
        'video/webm': 'webm',
        'video/quicktime': 'mov'
    };
    const extension = extensions[file.type];
    if (!extension) {
        throw new Error('Only JPG, PNG, GIF, WEBP, MP4, WEBM, and MOV files are supported.');
    }
    const client = await requirePuterSignIn();
    const month = new Date().toISOString().slice(0, 7).replace('-', '');
    const path = `${folder}/${month}/${crypto.randomUUID()}.${extension}`;
    await client.fs.write(path, file, { overwrite: false, createMissingParents: true });
    const url = await client.fs.getReadURL(path, '10y');
    return { url: String(url), type: file.type.startsWith('video/') ? 'video' : 'image' };
}

/** Loads the signed-in user from the server, or sends the visitor to the login page. */
async function requireSession(adminOnly = false) {
    if (!getTokens().access && !getTokens().refresh) {
        location.replace('/');
        return null;
    }
    try {
        const user = await api('/profile');
        cacheUser(user);
        if (adminOnly && !isAdmin(user)) {
            toast('This page is for administrators only.', 'error');
            setTimeout(() => location.replace('/dashboard'), 700);
            return null;
        }
        return user;
    } catch (e) {
        if (e.status === 401 || e.status === 403) {
            clearSession();
            location.replace('/');
        } else {
            toast('Cannot reach the AgriTrace server. Please try again.', 'error');
        }
        return null;
    }
}

async function signOut() {
    const { refresh } = getTokens();
    try {
        if (refresh) await api('/logout', { method: 'POST', body: { refresh_token: refresh }, auth: false });
    } catch (e) { /* the session is cleared locally regardless */ }
    clearSession();
    location.replace('/');
}

/* ---------- UI helpers ---------- */
function toast(message, type = 'success') {
    let box = document.getElementById('toast-container');
    if (!box) {
        box = document.createElement('div');
        box.id = 'toast-container';
        box.className = 'toast-container';
        document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.textContent = message;
    box.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3000);
}
function openModal(id) { const m = document.getElementById(id); if (m) m.classList.add('active'); }
function closeModal(id) { const m = document.getElementById(id); if (m) m.classList.remove('active'); }
function setBadge(id, n) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = n;
    el.classList.toggle('hidden', !n || n <= 0);
}
function emptyBlock(icon, title, text) {
    return `<div class="empty-block"><i class="fa-solid ${icon}"></i><h3 style="color: var(--text-main); margin-bottom: 6px;">${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p></div>`;
}
/** Reads a file as a data URL (used for previews). */
function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = reject;
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
    });
}

/* ---------- page lifecycle: listeners are tracked so they can be removed on exit ---------- */
const pageListeners = [];
function listen(target, type, handler) {
    target.addEventListener(type, handler);
    pageListeners.push([target, type, handler]);
}
function teardownPage() {
    pageListeners.splice(0).forEach(([target, type, handler]) => target.removeEventListener(type, handler));
}

/** Fills the sidebar profile, shows admin-only links and sets up the mobile drawer. */
function initShell(user) {
    document.body.classList.toggle('light-mode', localStorage.getItem('theme') === 'light');
    const nameEl = document.getElementById('sidebar-profile-name');
    if (nameEl) nameEl.textContent = displayName(user);
    const picEl = document.getElementById('sidebar-profile-pic');
    if (picEl) picEl.src = avatarOf(user);
    document.querySelectorAll('.admin-only').forEach((el) => el.classList.toggle('hidden', !isAdmin(user)));

    if (!document.getElementById('sidebar-overlay')) {
        const overlay = document.createElement('div');
        overlay.id = 'sidebar-overlay';
        overlay.className = 'sidebar-overlay';
        overlay.onclick = () => toggleSidebar(false);
        document.body.appendChild(overlay);
    }
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) listen(sidebar, 'click', (e) => {
        if (e.target.closest('.nav-item') && window.innerWidth <= 900) toggleSidebar(false);
    });
}
function toggleSidebar(force) {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (!sidebar) return;
    const open = typeof force === 'boolean' ? force : !sidebar.classList.contains('open');
    sidebar.classList.toggle('open', open);
    if (overlay) overlay.classList.toggle('open', open);
}

// Modal backdrop click and Escape close any open dialog.
function installModalBehaviour() {
    listen(document, 'click', (e) => {
        if (e.target.classList && e.target.classList.contains('modal-overlay')) e.target.classList.remove('active');
    });
    listen(document, 'keydown', (e) => {
        if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.active').forEach((m) => m.classList.remove('active'));
    });
}

/* ---------- maps (Leaflet + Geoapify tiles and geocoding) ---------- */
let leafletLoading = null;
let leafletStylesLoading = null;
function ensureLeafletStyles() {
    const stylesheetUrl = new URL('/vendor/leaflet/leaflet.css', location.href).href;
    if (Array.from(document.styleSheets).some((stylesheet) => stylesheet.href === stylesheetUrl)) {
        return Promise.resolve();
    }
    if (!leafletStylesLoading) {
        leafletStylesLoading = new Promise((resolve, reject) => {
            const stylesheet = document.createElement('link');
            stylesheet.rel = 'stylesheet';
            stylesheet.href = stylesheetUrl;
            stylesheet.onload = resolve;
            stylesheet.onerror = () => {
                leafletStylesLoading = null;
                reject(new Error('The map styles could not be loaded.'));
            };
            document.head.appendChild(stylesheet);
        });
    }
    return leafletStylesLoading;
}
/** Loads Leaflet from /vendor once and returns the global L. */
function ensureLeaflet() {
    if (!leafletLoading) {
        const scriptLoading = window.L ? Promise.resolve(window.L) : new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = '/vendor/leaflet/leaflet.js';
            script.onload = () => resolve(window.L);
            script.onerror = () => reject(new Error('The map could not be loaded.'));
            document.head.appendChild(script);
        });
        leafletLoading = Promise.all([scriptLoading, ensureLeafletStyles()])
            .then(([L]) => L)
            .catch((error) => {
                leafletLoading = null;
                throw error;
            });
    }
    return leafletLoading;
}
function geoapifyKey() {
    return window.AGRITRACE_GEOAPIFY_KEY || '';
}
/** Creates a Leaflet map with Geoapify tiles. Returns { map, L }. */
async function createMap(elementId, lat, lng, zoom = 14) {
    const L = await ensureLeaflet();
    const map = L.map(elementId).setView([lat, lng], zoom);
    L.tileLayer(`https://maps.geoapify.com/v1/tile/osm-bright/{z}/{x}/{y}.png?apiKey=${geoapifyKey()}`, {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.geoapify.com/">Geoapify</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    return { map, L };
}
/** Returns the address Geoapify finds for a coordinate, or '' when none. */
async function geoReverse(lat, lng) {
    const response = await fetch(`https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lng}&apiKey=${geoapifyKey()}`);
    const data = await response.json();
    const feature = data.features && data.features[0];
    return feature ? feature.properties.formatted : '';
}
/** Finds the first place matching a text search. Returns { lat, lng, label } or null. */
async function geoSearch(text) {
    const response = await fetch(`https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(text)}&limit=1&apiKey=${geoapifyKey()}`);
    if (!response.ok) {
        throw new Error(`Address search failed (${response.status}).`);
    }
    const data = await response.json();
    const feature = data.features && data.features[0];
    return feature ? { lat: feature.properties.lat, lng: feature.properties.lon, label: feature.properties.formatted } : null;
}
