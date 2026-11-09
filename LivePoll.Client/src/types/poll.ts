export interface OptionResponse {
  id: string;
  text: string;
  position: number;
  voteCount: number;
}

export interface PollResponse {
  id: string;
  code: string;
  question: string;
  status: 'Draft' | 'Open' | 'Closed';
  ownerId: string;
  createdAt: string;
  options: OptionResponse[];
}

export interface VoteRecord {
  voterName: string;
  optionText: string;
  votedAt: string;
}

export interface PollSummaryItem {
  id: string;
  title: string;
  module: string;
  code: string;
  status: 'OPEN' | 'CLOSED' | 'DRAFT';
  joinedCount: number;
  totalAudience: number;
  responseRate: number;
}