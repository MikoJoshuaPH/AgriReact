import { useEffect } from 'react';
import QRCode from 'qrcode';
import dashboardPage from './legacy/dashboard.html?raw';
import loginPage from './legacy/loginpage.html?raw';
import profilePage from './legacy/profile.html?raw';
import adminDashboardPage from './legacy/admin-dashboard.html?raw';
import tracePage from './legacy/trace.html?raw';
import adminCloudPage from './legacy/admin-cloud.html?raw';

// Shared page scripts (API client, session, UI helpers, page logic) live in src/legacy/js.
const sharedScripts = import.meta.glob('./legacy/js/*.js', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function sharedScript(src) {
  const name = src.split('/').pop();
  const key = Object.keys(sharedScripts).find((path) => path.endsWith(`/${name}`));
  if (!key) {
    throw new Error(`Unknown AgriTrace page script: ${src}`);
  }
  return sharedScripts[key];
}

function prepareTemplate(source) {
  const parsedPage = new DOMParser().parseFromString(source, 'text/html');
  const scripts = Array.from(parsedPage.querySelectorAll('script')).map((script) => {
    const src = script.getAttribute('src');
    if (src && src.startsWith('/vendor/')) {
      // Vendor libraries (Leaflet) are loaded on demand by the shared helpers in agritrace.js.
      script.remove();
      return '';
    }
    if (src) {
      if (/^https?:\/\//.test(src)) {
        throw new Error(`External page scripts are not supported: ${src}`);
      }
      script.remove();
      return sharedScript(src);
    }
    const content = script.textContent;
    script.remove();
    return content;
  });

  return {
    title: parsedPage.title || 'AgriTrace',
    body: parsedPage.body.innerHTML,
    head: Array.from(
      parsedPage.head.querySelectorAll('link[rel="stylesheet"], style'),
    ).map((element) => element.outerHTML).join(''),
    scripts,
  };
}

const templates = {
  loginpage: prepareTemplate(loginPage),
  profile: prepareTemplate(profilePage),
  dashboard: prepareTemplate(dashboardPage),
  adminDashboard: prepareTemplate(adminDashboardPage),
  trace: prepareTemplate(tracePage),
  adminCloud: prepareTemplate(adminCloudPage),
};

export default function LegacyPage({ page }) {
  useEffect(() => {
    const template = templates[page];
    if (!template) {
      throw new Error(`Unknown AgriTrace page: ${page}`);
    }

    const previousTitle = document.title;
    const previousBodyClass = document.body.className;
    const previousApiBaseUrl = window.AGRITRACE_API_BASE_URL;
    const previousPuter = window.puter;
    const previousGetPuterClient = window.getPuterClient;
    const previousGenerateQrCode = window.generateQrCode;
    window.AGRITRACE_API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';
    window.getPuterClient = async () => {
      if (!window.puter) {
        const module = await import('@heyputer/puter.js');
        window.puter = module.puter;
      }
      return window.puter;
    };
    window.AGRITRACE_GEOAPIFY_KEY = import.meta.env.VITE_GEOAPIFY_API_KEY || '';
    window.generateQrCode = (text) => QRCode.toDataURL(text, {
      width: 240,
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
    });

    const injectedHeadElements = [];
    const headTemplate = document.createElement('template');
    headTemplate.innerHTML = template.head;
    Array.from(headTemplate.content.children).forEach((element) => {
      const injected = document.importNode(element, true);
      document.head.appendChild(injected);
      injectedHeadElements.push(injected);
    });

    document.title = template.title;

    // All scripts of a page run together so helpers defined in shared files are visible to page code.
    const combined = template.scripts.join('\n;\n');
    const functionNames = Array.from(
      combined.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g),
      (match) => match[1],
    );
    const previousWindowFunctions = new Map();
    functionNames.forEach((name) => {
      if (!previousWindowFunctions.has(name)) {
        previousWindowFunctions.set(name, Object.getOwnPropertyDescriptor(window, name));
      }
    });
    const exposedFunctions = functionNames
      .map((name) => `if (typeof ${name} === 'function') window.${name} = ${name};`)
      .join('\n');

    const executableScript = document.createElement('script');
    executableScript.textContent = `(() => {\n${combined}\n${exposedFunctions}\n})();`;
    document.body.appendChild(executableScript);

    // Each page provides initPage() (and teardownPage() to remove its document listeners).
    if (typeof window.initPage === 'function') {
      window.initPage();
    }

    return () => {
      if (typeof window.teardownPage === 'function') {
        window.teardownPage();
      }
      injectedHeadElements.forEach((element) => element.remove());
      executableScript.remove();
      previousWindowFunctions.forEach((descriptor, name) => {
        if (descriptor) {
          Object.defineProperty(window, name, descriptor);
        } else {
          delete window[name];
        }
      });
      delete window.initPage;
      delete window.AGRITRACE_GEOAPIFY_KEY;
      delete window.teardownPage;
      if (previousGenerateQrCode === undefined) {
        delete window.generateQrCode;
      } else {
        window.generateQrCode = previousGenerateQrCode;
      }
      if (previousPuter === undefined) {
        delete window.puter;
      } else {
        window.puter = previousPuter;
      }
      if (previousGetPuterClient === undefined) {
        delete window.getPuterClient;
      } else {
        window.getPuterClient = previousGetPuterClient;
      }
      document.title = previousTitle;
      document.body.className = previousBodyClass;
      if (previousApiBaseUrl === undefined) {
        delete window.AGRITRACE_API_BASE_URL;
      } else {
        window.AGRITRACE_API_BASE_URL = previousApiBaseUrl;
      }
    };
  }, [page]);

  return <div dangerouslySetInnerHTML={{ __html: templates[page].body }} />;
}
