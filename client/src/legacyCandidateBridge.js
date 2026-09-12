(function () {
  // These instructor auth handlers live inside the legacy iframe as a fallback.
  // This makes the Create Account and Login buttons work even if the parent
  // React bridge has not attached yet.
  const authApi = async (path, options = {}) => {
    const response = await fetch('/api' + path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || 'Request failed.');
    return data;
  };

  const authToast = (message) => {
    if (typeof window.toast === 'function') window.toast(message);
    else alert(message);
  };

  window.registerDemo = async function () {
    const fullName = document.getElementById('regName')?.value?.trim();
    const phone = document.getElementById('regPhone')?.value?.trim();
    const email = document.getElementById('regEmail')?.value?.trim();
    const password = document.getElementById('regPassword')?.value || '';
    const confirmPassword = document.getElementById('regConfirm')?.value || '';

    if (!fullName || !phone || !email || !password || !confirmPassword) {
      return authToast('Complete all required fields.');
    }
    if (!/^\d{11}$/.test(phone)) {
      return authToast('Phone number must contain exactly 11 digits.');
    }
    if (password.length < 8) {
      return authToast('Password must be at least 8 characters.');
    }
    if (password !== confirmPassword) {
      return authToast('Passwords do not match.');
    }

    const button = document.querySelector('#registerForm button.btn-primary');
    if (button) {
      button.disabled = true;
      button.textContent = 'Creating Account...';
    }

    try {
      const data = await authApi('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ fullName, phone, email, password })
      });

      let message = data.message || 'Account created successfully.';
      if (data.developmentVerificationToken) {
        message += ` Development verification token: ${data.developmentVerificationToken}`;
      }
      authToast(message);

      if (typeof window.showAuth === 'function') {
        window.showAuth('loginForm');
      }
    } catch (error) {
      authToast(error.message);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Create Instructor Account';
      }
    }
  };

  window.loginDemo = async function () {
    const email = document.getElementById('loginEmail')?.value?.trim();
    const password = document.getElementById('loginPassword')?.value || '';
    if (!email || !password) return authToast('Enter your email address and password.');

    const button = document.querySelector('#loginForm button.btn-primary');
    if (button) {
      button.disabled = true;
      button.textContent = 'Logging in...';
    }

    try {
      const data = await authApi('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      localStorage.setItem('grateful_edutech_token', data.token);
      localStorage.setItem('grateful_edutech_user', JSON.stringify(data.user));

      const login = document.getElementById('login');
      const instructorApp = document.getElementById('instructorApp');
      if (login) login.style.display = 'none';
      if (instructorApp) instructorApp.style.display = 'flex';
      if (typeof window.showPage === 'function') window.showPage('dashboard');
      authToast('Login successful.');
    } catch (error) {
      authToast(error.message);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Login';
      }
    }
  };

  const params = new URLSearchParams(window.top && window.top.location ? window.top.location.search : window.location.search);
  const testSlug = params.get('test');
  if (!testSlug) return;

  let attemptId = null;
  let questions = [];
  let answers = {};
  let expiresAt = null;
  let timer = null;
  let candidateIndex = 0;

  const api = async (path, options = {}) => {
    const response = await fetch('/api' + path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || 'Request failed.');
    return data;
  };

  const toast = (message) => {
    if (typeof window.toast === 'function') window.toast(message);
    else alert(message);
  };

  const setCandidatePage = () => {
    const page = document.getElementById('candidateTest');
    if (!page) return;
    document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
    page.classList.add('active');
    page.style.display = 'block';
    const instructor = document.getElementById('instructorApp');
    if (instructor) instructor.style.display = 'none';
    const login = document.getElementById('login');
    if (login) login.style.display = 'none';
    const role = document.getElementById('roleLabel');
    if (role) role.textContent = 'Candidate Test';
  };

  const renderQuestion = () => {
    const item = questions[candidateIndex];
    if (!item) return;
    document.getElementById('candidateQNo').textContent = candidateIndex + 1;
    document.querySelector('#candidateTest .question-number').innerHTML =
      `QUESTION <span id="candidateQNo">${candidateIndex + 1}</span> OF ${questions.length}`;
    document.getElementById('candidateQuestion').textContent = item.questionText;
    const box = document.getElementById('candidateOptions');
    box.innerHTML = '';
    item.options.forEach((option) => {
      const label = document.createElement('label');
      label.className = 'exam-option';
      label.innerHTML = `<input type="radio" name="candidateAnswer" value="${option.id}"> <span><strong>${option.key}.</strong> ${option.text}</span>`;
      if (String(answers[item.id]) === String(option.id)) label.querySelector('input').checked = true;
      box.appendChild(label);
    });
    document.getElementById('candidatePrev').disabled = candidateIndex === 0;
    document.getElementById('candidateNext').textContent = candidateIndex === questions.length - 1 ? 'Finish' : 'Next →';
  };

  const saveAnswer = () => {
    const item = questions[candidateIndex];
    const selected = document.querySelector('input[name="candidateAnswer"]:checked');
    if (item && selected) answers[item.id] = Number(selected.value);
  };

  const tick = () => {
    if (!expiresAt) return;
    const seconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
    const el = document.getElementById('candidateTimer');
    if (el) el.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    if (seconds <= 0) {
      clearInterval(timer);
      timer = null;
      finish(true);
    }
  };

  const startTimer = () => {
    clearInterval(timer);
    tick();
    timer = setInterval(tick, 1000);
  };

  async function finish(auto = false) {
    saveAnswer();
    if (!attemptId) return;
    if (!auto && !confirm('Are you sure you want to submit this test?')) return;
    clearInterval(timer);
    timer = null;
    try {
      const result = await api(`/candidate/${attemptId}/submit`, {
        method: 'POST',
        body: JSON.stringify({
          answers: Object.entries(answers).map(([questionId, selectedOptionId]) => ({
            questionId: Number(questionId),
            selectedOptionId: Number(selectedOptionId)
          }))
        })
      });
      document.getElementById('candidateExamBox').style.display = 'none';
      document.getElementById('candidateLoginBox').style.display = 'grid';
      if (result.resultReleased) {
        alert(`Test Submitted Successfully\n\nScore: ${result.score}/${result.totalMarks} (${Number(result.percentage).toFixed(2)}%)`);
      } else {
        alert('Test Submitted Successfully\n\nYour test has been submitted. Your result will be available when the instructor releases it.');
      }
      attemptId = null;
      questions = [];
      answers = {};
      expiresAt = null;
      document.getElementById('candidateTimer').textContent = '00:00';
    } catch (error) {
      toast(error.message);
      startTimer();
    }
  }

  window.beginCandidateTest = async function () {
    const name = document.getElementById('candidateName').value.trim();
    const phone = document.getElementById('candidatePhone').value.trim();
    const email = document.getElementById('candidateEmail').value.trim();
    const password = document.getElementById('candidatePassword').value;
    if (!name || !phone || !email || !password) return toast('Please complete all candidate fields.');
    if (!/^\d{11}$/.test(phone)) return toast('Phone number must contain exactly 11 digits.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('Enter a valid email address.');

    try {
      const data = await api('/candidate/start', {
        method: 'POST',
        body: JSON.stringify({ slug: testSlug, name, email, phone, password })
      });
      attemptId = data.attemptId;
      questions = (data.questions || []).map((q) => ({
        id: q.id,
        questionText: q.questionText || q.question_text,
        options: (q.options || []).map((o) => ({
          id: o.id,
          key: o.key || o.option_key,
          text: o.text || o.option_text
        }))
      }));
      expiresAt = data.expiresAt;
      if (!attemptId || !questions.length) throw new Error('This test has no available questions.');
      const test = data.test || {};
      document.querySelector('#candidateTest .login-logo h1').textContent = test.name || 'Grateful EduTech Test';
      document.querySelector('#candidateExamBox strong').textContent = test.name || 'Grateful EduTech Test';
      document.getElementById('candidateDisplayName').textContent = `Candidate: ${name}`;
      document.getElementById('candidateLoginBox').style.display = 'none';
      document.getElementById('candidateExamBox').style.display = 'block';
      candidateIndex = 0;
      answers = {};
      renderQuestion();
      startTimer();
    } catch (error) {
      toast(error.message);
    }
  };

  window.candidatePrev = function () {
    saveAnswer();
    if (candidateIndex > 0) {
      candidateIndex--;
      renderQuestion();
    }
  };

  window.candidateNext = function () {
    saveAnswer();
    if (candidateIndex < questions.length - 1) {
      candidateIndex++;
      renderQuestion();
    } else {
      finish(false);
    }
  };

  window.finishCandidateTest = function (auto) {
    finish(!!auto);
  };

  setCandidatePage();
})();
