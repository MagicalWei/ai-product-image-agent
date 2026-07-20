// src/context/AppContext.jsx
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { fetchJsonWithRetry } from '../lib/reliableFetch';
import {
  loadConversationCache,
  mergeConversationMessages,
  removeConversationCache,
  saveConversationCache,
  toDurableConversationHistory,
} from '../lib/conversationCache';

const AppContext = createContext(null);

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};

export const AppProvider = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const auth = useAuth();
  const isAuthenticated = auth?.isAuthenticated || false;
  const isAuthLoading = auth?.isAuthLoading || false;

  const getViewFromPath = useCallback((pathname) => {
    // In HashRouter, pathname is the hash path (e.g. /history, /workspace)
    // Strip leading slash, default to 'portal'
    const cleanPath = (pathname || '/').replace(/^\/+/, '');
    return cleanPath || 'portal';
  }, []);

  // ---- Navigation & Layout ----
  const [view, setViewInternal] = useState(() => getViewFromPath(location.pathname));

  useEffect(() => {
    const currentView = getViewFromPath(location.pathname);
    if (currentView !== view) {
      setViewInternal(currentView);
    }
  }, [location.pathname, view, getViewFromPath]);

  const setView = useCallback((newView) => {
    setViewInternal(newView);
    const targetPath = newView === 'portal' ? '/' : `/${newView}`;
    navigate(targetPath);
  }, [navigate]);

  const [theme, setTheme] = useState(
    () => localStorage.getItem('design_studio_theme') || 'light'
  );

  // Theme side-effect: apply data-theme attribute and persist
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('design_studio_theme', theme);
    } catch (err) {
      console.warn('Failed to save design_studio_theme to localStorage:', err);
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  // ---- Product Configuration ----
  const [productInfo, setProductInfo] = useState({
    name: '',
    sellingPoints: '',
    styleId: '',
  });

  // ---- Versions History ----
  const [versions, setVersions] = useState([]);
  const [currentVersionIndex, setCurrentVersionIndex] = useState(0);
  const currentVersion =
    versions[currentVersionIndex] !== undefined ? versions[currentVersionIndex] : undefined;

  // ---- Ad Text ----
  const [adText, setAdText] = useState({ title: '', desc: '' });

  // ---- Uploaded Assets ----
  const [uploadedAssets, setUploadedAssets] = useState(() => {
    const saved = localStorage.getItem('user_uploaded_assets');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        // ignore parse errors
      }
    }
    return [];
  });

  // Persist uploaded assets to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('user_uploaded_assets', JSON.stringify(uploadedAssets));
    } catch (err) {
      console.warn('Failed to save user_uploaded_assets to localStorage (quota exceeded?):', err);
    }
  }, [uploadedAssets]);

  // ---- Toast Notifications ----
  const [errorToast, setErrorToast] = useState(null);
  const toastTimerRef = useRef(null);

  const showError = useCallback((message) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setErrorToast({ message, type: 'error' });
    toastTimerRef.current = setTimeout(() => {
      setErrorToast(null);
      toastTimerRef.current = null;
    }, 5000);
  }, []);

  const showSuccess = useCallback((message) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setErrorToast({ message, type: 'success' });
    toastTimerRef.current = setTimeout(() => {
      setErrorToast(null);
      toastTimerRef.current = null;
    }, 5000);
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setErrorToast(null);
    toastTimerRef.current = null;
  }, []);

  // ---- Chat State ----
  const [chatMessages, setChatMessages] = useState([]);
  const [isTyping, setIsTyping] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // ---- Chat Sessions State ----
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(
    () => localStorage.getItem('current_session_id') || ''
  );
  const [currentCanvasState, setCurrentCanvasState] = useState(null);

  const fetchSessions = useCallback(async (authToken) => {
    // authToken parameter kept for backwards compatibility — no longer needed
    if (!isAuthenticated && !authToken) return;
    try {
      const response = await fetch('/api/agent/sessions', {
        credentials: 'include'
      });
      const data = await response.json();
      if (response.ok && data.success) {
        const loadedSessions = data.sessions || [];
        setSessions(loadedSessions);
        setCurrentSessionId(previousId => {
          const nextId = loadedSessions.some(session => session.session_id === previousId)
            ? previousId
            : (loadedSessions[0]?.session_id || '');
          if (nextId) localStorage.setItem('current_session_id', nextId);
          else localStorage.removeItem('current_session_id');
          return nextId;
        });
      }
    } catch (e) {
      console.warn('Failed to fetch chat sessions:', e);
    }
  }, [isAuthenticated]);

  const selectSession = useCallback(async (sessionId, authToken) => {
    // authToken parameter kept for backwards compatibility — session cookie handles auth
    if (!sessionId || (!isAuthenticated && !authToken)) return;
    try {
      const response = await fetch(`/api/agent/sessions/${sessionId}`, {
        credentials: 'include'
      });
      const data = await response.json();
      if (response.ok && data.success && data.session) {
        const restoredCanvasState = data.session.canvas_state && typeof data.session.canvas_state === 'object'
          ? data.session.canvas_state
          : {};
        // Tag the canvas with its owner session. This prevents a previous or
        // empty local canvas from being saved into the newly selected session.
        setCurrentCanvasState({
          ...restoredCanvasState,
          elements: Array.isArray(restoredCanvasState.elements) ? restoredCanvasState.elements : [],
          camera: restoredCanvasState.camera || { x: 400, y: 300, zoom: 1 },
          _session_id: sessionId,
        });
        setCurrentSessionId(sessionId);
        localStorage.setItem('current_session_id', sessionId);
        
        const rawHistory = data.session.chat_history || [];
        const mappedMessages = rawHistory.map(msg => {
          if (msg.role === 'user') {
            return {
              id: msg.id,
              sender: 'user',
              text: msg.content,
              images: Array.isArray(msg.images) ? msg.images : [],
            };
          } else {
            return {
              id: msg.id,
              sender: 'ai',
              agent: msg.agent || (msg.role === 'status' ? 'react_agent' : 'coordinator'),
              type: msg.type,
              text: msg.content,
            };
          }
        });

        const confirmedAnalysis = data.session.product_analysis_confirmed;
        const draftAnalysis = data.session.product_analysis_draft;
        if (confirmedAnalysis && Object.keys(confirmedAnalysis).length > 0) {
          const analysisMessage = {
            id: `product-analysis-${sessionId}`,
            sender: 'ai',
            type: 'product_analysis',
            data: confirmedAnalysis,
            confirmed: true,
          };
          const position = Number(confirmedAnalysis?._timeline?.after_turn_count);
          mappedMessages.splice(Number.isFinite(position) ? Math.max(0, Math.min(position, mappedMessages.length)) : mappedMessages.length, 0, analysisMessage);
        } else if (draftAnalysis && Object.keys(draftAnalysis).length > 0) {
          const analysisMessage = {
            id: `product-analysis-${sessionId}`,
            sender: 'ai',
            type: 'product_analysis',
            data: draftAnalysis,
            confirmed: false,
          };
          const position = Number(draftAnalysis?._timeline?.after_turn_count);
          mappedMessages.splice(Number.isFinite(position) ? Math.max(0, Math.min(position, mappedMessages.length)) : mappedMessages.length, 0, analysisMessage);
        }
        
        if (mappedMessages.length === 0) {
          mappedMessages.push({
            sender: 'ai',
            agent: 'coordinator',
            text: '你好！我是您的 AI 商品图 Crew。请告诉我您的产品名称、卖点和需要的图片类型，我将为您设计和生成一系列精美的商品主图。'
          });
        }
        
        const cachedMessages = loadConversationCache(sessionId);
        const repairedMessages = mergeConversationMessages(mappedMessages, cachedMessages);
        setChatMessages(repairedMessages);
        saveConversationCache(sessionId, repairedMessages);

        // Backfill legacy browser-only status/attachment records after their
        // chronology has been repaired. This runs in the background so opening
        // a conversation is not delayed by cloud synchronization.
        const repairedHistory = toDurableConversationHistory(repairedMessages);
        const serverTimeline = rawHistory.map(turn => `${turn.role}|${turn.content || ''}`);
        const repairedTimeline = repairedHistory.map(turn => `${turn.role}|${turn.content || ''}`);
        if (cachedMessages.length > 0 && JSON.stringify(serverTimeline) !== JSON.stringify(repairedTimeline)) {
          fetch(`/api/agent/sessions/${sessionId}/conversation-history`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ chat_history: repairedHistory }),
          }).catch(error => console.warn('Failed to backfill repaired conversation history:', error));
        }
        
        const lastParams = data.session.last_params || {};
        if (lastParams.product_name) {
          setProductInfo({
            name: lastParams.product_name,
            sellingPoints: lastParams.selling_points || '',
            styleId: lastParams.style_preference || ''
          });
        }

        return data.session;
      }
      showError(data?.error || '加载会话失败');
    } catch (e) {
      showError(`加载会话失败: ${e.message}`);
    }
    return null;
  }, [isAuthenticated, setChatMessages, setProductInfo, showError]);

  const createSession = useCallback(async (title = '新设计会话', authToken, options = {}) => {
    // authToken parameter kept for backwards compatibility
    const clientSessionId = `session-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
    try {
      const { response, data } = await fetchJsonWithRetry('/api/agent/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title,
          client_session_id: clientSessionId,
          workspace_type: options.workspaceType || 'image_design',
          last_params: options.lastParams || {},
        }),
        credentials: 'include'
      }, { attempts: 4, timeoutMs: 30000 });
      if (response.ok && data.success && data.session) {
        const newSession = data.session;
        setSessions(prev => [newSession, ...prev]);
        setCurrentSessionId(newSession.session_id);
        localStorage.setItem('current_session_id', newSession.session_id);
        
        setChatMessages([{
          sender: 'ai',
          agent: 'coordinator',
          text: '你好！我是您的 AI 商品图 Crew。请告诉我您的产品名称、卖点和需要的图片类型，我将为您设计并生成一系列精美的商品主图。'
        }]);

        setCurrentCanvasState({
          _session_id: newSession.session_id,
          elements: [],
          camera: { x: 400, y: 300, zoom: 1 },
        });

        return newSession.session_id;
      }
      if (data?.code === 'AUTH_SERVICE_TEMPORARY_UNAVAILABLE') {
        showError('登录状态服务正在恢复，请再次点击生成。');
      } else if (!response.ok) {
        showError(data?.error || `创建会话失败（${response.status}）`);
      }
    } catch (e) {
      showError(`创建会话失败，请再次点击生成：${e.message}`);
    }
    return null;
  }, [setChatMessages, showError]);

  const deleteSession = useCallback(async (sessionId) => {
    if (!sessionId || !isAuthenticated) return false;
    try {
      const response = await fetch(`/api/agent/sessions/${sessionId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || `删除请求失败（${response.status}）`);
      }
      const remaining = sessions.filter(s => s.session_id !== sessionId);
      setSessions(remaining);
      removeConversationCache(sessionId);
      if (currentSessionId === sessionId) {
        if (remaining.length > 0) {
          await selectSession(remaining[0].session_id);
        } else {
          setCurrentSessionId('');
          localStorage.removeItem('current_session_id');
          setChatMessages([]);
          setCurrentCanvasState(null);
        }
      }
      showSuccess('会话已成功删除');
      return true;
    } catch (e) {
      showError(`删除会话失败: ${e.message}`);
      return false;
    }
  }, [currentSessionId, isAuthenticated, sessions, selectSession, showError, showSuccess]);

  const renameSession = useCallback(async (sessionId, title, authToken) => {
    // authToken parameter kept for backwards compatibility
    if (!sessionId || !title.trim()) return;
    try {
      const response = await fetch(`/api/agent/sessions/${sessionId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: title.trim() }),
        credentials: 'include'
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setSessions(prev => prev.map(s => s.session_id === sessionId ? { ...s, title: title.trim() } : s));
        showSuccess('会话标题已更新');
      }
    } catch (e) {
      showError(`更新会话标题失败: ${e.message}`);
    }
  }, [showError, showSuccess]);

  const saveCanvasState = useCallback(async (sessionId, canvasState, authToken) => {
    // authToken parameter kept for backwards compatibility
    if (!sessionId) return;
    try {
      await fetch(`/api/agent/sessions/${sessionId}/canvas-state`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ canvas_state: canvasState }),
        credentials: 'include'
      });
    } catch (e) {
      console.warn('Failed to save canvas state:', e);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    if (currentSessionId && chatMessages.length > 0) {
      saveConversationCache(currentSessionId, chatMessages);
    }
  }, [currentSessionId, chatMessages]);

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      setSessions([]);
      setCurrentSessionId('');
      setChatMessages([]);
      setCurrentCanvasState(null);
      localStorage.removeItem('current_session_id');
    }
  }, [isAuthLoading, isAuthenticated]);

  useEffect(() => {
    if (currentSessionId && chatMessages.length === 0) {
      selectSession(currentSessionId);
    }
  }, [currentSessionId, chatMessages.length, selectSession]);

  // ---- API Configuration ----
  const [evalModel, setEvalModel] = useState(
    () => localStorage.getItem('eval_model') || 'eval_standard'
  );
  const [genModel, setGenModel] = useState(
    () => localStorage.getItem('gen_model') || 'gen_quality'
  );

  // ---- Fidelity ----
  const [fidelity, setFidelity] = useState(85);
  const [globalFidelity, setGlobalFidelity] = useState(85);

  // ---- Auto Cutout Configuration ----
  const [autoCutout, setAutoCutout] = useState(() => {
    try {
      const saved = localStorage.getItem('design_studio_auto_cutout');
      return saved === null ? true : saved === 'true';
    } catch (e) {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('design_studio_auto_cutout', autoCutout ? 'true' : 'false');
    } catch (e) {
      console.warn('Failed to save design_studio_auto_cutout to localStorage:', e);
    }
  }, [autoCutout]);

  const value = {
    // Navigation & Layout
    view,
    setView,
    theme,
    setTheme,
    toggleTheme,
    // Product Configuration
    productInfo,
    setProductInfo,
    // Versions
    versions,
    setVersions,
    currentVersionIndex,
    setCurrentVersionIndex,
    currentVersion,
    // Ad Text
    adText,
    setAdText,
    // Uploaded Assets
    uploadedAssets,
    setUploadedAssets,
    // Toast
    errorToast,
    setErrorToast,
    showError,
    showSuccess,
    dismissToast,
    // Chat
    chatMessages,
    setChatMessages,
    isTyping,
    setIsTyping,
    isGenerating,
    setIsGenerating,
    // Chat Sessions
    sessions,
    setSessions,
    currentSessionId,
    setCurrentSessionId,
    fetchSessions,
    selectSession,
    createSession,
    deleteSession,
    renameSession,
    saveCanvasState,
    currentCanvasState,
    setCurrentCanvasState,
    // API Configuration
    evalModel,
    setEvalModel,
    genModel,
    setGenModel,
    // Fidelity
    fidelity,
    setFidelity,
    globalFidelity,
    setGlobalFidelity,
    // Auto Cutout
    autoCutout,
    setAutoCutout,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export default AppContext;
