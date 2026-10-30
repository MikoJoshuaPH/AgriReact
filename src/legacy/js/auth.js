/* Sign-in and registration (loginpage.html) */
const AUTH_PANELS = {
    login: {
        image: "url('https://images.unsplash.com/photo-1592982537447-7440770cbfc9?auto=format&fit=crop&w=1000&q=80')",
        title: 'Cultivating a Better Future.',
        text: '"Farming is a profession of hope. By connecting directly with consumers, we secure a better future for our families and our land." — Ramon Santos, Rice Farmer'
    },
    register: {
        image: "url('https://images.unsplash.com/photo-1605000797499-95a51c5269ae?auto=format&fit=crop&w=1000&q=80')",
        title: 'Join the AgriTrace Movement.',
        text: '"To make agriculture attractive to the youth, we must make it profitable and smart. AgriTrace gives us the platform to do exactly that." — Maria Santos, Organic Farmer'
    }
};

function toggleAuth(type) {
    const isRegister = type === 'register';
    document.getElementById('login-form').classList.toggle('hidden', isRegister);
    document.getElementById('register-form').classList.toggle('hidden', !isRegister);
    document.getElementById('register-error').classList.add('hidden');
    document.getElementById('form-title').innerText = isRegister ? 'Create an Account' : 'Welcome Back';
    const panel = isRegister ? AUTH_PANELS.register : AUTH_PANELS.login;
    document.getElementById('dynamic-left-panel').style.backgroundImage = panel.image;
    document.getElementById('quote-title').innerText = panel.title;
    document.getElementById('quote-text').innerText = panel.text;
}

let pendingLogin = null;   // email waiting for the sign-in code
let resetToken = null;     // token from the reset link

function postLoginDestination() {
    const destination = sessionStorage.getItem('agritrace_post_login_path');
    sessionStorage.removeItem('agritrace_post_login_path');
    return destination && destination.startsWith('/') && !destination.startsWith('//')
        ? destination
        : '/dashboard';
}

function showLoginError(message) {
    const errorBox = document.getElementById('login-error');
    errorBox.textContent = message;
    errorBox.classList.remove('hidden');
    errorBox.focus();
}

function clearLoginError() {
    const errorBox = document.getElementById('login-error');
    errorBox.textContent = '';
    errorBox.classList.add('hidden');
}

/** Shows one step of the sign-in page: login | code | forgot | reset. */
function showLoginStep(step) {
    clearLoginError();
    const codeStep = step === 'code';
    const loginStep = step === 'login' || codeStep;
    document.getElementById('login-form').classList.toggle('hidden', !loginStep);
    document.getElementById('forgot-form').classList.toggle('hidden', step !== 'forgot');
    document.getElementById('reset-form').classList.toggle('hidden', step !== 'reset');
    document.getElementById('register-form').classList.add('hidden');

    const email = document.getElementById('login-email');
    email.closest('.input-group').classList.toggle('hidden', codeStep);
    email.required = !codeStep;
    const password = document.getElementById('login-password');
    password.closest('.input-group').classList.toggle('hidden', codeStep);
    password.required = !codeStep;
    const code = document.getElementById('login-code');
    code.closest('.input-group').classList.toggle('hidden', !codeStep);
    code.required = codeStep;
    document.getElementById('login-submit').textContent = codeStep ? 'Verify code' : 'Login';
    document.getElementById('form-title').innerText =
        step === 'forgot' ? 'Reset your password' : step === 'reset' ? 'Choose a new password' : 'Welcome Back';
    if (step === 'login') pendingLogin = null;
}

/** Step 1: email + password. The server then emails a code (step 2). */
async function handleLogin(event) {
    event.preventDefault();
    clearLoginError();
    const button = document.getElementById('login-submit');
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.innerHTML = `<span class="auth-spinner" aria-hidden="true"></span> ${pendingLogin ? 'Verifying...' : 'Logging in...'}`;
    const loading = document.getElementById('auth-loading');
    document.getElementById('auth-loading-message').textContent = pendingLogin ? 'Verifying your code...' : 'Logging in...';
    loading.classList.remove('hidden');
    let redirecting = false;
    try {
        if (pendingLogin) {
            const code = document.getElementById('login-code').value.trim();
            const data = await api('/login/verify', { method: 'POST', body: { username: pendingLogin, code }, auth: false });
            storeTokens(data.tokens);
            cacheUser(data.user);
            pendingLogin = null;
            redirecting = true;
            location.href = postLoginDestination();
            return;
        }
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        const data = await api('/login', { method: 'POST', body: { username: email, password }, auth: false });
        if (data.requires_2fa) {
            pendingLogin = email;
            document.getElementById('login-code').value = '';
            showLoginStep('code');
            toast(data.message, 'info');
            return;
        }
        storeTokens(data.tokens);
        cacheUser(data.user);
        redirecting = true;
        location.href = postLoginDestination();
    } catch (error) {
        let message = error.message;
        if (error.status === 429) {
            message = 'Too many attempts. Please wait a minute and try again.';
        } else if (!pendingLogin && error.message === 'Invalid username or password.') {
            message = 'Invalid email or password.';
        }
        showLoginError(message);
    } finally {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        if (!redirecting) {
            button.textContent = pendingLogin ? 'Verify code' : 'Login';
            loading.classList.add('hidden');
        }
    }
}

async function handleForgot(event) {
    event.preventDefault();
    const email = document.getElementById('forgot-email').value.trim();
    try {
        const data = await api('/password/forgot', { method: 'POST', body: { email }, auth: false });
        toast(data.message, 'success');
        showLoginStep('login');
    } catch (error) {
        toast(error.message, 'error');
    }
}

async function handleReset(event) {
    event.preventDefault();
    const password = document.getElementById('reset-pass').value;
    const confirmPassword = document.getElementById('reset-cpass').value;
    if (password !== confirmPassword) { toast('Passwords do not match.', 'error'); return; }
    try {
        const data = await api('/password/reset', { method: 'POST', body: { token: resetToken, password }, auth: false });
        toast(data.message, 'success');
        history.replaceState(null, '', '/');
        resetToken = null;
        showLoginStep('login');
    } catch (error) {
        toast(error.message, 'error');
    }
}

/** Builds a unique username from the email address (the backend requires one). */
function usernameFromEmail(email) {
    const base = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'member';
    return base + Math.floor(1000 + Math.random() * 9000);
}
function startSocialLogin(provider, intent) {
    const role = intent === 'register' ? document.getElementById('reg-type').value : 'farmer';
    const query = new URLSearchParams({ intent, role });
    location.href = `${API_BASE}/oauth/${encodeURIComponent(provider)}/start?${query}`;
}

function handleSocialReturn() {
    const params = new URLSearchParams(location.hash.slice(1));
    const access = params.get('social_access');
    const refresh = params.get('social_refresh');
    if (access && refresh) {
        storeTokens({ access_token: access, refresh_token: refresh });
        history.replaceState(null, '', '/');
        location.replace(postLoginDestination());
        return true;
    }

    const query = new URLSearchParams(location.search);
    if (query.get('social_status') === 'pending') {
        toast('Registration received. You can sign in after an administrator approves your account.', 'success');
    } else if (query.get('social_error')) {
        toast(query.get('social_error'), 'error');
    }
    if (query.has('social_status') || query.has('social_error')) {
        history.replaceState(null, '', '/');
    }
    return false;
}

async function handleRegister(event) {
    event.preventDefault();
    const errorBox = document.getElementById('register-error');
    const showError = (message) => {
        errorBox.textContent = message;
        errorBox.classList.remove('hidden');
        errorBox.focus();
    };
    errorBox.classList.add('hidden');
    const get = (id) => document.getElementById(id).value.trim();
    const password = document.getElementById('reg-pass').value;
    const confirmPassword = document.getElementById('reg-cpass').value;
    const email = get('reg-email');
    const age = Number(get('reg-age'));

    if (password !== confirmPassword) { showError('Passwords do not match.'); return; }
    if (password.length < 8) { showError('Password must be at least 8 characters.'); return; }
    if (!(age >= 18)) { showError('You must be at least 18 years old to register.'); return; }

    const role = document.getElementById('reg-type').value;
    const button = event.target.querySelector('button[type=submit]');
    button.disabled = true;
    try {
        await api('/create', {
            method: 'POST',
            auth: false,
            body: {
                username: usernameFromEmail(email),
                email,
                password,
                first_name: get('reg-fname'),
                middle_name: get('reg-mname'),
                last_name: get('reg-lname'),
                age,
                gender: get('reg-gender'),
                address: get('reg-address'),
                contact_number: get('reg-contact'),
                role
            }
        });
        toast('Registration received. You can sign in after an administrator approves your account.', 'success');
        document.getElementById('login-email').value = email;
        document.getElementById('register-form').reset();
        toggleAuth('login');
    } catch (error) {
        showError(error.message);
    } finally {
        button.disabled = false;
    }
}

function fillSignupRoles() {
    document.getElementById('reg-type').innerHTML = SIGNUP_ROLES
        .map((option) => `<option value="${option.role}">${option.label}</option>`).join('');
}

function initPage() {
    const params = new URLSearchParams(location.search);
    if (params.get('reset')) {
        resetToken = params.get('reset');
        showLoginStep('reset');
        return;
    }
    installModalBehaviour();
    if (handleSocialReturn()) return;
    fillSignupRoles();
    document.getElementById('dynamic-left-panel').style.backgroundImage = AUTH_PANELS.login.image;
    ['login-email', 'login-password', 'login-code'].forEach((id) => {
        document.getElementById(id).addEventListener('input', clearLoginError);
    });
    if (getTokens().access) {
        // Already signed in: go straight to the dashboard. A failed check must not clear
        // tokens, because a sign-in that completes meanwhile would be wiped out.
        api('/profile').then(() => { location.replace(postLoginDestination()); }).catch(() => {});
    }
    history.replaceState(null, '', '/');
    window.onpageshow = () => {
        if (getTokens().access || getTokens().refresh) {
            location.replace(postLoginDestination());
        }
    };
}
