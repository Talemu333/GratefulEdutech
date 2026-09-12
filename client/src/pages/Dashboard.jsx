import { useEffect, useState } from 'react';
import { BarChart3, ClipboardList, LogOut, Plus, Settings, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/dashboard').then(r => setStats(r.data)).catch(e => setError(e.response?.data?.message || 'Unable to load dashboard statistics.'));
  }, []);

  const cards = [
    ['Total tests', stats?.totalTests ?? 0, ClipboardList],
    ['Active tests', stats?.activeTests ?? 0, BarChart3],
    ['Candidates', stats?.candidates ?? 0, Users],
    ['Completed exams', stats?.completedTests ?? 0, ClipboardList]
  ];

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="sidebar-brand"><div className="brand-mark small">GE</div><div><strong>Grateful EduTech</strong><small>CBT Platform</small></div></div>
      <nav>
        <a className="nav-item active"><BarChart3 size={18}/> Dashboard</a>
        <a className="nav-item"><ClipboardList size={18}/> Tests</a>
        <a className="nav-item"><Users size={18}/> Candidates</a>
        <a className="nav-item"><BarChart3 size={18}/> Results</a>
        <a className="nav-item"><Settings size={18}/> Settings</a>
      </nav>
      <button className="logout-btn" onClick={logout}><LogOut size={18}/> Sign out</button>
    </aside>
    <main className="main-content">
      <header className="topbar"><div><span className="eyebrow">INSTRUCTOR DASHBOARD</span><h1>Good to see you, {user?.name?.split(' ')[0] || 'Instructor'}.</h1></div><div className="profile"><div className="avatar">{(user?.name || 'I').charAt(0).toUpperCase()}</div><div><strong>{user?.name}</strong><small>{user?.organizationName || 'Organization'}</small></div></div></header>
      {error && <div className="alert error">{error}</div>}
      <section className="welcome-card"><div><span className="eyebrow">YOUR CBT WORKSPACE</span><h2>Build and manage professional examinations.</h2><p>Create tests, import questions, publish assessments and monitor candidate performance from one place.</p></div><button className="primary-btn compact"><Plus size={17}/> Create test</button></section>
      <section className="stats-grid">{cards.map(([label,value,Icon]) => <div className="stat-card" key={label}><div className="stat-icon"><Icon size={20}/></div><span>{label}</span><strong>{value}</strong></div>)}</section>
      <section className="content-card"><div className="section-heading"><div><h3>Recent activity</h3><p className="muted">Your latest CBT workspace activity will appear here.</p></div></div><div className="empty-state"><ClipboardList size={34}/><h3>No recent activity</h3><p>Create your first test to begin.</p></div></section>
    </main>
  </div>;
}
