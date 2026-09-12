import { useEffect, useRef } from 'react';
import './styles.css';

const API_BASE = '/api';

async function apiRequest(path, options = {}) {
  const token = localStorage.getItem('grateful_edutech_token');
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Request failed.');
  return data;
}

export default function App() {
  const frameRef = useRef(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    const getDocument = () => frame.contentDocument || frame.contentWindow?.document;

    const toast = (message) => {
      const win = frame.contentWindow;
      if (typeof win?.toast === 'function') win.toast(message);
      else window.alert(message);
    };

    const refreshDashboard = async () => {
      try {
        const data = await apiRequest('/dashboard');
        const doc = getDocument();
        if (!doc) return;
        const stats = data.stats || {};
        const values = {
          statTotalTests: stats.totalTests ?? 0,
          statCandidates: stats.candidates ?? 0,
          statCompleted: stats.completedTests ?? 0,
          statPending: stats.resultsPending ?? 0
        };
        Object.entries(values).forEach(([id, value]) => {
          const el = doc.getElementById(id);
          if (el) el.textContent = value;
        });
      } catch (error) {
        console.warn('Dashboard refresh failed:', error.message);
      }
    };

    const installBackendBridge = () => {
      const win = frame.contentWindow;
      const doc = getDocument();
      if (!win || !doc) return;

      // Preserve the supplied frontend exactly; replace only demo auth with real API calls.
      win.loginDemo = async () => {
        const email = doc.getElementById('loginEmail')?.value?.trim();
        const password = doc.getElementById('loginPassword')?.value || '';
        if (!email || !password) return toast('Enter your email address and password.');
        try {
          const data = await apiRequest('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
          });
          localStorage.setItem('grateful_edutech_token', data.token);
          localStorage.setItem('grateful_edutech_user', JSON.stringify(data.user));
          const login = doc.getElementById('login');
          const instructorApp = doc.getElementById('instructorApp');
          if (login) login.style.display = 'none';
          if (instructorApp) instructorApp.style.display = 'flex';
          if (typeof win.showPage === 'function') win.showPage('dashboard');
          await refreshDashboard();
          toast('Login successful.');
        } catch (error) {
          toast(error.message);
        }
      };

      win.registerDemo = async () => {
        const fullName = doc.getElementById('regName')?.value?.trim();
        const phone = doc.getElementById('regPhone')?.value?.trim();
        const email = doc.getElementById('regEmail')?.value?.trim();
        const password = doc.getElementById('regPassword')?.value || '';
        const confirmPassword = doc.getElementById('regConfirm')?.value || '';
        if (password !== confirmPassword) return toast('Passwords do not match.');
        if (!fullName || !phone || !email || !password) return toast('Complete all required fields.');
        try {
          const data = await apiRequest('/auth/register', {
            method: 'POST',
            body: JSON.stringify({ fullName, phone, email, password })
          });
          let message = data.message || 'Account created. Check your email to verify it.';
          if (data.developmentVerificationToken) {
            message += ` Development verification token: ${data.developmentVerificationToken}`;
          }
          toast(message);
          if (typeof win.showAuth === 'function') win.showAuth('loginForm');
        } catch (error) {
          toast(error.message);
        }
      };

      const token = localStorage.getItem('grateful_edutech_token');
      if (token) {
        apiRequest('/auth/me')
          .then(async () => {
            const login = doc.getElementById('login');
            const instructorApp = doc.getElementById('instructorApp');
            if (login) login.style.display = 'none';
            if (instructorApp) instructorApp.style.display = 'flex';
            if (typeof win.showPage === 'function') win.showPage('dashboard');
            await refreshDashboard();
          })
          .catch(() => {
            localStorage.removeItem('grateful_edutech_token');
            localStorage.removeItem('grateful_edutech_user');
          });
      }
    };

    const handleLoad = () => window.setTimeout(installBackendBridge, 0);
    frame.addEventListener('load', handleLoad);
    return () => frame.removeEventListener('load', handleLoad);
  }, []);

  return (
    <main className="legacy-shell">
      <iframe
        ref={frameRef}
        title="Grateful EduTech CBT Platform"
        src="/legacy.html"
        className="legacy-frame"
      />
    </main>
  );
}
