import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault(); setError(''); setBusy(true);
    try { await login(form.email, form.password); navigate('/dashboard'); }
    catch (err) { setError(err.response?.data?.message || 'Unable to log in. Check your details and try again.'); }
    finally { setBusy(false); }
  };

  return <div className="auth-shell">
    <div className="auth-brand-panel">
      <div className="brand-mark">GE</div>
      <span className="eyebrow">GRATEFUL EDUTECH</span>
      <h1>Secure, simple computer-based testing.</h1>
      <p>Manage institutions, instructors, assessments, candidates and results from one professional CBT platform.</p>
      <div className="trust-line"><ShieldCheck size={18}/> Built for organized examinations</div>
    </div>
    <div className="auth-form-panel">
      <form className="auth-card" onSubmit={submit}>
        <span className="eyebrow">INSTRUCTOR PORTAL</span>
        <h2>Welcome back</h2>
        <p className="muted">Sign in to continue to your CBT dashboard.</p>
        {error && <div className="alert error">{error}</div>}
        <label>Email address<div className="input-wrap"><Mail size={18}/><input type="email" required value={form.email} onChange={e => setForm({...form, email: e.target.value})} placeholder="you@example.com" /></div></label>
        <label>Password<div className="input-wrap"><LockKeyhole size={18}/><input type="password" required value={form.password} onChange={e => setForm({...form, password: e.target.value})} placeholder="Enter your password" /></div></label>
        <button className="primary-btn" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
        <p className="auth-footer">Don't have an account? <Link to="/register">Create an instructor account</Link></p>
      </form>
    </div>
  </div>;
}
