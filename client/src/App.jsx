import { useEffect, useRef } from 'react';
import './styles.css';

const API_BASE = '/api';

async function apiRequest(path, options = {}) {
  const token = localStorage.getItem('grateful_edutech_token');
  const isFormData = options.body instanceof FormData;
  const headers = { ...(options.headers || {}) };
  if (!isFormData) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || 'Request failed.');
  return data;
}

export default function App() {
  const frameRef = useRef(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;

    const getDocument = () => frame.contentDocument || frame.contentWindow?.document;
    const getWindow = () => frame.contentWindow;

    const toast = (message) => {
      const win = getWindow();
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
        const body = doc.getElementById('recentTestsBody');
        if (body) {
          body.innerHTML = '';
          (data.recentTests || []).forEach((test) => {
            const row = doc.createElement('tr');
            row.innerHTML = `<td>${escapeHtml(test.name)}</td><td>${test.questions ?? 0}</td><td><span class="status ${test.status === 'published' ? 'live' : 'draft'}">${test.status === 'published' ? 'Published' : 'Draft'}</span></td><td><button class="btn btn-secondary" data-test-id="${test.id}">Questions</button></td>`;
            row.querySelector('button')?.addEventListener('click', () => openReview(test.id));
            body.appendChild(row);
          });
        }
      } catch (error) {
        console.warn('Dashboard refresh failed:', error.message);
      }
    };

    const escapeHtml = (value) => String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

    let currentTestId = null;
    let currentTestSlug = null;

    const getCreateForm = () => {
      const doc = getDocument();
      const section = doc?.getElementById('create-test');
      if (!section) return null;
      const inputs = [...section.querySelectorAll('input, textarea')];
      const name = doc.getElementById('testName');
      const instructions = section.querySelector('textarea');
      const numberInputs = section.querySelectorAll('input[type="number"]');
      const toggles = section.querySelectorAll('.switch input');
      const textInputs = section.querySelectorAll('input[type="text"]');
      return {
        section,
        name,
        instructions,
        duration: numberInputs[0],
        attempts: numberInputs[1],
        release: toggles[0],
        review: toggles[1],
        autoSubmit: toggles[2],
        accessPassword: textInputs[1],
        senderName: textInputs[2],
        inputs
      };
    };

    const ensureTest = async () => {
      const form = getCreateForm();
      if (!form?.name?.value.trim()) throw new Error('Enter a test name first.');

      const payload = {
        name: form.name.value.trim(),
        instructions: form.instructions?.value?.trim() || '',
        durationMinutes: Number(form.duration?.value || 60),
        maxAttempts: Number(form.attempts?.value || 1),
        releaseResultImmediately: !!form.release?.checked,
        allowCandidateReview: !!form.review?.checked,
        autoSubmitOnTimeout: !!form.autoSubmit?.checked,
        accessPassword: form.accessPassword?.value || '',
        resultSenderName: form.senderName?.value || 'Grateful EduTech CBT'
      };

      if (currentTestId) {
        await apiRequest(`/tests/${currentTestId}`, { method: 'PUT', body: JSON.stringify(payload) });
        return { id: currentTestId, slug: currentTestSlug };
      }

      const data = await apiRequest('/tests', { method: 'POST', body: JSON.stringify(payload) });
      currentTestId = data.id;
      currentTestSlug = data.slug;
      return data;
    };

    const saveImportedQuestions = async (testId, questions) => {
      if (!questions?.length) throw new Error('No questions were extracted from the uploaded file.');
      await apiRequest(`/tests/${testId}/questions`, {
        method: 'POST',
        body: JSON.stringify({ questions })
      });
    };

    const uploadQuestions = async (testId) => {
      const doc = getDocument();
      const file = doc?.getElementById('questionFile')?.files?.[0];
      if (!file) return null;
      const formData = new FormData();
      formData.append('questionFile', file);
      return apiRequest(`/tests/${testId}/import`, { method: 'POST', body: formData });
    };

    const renderReview = (questions, testId) => {
      const doc = getDocument();
      const section = doc?.getElementById('review');
      if (!section) return;
      const card = section.querySelector('.card.card-pad');
      if (!card) return;
      card.innerHTML = '';
      (questions || []).forEach((q, index) => {
        const wrapper = doc.createElement('div');
        wrapper.className = 'question-card card';
        const correct = q.options?.find((option) => option.correct);
        wrapper.innerHTML = `<div class="q-top"><span class="q-num">Question ${index + 1}</span><span class="status ${correct ? 'live' : 'pending'}">${correct ? `Correct: ${escapeHtml(correct.key)}` : 'Answer not set'}</span></div><p style="font-weight:700;margin-bottom:12px">${escapeHtml(q.questionText)}</p><div class="options">${(q.options || []).map((option) => `<div class="option ${option.correct ? 'correct' : ''}">${escapeHtml(option.key)}. ${escapeHtml(option.text)}</div>`).join('')}</div>`;
        card.appendChild(wrapper);
      });
      const note = doc.createElement('p');
      note.className = 'help';
      note.textContent = `Extracted ${questions?.length || 0} question(s). Test ID: ${testId}.`;
      card.appendChild(note);
    };

    const openReview = async (testId) => {
      try {
        const data = await apiRequest(`/tests/${testId}`);
        currentTestId = data.test.id;
        currentTestSlug = data.test.slug;
        renderReview(data.questions, testId);
        if (typeof getWindow().showPage === 'function') getWindow().showPage('review');
      } catch (error) {
        toast(error.message);
      }
    };

    const loadTests = async () => {
      const data = await apiRequest('/tests');
      const doc = getDocument();
      const body = doc?.querySelector('#tests tbody');
      if (!body) return;
      body.innerHTML = '';
      (data.tests || []).forEach((test) => {
        const row = doc.createElement('tr');
        row.innerHTML = `<td>${escapeHtml(test.name)}</td><td>${test.question_count ?? 0}</td><td>${test.duration_minutes} min</td><td>${test.max_attempts}</td><td><span class="status ${test.status === 'published' ? 'live' : 'draft'}">${test.status === 'published' ? 'Published' : 'Draft'}</span></td><td><button class="btn btn-secondary">Questions</button></td>`;
        row.querySelector('button')?.addEventListener('click', () => openReview(test.id));
        body.appendChild(row);
      });
    };

    const loadResults = async () => {
      const data = await apiRequest('/results');
      const doc = getDocument();
      const body = doc?.querySelector('#results tbody');
      if (!body) return;
      body.innerHTML = '';
      (data.results || []).forEach((result) => {
        const row = doc.createElement('tr');
        const released = !!result.result_released_at;
        row.innerHTML = `<td>${escapeHtml(result.candidate_name)}</td><td>${escapeHtml(result.candidate_email)}</td><td>${escapeHtml(result.candidate_phone)}</td><td>${result.attempt_number}</td><td><strong>${Number(result.percentage || 0).toFixed(2)}%</strong></td><td><span class="status ${released ? 'live' : 'pending'}">${released ? 'Released' : 'Pending'}</span></td><td>${released ? '<button class="btn btn-secondary">View</button>' : '<button class="btn btn-success">Release</button>'}</td>`;
        const button = row.querySelector('button');
        if (button && !released) button.addEventListener('click', () => releaseResult(result.id));
        body.appendChild(row);
      });
    };

    const releaseResult = async (attemptId) => {
      try {
        await apiRequest(`/results/${attemptId}/release`, { method: 'POST', body: JSON.stringify({}) });
        toast('Result released successfully.');
        await loadResults();
      } catch (error) {
        toast(error.message);
      }
    };

    const changePassword = async () => {
      const doc = getDocument();
      const inputs = [...(doc?.querySelectorAll('#settings input[type="password"]') || [])];
      const [currentPassword, newPassword, confirmPassword] = inputs;
      if (!currentPassword?.value || !newPassword?.value) return toast('Enter your current and new passwords.');
      if (newPassword.value !== confirmPassword?.value) return toast('New passwords do not match.');
      try {
        await apiRequest('/auth/change-password', {
          method: 'POST',
          body: JSON.stringify({ currentPassword: currentPassword.value, newPassword: newPassword.value })
        });
        currentPassword.value = '';
        newPassword.value = '';
        if (confirmPassword) confirmPassword.value = '';
        toast('Instructor password updated successfully.');
      } catch (error) {
        toast(error.message);
      }
    };

    const installBackendBridge = () => {
      const win = getWindow();
      const doc = getDocument();
      if (!win || !doc) return;

      win.loginDemo = async () => {
        const email = doc.getElementById('loginEmail')?.value?.trim();
        const password = doc.getElementById('loginPassword')?.value || '';
        if (!email || !password) return toast('Enter your email address and password.');
        try {
          const data = await apiRequest('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
          localStorage.setItem('grateful_edutech_token', data.token);
          localStorage.setItem('grateful_edutech_user', JSON.stringify(data.user));
          const login = doc.getElementById('login');
          const instructorApp = doc.getElementById('instructorApp');
          if (login) login.style.display = 'none';
          if (instructorApp) instructorApp.style.display = 'flex';
          if (typeof win.showPage === 'function') win.showPage('dashboard');
          await refreshDashboard();
          toast('Login successful.');
        } catch (error) { toast(error.message); }
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
          const data = await apiRequest('/auth/register', { method: 'POST', body: JSON.stringify({ fullName, phone, email, password }) });
          let message = data.message || 'Account created. Check your email to verify it.';
          if (data.developmentVerificationToken) message += ` Development verification token: ${data.developmentVerificationToken}`;
          toast(message);
          if (typeof win.showAuth === 'function') win.showAuth('loginForm');
        } catch (error) { toast(error.message); }
      };

      win.saveDraft = async () => {
        try {
          const data = await ensureTest();
          toast(data.message || 'Test saved as draft.');
          await loadTests();
          await refreshDashboard();
        } catch (error) { toast(error.message); }
      };

      win.fileSelected = async (input) => {
        const file = input.files?.[0];
        doc.getElementById('fileName').textContent = file ? '✓ Selected: ' + file.name : '';
        if (!file) return;
        try {
          const test = await ensureTest();
          const result = await uploadQuestions(test.id);
          if (result?.questions?.length) {
            await saveImportedQuestions(test.id, result.questions);
            renderReview(result.questions, test.id);
            toast(`${result.questions.length} question(s) extracted and saved.`);
          }
        } catch (error) { toast(error.message); }
      };

      win.publishTest = async () => {
        try {
          const test = await ensureTest();
          const file = doc.getElementById('questionFile')?.files?.[0];
          if (file) {
            const result = await uploadQuestions(test.id);
            if (result?.questions?.length) await saveImportedQuestions(test.id, result.questions);
          }
          const detail = await apiRequest(`/tests/${test.id}`);
          if (!detail.questions?.length) throw new Error('Upload a question file containing at least one question before publishing.');
          renderReview(detail.questions, test.id);
          const published = await apiRequest(`/tests/${test.id}/publish`, { method: 'POST', body: JSON.stringify({}) });
          await loadTests();
          await refreshDashboard();
          if (typeof win.showPage === 'function') win.showPage('review');
          toast(published.message || 'Test published successfully.');
          setTimeout(() => alert(`Test Link\n\n${published.link}\n\nCopy this link and share it with candidates.`), 250);
        } catch (error) { toast(error.message); }
      };

      win.releaseResult = () => {
        const button = doc.querySelector('#results tbody .btn-success');
        const row = button?.closest('tr');
        const candidate = row?.children?.[0]?.textContent || '';
        toast(candidate ? `Select the result row for ${candidate} and use the refreshed results list.` : 'Refresh results to release a candidate result.');
        loadResults();
      };
      win.changePassword = changePassword;

      const originalShowPage = win.showPage;
      win.showPage = async (id) => {
        if (typeof originalShowPage === 'function') originalShowPage(id);
        try {
          if (id === 'dashboard') await refreshDashboard();
          if (id === 'tests') await loadTests();
          if (id === 'results') await loadResults();
        } catch (error) { console.warn(`Unable to load ${id}:`, error.message); }
      };

      const token = localStorage.getItem('grateful_edutech_token');
      if (token) {
        apiRequest('/auth/me').then(async () => {
          const login = doc.getElementById('login');
          const instructorApp = doc.getElementById('instructorApp');
          if (login) login.style.display = 'none';
          if (instructorApp) instructorApp.style.display = 'flex';
          if (typeof win.showPage === 'function') await win.showPage('dashboard');
        }).catch(() => {
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
      <iframe ref={frameRef} title="Grateful EduTech CBT Platform" src="/legacy.html" className="legacy-frame" />
    </main>
  );
}
