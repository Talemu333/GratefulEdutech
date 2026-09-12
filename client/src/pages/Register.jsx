import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../services/api';

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ fullName: '', phone: '', email: '', organizationName: '', password: '', confirmPassword: '' });
  const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const update = e => setForm({ ...form, [e.target.name]: e.target.value });
  const submit = async e => {
    e.preventDefault(); setError(''); setMessage('');
    if (form.password !== form.confirmPassword) return setError('Passwords do not match.');
    setBusy(true);
    try {
      const { data } = await api.post('/auth/register', form);
      setMessage(data.developmentVerificationToken ? `${data.message} Development verification token: ${data.developmentVerificationToken}` : data.message);
      setTimeout(() => navigate('/login'), 1800);
    } catch (err) { setError(err.response?.data?.message || 'Registration failed.'); }
    finally { setBusy(false); }
  };
  return <div className="auth-shell single-panel"><form className="auth-card register-card" onSubmit={submit}>
    <span className="eyebrow">GRATEFUL EDUTECH</span><h2>Create instructor account</h2><p className="muted">Set up your organization and start managing CBT examinations.</p>
    {error && <div className="alert error">{error}</div>}{message && <div className="alert success">{message}</div>}
    <div className="form-grid">
      <label>Full name<input name="fullName" required value={form.fullName} onChange={update} placeholder="Full name" /></label>
      <label>Phone number<input name="phone" required value={form.phone} onChange={update} placeholder="08012345678" maxLength="11" /></label>
      <label>Email address<input type="email" name="email" required value={form.email} onChange={update} placeholder="you@example.com" /></label>
      <label>Organization name<input name="organizationName" value={form.organizationName} onChange={update} placeholder="School or institution" /></label>
      <label>Password<input type="password" name="password" required value={form.password} onChange={update} placeholder="At least 8 characters" /></label>
      <label>Confirm password<input type="password" name="confirmPassword" required value={form.confirmPassword} onChange={update} placeholder="Repeat password" /></label>
    </div>
    <button className="primary-btn" disabled={busy}>{busy ? 'Creating account...' : 'Create account'}</button>
    <p className="auth-footer">Already registered? <Link to="/login">Sign in</Link></p>
  </form></div>;
}
