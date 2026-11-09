const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5255';

export async function createPoll(question: string, options: string[]) {
  const res = await fetch(`${API_BASE}/api/polls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, options })
  });
  if (!res.ok) throw new Error('Failed to create poll');
  return res.json();
}

export async function getPoll(code: string) {
  const res = await fetch(`${API_BASE}/api/polls/${code}`);
  if (!res.ok) throw new Error('Poll not found');
  return res.json();
}

export async function openPoll(code: string) {
  const res = await fetch(`${API_BASE}/api/polls/${code}/open`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to open poll');
}

export async function closePoll(code: string) {
  const res = await fetch(`${API_BASE}/api/polls/${code}/close`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to close poll');
}

export async function castVote(code: string, optionId: string, voterId: string, voterName: string) {
  const res = await fetch(`${API_BASE}/api/polls/${code}/votes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ optionId, voterId, voterName })
  });
  if (res.status === 409) {
    throw new Error('You have already voted in this poll.');
  }
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to cast vote');
  }
}

export async function getPollVotes(code: string) {
  const res = await fetch(`${API_BASE}/api/polls/${code}/votes`);
  if (!res.ok) throw new Error('Failed to fetch vote audit trail');
  return res.json();
}