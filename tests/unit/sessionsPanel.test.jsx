// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteSession: vi.fn(),
  fetchSessions: vi.fn(),
  renameSession: vi.fn(),
}));

vi.mock('../../frontend/src/context/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true, token: null }),
}));

vi.mock('../../frontend/src/context/AppContext', () => ({
  useApp: () => ({
    sessions: [{
      session_id: 'session-delete-me',
      title: '待删除会话',
      current_state: 'DONE',
      workspace_type: 'image_design',
      message_count: 2,
      image_count: 1,
    }],
    deleteSession: mocks.deleteSession,
    fetchSessions: mocks.fetchSessions,
    renameSession: mocks.renameSession,
  }),
}));

vi.mock('motion/react', () => ({
  motion: { div: ({ children, ...props }) => <div {...props}>{children}</div> },
  useReducedMotion: () => true,
}));

import SessionsPanel from '../../frontend/src/components/SessionsPanel';

describe('SessionsPanel deletion', () => {
  beforeEach(() => {
    mocks.deleteSession.mockReset().mockResolvedValue(true);
    mocks.fetchSessions.mockReset().mockResolvedValue(undefined);
    mocks.renameSession.mockReset().mockResolvedValue(undefined);
  });

  it('uses the cookie-authenticated delete action even when the legacy token is null', async () => {
    render(<SessionsPanel onOpenSession={vi.fn()} onCreateAndOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '删除会话：待删除会话' }));
    expect(mocks.deleteSession).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '确认删除这个会话？' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => expect(mocks.deleteSession).toHaveBeenCalledWith('session-delete-me'));
  });
});
