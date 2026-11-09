import React, { useState, useEffect } from 'react';
import * as signalR from '@microsoft/signalr';
import { QRCodeSVG } from 'qrcode.react';
import type { PollResponse, VoteRecord } from './types/poll';
import { createPoll, getPoll, openPoll, closePoll, castVote, getPollVotes } from './services/api';
import './App.css';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5255';

export default function App() {
  const [userProfile, setUserProfile] = useState<{ name: string; role: 'student' | 'host' } | null>(() => {
    const saved = localStorage.getItem('live_poll_profile');
    return saved ? JSON.parse(saved) : null;
  });
  const [nameInput, setNameInput] = useState('');
  const [roleInput, setRoleInput] = useState<'student' | 'host'>('student');

  const [voterId] = useState(() => {
    let id = localStorage.getItem('live_poll_voter_id');
    if (!id) {
      id = 'voter_' + Math.random().toString(36).substring(2, 9);
      localStorage.setItem('live_poll_voter_id', id);
    }
    return id;
  });

  const [view, setView] = useState<'dashboard' | 'create' | 'poll' | 'terminated'>('dashboard');
  const [pollCodeInput, setPollCodeInput] = useState('');
  const [poll, setPoll] = useState<PollResponse | null>(null);
  const [voteAudit, setVoteAudit] = useState<VoteRecord[]>([]);

  // Create Form State
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [isAnonymous, setIsAnonymous] = useState(false);
  
  const [hasVoted, setHasVoted] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameInput.trim()) return;
    const profile = { name: nameInput.trim(), role: roleInput };
    localStorage.setItem('live_poll_profile', JSON.stringify(profile));
    setUserProfile(profile);
  };

  const handleLogout = () => {
    localStorage.removeItem('live_poll_profile');
    setUserProfile(null);
    setView('dashboard');
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
      if (userProfile?.role === 'host') {
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
      if (userProfile?.role === 'host') {
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
      if (userProfile?.role === 'host') {
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
      await castVote(poll.code, optionId, voterId, userProfile.name);
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

  if (!userProfile) {
    return (
      <div className="container" style={{ maxWidth: '450px', marginTop: '80px' }}>
        <div className="card">
          <h1 style={{ color: 'var(--text-cream)', textAlign: 'center', marginBottom: '20px' }}>LivePoll Portal</h1>
          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px' }}>Your Name / ID:</label>
              <input
                type="text"
                placeholder="e.g. Prof. David Chen"
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                required
                className="input-text"
              />
            </div>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '5px' }}>Role / Permission:</label>
              <select
                value={roleInput}
                onChange={e => setRoleInput(e.target.value as 'student' | 'host')}
                className="input-text"
              >
                <option value="student">Student / Participant</option>
                <option value="host">Host / Instructor</option>
              </select>
            </div>
            <button type="submit" className="btn-primary" style={{ width: '100%' }}>Authenticate & Enter</button>
          </form>
        </div>
      </div>
    );
  }

  if (view === 'terminated') {
    return (
      <div className="container" style={{ maxWidth: '600px', textAlign: 'center', marginTop: '60px' }}>
        <div className="card">
          <h2>Session Terminated Successfully</h2>
          <p style={{ color: '#7FB3B8' }}>Your active WebSocket connection has been safely closed and local credentials cleared.</p>
          <div style={{ margin: '30px 0' }}>
            <button onClick={() => { handleLogout(); setView('dashboard'); }} className="btn-primary" style={{ marginRight: '10px' }}>Sign Back In</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <header className="app-header">
        <div className="brand-title">
          <span>LivePoll</span>
          <span className="badge-connected">● Connected to SignalR Hub</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <span>👤 <strong>{userProfile.name}</strong> ({userProfile.role})</span>
          <button onClick={() => setView('terminated')} className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }}>Sign Out</button>
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

            {userProfile.role === 'host' ? (
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

      {view === 'create' && userProfile.role === 'host' && (
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

              {userProfile.role === 'host' && (
                <div style={{ marginTop: '20px', padding: '15px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px' }}>
                  <h4 style={{ margin: '0 0 10px 0' }}>Host Actions</h4>
                  {poll.status === 'Draft' && <button onClick={() => handleToggleStatus('open')} className="btn-primary">Open Voting Session</button>}
                  {poll.status === 'Open' && <button onClick={() => handleToggleStatus('close')} className="btn-danger">Close Voting Session</button>}
                  {poll.status === 'Closed' && <span style={{ color: '#c6601f' }}>Session is closed for voting.</span>}
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

          <div style={{ display: 'grid', gridTemplateColumns: userProfile.role === 'host' ? '2fr 1fr' : '1fr', gap: '20px' }}>
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
                    {poll.status === 'Open' && userProfile.role === 'student' && !hasVoted && (
                      <button onClick={() => handleVote(opt.id)} className="btn-primary" style={{ padding: '6px 16px', fontSize: '14px' }}>Cast Ballot</button>
                    )}
                  </div>
                );
              })}
            </div>

            {userProfile.role === 'host' && (
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
            {userProfile.role === 'host' && (
              <div style={{ marginTop: '20px', padding: '15px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {poll.status === 'Draft' && <button onClick={() => handleToggleStatus('open')} className="btn-primary">Open Voting Session</button>}
                {poll.status === 'Open' && <button onClick={() => handleToggleStatus('close')} className="btn-danger">Close Voting Session</button>}
                
                <button 
                onClick={() => window.open(`${API_BASE}/api/polls/${poll.code}/export/csv`, '_blank')} 
                className="btn-secondary" 
                style={{ marginLeft: 'auto' }} >
                   📥 Export CSV Results
                   
                </button>
                
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  );
}