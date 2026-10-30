import LegacyPage from './LegacyPage.jsx';

const pages = {
  '': 'loginpage',
  'login': 'loginpage',
  'dashboard': 'dashboard',
  'profile': 'profile',
  'admin': 'adminDashboard',
  'loginpage.html': 'loginpage',
  'profile.html': 'profile',
  'indexed.html': 'dashboard',
  'database.html': 'adminDashboard',
  'trace': 'trace',
  'trace.html': 'trace',
  'cloud': 'adminDashboard',
  'admin-cloud.html': 'adminDashboard',
};

const canonicalPaths = {
  loginpage: '/',
  dashboard: '/dashboard',
  profile: '/profile',
  adminDashboard: '/admin',
  trace: '/trace',
  adminCloud: '/cloud',
};

export default function App() {
  const path = window.location.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
  const page = pages[path] || 'loginpage';
  if (path === 'cloud' || path === 'admin-cloud.html') {
    window.history.replaceState(window.history.state, '', '/admin#cloud');
  }
  const protectedPage = page !== 'loginpage' && page !== 'trace';
  const hasSession = Boolean(
    localStorage.getItem('access_token') || localStorage.getItem('refresh_token'),
  );

  if (protectedPage && !hasSession) {
    sessionStorage.setItem(
      'agritrace_post_login_path',
      window.location.pathname + window.location.search + window.location.hash,
    );
    window.location.replace('/');
    return null;
  }

  if (path.endsWith('.html') && path !== 'admin-cloud.html' && canonicalPaths[page]) {
    window.history.replaceState(null, '', canonicalPaths[page] + window.location.search);
  }

  return <LegacyPage page={page} />;
}
