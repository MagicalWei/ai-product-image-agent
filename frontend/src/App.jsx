// src/App.jsx
import React, { useState, useEffect, useRef, Suspense } from 'react';
import { Sparkles, Bell, HelpCircle, ArrowRight, Settings, AlertCircle, CheckCircle, Menu, Home, Grid, Layers, History, FolderOpen, Database, Sun, Moon, MessageSquare, Box, Tag, Type, Image as ImageIcon, X, Minus, ChevronDown, ChevronUp, Play, Download, Share2, Loader2, BookOpen, Video, ShoppingBag, User, Users, Wand2, Zap, Crown } from 'lucide-react';
import { Routes, Route, Navigate } from 'react-router-dom';

// Eagerly imported components (small / always needed)
import DashboardPanel from './components/DashboardPanel';
import ToolsPanel from './components/ToolsPanel';
import HistoryPanel from './components/HistoryPanel';
import FoldersPanel from './components/FoldersPanel';
import DatabaseView from './components/DatabaseView';
import SessionsPanel from './components/SessionsPanel';
import Sidebar from './components/Sidebar';
import LayersOutlinePanel from './components/LayersOutlinePanel';
import ExportModal from './components/ExportModal';

import { evaluateImageWithGemini, isValidApiKeyFormat } from './utils/geminiEvaluator';
import { removeBackground } from '@imgly/background-removal';
import { resolveAssetUrl } from './lib/utils';

// Lazy-loaded components for code splitting
const Portal = React.lazy(() => import('./components/Portal'));
const InfiniteCanvas = React.lazy(() => import('./components/InfiniteCanvas'));
const Onboarding = React.lazy(() => import('./components/Onboarding'));
const AuthModal = React.lazy(() => import('./components/AuthModal'));
const PaymentModal = React.lazy(() => import('./components/PaymentModal'));
const ModeSelectModal = React.lazy(() => import('./components/ModeSelectModal'));
const OssHero = React.lazy(() => import('./components/OssHero'));

// Context providers
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppProvider, useApp } from './context/AppContext';

// Custom hooks
import useExportImage from './hooks/useExportImage';

import './App.css';

// ---------------------------------------------------------------------------
// Loading Spinner Component
// ---------------------------------------------------------------------------
function LoadingSpinner() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      minHeight: 200,
      gap: 12,
      color: 'var(--text-secondary)',
    }}>
      <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
      <span style={{ fontSize: '0.85rem' }}>加载中...</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error Boundary Component
// ---------------------------------------------------------------------------
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleRefresh = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          gap: 16,
          padding: 24,
          textAlign: 'center',
          background: 'var(--surface, #fff)',
          color: 'var(--on-surface)',
        }}>
          <AlertCircle size={48} style={{ color: 'var(--error, #ba1a1a)' }} />
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>页面渲染出现异常</h2>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', maxWidth: 420 }}>
            应用遇到了意外的渲染错误。这可能是由于临时的数据异常或浏览器兼容性问题导致的。请尝试刷新页面以恢复正常。
          </p>
          {this.state.error && (
            <pre style={{
              fontSize: '0.7rem',
              background: 'rgba(0,0,0,0.04)',
              padding: 12,
              borderRadius: 8,
              maxWidth: 480,
              overflow: 'auto',
              color: 'var(--text-muted)',
            }}>
              {this.state.error.message}
            </pre>
          )}
          <button
            onClick={this.handleRefresh}
            style={{
              padding: '10px 28px',
              fontSize: '0.9rem',
              fontWeight: 600,
              background: 'var(--primary)',
              color: 'white',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            刷新页面
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// AppProviders – wraps the application with all context providers
// ---------------------------------------------------------------------------
function AppProviders({ children }) {
  return (
    <AuthProvider>
      <AppProvider>
        {children}
      </AppProvider>
    </AuthProvider>
  );
}

// ===========================================================================
// Main App Component
// ===========================================================================
export default function App() {
  return (
    <AppProviders>
      <ErrorBoundary>
        <AppInner />
      </ErrorBoundary>
    </AppProviders>
  );
}

// Image type labels — mirrors pipeline.py IMAGE_TYPE_CONFIGS
const IMAGE_TYPE_LABELS = {
  main: { name: '主图' },
  icon: { name: '图标' },
  selling_point: { name: '卖点图' },
  comparison: { name: '对比图' },
  scene_selling: { name: '场景卖点图' },
  structure: { name: '结构图' },
  scene_tag: { name: '场景标签图' },
  person_scene: { name: '人物场景图' },
};

function AppInner() {
  // ---- Context hooks ----
  const auth = useAuth();
  const app = useApp();

  // Convenience destructuring (auth)
  const { currentUser, isAuthenticated, isAuthLoading, logout: authLogout, updateUser: authUpdateUser, refreshToken: authRefreshToken } = auth;

  // Convenience destructuring (app) – state
  const {
    view, setView,
    theme, toggleTheme,
    productInfo, setProductInfo,
    versions, setVersions,
    currentVersionIndex, setCurrentVersionIndex,
    adText, setAdText,
    uploadedAssets, setUploadedAssets,
    errorToast,
    showError, showSuccess, dismissToast,
    chatMessages, setChatMessages,
    isTyping, setIsTyping,
    isGenerating, setIsGenerating,
    evalModel, setEvalModel,
    genModel, setGenModel,
    fidelity, setFidelity,
    globalFidelity, setGlobalFidelity,
    autoCutout, setAutoCutout,
    sessions,
    currentSessionId,
    setCurrentSessionId,
    selectSession,
    createSession,
    deleteSession,
    renameSession,
    fetchSessions,
    saveCanvasState,
    currentCanvasState,
  } = app;

  // ---- Export hook ----
  const { exportAsPNG, exportAsJPEG, exportComposite, isExporting } = useExportImage();

  // ---- Local UI state (component-specific, not shared via context) ----
  const [showLayersPanel, setShowLayersPanel] = useState(false);
  const [chatInputValue, setChatInputValue] = useState('');

  // OSS Hero splash — show once per session (localStorage flag)
  const [showOssHero, setShowOssHero] = useState(() => {
    try {
      return localStorage.getItem('oss_hero_seen') !== 'true';
    } catch {
      return true;
    }
  });
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showModeSelect, setShowModeSelect] = useState(false);
  const [pendingOnboardingInfo, setPendingOnboardingInfo] = useState(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [onboardingInit, setOnboardingInit] = useState(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalTab, setAuthModalTab] = useState('login');
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [triggerPayAfterLogin, setTriggerPayAfterLogin] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState('png');
  const [exportScale, setExportScale] = useState(2); // Default to 2x (HD)
  const [brandMemory, setBrandMemory] = useState({
    brand_name: '',
    style: '',
    color_palette: [],
    typography: '',
    logo_url: '',
    product_name: '',
    product_category: '',
    selling_points: []
  });

  // Navigation items
  const navItems = [
    { id: 'portal', icon: Home, label: '门户主页' },
    { id: 'tools', icon: Grid, label: '快捷工具' },
    { id: 'workspace', icon: Layers, label: '创意工作台' },
    { id: 'history', icon: History, label: '历史版本' },
    { id: 'folders', icon: FolderOpen, label: '文件库' },
    { id: 'database', icon: Database, label: '资产数据' },
  ];

  // ---- Canvas-related state (stays local – tightly coupled to rendering) ----
  const [titlePos, setTitlePos] = useState({ x: 5, y: 70 });
  const [descPos, setDescPos] = useState({ x: 5, y: 82 });
  const [tagPos, setTagPos] = useState({ x: 75, y: 5 });

  const [titleStyle, setTitleStyle] = useState({
    color: '#ffffff', fontSize: 16, bg: 'rgba(0,0,0,0.45)', weight: 'bold', align: 'left'
  });
  const [descStyle, setDescStyle] = useState({
    color: '#f3f4fa', fontSize: 11, bg: 'rgba(0,0,0,0.45)', weight: 'normal', align: 'left'
  });
  const [tagStyle, setTagStyle] = useState({
    color: '#ffffff', fontSize: 9, bg: '#0058bc', weight: 'bold', align: 'center'
  });

  const [aspect, setAspect] = useState('1:1');
  const [productImage, setProductImage] = useState(null);
  const [productCutout, setProductCutout] = useState(null);
  const [productTransform, setProductTransform] = useState(null);
  const [undoStack, setUndoStack] = useState([]);

  // 画布图片 → 对话框附件
  const [attachedImages, setAttachedImages] = useState([]);

  const [syncFidelity, setSyncFidelity] = useState(true);

  // Multi-model API keys (local storage backed)
  const [mimoKey, setMimoKey] = useState(() => localStorage.getItem('mimo_api_key') || '');
  const [geminiKey, setGeminiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const [qwenKey, setQwenKey] = useState(() => localStorage.getItem('qwen_api_key') || '');
  const [customProxy, setCustomProxy] = useState(() => localStorage.getItem('custom_api_proxy') || '');

  // Brand space states
  const [brandColor, setBrandColor] = useState(() => localStorage.getItem('brand_color') || '#ff6b35');
  const [brandLogo, setBrandLogo] = useState(() => localStorage.getItem('brand_logo') || '');
  const [brandFont, setBrandFont] = useState(() => localStorage.getItem('brand_font') || 'Inter');
  const [brandName, setBrandName] = useState(() => localStorage.getItem('brand_name') || '');


  // ---- Homepage Quick Tools States ----
  const [currentQuickTool, setCurrentQuickTool] = useState(null);
  const [showDetailGeneratorModal, setShowDetailGeneratorModal] = useState(false);
  
  // Set generator (商品套图) states
  const [showSetGeneratorModal, setShowSetGeneratorModal] = useState(false);
  const [setUploadBase64, setSetUploadBase64] = useState('');
  const [selectedSetSizes, setSelectedSetSizes] = useState(['1:1', '9:16']);
  const [chosenSetStyle, setChosenSetStyle] = useState('minimalist_white');

  // Copy generator (风格复刻) states
  const [showCopyGeneratorModal, setShowCopyGeneratorModal] = useState(false);
  const [copyUploadBase64, setCopyUploadBase64] = useState('');
  const [copyProductBase64, setCopyProductBase64] = useState('');
  const [copyStylePrompt, setCopyStylePrompt] = useState('');

  // AI Img generator (AI商品图) states
  const [showAiImgGeneratorModal, setShowAiImgGeneratorModal] = useState(false);
  const [aiImgUploadBase64, setAiImgUploadBase64] = useState('');
  const [aiImgPrompt, setAiImgPrompt] = useState('');
  const [aiImgStyle, setAiImgStyle] = useState('minimalist_white');

  // Video generator states
  const [showVideoGeneratorModal, setShowVideoGeneratorModal] = useState(false);
  const [videoUploadBase64, setVideoUploadBase64] = useState('');
  const [showVideoPlayerModal, setShowVideoPlayerModal] = useState(false);
  const [videoPlayerSrc, setVideoPlayerSrc] = useState('');
  const [videoPlayerMotion, setVideoPlayerMotion] = useState('');
  const [videoPlayerBg, setVideoPlayerBg] = useState('');
  const [videoPlayerSrcFilename, setVideoPlayerSrcFilename] = useState('');

  // Global Progress Overlay states (used by Video, Set, Copy, AI Img, Clear tools)
  const [globalProgressOpen, setGlobalProgressOpen] = useState(false);
  const [globalProgressVal, setGlobalProgressVal] = useState(0);
  const [globalProgressStatus, setGlobalProgressStatus] = useState('');
  const [globalProgressTitle, setGlobalProgressTitle] = useState('');

  // ---- Notification states ----
  const [showNotifications, setShowNotifications] = useState(false);
  const [notificationTab, setNotificationTab] = useState('system');
  const [unreadNotifications, setUnreadNotifications] = useState(false);
  const [systemMessages, setSystemMessages] = useState([]);
  const [promotionMessages, setPromotionMessages] = useState([]);
  const [paymentOrders, setPaymentOrders] = useState([]);

  // ---- Refs ----
  const canvasPanelRef = useRef(null);
  const infiniteCanvasRef = useRef(null);
  const quickToolFileInputRef = useRef(null);
  const warehouseInsertLockRef = useRef(false);

  // ---- OSS Hero dismiss ----
  const handleDismissOssHero = () => {
    try { localStorage.setItem('oss_hero_seen', 'true'); } catch {}
    setShowOssHero(false);
  };

  // ---- Close export menu on outside click ----
  useEffect(() => {
    if (!exportMenuOpen) return;
    const handler = () => setExportMenuOpen(false);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [exportMenuOpen]);

  // ---- Close notification / user dropdown on outside click ----
  useEffect(() => {
    if (!showNotifications && !showUserDropdown) return;
    const handler = () => {
      setShowNotifications(false);
      setShowUserDropdown(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [showNotifications, showUserDropdown]);

  const fetchBrandMemory = async () => {
    try {
      const res = await fetch('/api/agent/brand-memory', {
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.brandMemory) {
          setBrandMemory(data.brandMemory);
        }
      }
    } catch (err) {
      console.warn('Failed to fetch brand memory profile:', err.message);
    }
  };

  // ---- Fetch latest user profile and cloud assets on mount ----
  useEffect(() => {
    if (currentUser && currentUser.uid) {
      fetchUserProfile(currentUser.uid);
      fetchUserAssets(currentUser.uid);
      fetchBrandMemory();
    }
  }, [currentUser]);

  // ---- Fetch notifications on mount / user change ----
  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        const res = await fetch('/api/notifications');
        if (res.ok) {
          const data = await res.json();
          setSystemMessages(data.system || []);
          setPromotionMessages(data.promotion || []);

          if ((data.system?.length || 0) + (data.promotion?.length || 0) > 0) {
            setUnreadNotifications(true);
          } else {
            setUnreadNotifications(false);
          }
        }
      } catch (err) {
        console.warn('Real-time notifications API offline, defaulting to empty state:', err.message);
        setSystemMessages([]);
        setPromotionMessages([]);
        setUnreadNotifications(false);
      }
    };
    fetchNotifications();
  }, [currentUser]);

  // ---- Fetch payment orders when notification dropdown opens ----
  useEffect(() => {
    if (!showNotifications) return;
    const fetchOrders = async () => {
      try {
        const res = await fetch('/api/payment/orders', {
          credentials: 'include'
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            setPaymentOrders(data.orders || []);
          }
        }
      } catch (err) {
        console.warn('Failed to fetch payment orders:', err.message);
      }
    };
    fetchOrders();
  }, [showNotifications]);

  // ---- Handle Stripe Redirect Callbacks ----
  useEffect(() => {
    if (isAuthLoading) return;
    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    const orderId = params.get('orderId');

    if (payment === 'success' && orderId) {
      // Poll order status to confirm activation (webhook may take 1-3 seconds)
      let attempts = 0;
      const maxAttempts = 10;
      const pollInterval = setInterval(async () => {
        attempts++;
        try {
          const res = await fetch(`/api/payment/order-status/${orderId}`, {
            credentials: 'include'
          });
          if (res.ok) {
            const data = await res.json();
            if (data.order?.status === 'success') {
              clearInterval(pollInterval);
              window.history.replaceState({}, document.title, window.location.pathname);
              showSuccess(`支付成功！会员已升级为 ${data.membershipType}，剩余额度: ${data.remainingCredits} 次`);
              if (currentUser?.uid) {
                fetchUserProfile(currentUser.uid);
              }
              return;
            }
          }
        } catch (e) { /* keep polling */ }
        if (attempts >= maxAttempts) {
          clearInterval(pollInterval);
          window.history.replaceState({}, document.title, window.location.pathname);
          showSuccess('支付成功！会员权益正在开通中，请稍后刷新页面查看');
          if (currentUser?.uid) {
            fetchUserProfile(currentUser.uid);
          }
        }
      }, 1500);
      return () => clearInterval(pollInterval);
    }

    if (payment === 'success' && !orderId) {
      showSuccess('支付成功！会员权益已升级，请刷新页面查看');
      window.history.replaceState({}, document.title, window.location.pathname);
      if (currentUser?.uid) {
        fetchUserProfile(currentUser.uid);
      }
    }

    if (payment === 'cancel') {
      showError('支付已取消或未完成。');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [isAuthLoading]);

  // =====================================================================
  // Business logic functions
  // =====================================================================

  const fetchUserAssets = async (uid) => {
    try {
      const response = await fetch(`/api/assets?uid=${uid}`, {
        credentials: 'include'
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setUploadedAssets(data.assets);
      }
    } catch (err) {
      showError(`获取云端素材库失败: ${err.message}`);
    }
  };

  const handleLoginSuccess = (user) => {
    // Session is now managed by Better Auth cookie — no token to store
    // user comes from Better Auth's session (already populated via useSession)
    const effectiveUser = user || currentUser;
    if (!effectiveUser) return;

    const hasCloudKeys = effectiveUser.mimoKey || effectiveUser.geminiKey || effectiveUser.qwenKey || effectiveUser.customProxy;
    let updatedUser = { ...effectiveUser };

    if (hasCloudKeys) {
      setMimoKey(effectiveUser.mimoKey || '');
      setGeminiKey(effectiveUser.geminiKey || '');
      setQwenKey(effectiveUser.qwenKey || '');
      setCustomProxy(effectiveUser.customProxy || '');

      localStorage.setItem('mimo_api_key', effectiveUser.mimoKey || '');
      localStorage.setItem('gemini_api_key', effectiveUser.geminiKey || '');
      localStorage.setItem('qwen_api_key', effectiveUser.qwenKey || '');
      localStorage.setItem('custom_api_proxy', effectiveUser.customProxy || '');
    } else {
      updatedUser.mimoKey = mimoKey;
      updatedUser.geminiKey = geminiKey;
      updatedUser.qwenKey = qwenKey;
    }
    authUpdateUser(updatedUser);
    fetchUserAssets(effectiveUser.uid);

    showSuccess(`登录成功！欢迎您，${effectiveUser.email}`);

    if (triggerPayAfterLogin) {
      setTriggerPayAfterLogin(false);
      setTimeout(() => {
        setShowPaymentModal(true);
      }, 300);
    }
  };

  const handleLogout = () => {
    authLogout();
    setUploadedAssets([]);
    setShowUserDropdown(false);
    showSuccess('您已成功退出登录。');
  };

  const fetchUserProfile = async (uid) => {
    try {
      const response = await fetch(`/api/custom-auth/profile/${uid}`, {
        credentials: 'include'
      });
      const data = await response.json();
      if (response.ok && data.success) {
        authUpdateUser(data.user);
      }
    } catch (err) {
      showError(`获取用户资料失败: ${err.message}`);
    }
  };

  const handlePaymentSuccess = () => {
    if (!currentUser) return;
    fetchUserProfile(currentUser.uid);
    showSuccess('恭喜！您已成功升级，会员权益与额度已即时同步！');
  };

  const checkAndDeductCredit = async () => {
    if (!currentUser) {
      showError('请先登录账号以进行 AI 设计与生成！已为您自动弹出登录注册窗口。');
      setAuthModalTab('register');
      setShowAuthModal(true);
      return false;
    }

    // 免费体验：跳过额度检查
    return true;
  };

  const handleUpgradeClick = () => {
    if (!currentUser) {
      showError('请先登录账号，登录后将自动升级会员！');
      setTriggerPayAfterLogin(true);
      setShowAuthModal(true);
    } else {
      setShowPaymentModal(true);
    }
  };

  const getActiveGoogleKey = () => {
    if (geminiKey && geminiKey.startsWith('AIzaSy')) return geminiKey;
    if (mimoKey && mimoKey.startsWith('AIzaSy')) return mimoKey;
    if (qwenKey && qwenKey.startsWith('AIzaSy')) return qwenKey;
    return geminiKey || mimoKey || qwenKey;
  };

  // Activate onboarding modal
  const handleStartOnboarding = async (initialData) => {
    // "创建设计" 按钮：新建会话 + 清空画布 + 清空聊天
    if (initialData === null) {
      // Create new session (cookie-based auth)
      let newSessionId = null;
      try {
        newSessionId = await createSession('新设计会话');
      } catch (e) {
        console.warn('创建新会话失败:', e);
      }
      if (newSessionId) {
        setCurrentSessionId(newSessionId);
        localStorage.setItem('current_session_id', newSessionId);
        fetchSessions();
      }

      // 清空画布
      setVersions([]);
      setCurrentVersionIndex(0);
      setProductImage(null);
      setProductCutout(null);
      setProductTransform(null);
      setChatMessages([]);
      setAdText({ title: '', desc: '' });

      // 清空画布 localStorage
      try {
        localStorage.setItem('infinite_canvas_elements', JSON.stringify([]));
        localStorage.setItem('infinite_canvas_camera', JSON.stringify({ x: 400, y: 300, zoom: 1.0 }));
      } catch (err) {
        // ignore
      }

      setView('workspace');
      return;
    }

    if (initialData && initialData.uploadType === 'custom' && (initialData.productImage || initialData.multipleImages)) {
      setVersions([]);
      setCurrentVersionIndex(0);

      const singleImg = initialData ? (initialData.productImage || (initialData.multipleImages && initialData.multipleImages[0]?.base64)) : null;
      setProductImage(singleImg || null);
      setProductCutout(null);
      setProductTransform(null);

      const elementsToSave = [];
      if (initialData) {
        const imagesList = initialData.multipleImages || (initialData.productImage ? [{ name: initialData.name, base64: initialData.productImage }] : []);

        const imageWidth = 200;
        const imageHeight = 260;
        const gap = 30;
        const centerX = 200 + 150;
        const centerY = 150 + 200;
        const totalWidth = imagesList.length * imageWidth + (imagesList.length - 1) * gap;
        const startX = centerX - totalWidth / 2;

        imagesList.forEach((imgItem, idx) => {
          elementsToSave.push({
            id: 'image-' + Date.now() + '-' + idx,
            type: 'image',
            x: startX + idx * (imageWidth + gap),
            y: centerY - imageHeight / 2,
            width: imageWidth,
            height: imageHeight,
            url: imgItem.base64,
            name: imgItem.name || `图片图层-${idx+1}`
          });
        });
      }

      try {
        localStorage.setItem('infinite_canvas_elements', JSON.stringify(elementsToSave));
      } catch (err) {
        showError(`保存画布元素失败: ${err.message}`);
      }

      setView('workspace');
      return;
    }
    setOnboardingInit(initialData);
    setShowOnboarding(true);
  };

  const handleQuickToolClick = (toolId) => {
    if (toolId === 'set') {
      setSetUploadBase64('');
      setShowSetGeneratorModal(true);
    } else if (toolId === 'ai_img') {
      setAiImgUploadBase64('');
      setShowAiImgGeneratorModal(true);
    } else if (toolId === 'copy') {
      setCopyUploadBase64('');
      setCopyProductBase64('');
      setShowCopyGeneratorModal(true);
    } else if (toolId === 'cut' || toolId === 'cert') {
      setCurrentQuickTool(toolId);
      setTimeout(() => {
        quickToolFileInputRef.current?.click();
      }, 50);
    } else if (toolId === 'detail') {
      setShowDetailGeneratorModal(true);
    } else if (toolId === 'video_viral') {
      setVideoUploadBase64('');
      setShowVideoGeneratorModal(true);
    }
  };

  const handleQuickToolFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file || !currentQuickTool) return;

    const base64Url = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (re) => resolve(re.target.result);
      reader.readAsDataURL(file);
    });

    e.target.value = '';

    if (currentQuickTool === 'cut') {
      setIsGenerating(true);
      showSuccess('AI 智能抠图启动中...');
      try {
        const cutoutBase64 = await generateChromaKeyCutout(base64Url);
        
        const img = new Image();
        img.onload = () => {
          const w = img.naturalWidth || 300;
          const h = img.naturalHeight || 400;
          
          const newImageElement = {
            id: 'image-' + Date.now(),
            type: 'image',
            x: -w / 2,
            y: -h / 2,
            width: w,
            height: h,
            url: cutoutBase64,
            name: `智能抠图_${file.name}`
          };

          localStorage.setItem('infinite_canvas_elements', JSON.stringify([newImageElement]));
          
          const defaultCamera = { x: 400, y: 300, zoom: 1.0 };
          localStorage.setItem('infinite_canvas_camera', JSON.stringify(defaultCamera));
          
          setView('workspace');
          showSuccess('抠图提取成功，已导入画布中心！');
        };
        img.src = cutoutBase64;
      } catch (err) {
        showError(`智能抠图失败: ${err.message}`);
      } finally {
        setIsGenerating(false);
      }
    } else if (currentQuickTool === 'cert') {
      setIsGenerating(true);
      showSuccess('AI 证件照蓝底换底中...');
      
      try {
        const cutoutBase64 = await generateChromaKeyCutout(base64Url);
        
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = 413;
          canvas.height = 578;
          const ctx = canvas.getContext('2d');
          
          ctx.fillStyle = '#438edb';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          
          const cutoutImg = new Image();
          cutoutImg.onload = () => {
            const ratio = cutoutImg.width / cutoutImg.height;
            const drawH = canvas.height * 0.92;
            const drawW = drawH * ratio;
            const drawX = (canvas.width - drawW) / 2;
            const drawY = canvas.height - drawH;
            
            ctx.drawImage(cutoutImg, drawX, drawY, drawW, drawH);
            
            const certBase64 = canvas.toDataURL('image/png');
            
            const newImageElement = {
              id: 'image-' + Date.now(),
              type: 'image',
              x: -canvas.width / 2,
              y: -canvas.height / 2,
              width: canvas.width,
              height: canvas.height,
              url: certBase64,
              name: `精美证件照_${file.name}`
            };

            localStorage.setItem('infinite_canvas_elements', JSON.stringify([newImageElement]));
            
            const defaultCamera = { x: 400, y: 300, zoom: 1.0 };
            localStorage.setItem('infinite_canvas_camera', JSON.stringify(defaultCamera));
            
            setView('workspace');
            showSuccess('AI 智能证件照制作完成，已导入画布！');
            setIsGenerating(false);
          };
          cutoutImg.src = cutoutBase64;
        };
        img.src = base64Url;
      } catch (err) {
        showError(`证件照抠图失败: ${err.message}`);
        setIsGenerating(false);
      }
    }
  };

  // Helper to run progress timers for all AI tools
  const runGlobalProgress = (title, steps, onComplete) => {
    setGlobalProgressTitle(title);
    setGlobalProgressOpen(true);
    setGlobalProgressVal(0);
    setGlobalProgressStatus(steps[0].s);
    
    let currentStepIdx = 0;
    const interval = setInterval(() => {
      if (currentStepIdx < steps.length) {
        setGlobalProgressVal(steps[currentStepIdx].p);
        setGlobalProgressStatus(steps[currentStepIdx].s);
        currentStepIdx++;
      } else {
        clearInterval(interval);
        setGlobalProgressOpen(false);
        onComplete();
      }
    }, 500);
  };



  const handleGenerateSet = (productImg, chosenStyleId, selectedSizes) => {
    setShowSetGeneratorModal(false);
    setView('workspace');
  };

  const handleGenerateCopy = (styleRefImg, myProductImg, promptVal) => {
    setShowCopyGeneratorModal(false);
    setView('workspace');
  };

  const handleGenerateAiImg = (productImg, styleId, customPrompt) => {
    setShowAiImgGeneratorModal(false);
    setView('workspace');
  };

  const handleGenerateDetailPage = (points, styleVal, aspectVal) => {
    setShowDetailGeneratorModal(false);
    setView('workspace');
  };

  const handleRenderVideo = (img, motion, bg) => {
    setShowVideoGeneratorModal(false);
    setView('workspace');
  };

  // Helper to extract chroma key cutout client-side (Upgraded to Edge AI + BFS fallback)
  const generateChromaKeyCutout = async (imageUrl) => {
    // 1. Try local Edge AI matting first (removeBackground) with an 8-second timeout
    try {
      const cutoutPromise = removeBackground(imageUrl, {
        progress: (key, current, total) => {
        }
      });
      
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('AI模型下载超时，自动切换至备用抠图算法')), 8000)
      );

      const imageBlob = await Promise.race([cutoutPromise, timeoutPromise]);
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve(reader.result);
        };
        reader.readAsDataURL(imageBlob);
      });
    } catch (err) {
      console.warn('[App Cutout] Edge AI failed or timed out. Falling back to BFS chroma-key matting.', err);
    }

    // 2. Fallback to advanced local BFS chroma key matting
    return new Promise((resolve) => {
      const img = new Image();
      img.src = imageUrl;
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;
        const width = canvas.width;
        const height = canvas.height;

        const getPixel = (x, y) => {
          const idx = (y * width + x) * 4;
          return {
            r: data[idx],
            g: data[idx+1],
            b: data[idx+2],
            a: data[idx+3]
          };
        };

        // 1. Adaptive background color detection: sample 4 corners
        const corners = [
          getPixel(0, 0),
          getPixel(width - 1, 0),
          getPixel(0, height - 1),
          getPixel(width - 1, height - 1)
        ];
        
        // Find average color of the corners
        const sumColor = corners.reduce((acc, c) => {
          acc.r += c.r;
          acc.g += c.g;
          acc.b += c.b;
          return acc;
        }, { r: 0, g: 0, b: 0 });
        
        const bgR = Math.round(sumColor.r / 4);
        const bgG = Math.round(sumColor.g / 4);
        const bgB = Math.round(sumColor.b / 4);

        // Threshold parameters for soft keying
        const lowThreshold = 20;   // completely transparent below this distance
        const highThreshold = 65;  // starts transitioning below this distance

        // 2. Flood fill (BFS) starting from all borders to find connected background pixels
        const visited = new Uint8Array(width * height);
        const queue = [];

        const checkAndAdd = (x, y) => {
          const idx = y * width + x;
          if (!visited[idx]) {
            const px = getPixel(x, y);
            const dist = Math.sqrt((px.r - bgR) ** 2 + (px.g - bgG) ** 2 + (px.b - bgB) ** 2);
            if (dist < highThreshold) {
              visited[idx] = 1;
              queue.push(idx);
            }
          }
        };

        // Seed all border pixels
        for (let x = 0; x < width; x++) {
          checkAndAdd(x, 0);
          checkAndAdd(x, height - 1);
        }
        for (let y = 0; y < height; y++) {
          checkAndAdd(0, y);
          checkAndAdd(width - 1, y);
        }

        // BFS loop
        let head = 0;
        const dx = [0, 0, 1, -1];
        const dy = [1, -1, 0, 0];

        while (head < queue.length) {
          const curr = queue[head++];
          const cx = curr % width;
          const cy = Math.floor(curr / width);

          for (let i = 0; i < 4; i++) {
            const nx = cx + dx[i];
            const ny = cy + dy[i];

            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const nidx = ny * width + nx;
              if (!visited[nidx]) {
                const px = getPixel(nx, ny);
                const dist = Math.sqrt((px.r - bgR) ** 2 + (px.g - bgG) ** 2 + (px.b - bgB) ** 2);
                if (dist < highThreshold) {
                  visited[nidx] = 1;
                  queue.push(nidx);
                }
              }
            }
          }
        }

        // 3. Process image data: apply soft feathering to connected background pixels
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (visited[idx]) {
              const dataIdx = idx * 4;
              const r = data[dataIdx];
              const g = data[dataIdx+1];
              const b = data[dataIdx+2];
              
              const dist = Math.sqrt((r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2);
              
              if (dist < lowThreshold) {
                data[dataIdx+3] = 0;
              } else {
                // Smooth transition
                const alphaFactor = (dist - lowThreshold) / (highThreshold - lowThreshold);
                const newAlpha = Math.round(255 * alphaFactor);
                data[dataIdx+3] = Math.min(data[dataIdx+3], newAlpha);
              }
            }
          }
        }

        ctx.putImageData(imgData, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => resolve(imageUrl);
    });
  };

  const getImageDimensions = (url) => {
    return new Promise((resolve) => {
      if (!url) {
        resolve({ width: 0, height: 0, ratio: 1 });
        return;
      }
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth || 200;
        const h = img.naturalHeight || 200;
        resolve({ width: w, height: h, ratio: w / h });
      };
      img.onerror = () => {
        resolve({ width: 200, height: 200, ratio: 1 });
      };
      img.src = url;
    });
  };

  const syncAgentVersionToCanvas = async (version) => {
    if (!version) return;

    const verAspect = version.aspect || '1:1';
    const isDetail = verAspect === 'detail';
    const bgWidth = verAspect === '1:1' ? 380 : 320;
    const bgHeight = verAspect === '1:1' ? 380 : isDetail ? 520 : 426;

    const canvasX = 200;
    const canvasY = 150;

    const newElements = [];

    // 1. Background image
    newElements.push({
      id: 'canvas-bg-' + Date.now(),
      type: 'image',
      x: canvasX, y: canvasY,
      width: bgWidth, height: bgHeight,
      url: version.image,
      name: '背景图层',
      locked: true
    });

    // 2. Product cutout
    if (version.productCutout) {
      const transform = version.productTransform || { x: 206, y: 206, scaleX: 0.85, scaleY: 0.85, rotation: 0 };
      
      const { ratio: prodRatio } = await getImageDimensions(version.productCutout);
      let prodWidth = 200;
      let prodHeight = 200;

      if (prodRatio > 1) {
        prodHeight = 200 / prodRatio;
      } else {
        prodWidth = 200 * prodRatio;
      }

      const cutoutW = prodWidth * transform.scaleX;
      const cutoutH = prodHeight * transform.scaleY;
      const cutoutX = canvasX + (transform.x - 16) - (cutoutW / 2);
      const cutoutY = canvasY + (transform.y - 16) - (cutoutH / 2);

      newElements.push({
        id: 'canvas-product-' + Date.now(),
        type: 'image',
        x: cutoutX, y: cutoutY,
        width: cutoutW, height: cutoutH,
        url: version.productCutout,
        name: '商品主体图层'
      });
    }

    // 3. Text layers
    if (version.adText?.title) {
      const pos = version.textPositions?.title || { x: 5, y: 70 };
      const style = version.textStyles?.title || { color: '#ffffff', fontSize: 16 };
      newElements.push({
        id: 'canvas-title-' + Date.now(),
        type: 'text',
        x: canvasX + (pos.x / 100) * bgWidth,
        y: canvasY + (pos.y / 100) * bgHeight + (style.fontSize || 16),
        text: version.adText.title,
        color: style.color || '#ffffff',
        fontSize: style.fontSize || 16,
        name: '主标题文本'
      });
    }

    if (version.adText?.desc) {
      const pos = version.textPositions?.desc || { x: 5, y: 82 };
      const style = version.textStyles?.desc || { color: '#f3f4fa', fontSize: 11 };
      newElements.push({
        id: 'canvas-desc-' + Date.now(),
        type: 'text',
        x: canvasX + (pos.x / 100) * bgWidth,
        y: canvasY + (pos.y / 100) * bgHeight + (style.fontSize || 11),
        text: version.adText.desc,
        color: style.color || '#f3f4fa',
        fontSize: style.fontSize || 11,
        name: '副标题文本'
      });
    }

    if (version.adText?.tag) {
      const pos = version.textPositions?.tag || { x: 75, y: 5 };
      const style = version.textStyles?.tag || { color: '#ffffff', fontSize: 9 };
      newElements.push({
        id: 'canvas-tag-' + Date.now(),
        type: 'text',
        x: canvasX + (pos.x / 100) * bgWidth,
        y: canvasY + (pos.y / 100) * bgHeight + (style.fontSize || 9),
        text: version.adText.tag,
        color: style.color || '#ffffff',
        fontSize: style.fontSize || 9,
        name: '促销标签'
      });
    }

    // 4. Brand Logo Layer
    if (brandLogo) {
      const { ratio: logoRatio } = await getImageDimensions(brandLogo);
      const containerW = 80;
      const containerH = 24;
      const containerRatio = containerW / containerH;

      let logoWidth = containerW;
      let logoHeight = containerH;

      if (logoRatio > containerRatio) {
        logoWidth = containerW;
        logoHeight = containerW / logoRatio;
      } else {
        logoHeight = containerH;
        logoWidth = containerH * logoRatio;
      }

      newElements.push({
        id: 'canvas-logo-' + Date.now(),
        type: 'image',
        x: canvasX + bgWidth - logoWidth - 16,
        y: canvasY + 20,
        width: logoWidth,
        height: logoHeight,
        url: brandLogo,
        name: '品牌 LOGO'
      });
    }

    try {
      localStorage.setItem('infinite_canvas_elements', JSON.stringify(newElements));
    } catch (err) {
      showError(`保存画布元素失败: ${err.message}`);
    }
  };

  // 导出单个 cluster 为 PNG data URL
  const startAiDesign = async (info, mode) => {
    if (!(await checkAndDeductCredit())) {
      return;
    }
    setProductInfo(info);
    setIsGenerating(true);
    setView('workspace');

    // Auto-create session for Portal workflow if none exists
    if (!currentSessionId) {
      const newId = await createSession('新设计会话');
      if (newId) setCurrentSessionId(newId);
    }

    const defaultAdText = {
      title: info.name,
      desc: info.sellingPoints.split('、')[0] || info.sellingPoints.split('，')[0] || '热卖爆款'
    };
    setAdText(defaultAdText);

    let selectedCutout = null;
    try {
      selectedCutout = await generateChromaKeyCutout(info.productImage);
    } catch (e) {
      showError(`商品抠图处理异常: ${e.message}`);
      selectedCutout = info.productImage;
    }
    if (!selectedCutout) {
      selectedCutout = info.productImage;
    }

    const backgroundName = info.productImage || '';

    let finalMetrics = { ctr: 0, cvr: 0, quality: 0, details: {}, positives: [], negatives: [] };
    let finalCritique = '';

    try {
      const response = await fetch('/api/generate/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: currentUser?.uid || '',
          image: info.productImage,
          productInfo: info,
          instruction: '请对当前图片进行首次全面评估'
        }),
        credentials: 'include'
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || data.error || '评估失败');
      }
      finalMetrics = data.metrics;
      finalCritique = data.critique;
    } catch (err) {
      showError(`首次 API 评估与启动服务异常: ${err.message}`);
      setIsGenerating(false);
      return;
    }

    const startTime = Date.now();
    const remainingDelay = Math.max(0, 2000 - (Date.now() - startTime));

    setTimeout(async () => {
      const isCustom = info.uploadType === 'custom';
      const defaultTransform = isCustom ? { x: 206, y: 206, scaleX: 0.85, scaleY: 0.85, rotation: 0 } : null;

      const firstVersion = {
        id: 'v1-' + Date.now(),
        name: info.name + ' (初始生成)',
        image: backgroundName,
        nanoBananaMatting: backgroundName,
        refinedMatting: backgroundName,
        displayMattingState: 'refined',
        adText: defaultAdText,
        textPositions: {
          title: { x: 5, y: 70 },
          desc: { x: 5, y: 82 },
          tag: { x: 75, y: 5 }
        },
        textStyles: {
          title: { color: '#ffffff', fontSize: 16, bg: 'rgba(0,0,0,0.45)', weight: 'bold', align: 'left' },
          desc: { color: '#f3f4fa', fontSize: 11, bg: 'rgba(0,0,0,0.45)', weight: 'normal', align: 'left' },
          tag: { color: '#ffffff', fontSize: 9, bg: '#0058bc', weight: 'bold', align: 'center' }
        },
        aspect: '1:1',
        fidelity: globalFidelity,
        metrics: finalMetrics,
        productImage: info.productImage,
        productCutout: selectedCutout,
        productTransform: defaultTransform,
        annotations: []
      };

      setProductImage(info.productImage);
      setProductCutout(selectedCutout);
      setProductTransform(defaultTransform);

      setAdText(defaultAdText);
      setTitlePos({ x: 5, y: 70 });
      setDescPos({ x: 5, y: 82 });
      setTagPos({ x: 75, y: 5 });
      setTitleStyle({ color: '#ffffff', fontSize: 16, bg: 'rgba(0,0,0,0.45)', weight: 'bold', align: 'left' });
      setDescStyle({ color: '#f3f4fa', fontSize: 11, bg: 'rgba(0,0,0,0.45)', weight: 'normal', align: 'left' });
      setTagStyle({ color: '#ffffff', fontSize: 9, bg: '#0058bc', weight: 'bold', align: 'center' });
      setAspect('1:1');
      setFidelity(globalFidelity);

      setVersions([firstVersion]);
      setCurrentVersionIndex(0);
      setIsGenerating(false);

      if (mode === 'cowork') {
        await syncAgentVersionToCanvas(firstVersion);
      }

      // AI introduces itself and critiques the V1 image
      setIsTyping(true);
      setTimeout(() => {
        let welcomeMessage = `👋 您好！已为您生成第一版商品创意图。
根据您输入的商品《${info.name}》。

📊 **V1 效果快评** (AI 评估 - ${evalModel.toUpperCase()})：
- **预估 CTR**：**${finalMetrics.ctr?.toFixed?.(2) ?? finalMetrics.ctr}%**
- **优势特征**：${(finalMetrics.positives || []).slice(0, 2).join('，') || '待评估'}。
- **劣化特征**：${(finalMetrics.negatives && finalMetrics.negatives[0]) || '无明显缺陷'}。`;

        if (finalCritique) {
          welcomeMessage += `\n\n💡 **AI 专家诊断建议**：\n${finalCritique}`;
        }

        welcomeMessage += `\n\n💡 **建议操作**：您可以对我说"换背景为沙滩"、"换背景为都市"、或者"优化提示词"来探索更高 CTR 的视觉搭配！`;

        const welcomeReasoning = [
          { desc: 'AI 评估引擎初始化视觉分析指标参数', metric: '完成' },
          { desc: '当前版本 CTR 预估值', metric: finalMetrics.ctr?.toFixed?.(2) ?? finalMetrics.ctr + '%' }
        ];

        setChatMessages([{
          sender: 'ai',
          text: welcomeMessage,
          reasoningChain: welcomeReasoning
        }]);
        setIsTyping(false);
      }, 1000);
    }, remainingDelay);
  };

  const handleOnboardingSubmit = async (info) => {
    setIsGenerating(true);
    let updatedInfo = { ...info };
    if (info.autoCutout !== undefined) {
      setAutoCutout(info.autoCutout);
    }
    if (info.uploadType === 'custom' && info.productImage.startsWith('data:image')) {
      try {
        const persistedAsset = await addUploadedAsset(info.name + '.png', info.productImage, 'raw');
        updatedInfo.productImage = persistedAsset.url;
      } catch (e) {
        showError(`保存上传的商品图片失败: ${e.message}`);
      }
    }
    setIsGenerating(false);
    setPendingOnboardingInfo(updatedInfo);
    setShowOnboarding(false);
    setShowModeSelect(true);
  };

  const handleSelectMode = (mode) => {
    if (pendingOnboardingInfo) {
      startAiDesign(pendingOnboardingInfo, 'cowork');
    }
  };

  const handleDirectAgentStart = async (prompt, attachedImage) => {
    // Auto-create session for Portal workflow if none exists
    if (!currentSessionId) {
      const newId = await createSession('新设计会话');
      if (newId) setCurrentSessionId(newId);
    }

    let chosenStyleId = 'minimalist_white';
    if (prompt.includes('沙滩') || prompt.includes('阳光') || prompt.includes('海边')) {
      chosenStyleId = 'outdoor_sunlight';
    } else if (prompt.includes('都市') || prompt.includes('极简') || prompt.includes('白底')) {
      chosenStyleId = 'urban_minimalist';
    }

    const guessedName = prompt.length > 25 ? prompt.substring(0, 25) + '...' : (prompt || '商品设计');
    let imageToUse = '';
    let uploadType = 'custom';

    if (attachedImage) {
      setIsGenerating(true);
      const asset = await addUploadedAsset(attachedImage.name, attachedImage.base64, 'raw');
      imageToUse = asset.url;
      uploadType = 'custom';
      setIsGenerating(false);
    }

    const initialProductInfo = {
      name: guessedName,
      sellingPoints: prompt.split('，')[1] || prompt.split(',')[1] || '',
      styleId: chosenStyleId,
      uploadType: uploadType,
      productImage: imageToUse
    };

    setProductInfo(initialProductInfo);
    setVersions([]);
    setCurrentVersionIndex(-1);
    setView('workspace');

    if (attachedImage) {
      startAiDesign(initialProductInfo, 'cowork');
    } else {
      setChatMessages([
        {
          sender: 'ai',
          text: `👋 您好！已收到您的设计创意意图：
"${prompt}"

为了帮您生成高品质的场景融合图，**请在输入框旁点击上传按钮上传您的商品实拍照片**！`
        }
      ]);
    }
  };

  const handleSelectAsset = async (asset) => {
    let updatedInfo = { ...productInfo };

    if (asset.type === 'custom') {
      setIsGenerating(true);
      const persistedAsset = await addUploadedAsset(asset.name, asset.data, 'raw');
      updatedInfo = {
        name: (productInfo.name && !productInfo.name.includes('...')) ? productInfo.name : (asset.name ? asset.name.split('.')[0] : '自定义设计商品'),
        sellingPoints: productInfo.sellingPoints || '',
        styleId: productInfo.styleId || 'minimalist_white',
        uploadType: 'custom',
        productImage: persistedAsset.url
      };
      setIsGenerating(false);
    }

    startAiDesign(updatedInfo, 'cowork');
  };

  // Helper to commit a new version snapshot
  const commitNewVersion = (name, updatedFields = {}) => {
    const currentSnapshot = versions[currentVersionIndex] || {};
    const nextIteration = versions.length + 1;

    const newVersion = {
      id: 'v' + nextIteration + '-' + Date.now(),
      name: name,
      image: currentSnapshot.image || '',
      nanoBananaMatting: currentSnapshot.nanoBananaMatting || currentSnapshot.image || '',
      refinedMatting: currentSnapshot.refinedMatting || currentSnapshot.image || '',
      displayMattingState: currentSnapshot.displayMattingState || 'refined',
      adText: { ...adText },
      textPositions: {
        title: { ...titlePos },
        desc: { ...descPos },
        tag: { ...tagPos }
      },
      textStyles: {
        title: { ...titleStyle },
        desc: { ...descStyle },
        tag: { ...tagStyle }
      },
      aspect: aspect,
      fidelity: fidelity,
      productImage: productImage,
      productCutout: productCutout,
      productTransform: productTransform ? { ...productTransform } : null,
      metrics: currentSnapshot.metrics ? { ...currentSnapshot.metrics } : null,
      annotations: currentSnapshot.annotations ? JSON.parse(JSON.stringify(currentSnapshot.annotations)) : [],
      ...updatedFields
    };

    const newVersions = [...versions, newVersion];
    setVersions(newVersions);
    setCurrentVersionIndex(newVersions.length - 1);
    return newVersion;
  };

  const handleCommitPositions = (newPositions) => {
    saveToUndoStack();
    setTitlePos(newPositions.title);
    setDescPos(newPositions.desc);
    setTagPos(newPositions.tag);

    commitNewVersion("微调广告语排版位置", {
      textPositions: newPositions
    });
  };

  const handleCommitProductTransform = (newTransform) => {
    saveToUndoStack();
    setProductTransform(newTransform);
    commitNewVersion("调整商品大小/位置", {
      productTransform: newTransform
    });
  };

  const handleCommitStyles = (type, newStyle) => {
    saveToUndoStack();
    let updatedStyles = {
      title: { ...titleStyle },
      desc: { ...descStyle },
      tag: { ...tagStyle }
    };
    updatedStyles[type] = newStyle;

    if (type === 'title') setTitleStyle(newStyle);
    else if (type === 'desc') setDescStyle(newStyle);
    else if (type === 'tag') setTagStyle(newStyle);

    commitNewVersion("修改广告语视觉样式", {
      textStyles: updatedStyles
    });
  };

  const handleCommitFidelity = (newFidelity) => {
    setFidelity(newFidelity);
    commitNewVersion("调整涂抹重绘保真度", {
      fidelity: newFidelity
    });
  };

  const handleInsertLayerRef = (layerName) => {
    setChatInputValue(prev => prev + ` [引用图层: ${layerName}]`);
  };

  // 处理框选局部修改请求
  const handleInpaintRequest = async (imageId, prompt) => {
    if (!infiniteCanvasRef.current) return;

    const regions = infiniteCanvasRef.current.getStitchRegions?.() || [];
    const activeRegions = regions.filter(r => r.imageId === imageId);

    if (activeRegions.length === 0) {
      showError('未找到该图片上的框选区域，请先在图片上画框。');
      return;
    }

    setIsGenerating(true);
    try {
      infiniteCanvasRef.current.handleTriggerAI?.({
        imageId,
        regions: activeRegions,
        prompt
      });
    } catch (err) {
      showError(`局部修改失败: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAttachImageToChat = (imageEl) => {
    setAttachedImages(prev => {
      if (prev.find(img => img.id === imageEl.id)) return prev;
      return [...prev, { id: imageEl.id, url: imageEl.url, name: imageEl.name || '图片' }];
    });
  };

  const handleRemoveAttachedImage = (id) => {
    setAttachedImages(prev => prev.filter(img => img.id !== id));
  };

  const handleSendMessage = async (text, customMaskData = null, options = {}) => {
    if (!(await checkAndDeductCredit())) {
      return;
    }
    const updatedMessages = [...chatMessages, { sender: 'user', text }];
    setChatMessages(updatedMessages);
    setIsTyping(true);

    const hasInpaintMask = customMaskData ? true : (canvasPanelRef.current?.hasMask?.() || false);
    let inpaintMaskData = customMaskData || (hasInpaintMask ? canvasPanelRef.current?.getMaskDataUrl?.() : null);

    // 检测画布 stitch 框选信息，注入消息上下文
    const stitchRegions = infiniteCanvasRef.current?.getStitchRegions?.() || [];
    const hasStitchContext = stitchRegions.length > 0;
    let enhancedText = text;
    if (hasStitchContext) {
      const regionLines = stitchRegions.map(r => {
        const targetImage = infiniteCanvasRef.current?.getElementById?.(r.imageId);
        const imageName = targetImage?.name || '图片';
        return `- ${r.emoji} ${r.colorName}框 ${r.label}: 位于图片 "${imageName}" 内 (x:${r.relX?.toFixed(0) || 0}, y:${r.relY?.toFixed(0) || 0}, ${r.width?.toFixed(0) || 0}x${r.height?.toFixed(0) || 0})`;
      });
      enhancedText = `[系统] 画布框选区域:\n${regionLines.join('\n')}\n\n[用户指令] ${text}`;
    }

    const currentVer = versions[currentVersionIndex];

    // 检测是否包含 inpainting 意图（颜色引用）
    const colorNames = ['蓝色', '绿色', '红色', '黄色', '橙色', '紫色', '蓝', '绿', '红', '黄', '橙', '紫'];
    const hasInpaintIntent = hasStitchContext && colorNames.some(c => text.includes(c));
    if (hasInpaintIntent) {
      // Find the primary image being referenced
      const primaryRegion = stitchRegions[0];
      if (primaryRegion?.imageId) {
        // Trigger inpainting via InfiniteCanvas
        infiniteCanvasRef.current?.handleTriggerAI?.({
          imageId: primaryRegion.imageId,
          regions: stitchRegions,
          prompt: text
        });
        // Still continue the chat flow for the agent to understand
      }
    }

    try {
      setIsGenerating(true);

      let currentCutout = productCutout;
      if (!currentCutout && productImage) {
        try {
          currentCutout = await generateChromaKeyCutout(productImage);
          setProductCutout(currentCutout);
        } catch (e) {
          showError(`商品抠图处理异常: ${e.message}`);
          currentCutout = productImage;
          setProductCutout(currentCutout);
        }
      }

      // SSE streaming — fully Agent-driven
      let streamingResult = { generated_images: {}, product_name: '', selling_points: '', image_types: [] };

      // 从画布收集当前已有的图片信息，作为 current_images 传递给 Agent
      const canvasElements = infiniteCanvasRef.current?.getElements?.() || [];
      const canvasImageMap = {};
      canvasElements.forEach(el => {
        if (el.type === 'image' && el.url) {
          const label = el.name || el.id || 'image';
          canvasImageMap[label] = el.url;
        }
      });

      // 将附件图片 URL 转为 base64
      let attachedImageBase64List = [];
      if (attachedImages.length > 0) {
        attachedImageBase64List = await Promise.all(
          attachedImages.map(async (img) => {
            try {
              const resp = await fetch(img.url);
              const blob = await resp.blob();
              return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(blob);
              });
            } catch (e) {
              console.warn('附件图片 URL→base64 转换失败:', img.url, e);
              return null;
            }
          })
        );
        attachedImageBase64List = attachedImageBase64List.filter(Boolean);
      }

      // 取第一张附件作为 product_image_base64（保持向后兼容）
      const attachedBase64 = attachedImageBase64List.length > 0 ? attachedImageBase64List[0] : null;

      const bodyObj = {
          message: enhancedText,
          product_name: productInfo.name || '',
          selling_points: productInfo.sellingPoints || '',
          product_image_base64: options.product_image_base64 || attachedBase64 || productImage || null,
          image_types: options.image_types || [],
          session_id: currentSessionId,
          mask_data: inpaintMaskData || null,
          canvas_snapshot: infiniteCanvasRef.current?.getCanvasSnapshot?.() || null,
          stitch_regions: stitchRegions,
          current_images: canvasImageMap,
          reference_images: attachedImageBase64List,
          style_preference: productInfo.styleId || '',
          aspect_ratio: aspect,
          skip_info_collection: options.skip_info_collection || false,
          skip_design_planning: options.skip_design_planning || false,
          single_image_mode: options.single_image_mode || false,
          target_single_type: options.target_single_type || '',
          refinement_mode: options.refinement_mode || false,
          agent_memory: options.agent_memory || {},
        };
        const sseResponse = await fetch('/api/agent/chat-stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(bodyObj)
      });

      // 清空附件列表
      if (attachedImages.length > 0) {
        setAttachedImages([]);
      }

      if (!sseResponse.ok) {
        const errText = await sseResponse.text();
        let errData;
        try {
          errData = JSON.parse(errText);
        } catch {
          errData = { error: errText };
        }
        if (errData.error && (errData.error.includes('令牌') || errData.error.includes('token') || errData.error.includes('认证'))) {
          showError('登录已过期，请重新登录');
          setShowAuthModal(true);
          setIsTyping(false);
          setIsGenerating(false);
          return;
        }
        throw new Error(errData.error || errData.message || 'Agent 服务响应异常');
      }

      const reader = sseResponse.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          try {
            const event = JSON.parse(payload);
            switch (event.event) {
              case 'agent_message':
                // Agent-controlled chat message — display directly
                setChatMessages(prev => [...prev, {
                  sender: 'ai',
                  agent: event.agent || 'coordinator',
                  text: event.text
                }]);
                break;

              case 'chitchat_reply':
                // Chitchat response — display and end
                if (event.text) {
                  setChatMessages(prev => [...prev, {
                    sender: 'ai',
                    agent: 'coordinator',
                    text: event.text
                  }]);
                }
                break;

              case 'new_design_started':
                // Agent reset for new design
                if (event.text) {
                  setChatMessages(prev => [...prev, {
                    sender: 'ai',
                    agent: 'coordinator',
                    text: event.text
                  }]);
                }
                break;

              case 'info_complete':
                // Phase 1 still collecting info — display assistant reply directly
                {
                  const chatHistory = event.chat_history || [];
                  const lastMsg = chatHistory[chatHistory.length - 1];
                  if (lastMsg?.role === 'assistant') {
                    setChatMessages(prev => [...prev, {
                      sender: 'ai',
                      agent: 'planner',
                      text: lastMsg.content
                    }]);
                  }
                }
                break;

              case 'phase_complete':
                streamingResult.product_name = event.product_name || '';
                streamingResult.selling_points = event.selling_points || '';
                streamingResult.image_types = event.image_types || [];
                streamingResult.style_preference = event.style_preference || '';
                break;

              case 'image_progress':
                streamingResult.generated_images[event.image_type] = event.url;
                // Inject image into canvas
                {
                  const imgType = event.image_type || '图片';
                  const imgLabel = IMAGE_TYPE_LABELS?.[imgType]
                    ? `${IMAGE_TYPE_LABELS[imgType].name}`
                    : `${imgType}`;
                  infiniteCanvasRef.current?.insertImageLayer(event.url, imgLabel);
                }
                break;

              case 'image_done':
                streamingResult.generated_images = event.all_images || {};
                if (event.warning) {
                  setChatMessages(prev => [...prev, {
                    sender: 'ai',
                    agent: 'coordinator',
                    text: `⚠️ 部分图片生成遇到问题: ${event.warning}`
                  }]);
                }
                // 兜底插入画布：遍历所有生成的图片，不在画布上的就插入
                {
                  const canvasEls = infiniteCanvasRef.current?.getElements?.() || [];
                  const canvasUrls = new Set(canvasEls.filter(e => e.type === 'image').map(e => e.url));
                  const allImages = event.all_images || {};
                  Object.entries(allImages).forEach(([imgType, imgUrl]) => {
                    if (!canvasUrls.has(imgUrl)) {
                      const cfg = IMAGE_TYPE_LABELS?.[imgType];
                      const label = cfg ? cfg.name : imgType;
                      infiniteCanvasRef.current?.insertImageLayer(imgUrl, `${label}（已生成）`);
                    }
                  });
                  // 不在这里保存 canvas state —— 等 images_saved 事件用本地 URL 替换后再保存
                }
                break;

              case 'images_saved':
                if (event.images) {
                  // 合并本地化后的图片 URL
                  const prevImages = { ...streamingResult.generated_images };
                  streamingResult.generated_images = { ...prevImages, ...event.images };
                  // 更新画布上的图片 URL：用本地化 URL 替换临时 URL
                  Object.entries(event.images).forEach(([imgType, localUrl]) => {
                    const oldUrl = prevImages[imgType];
                    if (oldUrl && oldUrl !== localUrl) {
                      infiniteCanvasRef.current?.replaceImageUrl?.(oldUrl, localUrl);
                    }
                  });
                  // 替换后重新保存 canvas state（URL 已更新为本地持久化 URL）
                  setTimeout(() => {
                    const els = infiniteCanvasRef.current?.getElements?.() || [];
                    const cam = infiniteCanvasRef.current?.getCamera?.() || { x: 400, y: 300, zoom: 1.0 };
                    saveCanvasState(currentSessionId, { elements: els, camera: cam });
                  }, 2000);
                }
                if (event.remainingCredits != null) {
                  setCurrentUser(prev => ({ ...prev, remainingCredits: event.remainingCredits }));
                }
                break;

              case 'evaluation_progress':
              case 'design_plan':
              case 'phase_start':
                // Internal events — no chat message
                break;

              case 'agent_thinking':
                // New ReAct Agent: show thinking status
                if (event.text) {
                  setChatMessages(prev => [...prev, {
                    sender: 'ai',
                    agent: 'react_agent',
                    text: `🤔 ${event.text.slice(0, 200)}`
                  }]);
                }
                break;

              case 'agent_tool_start':
                // New ReAct Agent: show which tool is being called
                {
                  const toolLabels = {
                    'generate_image': '正在生成图片...',
                    'evaluate_image': '正在评估图片质量...',
                    'query_canvas': '正在查询画布状态...',
                    'search_knowledge': '正在搜索知识库...',
                    'update_plan': '正在更新设计方案...',
                    'finish_task': '任务完成',
                  };
                  const label = toolLabels[event.tool] || `正在执行: ${event.tool}`;
                  setChatMessages(prev => [...prev, {
                    sender: 'ai',
                    agent: 'react_agent',
                    text: `🔧 ${label}`
                  }]);
                }
                break;

              case 'flow_decision':
                // Show flow control decisions
                if (event.text) {
                  setChatMessages(prev => [...prev, {
                    sender: 'ai',
                    agent: 'coordinator',
                    text: `⚡ ${event.text}`
                  }]);
                }
                break;

              case 'intent_detected':
                // Debug: log detected intent (not shown to user)
                console.log(`[Intent] Detected: ${event.intent}, phase: ${event.current_phase}`);
                break;

              case 'memory_updated':
                // Update product info when memory changes
                if (event.agent_memory) {
                  const mem = event.agent_memory;
                  if (mem.product_name) {
                    setProductInfo(prev => ({
                      ...prev,
                      name: mem.product_name || prev.name,
                      sellingPoints: mem.selling_points || prev.sellingPoints,
                      styleId: mem.style_preference || prev.styleId,
                    }));
                  }
                }
                break;

              case 'error':
                throw new Error(event.message || 'Stream processing error');

              case 'done':
                // Stream complete
                break;

              case 'tool_call':
                {
                  const toolName = event.tool;
                  const args = event.args || {};
                  let toolResult = null;
                  try {
                    if (toolName === 'getElements') {
                      toolResult = infiniteCanvasRef.current?.getElements?.() || [];
                    } else if (toolName === 'getElementById') {
                      toolResult = infiniteCanvasRef.current?.getElementById?.(args.id) || null;
                    } else if (toolName === 'getSelectedElements') {
                      toolResult = infiniteCanvasRef.current?.getSelectedElements?.() || [];
                    } else if (toolName === 'getStitchRegions') {
                      toolResult = infiniteCanvasRef.current?.getStitchRegions?.() || [];
                    } else if (toolName === 'getCanvasSnapshot') {
                      toolResult = infiniteCanvasRef.current?.getCanvasSnapshot?.() || {};
                    } else if (toolName === 'getDimensions') {
                      toolResult = infiniteCanvasRef.current?.getDimensions?.() || { width: 1200, height: 800 };
                    } else if (toolName === 'getClusters') {
                      toolResult = infiniteCanvasRef.current?.getClusters?.() || [];
                    } else if (toolName === 'getHistory') {
                      toolResult = infiniteCanvasRef.current?.getHistory?.() || { past: [], future: [] };
                    } else {
                      toolResult = { error: `Unknown tool: ${toolName}` };
                    }
                  } catch (err) {
                    toolResult = { error: err.message };
                  }
                  fetch('/api/agent/tool-result', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    credentials: 'include',
                    body: JSON.stringify({
                      session_id: currentSessionId,
                      tool_name: toolName,
                      result: toolResult
                    })
                  }).catch(err => console.warn('[Tool SSE] Failed to post tool result:', err));
                }
                break;
                }
              } catch (parseErr) {
                if (parseErr.message && parseErr.message.includes('Stream')) throw parseErr;
              }
            }
          }

      // 保存 SSE 流式结果上下文，供后续对话使用
      if (streamingResult.product_name) {
        setProductInfo(prev => ({
          ...prev,
          name: streamingResult.product_name || prev.name,
          sellingPoints: streamingResult.selling_points || prev.sellingPoints,
          styleId: streamingResult.style_preference || prev.styleId,
        }));
      }

      // Update session_id if changed
      if (streamingResult.session_id && streamingResult.session_id !== currentSessionId) {
        setCurrentSessionId(streamingResult.session_id);
        localStorage.setItem('current_session_id', streamingResult.session_id);
        fetchSessions();
      }

      if (hasInpaintMask) {
        canvasPanelRef.current?.clearMask?.();
      }

      // Create version if images were generated
      if (Object.keys(streamingResult.generated_images).length > 0) {
        const firstImageUrl = Object.values(streamingResult.generated_images)[0];
        const newVersion = {
          id: 'v' + (versions.length + 1) + '-' + Date.now(),
          name: `AI生成: ${text.slice(0, 30)}`,
          image: firstImageUrl,
          nanoBananaMatting: firstImageUrl,
          refinedMatting: firstImageUrl,
          displayMattingState: 'refined',
          metrics: { ctr: 0, cvr: 0, quality: 0, positives: [], negatives: [], critique: '' },
          adText: { title: adText.title, desc: adText.desc },
          textPositions: { title: { ...titlePos }, desc: { ...descPos }, tag: { ...tagPos } },
          textStyles: { title: { ...titleStyle }, desc: { ...descStyle }, tag: { ...tagStyle } },
          aspect: aspect,
          fidelity: fidelity,
          productImage: productImage,
          productCutout: currentCutout,
          productTransform: productTransform ? { ...productTransform } : null,
          annotations: currentVer && currentVer.annotations ? JSON.parse(JSON.stringify(currentVer.annotations)) : []
        };

        setVersions(prev => {
          const updated = [...prev, newVersion];
          setCurrentVersionIndex(updated.length - 1);
          return updated;
        });
      }
    } catch (err) {
      showError(`Agent 创意引擎响应异常: ${err.message}`);
    } finally {
      setIsGenerating(false);
      setIsTyping(false);
    }
  };

  const handleSelectVersion = (index) => {
    setCurrentVersionIndex(index);
    const ver = versions[index];
    if (ver) {
      if (ver.adText) setAdText(ver.adText);
      if (ver.textPositions) {
        if (ver.textPositions.title) setTitlePos(ver.textPositions.title);
        if (ver.textPositions.desc) setDescPos(ver.textPositions.desc);
        if (ver.textPositions.tag) setTagPos(ver.textPositions.tag);
      }
      if (ver.textStyles) {
        if (ver.textStyles.title) setTitleStyle(ver.textStyles.title);
        if (ver.textStyles.desc) setDescStyle(ver.textStyles.desc);
        if (ver.textStyles.tag) setTagStyle(ver.textStyles.tag);
      }
      if (ver.aspect) setAspect(ver.aspect);
      if (ver.fidelity) setFidelity(ver.fidelity);

      if (ver.productImage) setProductImage(ver.productImage);
      if (ver.productCutout !== undefined) setProductCutout(ver.productCutout);
      if (ver.productTransform !== undefined) setProductTransform(ver.productTransform);
    }
    // 跳转到画板工作台
    setView('workspace');
  };

  // Open a session from the sessions list — load chat + canvas state, then jump to workspace
  const handleOpenSession = async (sessionId) => {
    await selectSession(sessionId);
    setView('workspace');
  };

  // Create a new session and jump to workspace
  const handleCreateAndOpenSession = async () => {
    const newId = await createSession('新设计会话');
    if (newId) {
      setVersions([]);
      setCurrentVersionIndex(0);
      try {
        localStorage.removeItem('infinite_canvas_elements');
        localStorage.removeItem('infinite_canvas_camera');
      } catch (e) { /* ignore */ }
      setView('workspace');
    } else {
      showError('创建会话失败，请检查网络连接后重试');
    }
  };

  const handleSelectAssetFromWarehouse = async (item) => {
    if (!item) {
      showError('素材数据为空，无法加载');
      return;
    }

    // All assets: insert as image layer on canvas
    const rawUrl = item.url || item.img;
    if (!rawUrl) {
      showError('素材文件路径无效，无法加载到画布');
      return;
    }
    const url = resolveAssetUrl(rawUrl);
    if (!url) {
      showError('素材文件路径无效，无法加载到画布');
      return;
    }
    const name = item.name || '素材';

    // Pre-check if the file is accessible before switching to workspace
    try {
      const checkRes = await fetch(url, { method: 'HEAD' });
      if (!checkRes.ok) {
        showError(`素材文件 "${name}" 不存在或已被删除，请重新上传`);
        return;
      }
    } catch {
      // For data: URLs, HEAD might fail — fall through to canvas insertion
      if (!url.startsWith('data:')) {
        showError(`素材文件 "${name}" 加载失败，请检查网络连接`);
        return;
      }
    }

    const onError = (failedUrl) => {
      showError(`图片加载失败：${failedUrl}，请检查文件是否存在`);
    };
    const insert = () => {
      if (infiniteCanvasRef.current?.insertImageLayer) {
        infiniteCanvasRef.current.insertImageLayer(url, name, onError);
        showSuccess(`素材 "${name}" 已添加到画布`);
      } else {
        setTimeout(() => {
          if (infiniteCanvasRef.current?.insertImageLayer) {
            infiniteCanvasRef.current.insertImageLayer(url, name, onError);
            showSuccess(`素材 "${name}" 已添加到画布`);
          } else {
            showError('画布尚未就绪，请稍后再试');
          }
        }, 500);
      }
    };

    setView('workspace');
    setTimeout(insert, 500);
  };

  const handleUpdateAdText = (newAdText) => {
    saveToUndoStack();
    setAdText(newAdText);
    if (versions.length > 0) {
      const updated = [...versions];
      updated[currentVersionIndex].adText = newAdText;
      setVersions(updated);
    }
  };

  const handleUpdateBackgroundImage = (newBgImage) => {
    saveToUndoStack();
    if (versions.length > 0) {
      const updated = [...versions];
      const currentVer = updated[currentVersionIndex];
      updated[currentVersionIndex] = {
        ...currentVer,
        image: newBgImage,
        nanoBananaMatting: newBgImage,
        refinedMatting: newBgImage
      };
      setVersions(updated);
    }
  };

  const saveToUndoStack = () => {
    const snapshot = {
      productCutout,
      productTransform: productTransform ? { ...productTransform } : null,
      versions: JSON.parse(JSON.stringify(versions)),
      currentVersionIndex,
      adText: { ...adText },
      titlePos: { ...titlePos },
      descPos: { ...descPos },
      tagPos: { ...tagPos },
      titleStyle: { ...titleStyle },
      descStyle: { ...descStyle },
      tagStyle: { ...tagStyle },
      aspect,
      fidelity
    };
    setUndoStack(prev => [...prev.slice(-49), snapshot]);
  };

  const handleUndo = () => {
    setUndoStack(prev => {
      if (prev.length === 0) return prev;
      const updated = [...prev];
      const snapshot = updated.pop();

      setProductCutout(snapshot.productCutout);
      setProductTransform(snapshot.productTransform);
      setVersions(snapshot.versions);
      setCurrentVersionIndex(snapshot.currentVersionIndex);
      setAdText(snapshot.adText);
      setTitlePos(snapshot.titlePos);
      setDescPos(snapshot.descPos);
      setTagPos(snapshot.tagPos);
      setTitleStyle(snapshot.titleStyle);
      setDescStyle(snapshot.descStyle);
      setTagStyle(snapshot.tagStyle);
      setAspect(snapshot.aspect);
      setFidelity(snapshot.fidelity);

      return updated;
    });
  };

  const handleUpdateAnnotations = (newAnnotations) => {
    if (versions.length === 0) return;
    const updated = [...versions];
    updated[currentVersionIndex].annotations = newAnnotations;
    setVersions(updated);
  };

  const handleUpdateProductCutout = (newCutout) => {
    saveToUndoStack();
    setProductCutout(newCutout);
  };

  const handleRecommendationAction = (reco) => {
    if (reco.type === 'add_text') {
      handleSendMessage('为画面优化并叠加广告语');
    } else if (reco.type === 'brand_check') {
      handleSendMessage('对当前版本进行品牌一致性检测');
    }
  };

  const addUploadedAsset = async (fileName, base64Url, type = 'raw') => {
    const bytes = base64Url ? Math.round(base64Url.length * 0.75) : 0;
    let sizeStr = '0 KB';
    if (bytes > 1024 * 1024) {
      sizeStr = `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    } else if (bytes > 1024) {
      sizeStr = `${Math.round(bytes / 1024)} KB`;
    } else {
      sizeStr = `${bytes} B`;
    }

    const tempId = 'temp-' + Date.now();
    const newAsset = {
      id: tempId,
      name: fileName || `自定义素材_${Math.floor(Math.random() * 100)}.png`,
      type: type,
      size: sizeStr,
      date: new Date().toISOString().split('T')[0],
      url: base64Url
    };
    setUploadedAssets(prev => [newAsset, ...prev]);

    if (currentUser) {
      try {
        // Auto-create session on first upload if none exists
        let activeSessionId = currentSessionId;
        if (!activeSessionId) {
          try {
            const newId = await createSession('新设计会话');
            if (newId) {
              activeSessionId = newId;
              setCurrentSessionId(newId);
            }
          } catch (err) {
            console.warn('Auto-create session on upload failed:', err);
          }
        }

        const response = await fetch('/api/assets/upload', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            uid: currentUser.uid,
            name: fileName || `upload_${Date.now()}.png`,
            data: base64Url,
            session_id: activeSessionId || null
          }),
          credentials: 'include'
        });
        const data = await response.json();
        if (response.ok && data.success) {
          setUploadedAssets(prev => prev.map(a => a.id === tempId ? data.asset : a));
          return data.asset;
        }
      } catch (err) {
        showError(`素材云端同步失败: ${err.message}`);
      }
    }
    return newAsset;
  };

  // ---- Export handlers ----
  const handleExportClick = (format) => {
    setExportFormat(format);
    setExportScale(2); // Reset to HD (2x) default
    setExportMenuOpen(false);
    setShowExportModal(true);
  };

  const handleConfirmExport = async () => {
    setShowExportModal(false);
    try {
      if (infiniteCanvasRef.current) {
        infiniteCanvasRef.current.exportCanvas(exportFormat, exportScale);
      } else {
        showError('画布未就绪，无法导出。');
      }
    } catch (err) {
      showError(`导出图片失败: ${err.message}`);
    }
  };

  // ---- Computed values ----
  const currentVersion = versions[currentVersionIndex];
  const previousVersion = currentVersionIndex > 0 ? versions[currentVersionIndex - 1] : null;

  const isPremium = currentUser && (currentUser.membershipType === 'pro' || currentUser.membershipType === 'enterprise' || currentUser.membershipType === 'premium');

  const getMembershipBadgeText = () => {
    if (!currentUser) return '';
    if (currentUser.membershipType === 'pro') return '👑 专业版 VIP';
    if (currentUser.membershipType === 'enterprise') return '👑 企业版 VIP';
    if (currentUser.membershipType === 'premium') return '👑 Premium VIP';
    return '';
  };


  // =====================================================================
  // JSX
  // =====================================================================
  return (
    <>
      {/* OSS Hero — scrollable fullscreen page */}
      {showOssHero && <OssHero onEnter={handleDismissOssHero} />}

      <div className="app-container" onClick={() => setIsMenuOpen(false)}>
      <Sidebar
        activeView={view}
        onViewChange={(newView) => {
          if (newView === 'workspace' && versions.length === 0) {
            setShowOnboarding(true);
          } else {
            setView(newView);
          }
        }}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        hasActiveSession={versions.length > 0}
        onHelpDesign={() => setShowOnboarding(true)}
      />

      {/* 2. Main content area */}
      <div className="app-main-content">
        {/* Top Header */}
        <header className="topbar">
          <div className="topbar-brand" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {view === 'workspace' && (
              <button
                className="command-tool-btn"
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', color: 'var(--on-surface-variant)' }}
                title="菜单"
              >
                <Menu size={20} />
              </button>
            )}
            <h1 className="brand-text" style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--on-surface)' }}>
              {view === 'workspace' ? "协同编辑工作台" : "AI商品工作台"}
            </h1>
          </div>

          <div className="topbar-actions">
            {view === 'workspace' ? (
              <>
                <button
                  className="command-tool-btn"
                  title={theme === 'dark' ? '切换为白天模式' : '切换为黑夜模式'}
                  onClick={toggleTheme}
                >
                  {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                </button>
                <button className="command-tool-btn" title="预览恢复"><Play size={18} /></button>

                {/* Pricing button (CoWork mode) */}
                <button
                  className="flex items-center space-x-2 px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 transition-colors"
                  style={{ display: 'flex', gap: '6px', alignItems: 'center', background: 'linear-gradient(135deg, #0058bc 0%, #4c4aca 100%)', border: 'none', borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '0.8rem', color: 'white', fontWeight: 600 }}
                  onClick={() => setShowPaymentModal(true)}
                >
                  <Crown size={16} />
                  <span>定价</span>
                </button>

                {/* Export button with dropdown (CoWork mode) */}
                <div style={{ position: 'relative' }}>
                  <button
                    className="flex items-center space-x-2 px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 transition-colors"
                    style={{ display: 'flex', gap: '6px', alignItems: 'center', background: 'transparent', border: '1px solid var(--outline-variant)', borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--on-surface)' }}
                    title="导出图片"
                    onClick={(e) => { e.stopPropagation(); setExportMenuOpen(!exportMenuOpen); }}
                  >
                    <Download size={16} />
                    <span>{isExporting ? '导出中...' : '导出图片'}</span>
                  </button>
                  {exportMenuOpen && (
                    <div
                      className="glass-panel animate-fade-in"
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        position: 'absolute', top: '100%', right: 0, marginTop: 4,
                        background: 'var(--surface)', border: '1px solid var(--outline-variant)',
                        borderRadius: 8, padding: 4, minWidth: 140, zIndex: 1000,
                        boxShadow: '0 4px 16px rgba(0,0,0,0.12)'
                      }}
                    >
                      <button
                        onClick={() => handleExportClick('png')}
                        disabled={isExporting}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 6, fontSize: '0.8rem', color: 'var(--on-surface)' }}
                        onMouseOver={(e) => e.currentTarget.style.background = 'var(--surface-variant, rgba(0,0,0,0.04))'}
                        onMouseOut={(e) => e.currentTarget.style.background = 'none'}
                      >
                        <Download size={14} />
                        <span>导出为 PNG</span>
                      </button>
                      <button
                        onClick={() => handleExportClick('jpeg')}
                        disabled={isExporting}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 6, fontSize: '0.8rem', color: 'var(--on-surface)' }}
                        onMouseOver={(e) => e.currentTarget.style.background = 'var(--surface-variant, rgba(0,0,0,0.04))'}
                        onMouseOut={(e) => e.currentTarget.style.background = 'none'}
                      >
                        <Download size={14} />
                        <span>导出为 JPEG</span>
                      </button>
                    </div>
                  )}
                </div>

                <button className="flex items-center space-x-2 px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 transition-colors" style={{ display: 'flex', gap: '6px', alignItems: 'center', background: 'transparent', border: '1px solid var(--outline-variant)', borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--on-surface)' }} title="共享链接">
                  <Share2 size={16} />
                  <span>共享</span>
                </button>
              </>
            ) : (
              <>

                {/* Membership badge */}
                {isPremium ? (
                  <div
                    className="mode-indicator live"
                    style={{
                      background: 'rgba(212, 175, 55, 0.08)',
                      color: '#b59410',
                      borderColor: 'rgba(212, 175, 55, 0.2)',
                      fontWeight: 700
                    }}
                  >
                    {getMembershipBadgeText()}
                  </div>
                ) : null}

                {/* Pricing button (Agent mode) */}
                <button
                  className="command-tool-btn"
                  style={{ display: 'flex', gap: '4px', alignItems: 'center', background: 'linear-gradient(135deg, #0058bc 0%, #4c4aca 100%)', border: 'none', borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', color: 'white', fontWeight: 600 }}
                  onClick={() => setShowPaymentModal(true)}
                >
                  <Crown size={16} />
                  <span style={{ fontSize: '0.75rem' }}>定价</span>
                </button>

                {/* Export button with dropdown (Agent mode) */}
                <div style={{ position: 'relative' }}>
                  <button
                    className="command-tool-btn"
                    style={{ display: 'flex', gap: '4px', alignItems: 'center' }}
                    title="导出图片"
                    onClick={(e) => { e.stopPropagation(); setExportMenuOpen(!exportMenuOpen); }}
                  >
                    <Download size={18} />
                    <span style={{ fontSize: '0.75rem' }}>{isExporting ? '导出中...' : '导出图片'}</span>
                  </button>
                  {exportMenuOpen && (
                    <div
                      className="glass-panel animate-fade-in"
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        position: 'absolute', top: '100%', right: 0, marginTop: 4,
                        background: 'var(--surface)', border: '1px solid var(--outline-variant)',
                        borderRadius: 8, padding: 4, minWidth: 140, zIndex: 1000,
                        boxShadow: '0 4px 16px rgba(0,0,0,0.12)'
                      }}
                    >
                      <button
                        onClick={() => handleExportClick('png')}
                        disabled={isExporting}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 6, fontSize: '0.8rem', color: 'var(--on-surface)' }}
                        onMouseOver={(e) => e.currentTarget.style.background = 'var(--surface-variant, rgba(0,0,0,0.04))'}
                        onMouseOut={(e) => e.currentTarget.style.background = 'none'}
                      >
                        <Download size={14} />
                        <span>导出为 PNG</span>
                      </button>
                      <button
                        onClick={() => handleExportClick('jpeg')}
                        disabled={isExporting}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 6, fontSize: '0.8rem', color: 'var(--on-surface)' }}
                        onMouseOver={(e) => e.currentTarget.style.background = 'var(--surface-variant, rgba(0,0,0,0.04))'}
                        onMouseOut={(e) => e.currentTarget.style.background = 'none'}
                      >
                        <Download size={14} />
                        <span>导出为 JPEG</span>
                      </button>
                    </div>
                  )}
                </div>

                <button
                  className="command-tool-btn"
                  title={theme === 'dark' ? '切换为白天模式' : '切换为黑夜模式'}
                  onClick={toggleTheme}
                >
                  {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                </button>
                {/* Notification Dropdown Container */}
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <button 
                    className="command-tool-btn" 
                    title="消息"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowNotifications(!showNotifications);
                      setUnreadNotifications(false);
                      setShowUserDropdown(false);
                      setExportMenuOpen(false);
                    }}
                    style={{ position: 'relative' }}
                  >
                    <Bell size={18} />
                    {unreadNotifications && (
                      <span style={{
                        position: 'absolute',
                        top: '4px',
                        right: '4px',
                        width: '8px',
                        height: '8px',
                        background: 'var(--error)',
                        borderRadius: '50%',
                        border: '1.5px solid var(--surface-container-lowest)'
                      }} />
                    )}
                  </button>

                  {showNotifications && (
                    <div 
                      className="user-dropdown-menu glass-panel animate-fade-in" 
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        position: 'absolute',
                        top: 'calc(100% + 8px)',
                        right: 0,
                        width: '320px',
                        padding: '12px',
                        zIndex: 1000,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                        background: 'var(--surface-container-lowest)',
                        border: '1px solid var(--border-glass)',
                        boxShadow: '0 8px 30px rgba(0,0,0,0.15)',
                        borderRadius: '12px',
                        color: 'var(--on-surface)',
                        cursor: 'default'
                      }}
                    >
                      {/* Dropdown Header */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--outline-variant, rgba(0,0,0,0.08))', paddingBottom: '8px' }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>🔔</span> 消息通知中心
                        </span>
                        <button 
                          onClick={() => setShowNotifications(false)}
                          style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '1rem', color: 'var(--text-muted, #717786)', display: 'flex', padding: '2px' }}
                        >
                          &times;
                        </button>
                      </div>

                      {/* Tab Selectors */}
                      <div style={{ display: 'flex', background: 'var(--surface-container-low, rgba(0,0,0,0.02))', borderRadius: '6px', padding: '2px' }}>
                        <button
                          onClick={() => setNotificationTab('system')}
                          style={{
                            flex: 1,
                            border: 'none',
                            background: notificationTab === 'system' ? 'var(--surface-container-lowest, white)' : 'transparent',
                            color: notificationTab === 'system' ? 'var(--primary)' : 'var(--on-surface-variant)',
                            fontWeight: notificationTab === 'system' ? 700 : 500,
                            fontSize: '0.7rem',
                            padding: '6px 0',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            boxShadow: notificationTab === 'system' ? '0 1px 3px rgba(0,0,0,0.05)' : 'none',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          系统消息
                        </button>
                        <button
                          onClick={() => setNotificationTab('promotion')}
                          style={{
                            flex: 1,
                            border: 'none',
                            background: notificationTab === 'promotion' ? 'var(--surface-container-lowest, white)' : 'transparent',
                            color: notificationTab === 'promotion' ? 'var(--primary)' : 'var(--on-surface-variant)',
                            fontWeight: notificationTab === 'promotion' ? 700 : 500,
                            fontSize: '0.7rem',
                            padding: '6px 0',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            boxShadow: notificationTab === 'promotion' ? '0 1px 3px rgba(0,0,0,0.05)' : 'none',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          活动通知
                        </button>
                      </div>

                      {/* Message List */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '240px', overflowY: 'auto', paddingRight: '2px' }}>
                        {notificationTab === 'system' ? (
                          (systemMessages.length > 0 || paymentOrders.length > 0) ? (
                            <>
                              {/* Payment order history mixed into system messages */}
                              {paymentOrders.map(order => {
                                const statusLabels = { pending: '待支付', success: '已支付', failed: '支付失败', cancelled: '已取消' };
                                const statusLabel = statusLabels[order.status] || order.status;
                                const dateStr = order.created_at ? new Date(order.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
                                return (
                                  <div
                                    key={order.order_id}
                                    style={{
                                      padding: '8px 10px',
                                      background: 'var(--surface-container-low, rgba(0,0,0,0.01))',
                                      border: '1px solid var(--outline-variant, rgba(0,0,0,0.05))',
                                      borderRadius: '8px',
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: '4px'
                                    }}
                                  >
                                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--on-surface)' }}>
                                      💳 购买 {order.credits} 点额度
                                    </div>
                                    <div style={{ fontSize: '0.65rem', color: 'var(--on-surface-variant)', lineHeight: '1.4' }}>
                                      金额: ${Number(order.amount).toFixed(2)} · 状态: {statusLabel}
                                    </div>
                                    <div style={{ fontSize: '0.6rem', color: 'var(--outline)', textAlign: 'right', marginTop: '2px' }}>{dateStr}</div>
                                  </div>
                                );
                              })}
                              {systemMessages.map(msg => (
                                <div
                                  key={msg.id}
                                  style={{
                                    padding: '8px 10px',
                                    background: 'var(--surface-container-low, rgba(0,0,0,0.01))',
                                    border: '1px solid var(--outline-variant, rgba(0,0,0,0.05))',
                                    borderRadius: '8px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '4px'
                                  }}
                                >
                                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--on-surface)' }}>{msg.title}</div>
                                  <div style={{ fontSize: '0.65rem', color: 'var(--on-surface-variant)', lineHeight: '1.4', wordBreak: 'break-all' }}>{msg.desc}</div>
                                  <div style={{ fontSize: '0.6rem', color: 'var(--outline)', textAlign: 'right', marginTop: '2px' }}>{msg.time}</div>
                                </div>
                              ))}
                            </>
                          ) : (
                            <div style={{
                              padding: '24px 16px',
                              textAlign: 'center',
                              color: 'var(--on-surface-variant)',
                              fontSize: '0.7rem',
                              lineHeight: '1.5',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              gap: '6px',
                              background: 'var(--surface-container-low, rgba(0,0,0,0.01))',
                              border: '1px solid var(--outline-variant, rgba(0,0,0,0.05))',
                              borderRadius: '8px'
                            }}>
                              <span style={{ fontSize: '1.2rem' }}>📥</span>
                              <div>暂无系统消息，您的账单及充值信息将在此处展示。</div>
                            </div>
                          )
                        ) : (
                          promotionMessages.length > 0 ? (
                            promotionMessages.map(msg => (
                              <div 
                                key={msg.id} 
                                style={{
                                  padding: '8px 10px',
                                  background: 'var(--surface-container-low, rgba(0,0,0,0.01))',
                                  border: '1px solid var(--outline-variant, rgba(0,0,0,0.05))',
                                  borderRadius: '8px',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '4px'
                                }}
                              >
                                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--on-surface)' }}>{msg.title}</div>
                                <div style={{ fontSize: '0.65rem', color: 'var(--on-surface-variant)', lineHeight: '1.4', wordBreak: 'break-all' }}>{msg.desc}</div>
                                <div style={{ fontSize: '0.6rem', color: 'var(--outline)', textAlign: 'right', marginTop: '2px' }}>{msg.time}</div>
                              </div>
                            ))
                          ) : (
                            <div style={{
                              padding: '24px 16px',
                              textAlign: 'center',
                              color: 'var(--on-surface-variant)',
                              fontSize: '0.7rem',
                              lineHeight: '1.5',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              gap: '6px',
                              background: 'var(--surface-container-low, rgba(0,0,0,0.01))',
                              border: '1px solid var(--outline-variant, rgba(0,0,0,0.05))',
                              borderRadius: '8px'
                            }}>
                              <span style={{ fontSize: '1.2rem' }}>🎉</span>
                              <div>暂无活动通知，最新优惠与促销将在此处展示。</div>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <button className="command-tool-btn" title="帮助手册"><HelpCircle size={18} /></button>
              </>
            )}

            {/* User Profile Area */}
            {currentUser ? (
                <div
                  className="user-profile-wrapper"
                  onClick={(e) => { e.stopPropagation(); setShowUserDropdown(!showUserDropdown); }}
                >
                  <div className="user-profile" title="点击查看资料">
                    <div className="avatar-placeholder" style={{
                      width: '100%',
                      height: '100%',
                      backgroundColor: 'var(--brand-gradient-start)',
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '16px',
                      fontWeight: 'bold',
                      textTransform: 'uppercase'
                    }}>
                      {currentUser?.email ? currentUser.email.charAt(0) : 'U'}
                    </div>
                    {isPremium && (
                      <span className="premium-crown-badge">👑</span>
                    )}
                  </div>

                  {showUserDropdown && (
                    <div className="user-dropdown-menu glass-panel animate-fade-in" onClick={(e) => e.stopPropagation()}>
                      <div style={{ borderBottom: '1px solid var(--border-light)', paddingBottom: '8px', fontSize: '0.75rem' }}>
                        <div style={{ fontWeight: 700, color: 'var(--on-surface)', wordBreak: 'break-all' }}>{currentUser.email}</div>
                        <div style={{ color: 'var(--text-secondary)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span>账号级别:</span>
                          {isPremium ? (
                            <span style={{ color: '#d4af37', fontWeight: 'bold' }}>
                              {currentUser.membershipType === 'enterprise' ? '企业版 VIP' : '专业版 VIP'}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>免费体验账号</span>
                          )}
                        </div>
                      </div>

                      <div style={{ fontSize: '0.75rem', display: 'flex', flexDirection: 'column', gap: '6px', margin: '4px 0' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>AI 剩余额度:</span>
                          <span style={{ fontWeight: 'bold', color: '#067a53' }}>免费体验中</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>配置云端同步:</span>
                          <span style={{ color: '#067a53', fontWeight: 600 }}>自动同步中</span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid var(--border-light)', paddingTop: '8px' }}>
                        {!isPremium && (
                          <button
                            className="settings-btn save"
                            style={{ padding: '6px 0', fontSize: '0.75rem', width: '100%', fontWeight: 700, cursor: 'pointer' }}
                            onClick={(e) => { e.stopPropagation(); setShowPaymentModal(true); setShowUserDropdown(false); }}
                          >
                            9.9元开通会员
                          </button>
                        )}
                        <button
                          className="settings-btn cancel"
                          style={{ padding: '6px 0', fontSize: '0.75rem', width: '100%', border: '1px solid var(--outline-variant)', cursor: 'pointer' }}
                          onClick={(e) => { e.stopPropagation(); handleLogout(); }}
                        >
                          退出登录
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <button
                  className="topbar-login-btn"
                  style={{
                    background: 'var(--primary)',
                    color: 'white',
                    border: 'none',
                    borderRadius: 'var(--radius-default)',
                    padding: '6px 14px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'var(--transition-fast)'
                  }}
                  onClick={() => setShowAuthModal(true)}
                >
                  登录/注册
                </button>
              )}
          </div>
        </header>

        {/* Core display based on routing – wrapped in Suspense for lazy components */}
        <Suspense fallback={<LoadingSpinner />}>
          <Routes>
            <Route path="/" element={
              <Portal
                onStartOnboarding={handleStartOnboarding}
                onQuickToolClick={handleQuickToolClick}
                onDirectAgentStart={handleDirectAgentStart}
                onImageUploaded={addUploadedAsset}
                onOpenPricing={() => setShowPaymentModal(true)}
              />
            } />
            <Route path="/portal" element={
              <Portal
                onStartOnboarding={handleStartOnboarding}
                onQuickToolClick={handleQuickToolClick}
                onDirectAgentStart={handleDirectAgentStart}
                onImageUploaded={addUploadedAsset}
                onOpenPricing={() => setShowPaymentModal(true)}
              />
            } />
            <Route path="/tools" element={
              <div style={{ padding: '0 24px' }}>
                <ToolsPanel currentVersion={currentVersion} />
              </div>
            } />
            <Route path="/sessions" element={
              <div style={{ padding: '0 24px' }}>
                <SessionsPanel onOpenSession={handleOpenSession} onCreateAndOpen={handleCreateAndOpenSession} />
              </div>
            } />
            <Route path="/folders" element={
              <div style={{ padding: '0 24px' }}>
                <FoldersPanel
                  versions={versions}
                  setVersions={setVersions}
                  onSelectAsset={handleSelectAssetFromWarehouse}
                />
              </div>
            } />
            <Route path="/database" element={
              <div style={{ padding: '0 24px' }}>
                <DatabaseView />
              </div>
            } />
            <Route path="/workspace" element={
              <main className="workspace-body animate-fade-scale">
                <InfiniteCanvas
                  ref={infiniteCanvasRef}
                  theme={theme}
                  currentUser={currentUser}
                  fidelity={fidelity}
                  isGenerating={isGenerating}
                  setIsGenerating={setIsGenerating}
                  onImportImageAsset={(name, base64) => addUploadedAsset(name, base64, 'raw')}
                  autoCutout={autoCutout}
                  setAutoCutout={setAutoCutout}
                  processCutout={generateChromaKeyCutout}
                  chatMessages={chatMessages}
                  isTyping={isTyping}
                  onSendMessage={handleSendMessage}
                  chatInputValue={chatInputValue}
                  onInputValueChange={setChatInputValue}
                  onRecommendationAction={handleRecommendationAction}
                  evalModel={evalModel}
                  currentSessionId={currentSessionId}
                  saveCanvasState={saveCanvasState}
                  initialCanvasState={currentCanvasState}
                  onAttachImageToChat={handleAttachImageToChat}
                  attachedImages={attachedImages}
                  onRemoveAttachedImage={handleRemoveAttachedImage}
                />

                {currentVersion && showDashboard && (
                  <DashboardPanel
                    metrics={currentVersion.metrics}
                    previousMetrics={previousVersion?.metrics}
                    className="dashboard-card-floating"
                  />
                )}

                {showLayersPanel && (
                  <LayersOutlinePanel
                    currentVersion={currentVersion}
                    onInsertRef={handleInsertLayerRef}
                    onClose={() => setShowLayersPanel(false)}
                  />
                )}
              </main>
            } />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </div>

      {/* Onboarding Dialog Overlay modal */}
      <Suspense fallback={null}>
        {showOnboarding && (
          <Onboarding
            onSubmit={handleOnboardingSubmit}
            onClose={() => setShowOnboarding(false)}
            initialValues={onboardingInit}
          />
        )}
      </Suspense>


      {/* Export Settings Modal */}
      {showExportModal && (() => {
        const exportItems = infiniteCanvasRef.current?.getExportClustersInfo
          ? infiniteCanvasRef.current.getExportClustersInfo()
          : [{ width: 1200, height: 800 }];
        return (
          <ExportModal
            isOpen={showExportModal}
            onClose={() => setShowExportModal(false)}
            onConfirm={handleConfirmExport}
            exportFormat={exportFormat}
            onFormatChange={setExportFormat}
            exportScale={exportScale}
            onScaleChange={setExportScale}
            exportItems={exportItems}
            isExporting={isExporting}
          />
        );
      })()}

      {/* Hidden file input for quick tools */}
      <input
        type="file"
        ref={quickToolFileInputRef}
        onChange={handleQuickToolFileChange}
        accept="image/*"
        style={{ display: 'none' }}
      />

      {/* A+ / Details Page Generator Modal */}
      {showDetailGeneratorModal && (
        <div className="settings-modal-overlay" onClick={() => setShowDetailGeneratorModal(false)}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div className="settings-modal-header">
              <h3 className="settings-modal-title">
                <BookOpen size={18} style={{ color: 'var(--primary)' }} />
                <span>AI 智能 A+/详情页生成器</span>
              </h3>
              <button className="settings-close-btn" onClick={() => setShowDetailGeneratorModal(false)}>×</button>
            </div>
            <div className="settings-modal-body">
              <div>
                <label className="settings-label">商品品类 & 卖点描述</label>
                <textarea
                  className="settings-input"
                  rows={3}
                  placeholder="例如：高端户外防风服，卖点是拒水防风、超轻盈、高透气"
                  id="detail-points"
                  defaultValue=""
                />
              </div>
              <div>
                <label className="settings-label">排版设计风格</label>
                <select className="settings-select" id="detail-style">
                  <option value="french_vintage">法式浪漫复古</option>
                  <option value="outdoor_sunlight">户外晨曦自然</option>
                  <option value="urban_minimalist">都市极简科技</option>
                  <option value="minimalist_white">极简清冷白底</option>
                </select>
              </div>
              <div>
                <label className="settings-label">版面尺寸规格</label>
                <select className="settings-select" id="detail-aspect">
                  <option value="detail">2:3 详情页纵向版 (320 x 480)</option>
                  <option value="1:1">1:1 主图首图版 (380 x 380)</option>
                </select>
              </div>
            </div>
            <div className="settings-actions" style={{ marginTop: '20px' }}>
              <button className="settings-btn cancel" onClick={() => setShowDetailGeneratorModal(false)}>取消</button>
              <button 
                className="settings-btn save" 
                onClick={() => {
                  const points = document.getElementById('detail-points')?.value || '详情页';
                  const styleVal = document.getElementById('detail-style')?.value || 'french_vintage';
                  const aspectVal = document.getElementById('detail-aspect')?.value || 'detail';
                  setShowDetailGeneratorModal(false);
                  handleGenerateDetailPage(points, styleVal, aspectVal);
                }}
              >
                立即智能排版生成
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Video Generator Modal */}
      {showVideoGeneratorModal && (
        <div className="settings-modal-overlay" onClick={() => setShowVideoGeneratorModal(false)}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div className="settings-modal-header">
              <h3 className="settings-modal-title">
                <Video size={18} style={{ color: 'var(--primary)' }} />
                <span>AI 爆款视频生成器 (三维运镜)</span>
              </h3>
              <button className="settings-close-btn" onClick={() => setShowVideoGeneratorModal(false)}>×</button>
            </div>
            <div className="settings-modal-body">
              <div>
                <label className="settings-label">上传或选择参考商品图</label>
                <div 
                  onClick={() => {
                    const inp = document.createElement('input');
                    inp.type = 'file';
                    inp.accept = 'image/*';
                    inp.onchange = (e) => {
                      const file = e.target.files[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (re) => {
                          setVideoUploadBase64(re.target.result);
                          setVideoPlayerSrcFilename(file.name);
                        };
                        reader.readAsDataURL(file);
                      }
                    };
                    inp.click();
                  }}
                  style={{ 
                    border: '1px dashed var(--outline-variant)', 
                    borderRadius: '12px', 
                    padding: '24px', 
                    textAlign: 'center', 
                    cursor: 'pointer',
                    background: 'var(--surface-container-low)',
                    transition: 'all 0.2s',
                    color: 'var(--on-surface)'
                  }}
                >
                  {videoUploadBase64 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                      <img src={videoUploadBase64} style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '6px', border: '1px solid var(--border-glass)' }} alt="preview" />
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>点击更换参考图片</span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                      <ImageIcon size={24} style={{ color: 'var(--outline)', opacity: 0.6 }} />
                      <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>点击上传商品主体实拍图</span>
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>模型将对该图进行三维运镜插帧生成视频</span>
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="settings-label">动感运动运镜描述</label>
                <input 
                  type="text" 
                  className="settings-input" 
                  placeholder="例如：3D慢动作推轨、环绕环切、镜头拉近" 
                  id="video-motion-desc"
                  defaultValue=""
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--outline-variant)', background: 'var(--surface-container-low)', color: 'var(--on-surface)' }}
                />
              </div>
              <div>
                <label className="settings-label">背景环境描述</label>
                <input 
                  type="text" 
                  className="settings-input" 
                  placeholder="例如：日落沙滩、赛博朋克都市、清冷冰川" 
                  id="video-bg-desc"
                  defaultValue=""
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--outline-variant)', background: 'var(--surface-container-low)', color: 'var(--on-surface)' }}
                />
              </div>
            </div>
            <div className="settings-actions" style={{ marginTop: '20px' }}>
              <button className="settings-btn cancel" onClick={() => setShowVideoGeneratorModal(false)}>取消</button>
              <button 
                className="settings-btn save" 
                onClick={() => {
                  const motion = document.getElementById('video-motion-desc')?.value || '运镜';
                  const bg = document.getElementById('video-bg-desc')?.value || '背景';
                  const img = videoUploadBase64;
                  if (!img) return;
                  setShowVideoGeneratorModal(false);
                  handleRenderVideo(img, motion, bg);
                }}
              >
                开始合成爆款视频
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global AI Progress Rendering Overlay */}
      {globalProgressOpen && (
        <div className="settings-modal-overlay" style={{ zIndex: 9999 }}>
          <div className="settings-modal" style={{ maxWidth: '380px', padding: '30px 24px', textAlign: 'center' }}>
            <div style={{ marginBottom: '16px' }}>
              <Loader2 size={36} className="animate-spin" style={{ color: 'var(--primary)', margin: '0 auto' }} />
            </div>
            <h4 style={{ margin: '0 0 8px 0', fontSize: '0.95rem', fontWeight: 700, color: 'var(--on-surface)' }}>
              {globalProgressTitle}
            </h4>
            <div style={{ width: '100%', height: '6px', background: 'var(--surface-container-high)', borderRadius: '3px', overflow: 'hidden', marginTop: '16px', marginBottom: '8px' }}>
              <div style={{ width: `${globalProgressVal}%`, height: '100%', background: 'var(--primary)', transition: 'width 0.2s ease-in-out' }} />
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              {globalProgressStatus} ({globalProgressVal}%)
            </span>
          </div>
        </div>
      )}

      {/* Set Generator Modal (商品套图) */}
      {showSetGeneratorModal && (
        <div className="settings-modal-overlay" onClick={() => setShowSetGeneratorModal(false)}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div className="settings-modal-header">
              <h3 className="settings-modal-title">
                <ShoppingBag size={18} style={{ color: 'var(--primary)' }} />
                <span>AI 商品多比例套图生成器</span>
              </h3>
              <button className="settings-close-btn" onClick={() => setShowSetGeneratorModal(false)}>×</button>
            </div>
            <div className="settings-modal-body">
              <div>
                <label className="settings-label">上传您的商品图 (作为主体)</label>
                <div 
                  onClick={() => {
                    const inp = document.createElement('input');
                    inp.type = 'file';
                    inp.accept = 'image/*';
                    inp.onchange = (e) => {
                      const file = e.target.files[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (re) => {
                          setSetUploadBase64(re.target.result);
                        };
                        reader.readAsDataURL(file);
                      }
                    };
                    inp.click();
                  }}
                  style={{ 
                    border: '1px dashed var(--outline-variant)', 
                    borderRadius: '12px', 
                    padding: '20px', 
                    textAlign: 'center', 
                    cursor: 'pointer',
                    background: 'var(--surface-container-low)',
                    color: 'var(--on-surface)'
                  }}
                >
                  {setUploadBase64 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                      <img src={setUploadBase64} style={{ width: '85px', height: '85px', objectFit: 'cover', borderRadius: '6px', border: '1px solid var(--border-glass)' }} alt="preview" />
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>点击更换商品主体图</span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                      <ImageIcon size={22} style={{ color: 'var(--outline)', opacity: 0.6 }} />
                      <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>点击上传商品实拍图</span>
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>模型将对该商品进行抠图并批量排版套图</span>
                    </div>
                  )}
                </div>
              </div>
              
              <div>
                <label className="settings-label">选择套图背景模板风格</label>
                <select 
                  className="settings-select" 
                  value={chosenSetStyle}
                  onChange={(e) => setChosenSetStyle(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--outline-variant)', background: 'var(--surface-container-low)', color: 'var(--on-surface)' }}
                >
                  <option value="french_vintage">法式浪漫复古 (优雅逆光)</option>
                  <option value="outdoor_sunlight">户外晨曦自然 (夏日沙滩)</option>
                  <option value="urban_minimalist">都市极简科技 (白领商务)</option>
                  <option value="minimalist_white">极简清冷白底 (多平台通用)</option>
                </select>
              </div>

              <div>
                <label className="settings-label" style={{ marginBottom: '6px', display: 'block' }}>选择生成的尺寸比例 (支持多选)</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  {[
                    { id: '1:1', name: '天猫/淘宝主图 (380x380)' },
                    { id: '9:16', name: '抖音/小红书封面 (320x568)' },
                    { id: '16:9', name: '京东宽幅 Banner (600x337)' },
                    { id: '3:4', name: '拼多多主图 (360x480)' }
                  ].map((size) => (
                    <label key={size.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', color: 'var(--on-surface)', cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        checked={selectedSetSizes.includes(size.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedSetSizes([...selectedSetSizes, size.id]);
                          } else {
                            setSelectedSetSizes(selectedSetSizes.filter(s => s !== size.id));
                          }
                        }}
                        style={{ accentColor: 'var(--primary)' }}
                      />
                      <span>{size.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="settings-actions" style={{ marginTop: '20px' }}>
              <button className="settings-btn cancel" onClick={() => setShowSetGeneratorModal(false)}>取消</button>
              <button 
                className="settings-btn save" 
                onClick={() => {
                  setShowSetGeneratorModal(false);
                  handleGenerateSet(setUploadBase64, chosenSetStyle, selectedSetSizes);
                }}
              >
                立即生成多尺寸套图
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Copy Generator Modal (爆款风格复刻) */}
      {showCopyGeneratorModal && (
        <div className="settings-modal-overlay" onClick={() => setShowCopyGeneratorModal(false)}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div className="settings-modal-header">
              <h3 className="settings-modal-title">
                <Layers size={18} style={{ color: 'var(--primary)' }} />
                <span>AI 爆款图视觉风格复刻器</span>
              </h3>
              <button className="settings-close-btn" onClick={() => setShowCopyGeneratorModal(false)}>×</button>
            </div>
            <div className="settings-modal-body">
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label className="settings-label">1. 上传爆款参考图</label>
                  <div 
                    onClick={() => {
                      const inp = document.createElement('input');
                      inp.type = 'file';
                      inp.accept = 'image/*';
                      inp.onchange = (e) => {
                        const file = e.target.files[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (re) => {
                            setCopyUploadBase64(re.target.result);
                          };
                          reader.readAsDataURL(file);
                        }
                      };
                      inp.click();
                    }}
                    style={{ 
                      border: '1px dashed var(--outline-variant)', 
                      borderRadius: '12px', 
                      padding: '16px', 
                      textAlign: 'center', 
                      cursor: 'pointer',
                      background: 'var(--surface-container-low)',
                      color: 'var(--on-surface)',
                      height: '110px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    {copyUploadBase64 ? (
                      <img src={copyUploadBase64} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '6px' }} alt="preview" />
                    ) : (
                      <div style={{ fontSize: '0.65rem' }}>
                        📸 点击上传<br/>爆款样板参考图
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="settings-label">2. 上传我的商品图</label>
                  <div 
                    onClick={() => {
                      const inp = document.createElement('input');
                      inp.type = 'file';
                      inp.accept = 'image/*';
                      inp.onchange = (e) => {
                        const file = e.target.files[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (re) => {
                            setCopyProductBase64(re.target.result);
                          };
                          reader.readAsDataURL(file);
                        }
                      };
                      inp.click();
                    }}
                    style={{ 
                      border: '1px dashed var(--outline-variant)', 
                      borderRadius: '12px', 
                      padding: '16px', 
                      textAlign: 'center', 
                      cursor: 'pointer',
                      background: 'var(--surface-container-low)',
                      color: 'var(--on-surface)',
                      height: '110px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    {copyProductBase64 ? (
                      <img src={copyProductBase64} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '6px' }} alt="preview" />
                    ) : (
                      <div style={{ fontSize: '0.65rem' }}>
                        👕 点击上传<br/>我的商品实物图
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <label className="settings-label">复刻微调描述 (Style Prompt)</label>
                <input 
                  type="text" 
                  className="settings-input" 
                  value={copyStylePrompt}
                  onChange={(e) => setCopyStylePrompt(e.target.value)}
                  placeholder="例如：复刻此爆款图的干练职业通勤背景与柔和光影效果"
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--outline-variant)', background: 'var(--surface-container-low)', color: 'var(--on-surface)' }}
                />
              </div>
            </div>
            
            <div className="settings-actions" style={{ marginTop: '20px' }}>
              <button className="settings-btn cancel" onClick={() => setShowCopyGeneratorModal(false)}>取消</button>
              <button 
                className="settings-btn save" 
                onClick={() => {
                  setShowCopyGeneratorModal(false);
                  handleGenerateCopy(copyUploadBase64, copyProductBase64, copyStylePrompt);
                }}
              >
                开始智能分析复刻
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Product Image Modal (AI创意主图) */}
      {showAiImgGeneratorModal && (
        <div className="settings-modal-overlay" onClick={() => setShowAiImgGeneratorModal(false)}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div className="settings-modal-header">
              <h3 className="settings-modal-title">
                <ImageIcon size={18} style={{ color: 'var(--primary)' }} />
                <span>AI 创意商品主图生成器</span>
              </h3>
              <button className="settings-close-btn" onClick={() => setShowAiImgGeneratorModal(false)}>×</button>
            </div>
            <div className="settings-modal-body">
              <div>
                <label className="settings-label">上传商品实物图</label>
                <div 
                  onClick={() => {
                    const inp = document.createElement('input');
                    inp.type = 'file';
                    inp.accept = 'image/*';
                    inp.onchange = (e) => {
                      const file = e.target.files[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (re) => {
                          setAiImgUploadBase64(re.target.result);
                        };
                        reader.readAsDataURL(file);
                      }
                    };
                    inp.click();
                  }}
                  style={{ 
                    border: '1px dashed var(--outline-variant)', 
                    borderRadius: '12px', 
                    padding: '20px', 
                    textAlign: 'center', 
                    cursor: 'pointer',
                    background: 'var(--surface-container-low)',
                    color: 'var(--on-surface)'
                  }}
                >
                  {aiImgUploadBase64 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                      <img src={aiImgUploadBase64} style={{ width: '85px', height: '85px', objectFit: 'cover', borderRadius: '6px', border: '1px solid var(--border-glass)' }} alt="preview" />
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>点击更换商品实物图</span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                      <Plus size={20} style={{ color: 'var(--outline)', opacity: 0.6 }} />
                      <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>点击上传商品实物图</span>
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>AI 算法会自动在云端或本地完成无缝融合</span>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="settings-label">大师创意场景风格</label>
                <select 
                  className="settings-select" 
                  value={aiImgStyle}
                  onChange={(e) => setAiImgStyle(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--outline-variant)', background: 'var(--surface-container-low)', color: 'var(--on-surface)' }}
                >
                  <option value="french_vintage">优雅花园 - 法式浪漫复古</option>
                  <option value="outdoor_sunlight">海滩假日 - 户外日光松弛</option>
                  <option value="urban_minimalist">都市极简 - 干练西装白领</option>
                  <option value="minimalist_white">极简清冷 - 经典白底平铺</option>
                </select>
              </div>

              <div>
                <label className="settings-label">画面细节或背景提示描述</label>
                <input 
                  type="text" 
                  className="settings-input" 
                  value={aiImgPrompt}
                  onChange={(e) => setAiImgPrompt(e.target.value)}
                  placeholder="例如：高端法式羊毛衫，柔光逆光，精细背景"
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--outline-variant)', background: 'var(--surface-container-low)', color: 'var(--on-surface)' }}
                />
              </div>
            </div>

            <div className="settings-actions" style={{ marginTop: '20px' }}>
              <button className="settings-btn cancel" onClick={() => setShowAiImgGeneratorModal(false)}>取消</button>
              <button 
                className="settings-btn save" 
                onClick={() => {
                  setShowAiImgGeneratorModal(false);
                  handleGenerateAiImg(aiImgUploadBase64, aiImgStyle, aiImgPrompt);
                }}
              >
                生成 AI 创意主图
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Video Player Modal */}
      {showVideoPlayerModal && (
        <div className="settings-modal-overlay" onClick={() => setShowVideoPlayerModal(false)}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '520px', background: '#0e111a', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="settings-modal-header" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <h3 className="settings-modal-title" style={{ color: 'white' }}>
                <Video size={18} style={{ color: '#ff6b35' }} />
                <span>AI 爆款视频合成预览 (Video Player)</span>
              </h3>
              <button className="settings-close-btn" style={{ padding: '4px', height: 'auto', width: 'auto', border: 'none', background: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'white' }} onClick={() => setShowVideoPlayerModal(false)}>&times;</button>
            </div>
            
            <div className="settings-modal-body" style={{ padding: '20px 0 0 0', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ 
                position: 'relative', 
                width: '100%', 
                aspectRatio: '16/9', 
                background: '#02040a', 
                borderRadius: '8px', 
                overflow: 'hidden',
                border: '1px solid rgba(255,255,255,0.04)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
              }}>
                <div style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'radial-gradient(circle, #1a2238 0%, #080c14 100%)',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    width: '320px',
                    height: '100%',
                    position: 'relative',
                    backgroundImage: `url(${videoPlayerSrc})`,
                    backgroundSize: 'contain',
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'center',
                    transformOrigin: 'center center',
                    animation: 'videoPanZoom 8s infinite ease-in-out'
                  }}>
                    <div style={{
                      position: 'absolute',
                      top: 0, left: 0, right: 0, bottom: 0,
                      background: 'linear-gradient(45deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0) 50%, rgba(255,255,255,0.05) 100%)',
                      mixBlendMode: 'overlay',
                      pointerEvents: 'none'
                    }} />
                  </div>
                </div>
                
                <div style={{
                  position: 'absolute',
                  bottom: 0, left: 0, right: 0,
                  background: 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0) 100%)',
                  padding: '16px 12px 10px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.2)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{
                      width: '65%',
                      height: '100%',
                      background: '#ff6b35',
                      borderRadius: '2px',
                      animation: 'progressBarPlay 8s infinite linear'
                    }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.65rem', color: '#8892b0' }}>
                    <span>0:04 / 0:08</span>
                    <span>1080P | H.264</span>
                  </div>
                </div>
              </div>
              
              <div style={{ width: '100%', padding: '16px 20px', boxSizing: 'border-box' }}>
                <div style={{ fontSize: '0.75rem', color: '#e2e8f0', marginBottom: '8px', lineHeight: '1.4' }}>
                  🎥 <strong>视频主题</strong>：{videoPlayerBg}<br/>
                  🎬 <strong>镜头特征</strong>：{videoPlayerMotion}
                </div>
                <div style={{ fontSize: '0.65rem', color: '#64748b' }}>
                  提示：此视频由 Stable Video Diffusion AI 引擎自动扩展生成，已生成 3D 流光溢彩动感物理环境。
                </div>
              </div>
            </div>
            
            <div className="settings-actions" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '16px 20px', marginTop: '0' }}>
              <button className="settings-btn cancel" style={{ borderColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)', background: 'transparent' }} onClick={() => setShowVideoPlayerModal(false)}>关闭</button>
              <button 
                className="settings-btn save" 
                style={{ background: '#ff6b35', border: 'none', color: 'white', cursor: 'pointer' }}
                onClick={() => {
                  showSuccess('高清 MP4 视频正在打包下载中...');
                  setShowVideoPlayerModal(false);
                }}
              >
                下载 MP4 视频
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auth Modal Overlay */}
      <Suspense fallback={null}>
        {showAuthModal && (
          <AuthModal
            onClose={() => setShowAuthModal(false)}
            onLoginSuccess={handleLoginSuccess}
            initialTab={authModalTab}
          />
        )}
      </Suspense>

      {/* Payment Modal Overlay */}
      <Suspense fallback={null}>
        {showPaymentModal && (
          <PaymentModal
            onClose={() => setShowPaymentModal(false)}
            onPaymentSuccess={handlePaymentSuccess}
            currentUser={currentUser}
          />
        )}
      </Suspense>

      {/* Mode Select Modal Overlay */}
      <Suspense fallback={null}>
        {showModeSelect && (
          <ModeSelectModal
            onSelectMode={handleSelectMode}
            onClose={() => setShowModeSelect(false)}
          />
        )}
      </Suspense>

      {/* Error / Success Toast */}
      {errorToast && (
        <div className="error-toast" style={{
          background: errorToast.type === 'success' ? 'rgba(209, 250, 229, 0.95)' : 'var(--error-container)',
          color: errorToast.type === 'success' ? '#065f46' : 'var(--on-error-container)',
          borderColor: errorToast.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(186, 26, 26, 0.15)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {errorToast.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
            <span>{errorToast.message}</span>
          </div>
        </div>
      )}
    </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Floating Layers Outline Drawer Component (preserved from original)
// ---------------------------------------------------------------------------
function LayersPanel({ currentVersion, onInsertRef, onClose }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  if (!currentVersion) return null;

  const layers = [
    {
      id: 'bg',
      name: '背景图层',
      desc: currentVersion.image ? currentVersion.image.replace('bg_', '').replace('.png', '') : '自然风格场景',
      icon: ImageIcon,
      displayName: '背景图层'
    },
    ...(currentVersion.productCutout || currentVersion.productImage ? [
      {
        id: 'product',
        name: '商品主体图层',
        desc: '抠图融合主体',
        icon: Box,
        displayName: '商品主体图层'
      }
    ] : []),
    ...(currentVersion.adText?.title ? [
      {
        id: 'title',
        name: '主标题文本图层',
        desc: currentVersion.adText.title,
        icon: Type,
        displayName: '主标题文本图层'
      }
    ] : []),
    ...(currentVersion.adText?.desc ? [
      {
        id: 'desc',
        name: '副标题文本图层',
        desc: currentVersion.adText.desc,
        icon: Type,
        displayName: '副标题文本图层'
      }
    ] : []),
    ...(currentVersion.adText?.tag ? [
      {
        id: 'tag',
        name: '促销标签图层',
        desc: currentVersion.adText.tag,
        icon: Tag,
        displayName: '促销标签图层'
      }
    ] : []),
  ];

  return (
    <div className={`layers-outline-floating-panel glass-pane animate-slide-left ${isCollapsed ? 'collapsed' : ''}`} onClick={(e) => e.stopPropagation()}>
      <div
        className="layers-panel-header"
        onClick={() => setIsCollapsed(!isCollapsed)}
        style={{ cursor: 'pointer', userSelect: 'none' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '0.85rem' }}>
          <Layers size={14} style={{ color: 'var(--primary)' }} />
          <span>{isCollapsed ? '图层' : '图层大纲'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            className="layers-panel-collapse-btn"
            onClick={(e) => {
              e.stopPropagation();
              setIsCollapsed(!isCollapsed);
            }}
            title={isCollapsed ? "展开" : "折叠"}
          >
            {isCollapsed ? <ChevronDown size={12} /> : <Minus size={12} />}
          </button>
          <button
            className="layers-panel-close-btn"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            title="关闭大纲"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="layers-panel-body">
          {layers.map(layer => {
            const Icon = layer.icon;
            return (
              <div key={layer.id} className="layer-outline-item">
                <div className="layer-item-info">
                  <div className="layer-icon-wrapper">
                    <Icon size={12} />
                  </div>
                  <div className="layer-text-meta">
                    <div className="layer-title-name">{layer.name}</div>
                    <div className="layer-subtitle-desc" title={layer.desc}>
                      {layer.desc.length > 20 ? layer.desc.substring(0, 18) + '...' : layer.desc}
                    </div>
                  </div>
                </div>

                <button
                  className="btn-layer-insert-chat"
                  onClick={() => onInsertRef(layer.displayName)}
                  title={`引用此图层到对话输入框中`}
                >
                  <MessageSquare size={11} />
                  <span>引用修改</span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
