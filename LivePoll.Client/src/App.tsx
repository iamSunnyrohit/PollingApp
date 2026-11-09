import React, { useState, useEffect } from 'react';
import * as signalR from '@microsoft/signalr';
import { QRCodeSVG } from 'qrcode.react';
import type { PollResponse, VoteRecord } from './types/poll';
import { 
  createPoll, getPoll, openPoll, closePoll, castVote, getPollVotes,
  loginUser, registerUser, verifyEmail, forgotPassword, resetPassword 
} from './services/api';
import './App.css';


const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5255';

export default function App() {
  const [userProfile, setUserProfile] = useState<{ token: string; username: string; role: string } | null>(() => {
    const saved = localStorage.getItem('live_poll_auth');
    return saved ? JSON.parse(saved) : null;
  });

  const [view, setView] = useState<'login' | 'register' | 'verify' | 'forgot' | 'reset' | 'dashboard' | 'create' | 'poll' | 'terminated'>('login');
  
  // Auth Form State
  const [usernameInput, setUsernameInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [roleInput, setRoleInput] = useState('Student');
  const [tokenInput, setTokenInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');

  const [voterId] = useState(() => {
    let id = localStorage.getItem('live_poll_voter_id');
    if (!id) {
      id = 'voter_' + Math.random().toString(36).substring(2, 9);
      localStorage.setItem('live_poll_voter_id', id);
    }
    return id;
  });

  const [pollCodeInput, setPollCodeInput] = useState('');
  const [poll, setPoll] = useState<PollResponse | null>(null);
  const [voteAudit, setVoteAudit] = useState<VoteRecord[]>([]);

  // Create Poll State
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [isAnonymous, setIsAnonymous] = useState(false);
  
  const [hasVoted, setHasVoted] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError('');
      const res = await loginUser({ username: usernameInput, password: passwordInput });
      const profile = { token: res.token, username: res.username, role: res.role };
      localStorage.setItem('live_poll_auth', JSON.stringify(profile));
      setUserProfile(profile);
      setView('dashboard');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError('');
      const res = await registerUser({ username: usernameInput, email: emailInput, password: passwordInput, role: roleInput });
      setSuccessMsg(res.message || 'Registration successful. Please verify your email.');
      if (res.verificationToken) {
        setTokenInput(res.verificationToken); // Autofill for convenience in dev
      }
      setView('verify');
    } catch (err: any) {
      setError(err.message || 'Registration failed');
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError('');
      const res = await verifyEmail(emailInput, tokenInput);
      setSuccessMsg(res.message || 'Email verified successfully!');
      setView('login');
    } catch (err: any) {
      setError(err.message || 'Verification failed');
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError('');
      const res = await forgotPassword(emailInput);
      setSuccessMsg(res.message || 'Reset token generated.');
      if (res.resetToken) {
        setTokenInput(res.resetToken); // Autofill for convenience in dev
      }
      setView('reset');
    } catch (err: any) {
      setError(err.message || 'Failed to send reset request');
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError('');
      const res = await resetPassword({ email: emailInput, token: tokenInput, newPassword: newPasswordInput });
      setSuccessMsg(res.message || 'Password reset successfully!');
      setView('login');
    } catch (err: any) {
      setError(err.message || 'Password reset failed');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('live_poll_auth');
    setUserProfile(null);
    setView('login');
    setPoll(null);
  };

  useEffect(() => {
    if (!poll) return;

    const connection = new signalR.HubConnectionBuilder()
      .withUrl(`${API_BASE}/hubs/polls`)
      .withAutomaticReconnect()
      .build();

    connection.start()
      .then(() => {
        connection.invoke('JoinPollGroup', poll.code);
      })
      .catch(err => console.error('SignalR Connection Error: ', err));

    connection.on('ReceivePollUpdate', (updatedPoll: PollResponse) => {
      setPoll(updatedPoll);
      if (userProfile?.role.toLowerCase() === 'host' || userProfile?.role.toLowerCase() === 'admin') {
        fetchVoteAudit(updatedPoll.code);
      }
    });

    return () => {
      connection.invoke('LeavePollGroup', poll.code).catch(() => {});
      connection.stop();
    };
  }, [poll?.code, userProfile?.role]);

  const fetchVoteAudit = async (code: string) => {
    try {
      const audit = await getPollVotes(code);
      setVoteAudit(audit);
    } catch (err) {
      console.error('Failed to load vote audit trail', err);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError('');
      const filteredOptions = options.filter(o => o.trim() !== '');
      const newPoll = await createPoll(question, filteredOptions, isAnonymous);
      setPoll(newPoll);
      setView('poll');
      if (userProfile?.role.toLowerCase() === 'host') {
        fetchVoteAudit(newPoll.code);
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pollCodeInput.trim()) return;
    try {
      setError('');
      const fetched = await getPoll(pollCodeInput.trim().toUpperCase());
      setPoll(fetched);
      setView('poll');
      if (userProfile?.role.toLowerCase() === 'host') {
        fetchVoteAudit(fetched.code);
      }
    } catch (err: any) {
      setError('Poll not found. Check the code.');
    }
  };

  const handleVote = async (optionId: string) => {
    if (!poll || !userProfile) return;
    try {
      setError('');
      await castVote(poll.code, optionId, voterId, userProfile.username);
      setHasVoted(true);
      setSuccessMsg('Vote recorded successfully!');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleToggleStatus = async (newStatus: 'open' | 'close') => {
    if (!poll) return;
    try {
      setError('');
      if (newStatus === 'open') await openPoll(poll.code);
      else await closePoll(poll.code);
      const updated = await getPoll(poll.code);
      setPoll(updated);
    } catch (err: any) {
      setError(err.message);
    }
  };

  // --- AUTH SCREENS ---
  if (!userProfile) {
    return (
      <div className="container" style={{ maxWidth: '450px', marginTop: '60px' }}>
        <div className="card">
          <h1 style={{ color: 'var(--text-cream)', textAlign: 'center', marginBottom: '20px' }}>🗳️ LivePoll Portal</h1>

          {error && <div style={{ background: 'rgba(198,96,31,0.2)', color: 'var(--accent-terracotta)', border: '1px solid var(--accent-terracotta)', padding: '10px', borderRadius: '6px', marginBottom: '15px' }}>{error}</div>}
          {successMsg && <div style={{ background: 'rgba(127,179,184,0.2)', color: 'var(--accent-teal-light)', border: '1px solid var(--accent-teal-light)', padding: '10px', borderRadius: '6px', marginBottom: '15px' }}>{successMsg}</div>}

          {view === 'login' && (
            <form onSubmit={handleLogin}>
              <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', marginBottom: '5px' }}>Username:</label>
                <input type="text" value={usernameInput} onChange={e => setUsernameInput(e.target.value)} required className="input-text" />
              </div>
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '5px' }}>Password:</label>
                <input type="password" value={passwordInput} onChange={e => setPasswordInput(e.target.value)} required className="input-text" />
              </div>
              <button type="submit" className="btn-primary" style={{ width: '100%', marginBottom: '10px' }}>Sign In</button>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                <button type="button" onClick={() => { setView('register'); setError(''); setSuccessMsg(''); }} style={{ background: 'none', border: 'none', color: 'var(--accent-teal-light)', cursor: 'pointer' }}>Create Account</button>
                <button type="button" onClick={() => { setView('forgot'); setError(''); setSuccessMsg(''); }} style={{ background: 'none', border: 'none', color: 'var(--accent-teal-light)', cursor: 'pointer' }}>Forgot Password?</button>
              </div>
            </form>
          )}

          {view === 'register' && (
            <form onSubmit={handleRegister}>
              <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', marginBottom: '5px' }}>Username:</label>
                <input type="text" value={usernameInput} onChange={e => setUsernameInput(e.target.value)} required className="input-text" />
              </div>
              <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', marginBottom: '5px' }}>Email Address:</label>
                <input type="email" value={emailInput} onChange={e => setEmailInput(e.target.value)} required className="input-text" />
              </div>
              <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', marginBottom: '5px' }}>Password:</label>
                <input type="password" value={passwordInput} onChange={e => setPasswordInput(e.target.value)} required className="input-text" />
              </div>
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '5px' }}>Role:</label>
                <select value={roleInput} onChange={e => setRoleInput(e.target.value)} className="input-text">
                  <option value="Student">Student / Participant</option>
                  <option value="Host">Host / Instructor</option>
                  <option value="Admin">Admin</option>
                </select>
              </div>
              <button type="submit" className="btn-primary" style={{ width: '100%', marginBottom: '10px' }}>Register</button>
              <button type="button" onClick={() => { setView('login'); setError(''); setSuccessMsg(''); }} style={{ background: 'none', border: 'none', color: 'var(--accent-teal-light)', cursor: 'pointer', width: '100%' }}>Back to Sign In</button>
            </form>
          )}

          {view === 'verify' && (
            <form onSubmit={handleVerify}>
              <p style={{ fontSize: '13px', color: '#7FB3B8', marginBottom: '15px' }}>Enter your email and the verification token provided upon registration.</p>
              <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', marginBottom: '5px' }}>Email:</label>
                <input type="email" value={emailInput} onChange={e => setEmailInput(e.target.value)} required className="input-text" />
              </div>
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '5px' }}>Verification Token:</label>
                <input type="text" value={tokenInput} onChange={e => setTokenInput(e.target.value)} required className="input-text" />
              </div>
              <button type="submit" className="btn-primary" style={{ width: '100%', marginBottom: '10px' }}>Verify Email</button>
              <button type="button" onClick={() => { setView('login'); setError(''); setSuccessMsg(''); }} style={{ background: 'none', border: 'none', color: 'var(--accent-teal-light)', cursor: 'pointer', width: '100%' }}>Back to Sign In</button>
            </form>
          )}

          {view === 'forgot' && (
            <form onSubmit={handleForgot}>
              <p style={{ fontSize: '13px', color: '#7FB3B8', marginBottom: '15px' }}>Enter your account email to receive a password reset token.</p>
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '5px' }}>Email Address:</label>
                <input type="email" value={emailInput} onChange={e => setEmailInput(e.target.value)} required className="input-text" />
              </div>
              <button type="submit" className="btn-primary" style={{ width: '100%', marginBottom: '10px' }}>Send Reset Token</button>
              <button type="button" onClick={() => { setView('login'); setError(''); setSuccessMsg(''); }} style={{ background: 'none', border: 'none', color: 'var(--accent-teal-light)', cursor: 'pointer', width: '100%' }}>Back to Sign In</button>
            </form>
          )}

          {view === 'reset' && (
            <form onSubmit={handleReset}>
              <p style={{ fontSize: '13px', color: '#7FB3B8', marginBottom: '15px' }}>Provide your reset token and enter a new password.</p>
              <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', marginBottom: '5px' }}>Email:</label>
                <input type="email" value={emailInput} onChange={e => setEmailInput(e.target.value)} required className="input-text" />
              </div>
              <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', marginBottom: '5px' }}>Reset Token:</label>
                <input type="text" value={tokenInput} onChange={e => setTokenInput(e.target.value)} required className="input-text" />
              </div>
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '5px' }}>New Password:</label>
                <input type="password" value={newPasswordInput} onChange={e => setNewPasswordInput(e.target.value)} required className="input-text" />
              </div>
              <button type="submit" className="btn-primary" style={{ width: '100%', marginBottom: '10px' }}>Update Password</button>
              <button type="button" onClick={() => { setView('login'); setError(''); setSuccessMsg(''); }} style={{ background: 'none', border: 'none', color: 'var(--accent-teal-light)', cursor: 'pointer', width: '100%' }}>Back to Sign In</button>
            </form>
          )}
        </div>
      </div>
    );
  }

  // --- MAIN APP DASHBOARD & POLL VIEWS ---
  return (
    <div className="container">
      <header className="app-header">
        <div className="brand-title">
          <span>LivePoll</span>
          <span className="badge-connected">● Connected to SignalR Hub</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <span>👤 <strong>{userProfile.username}</strong> ({userProfile.role})</span>
          <button onClick={handleLogout} className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }}>Sign Out</button>
        </div>
      </header>

      {error && <div style={{ background: 'rgba(198,96,31,0.2)', color: 'var(--accent-terracotta)', border: '1px solid var(--accent-terracotta)', padding: '10px', borderRadius: '6px', marginBottom: '15px' }}>{error}</div>}
      {successMsg && <div style={{ background: 'rgba(127,179,184,0.2)', color: 'var(--accent-teal-light)', border: '1px solid var(--accent-teal-light)', padding: '10px', borderRadius: '6px', marginBottom: '15px' }}>{successMsg}</div>}

      {view === 'dashboard' && (
        <div>
          <div className="dashboard-grid">
            <div className="card">
              <h3>Join Live Poll</h3>
              <p style={{ fontSize: '14px', color: '#a0a0a0' }}>Enter 6-character room passkey to participate in live tallying.</p>
              <form onSubmit={handleJoin} style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
                <input
                  type="text"
                  placeholder="e.g. QM8FJW"
                  value={pollCodeInput}
                  onChange={e => setPollCodeInput(e.target.value.toUpperCase())}
                  maxLength={6}
                  className="input-text"
                  style={{ textTransform: 'uppercase', letterSpacing: '2px', fontWeight: 'bold' }}
                />
                <button type="submit" className="btn-secondary">Join</button>
              </form>
            </div>

            {userProfile.role.toLowerCase() === 'host' || userProfile.role.toLowerCase() === 'admin' ? (
              <div className="card" style={{ background: 'linear-gradient(135deg, #0f3d3e 0%, #1a4a4b 100%)' }}>
                <h3>Host Management Hub</h3>
                <p style={{ fontSize: '14px', color: '#a0a0a0' }}>Deploy real-time interactive questions & survey state engines.</p>
                <button onClick={() => setView('create')} className="btn-primary" style={{ marginTop: '15px', width: '100%' }}>
                  + Create New Live Poll Session
                </button>
              </div>
            ) : (
              <div className="card">
                <h3>Participant Status</h3>
                <p style={{ fontSize: '14px', color: '#7FB3B8' }}>Ready to receive live questions and broadcast secure ballots instantly.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {view === 'create' && (userProfile.role.toLowerCase() === 'host' || userProfile.role.toLowerCase() === 'admin') && (
        <div className="card">
          <h2>Configure Interactive Live Poll</h2>
          <form onSubmit={handleCreate}>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px' }}>Poll Question / Prompt:</label>
              <input
                type="text"
                value={question}
                onChange={e => setQuestion(e.target.value)}
                placeholder="e.g. Which architectural pattern best fits our streaming layer?"
                required
                className="input-text"
              />
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={isAnonymous}
                  onChange={e => setIsAnonymous(e.target.checked)}
                  style={{ width: '18px', height: '18px', accentColor: 'var(--accent-terracotta)' }}
                />
                <span>Enable Anonymous Polling (Mask voter names as Anonymous Participant in host audit trail)</span>
              </label>
            </div>

            <h3>Poll Options (2 to 10)</h3>
            {options.map((opt, idx) => (
              <div key={idx} style={{ marginBottom: '12px', display: 'flex', gap: '10px' }}>
                <input
                  type="text"
                  value={opt}
                  onChange={e => {
                    const newOpts = [...options];
                    newOpts[idx] = e.target.value;
                    setOptions(newOpts);
                  }}
                  placeholder={`Option ${idx + 1}`}
                  required={idx < 2}
                  className="input-text"
                />
                {options.length > 2 && (
                  <button type="button" onClick={() => setOptions(options.filter((_, i) => i !== idx))} className="btn-danger">Remove</button>
                )}
              </div>
            ))}
            {options.length < 10 && (
              <button type="button" onClick={() => setOptions([...options, ''])} className="btn-secondary" style={{ marginBottom: '20px' }}>+ Add Option</button>
            )}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="submit" className="btn-primary">Create Poll & Generate 6-Char PIN</button>
              <button type="button" onClick={() => setView('dashboard')} className="btn-secondary">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {view === 'poll' && poll && (
        <div>
          <button onClick={() => setView('dashboard')} className="btn-secondary" style={{ marginBottom: '20px' }}>← Back to Dashboard</button>
          
          <div className="card" style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '20px' }}>
            <div style={{ flex: '1 1 300px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2>{poll.question}</h2>
                <span className={`status-badge status-${poll.status.toLowerCase()}`}>{poll.status}</span>
              </div>
              <p style={{ color: '#7FB3B8', fontFamily: 'monospace', fontSize: '16px' }}>ROOM CODE: <strong>{poll.code}</strong></p>

              {(userProfile.role.toLowerCase() === 'host' || userProfile.role.toLowerCase() === 'admin') && (
                <div style={{ marginTop: '20px', padding: '15px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  {poll.status === 'Draft' && <button onClick={() => handleToggleStatus('open')} className="btn-primary">Open Voting Session</button>}
                  {poll.status === 'Open' && <button onClick={() => handleToggleStatus('close')} className="btn-danger">Close Voting Session</button>}
                  
                  <button 
                    onClick={() => window.open(`${API_BASE}/api/polls/${poll.code}/export/csv`, '_blank')} 
                    className="btn-secondary" 
                    style={{ marginLeft: 'auto' }}
                  >
                    📥 Export CSV Results
                  </button>
                </div>
              )}
            </div>

            {/* QR Code Section */}
            <div style={{ background: '#0a0f14', padding: '15px', borderRadius: '8px', border: '1px solid var(--accent-teal-dark)', textAlign: 'center' }}>
              <p style={{ fontSize: '12px', color: '#7FB3B8', marginBottom: '8px' }}>Scan to Join</p>
              <QRCodeSVG value={`${window.location.origin}?code=${poll.code}`} size={110} bgColor="#0a0f14" fgColor="#EADCC8" />
              <p style={{ fontSize: '11px', color: '#888', marginTop: '6px' }}>PIN: {poll.code}</p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: (userProfile.role.toLowerCase() === 'host' || userProfile.role.toLowerCase() === 'admin') ? '2fr 1fr' : '1fr', gap: '20px' }}>
            <div className="card">
              <h3>Live Tally & Results</h3>
              {poll.options.map(opt => {
                const totalVotes = poll.options.reduce((sum, o) => sum + o.voteCount, 0);
                const percentage = totalVotes > 0 ? Math.round((opt.voteCount / totalVotes) * 100) : 0;

                return (
                  <div key={opt.id} style={{ marginBottom: '20px', padding: '15px', background: 'var(--bg-main)', borderRadius: '6px', border: '1px solid var(--accent-teal-dark)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span style={{ fontWeight: 'bold' }}>{opt.text}</span>
                      <span>{opt.voteCount} votes ({percentage}%)</span>
                    </div>
                    <div style={{ background: '#0a0f14', height: '10px', borderRadius: '5px', overflow: 'hidden', marginBottom: '10px' }}>
                      <div style={{ width: `${percentage}%`, background: 'var(--accent-teal-light)', height: '100%', transition: 'width 0.3s' }} />
                    </div>
                    {poll.status === 'Open' && userProfile.role.toLowerCase() === 'student' && !hasVoted && (
                      <button onClick={() => handleVote(opt.id)} className="btn-primary" style={{ padding: '6px 16px', fontSize: '14px' }}>Cast Ballot</button>
                    )}
                  </div>
                );
              })}
            </div>

            {(userProfile.role.toLowerCase() === 'host' || userProfile.role.toLowerCase() === 'admin') && (
              <div className="card">
                <h3>Voter Roster Audit Trail</h3>
                <p style={{ fontSize: '12px', color: '#7FB3B8', marginBottom: '15px' }}>Real-time student ballot submissions ledger.</p>
                {voteAudit.length === 0 ? (
                  <p style={{ color: '#888', fontSize: '14px' }}>No ballots recorded yet.</p>
                ) : (
                  <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
                    {voteAudit.map((record, index) => (
                      <div key={index} style={{ padding: '8px 10px', marginBottom: '8px', background: 'var(--bg-main)', borderRadius: '4px', fontSize: '13px', borderLeft: '3px solid var(--accent-terracotta)' }}>
                        <strong>{record.voterName}</strong><br/>
                        <span style={{ color: '#7FB3B8' }}>{record.optionText}</span><br/>
                        <span style={{ fontSize: '11px', color: '#888' }}>{new Date(record.votedAt).toLocaleTimeString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}