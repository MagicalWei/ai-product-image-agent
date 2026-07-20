// src/components/SessionsPanel.jsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Search, MessageSquare, Image, Film, Clock, Plus, Trash2, Pencil, Check, X, FileText } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { motion, useReducedMotion } from 'motion/react';

const STATE_LABELS = {
  COLLECTING_INFO: '信息收集',
  GENERATING_IMAGES: '生成中',
  DONE: '已完成',
  VIDEO_EDITING: '剪辑中',
  VIDEO_RENDERING: '生成中',
};

const STATE_COLORS = {
  COLLECTING_INFO: 'var(--primary)',
  GENERATING_IMAGES: '#f59e0b',
  DONE: '#10b981',
  VIDEO_EDITING: 'var(--primary)',
  VIDEO_RENDERING: '#f59e0b',
};

export default function SessionsPanel({ onOpenSession, onCreateAndOpen }) {
  const shouldReduceMotion = useReducedMotion();
  const auth = useAuth();
  const app = useApp();
  const isAuthenticated = Boolean(auth?.isAuthenticated);

  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [confirmingSession, setConfirmingSession] = useState(null);
  const [searchResults, setSearchResults] = useState(null);
  const [searchResultQuery, setSearchResultQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState({ query: '', message: '' });
  const searchRequestRef = useRef(0);

  const sessions = app?.sessions || [];
  const fetchSessions = app?.fetchSessions;
  const deleteSession = app?.deleteSession;
  const renameSession = app?.renameSession;

  useEffect(() => {
    if (isAuthenticated && fetchSessions) {
      fetchSessions();
    }
  }, [isAuthenticated, fetchSessions]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      searchRequestRef.current += 1;
      return undefined;
    }

    const requestId = ++searchRequestRef.current;
    const timer = window.setTimeout(async () => {
      setSearchLoading(true);
      try {
        const response = await fetch(`/api/agent/sessions?q=${encodeURIComponent(query)}`, {
          credentials: 'include',
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) throw new Error(data.error || '搜索失败');
        if (searchRequestRef.current === requestId) {
          setSearchResults(data.sessions || []);
          setSearchResultQuery(query);
          setSearchError({ query: '', message: '' });
        }
      } catch (error) {
        if (searchRequestRef.current === requestId) {
          setSearchError({ query, message: error.message || '搜索失败，请重试' });
          setSearchResultQuery(query);
        }
      } finally {
        if (searchRequestRef.current === requestId) setSearchLoading(false);
      }
    }, 260);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const activeQuery = searchQuery.trim();
  const filteredSessions = activeQuery
    ? (searchResultQuery === activeQuery ? (searchResults || []) : [])
    : sessions;
  const activeSearchError = searchError.query === activeQuery ? searchError.message : '';
  const isSearchPending = Boolean(activeQuery) && (searchLoading || searchResultQuery !== activeQuery);

  const handleOpen = useCallback((sessionId) => {
    if (onOpenSession) {
      onOpenSession(sessionId);
    }
  }, [onOpenSession]);

  const requestDelete = useCallback((e, session) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isAuthenticated || deletingId) return;
    setConfirmingSession(session);
  }, [isAuthenticated, deletingId]);

  const handleDelete = useCallback(async () => {
    const sessionId = confirmingSession?.session_id;
    if (!sessionId || !isAuthenticated || !deleteSession || deletingId) return;
    setDeletingId(sessionId);
    try {
      const deleted = await deleteSession(sessionId);
      if (deleted) {
        setSearchResults(current => Array.isArray(current)
          ? current.filter(session => session.session_id !== sessionId)
          : current);
        setConfirmingSession(null);
      }
    } finally {
      setDeletingId(null);
    }
  }, [confirmingSession, isAuthenticated, deleteSession, deletingId]);

  const handleRenameStart = useCallback((e, session) => {
    e.stopPropagation();
    setEditingId(session.session_id);
    setEditingTitle(session.title || '');
  }, []);

  const handleRenameSave = useCallback(async (e, sessionId) => {
    e.stopPropagation();
    if (!isAuthenticated || !editingTitle.trim()) {
      setEditingId(null);
      return;
    }
    await renameSession(sessionId, editingTitle.trim());
    if (fetchSessions) fetchSessions();
    setEditingId(null);
  }, [isAuthenticated, editingTitle, renameSession, fetchSessions]);

  const handleRenameCancel = useCallback((e) => {
    e.stopPropagation();
    setEditingId(null);
  }, []);

  const handleCreate = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    try {
      if (onCreateAndOpen) {
        await onCreateAndOpen();
      }
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, onCreateAndOpen]);

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
    <motion.div className="sessions-panel-container" initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: shouldReduceMotion ? 0.1 : 0.2, ease: [0.22, 1, 0.36, 1] }} style={{
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
        <div style={{ position: 'relative', flex: 1, maxWidth: '460px' }}>
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
            placeholder="搜索会话、商品名称或对话内容..."
            aria-label="搜索最近打开的会话"
            style={{ fontSize: '0.8rem', padding: '8px 36px 8px 34px', width: '100%' }}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              aria-label="清空搜索"
              onClick={() => setSearchQuery('')}
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', border: 0, background: 'transparent', color: 'var(--outline)', cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 4 }}
            >
              <X size={14} />
            </button>
          )}
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
        {activeSearchError ? (
          <div className="glass-panel" role="alert" style={{ padding: '18px 20px', color: 'var(--error)', fontSize: '0.8rem' }}>
            {activeSearchError}，请检查网络后重新输入。
          </div>
        ) : isSearchPending ? (
          <div className="glass-panel" style={{ padding: '18px 20px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            正在搜索会话、商品名称和对话内容…
          </div>
        ) : filteredSessions.length === 0 ? (
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
                {searchQuery.trim() ? '没有找到相关会话' : '暂无设计会话'}
              </p>
              <p style={{ margin: '4px 0 0', fontSize: '0.8rem' }}>
                {searchQuery.trim() ? `没有与“${searchQuery.trim()}”匹配的商品或对话` : '点击下方按钮开始创建'}
              </p>
            </div>
            {!searchQuery.trim() && <button
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
            </button>}
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
                        type="button"
                        onClick={(e) => requestDelete(e, session)}
                        title="删除"
                        aria-label={`删除会话：${session.title || '未命名会话'}`}
                        disabled={deletingId === session.session_id}
                        style={{
                          border: 'none',
                          background: 'rgba(0,0,0,0.04)',
                          borderRadius: '6px',
                          padding: '4px 6px',
                          cursor: deletingId === session.session_id ? 'wait' : 'pointer',
                          opacity: deletingId === session.session_id ? 0.55 : 1,
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

                {session.product_name && session.product_name !== session.title && (
                  <div style={{ color: 'var(--on-surface-variant)', fontSize: '0.74rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    商品：{session.product_name}
                  </div>
                )}

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
                  {session.workspace_type !== 'image_design' && <span style={{ fontSize: '0.68rem', color: 'var(--on-surface-variant)' }}>{session.workspace_type === 'viral_replication' ? '爆款结构复刻' : '智能剪辑'}</span>}
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
                  {session.workspace_type === 'video_edit' || session.workspace_type === 'viral_replication' ? <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Film size={12} />{session.video_count ?? 0} 个视频</span> : <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Image size={12} />{session.image_count ?? 0} 张图</span>}
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
      {confirmingSession && createPortal(
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deletingId) setConfirmingSession(null);
          }}
          style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            display: 'grid', placeItems: 'center', padding: 20,
            background: 'rgba(18, 20, 24, 0.42)', backdropFilter: 'blur(6px)',
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-session-title"
            aria-describedby="delete-session-description"
            style={{
              width: 'min(420px, 100%)', padding: 24,
              borderRadius: 16, border: '1px solid var(--outline-variant)',
              background: 'var(--surface-container-lowest)',
              boxShadow: '0 24px 70px rgba(0,0,0,.22)',
            }}
          >
            <div style={{ width: 38, height: 38, borderRadius: 10, display: 'grid', placeItems: 'center', color: 'var(--error)', background: 'rgba(239,68,68,.1)' }}>
              <Trash2 size={19} />
            </div>
            <h2 id="delete-session-title" style={{ margin: '16px 0 7px', fontSize: 17 }}>确认删除这个会话？</h2>
            <p id="delete-session-description" style={{ margin: 0, color: 'var(--on-surface-variant)', fontSize: 13, lineHeight: 1.65 }}>
              将删除“{confirmingSession.title || '未命名会话'}”及其对话记录。此操作执行后不能在应用内撤销。
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, marginTop: 22 }}>
              <button type="button" className="settings-btn cancel" disabled={Boolean(deletingId)} onClick={() => setConfirmingSession(null)}>取消</button>
              <button type="button" className="settings-btn save" disabled={Boolean(deletingId)} onClick={handleDelete} style={{ background: 'var(--error)', borderColor: 'var(--error)', color: '#fff' }}>
                {deletingId ? '正在删除…' : '确认删除'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </motion.div>
  );
}
