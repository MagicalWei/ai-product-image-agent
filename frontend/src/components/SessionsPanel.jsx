// src/components/SessionsPanel.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { Search, MessageSquare, Image, Clock, Plus, Trash2, Pencil, Check, X, FileText } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';

const STATE_LABELS = {
  COLLECTING_INFO: '信息收集',
  GENERATING_IMAGES: '生成中',
  DONE: '已完成',
};

const STATE_COLORS = {
  COLLECTING_INFO: 'var(--primary)',
  GENERATING_IMAGES: '#f59e0b',
  DONE: '#10b981',
};

export default function SessionsPanel({ onOpenSession, onCreateAndOpen }) {
  const auth = useAuth();
  const app = useApp();
  const token = auth?.token;

  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [loading, setLoading] = useState(false);

  const sessions = app?.sessions || [];
  const fetchSessions = app?.fetchSessions;
  const deleteSession = app?.deleteSession;
  const renameSession = app?.renameSession;

  useEffect(() => {
    if (token && fetchSessions) {
      fetchSessions(token);
    }
  }, [token, fetchSessions]);

  const filteredSessions = searchQuery.trim()
    ? sessions.filter(s => (s.title || '').toLowerCase().includes(searchQuery.toLowerCase()))
    : sessions;

  const handleOpen = useCallback((sessionId) => {
    if (onOpenSession) {
      onOpenSession(sessionId);
    }
  }, [onOpenSession]);

  const handleDelete = useCallback(async (e, sessionId) => {
    e.stopPropagation();
    if (!token) return;
    await deleteSession(sessionId, token);
    if (fetchSessions) fetchSessions(token);
  }, [token, deleteSession, fetchSessions]);

  const handleRenameStart = useCallback((e, session) => {
    e.stopPropagation();
    setEditingId(session.session_id);
    setEditingTitle(session.title || '');
  }, []);

  const handleRenameSave = useCallback(async (e, sessionId) => {
    e.stopPropagation();
    if (!token || !editingTitle.trim()) {
      setEditingId(null);
      return;
    }
    await renameSession(sessionId, editingTitle.trim(), token);
    if (fetchSessions) fetchSessions(token);
    setEditingId(null);
  }, [token, editingTitle, renameSession, fetchSessions]);

  const handleRenameCancel = useCallback((e) => {
    e.stopPropagation();
    setEditingId(null);
  }, []);

  const handleCreate = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      if (onCreateAndOpen) {
        await onCreateAndOpen();
      }
    } finally {
      setLoading(false);
    }
  }, [token, onCreateAndOpen]);

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="sessions-panel-container animate-fade-scale" style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '20px',
      height: 'calc(100vh - 110px)',
      padding: '10px 0',
      overflowY: 'auto'
    }}>
      {/* Top bar: search + new session */}
      <div className="glass-panel" style={{
        padding: '20px 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '16px'
      }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: '400px' }}>
          <Search size={14} style={{
            position: 'absolute',
            left: '12px',
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--outline)'
          }} />
          <input
            type="text"
            className="form-input"
            placeholder="搜索设计会话..."
            style={{ fontSize: '0.8rem', padding: '8px 12px 8px 34px', width: '100%' }}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <button
          className="settings-btn save"
          onClick={handleCreate}
          disabled={loading}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            cursor: 'pointer',
            padding: '8px 18px',
            fontSize: '0.8rem',
            whiteSpace: 'nowrap'
          }}
        >
          <Plus size={14} />
          <span>{loading ? '创建中...' : '新建会话'}</span>
        </button>
      </div>

      {/* Session list */}
      <div style={{ flex: 1 }}>
        {filteredSessions.length === 0 ? (
          <div className="glass-panel" style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '300px',
            gap: '16px',
            color: 'var(--text-muted)',
            fontSize: '0.85rem'
          }}>
            <FileText size={40} style={{ opacity: 0.3 }} />
            <div style={{ textAlign: 'center' }}>
              <p style={{ margin: 0, fontWeight: 600, color: 'var(--on-surface)', fontSize: '0.95rem' }}>
                暂无设计会话
              </p>
              <p style={{ margin: '4px 0 0', fontSize: '0.8rem' }}>
                点击下方按钮开始创建
              </p>
            </div>
            <button
              className="settings-btn save"
              onClick={handleCreate}
              disabled={loading}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                padding: '10px 24px',
                fontSize: '0.85rem'
              }}
            >
              <Plus size={16} />
              <span>新建会话</span>
            </button>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: '16px'
          }}>
            {filteredSessions.map((session) => (
              <div
                key={session.session_id}
                className="glass-pane glass-pane-interactive"
                onClick={() => handleOpen(session.session_id)}
                style={{
                  padding: '20px',
                  borderRadius: '12px',
                  border: '1px solid var(--border-glass)',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  transition: 'all 0.2s ease',
                  position: 'relative'
                }}
              >
                {/* Title row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  {editingId === session.session_id ? (
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameSave(e, session.session_id);
                          if (e.key === 'Escape') handleRenameCancel(e);
                        }}
                        autoFocus
                        style={{
                          fontSize: '0.85rem',
                          padding: '4px 8px',
                          borderRadius: '6px',
                          border: '1px solid var(--primary)',
                          background: 'var(--surface)',
                          color: 'var(--on-surface)',
                          width: '100%',
                          outline: 'none'
                        }}
                      />
                      <button
                        onClick={(e) => handleRenameSave(e, session.session_id)}
                        style={{ border: 'none', background: 'transparent', color: 'var(--accent)', cursor: 'pointer', padding: '2px' }}
                      >
                        <Check size={14} />
                      </button>
                      <button
                        onClick={handleRenameCancel}
                        style={{ border: 'none', background: 'transparent', color: 'var(--error)', cursor: 'pointer', padding: '2px' }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <h3 style={{
                      fontSize: '0.9rem',
                      fontWeight: 700,
                      color: 'var(--on-surface)',
                      margin: 0,
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {session.title || '未命名会话'}
                    </h3>
                  )}

                  {/* Action buttons */}
                  {editingId !== session.session_id && (
                    <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                      <button
                        onClick={(e) => handleRenameStart(e, session)}
                        title="重命名"
                        style={{
                          border: 'none',
                          background: 'rgba(0,0,0,0.04)',
                          borderRadius: '6px',
                          padding: '4px 6px',
                          cursor: 'pointer',
                          color: 'var(--text-secondary)',
                          display: 'flex',
                          alignItems: 'center'
                        }}
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={(e) => handleDelete(e, session.session_id)}
                        title="删除"
                        style={{
                          border: 'none',
                          background: 'rgba(0,0,0,0.04)',
                          borderRadius: '6px',
                          padding: '4px 6px',
                          cursor: 'pointer',
                          color: 'var(--error)',
                          display: 'flex',
                          alignItems: 'center'
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </div>

                {/* Status badge */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: '10px',
                    background: `${STATE_COLORS[session.current_state] || 'var(--outline)'}20`,
                    color: STATE_COLORS[session.current_state] || 'var(--outline)'
                  }}>
                    {STATE_LABELS[session.current_state] || session.current_state || '未知'}
                  </span>
                </div>

                {/* Stats row */}
                <div style={{
                  display: 'flex',
                  gap: '16px',
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  borderTop: '1px solid var(--border-light)',
                  paddingTop: '10px'
                }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <MessageSquare size={12} />
                    {session.message_count ?? 0} 条消息
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Image size={12} />
                    {session.image_count ?? 0} 张图
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: 'auto' }}>
                    <Clock size={12} />
                    {formatDate(session.updated_at)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
