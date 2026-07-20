import { useState, useEffect } from 'react';
import { Mail, Lock, ShieldCheck, UserPlus, LogIn, ArrowRight, CheckCircle, AlertCircle, KeyRound } from 'lucide-react';
import CloseButton from './CloseButton';
import { useAuth } from '../context/AuthContext';
import { AnimatePresence, motion } from 'motion/react';

export default function AuthModal({ onClose, onLoginSuccess, initialTab = 'login' }) {
  const { login, register, forgotPassword, resetPassword, sendVerificationCode } = useAuth();
  const [activeTab, setActiveTab] = useState(initialTab); // 'login' | 'register' | 'forgot'

  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  // Verification code states
  const [countdown, setCountdown] = useState(0);
  const [codeSentMessage, setCodeSentMessage] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const requestClose = () => setIsVisible(false);

  // Handle countdown timer
  useEffect(() => {
    let timer;
    if (countdown > 0) {
      timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [countdown]);

  // Reset form when switching tabs
  const switchTab = (tab) => {
    setActiveTab(tab);
    setErrorMsg('');
    setSuccessMsg('');
    setCodeSentMessage('');
    setCode('');
    setPassword('');
    setCountdown(0);
  };

  // Send verification code for registration
  const handleSendRegisterCode = async (e) => {
    e.preventDefault();
    if (!email || !email.includes('@')) { setErrorMsg('请输入有效的邮箱地址！'); return; }
    if (!password || password.length < 6) { setErrorMsg('请先输入有效的账号密码（最少 6 位）再获取验证码！'); return; }

    setErrorMsg('');
    setCodeSentMessage('');
    setIsLoading(true);

    try {
      await sendVerificationCode(email, password, name || email.split('@')[0]);
      setCountdown(60);
      setCodeSentMessage('验证码已发送到您的邮箱，请查收！');
    } catch (err) {
      setErrorMsg(`发送验证码失败: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Send verification code for forgot password
  const handleSendForgotCode = async (e) => {
    e.preventDefault();
    if (!email || !email.includes('@')) { setErrorMsg('请输入有效的邮箱地址！'); return; }

    setErrorMsg('');
    setCodeSentMessage('');
    setIsLoading(true);

    try {
      await forgotPassword(email);
      setCountdown(60);
      setCodeSentMessage('验证码已发送到您的邮箱，请查收！');
    } catch (err) {
      setErrorMsg(`发送验证码失败: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setErrorMsg(''); setSuccessMsg('');

    if (!email || !email.includes('@')) { setErrorMsg('请输入有效的邮箱地址！'); return; }
    if (!password || password.length < 6) { setErrorMsg('密码长度不能少于 6 位！'); return; }
    if (!code || code.length < 4) { setErrorMsg('请先获取并输入验证码！'); return; }

    setIsLoading(true);
    try {
      await register(email, password, name || email.split('@')[0], code);
      setSuccessMsg('注册成功！正在自动登录...');
      setTimeout(() => { onLoginSuccess?.(); requestClose(); }, 1500);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setErrorMsg(''); setSuccessMsg('');

    if (!email || !email.includes('@')) { setErrorMsg('请输入有效的邮箱地址！'); return; }
    if (!password) { setErrorMsg('请输入密码！'); return; }

    setIsLoading(true);
    try {
      await login(email, password);
      setSuccessMsg('登录成功！');
      setTimeout(() => { onLoginSuccess?.(); requestClose(); }, 1500);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setErrorMsg(''); setSuccessMsg('');

    if (!email || !email.includes('@')) { setErrorMsg('请输入有效的邮箱地址！'); return; }
    if (!code) { setErrorMsg('请输入验证码！'); return; }
    if (!password || password.length < 6) { setErrorMsg('新密码长度不能少于 6 位！'); return; }

    setIsLoading(true);
    try {
      await resetPassword(email, code, password);
      setSuccessMsg('密码重置成功！请使用新密码登录');
      setTimeout(() => switchTab('login'), 2000);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const titleMap = { login: '欢迎回来', register: '注册新账号', forgot: '找回密码' };
  const descMap = {
    login: '登录以云端同步您的 API 密钥及设计资产',
    register: '只需一个邮箱，立即开启 AI 设计体验',
    forgot: '输入注册邮箱，我们将发送验证码帮您重置密码'
  };

  const isForgot = activeTab === 'forgot';

  return (
    <AnimatePresence onExitComplete={onClose}>
    {isVisible && <motion.div className="onboarding-modal-overlay" onClick={requestClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
      <motion.div className="onboarding-modal-content" onClick={(e) => e.stopPropagation()} initial={{ opacity: 0, y: 8, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 5, scale: 0.99 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} style={{ maxWidth: '420px', padding: '28px' }}>
        <CloseButton onClick={requestClose} />

        <div style={{ textAlign: 'center', marginBottom: '8px' }}>
          <h2 className="headline-lg" style={{ fontSize: '1.4rem', fontWeight: 700, fontFamily: 'var(--font-display)' }}>
            {titleMap[activeTab]}
          </h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--on-surface-variant)', marginTop: '4px' }}>
            {descMap[activeTab]}
          </p>
        </div>

        {/* Tab triggers */}
        <div style={{ display: 'flex', background: 'rgba(0,0,0,0.04)', borderRadius: '8px', padding: '3px', border: '1px solid rgba(0,0,0,0.06)' }}>
          <button
            className="settings-btn"
            style={{
              flex: 1,
              background: activeTab === 'login' ? 'white' : 'transparent',
              color: activeTab === 'login' ? 'var(--primary)' : 'var(--on-surface-variant)',
              border: 'none',
              boxShadow: activeTab === 'login' ? '0 2px 8px rgba(0,0,0,0.05)' : 'none',
              fontSize: '0.8rem', padding: '6px 0',
              fontWeight: activeTab === 'login' ? 700 : 500,
              borderRadius: '6px'
            }}
            onClick={() => switchTab('login')}
          >
            <LogIn size={13} style={{ marginRight: '6px', display: 'inline-block', verticalAlign: 'middle' }} />
            <span>账号登录</span>
          </button>
          <button
            className="settings-btn"
            style={{
              flex: 1,
              background: activeTab === 'register' ? 'white' : 'transparent',
              color: activeTab === 'register' ? 'var(--primary)' : 'var(--on-surface-variant)',
              border: 'none',
              boxShadow: activeTab === 'register' ? '0 2px 8px rgba(0,0,0,0.05)' : 'none',
              fontSize: '0.8rem', padding: '6px 0',
              fontWeight: activeTab === 'register' ? 700 : 500,
              borderRadius: '6px'
            }}
            onClick={() => switchTab('register')}
          >
            <UserPlus size={13} style={{ marginRight: '6px', display: 'inline-block', verticalAlign: 'middle' }} />
            <span>免费注册</span>
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={isForgot ? handleResetPassword : (activeTab === 'login' ? handleLogin : handleRegister)} style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '8px' }}>

          {/* Name field (for register) */}
          {activeTab === 'register' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label className="settings-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Mail size={12} />
                <span>显示名称</span>
              </label>
              <input
                type="text"
                className="settings-input"
                placeholder="您的昵称（选填）"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isLoading}
              />
            </div>
          )}

          {/* Email field */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label className="settings-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Mail size={12} />
              <span>注册邮箱</span>
            </label>
            <input
              type="email"
              className="settings-input"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isLoading}
            />
          </div>

          {/* Password field (not shown in forgot tab) */}
          {!isForgot && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label className="settings-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Lock size={12} />
                <span>账号密码</span>
              </label>
              <input
                type="password"
                className="settings-input"
                placeholder="输入 6 位及以上密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>
          )}

          {/* Verification Code field (Register) */}
          {activeTab === 'register' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label className="settings-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <ShieldCheck size={12} />
                <span>邮箱验证码</span>
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text" className="settings-input"
                  style={{ width: '60%' }}
                  placeholder="6位验证码"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  maxLength={6}
                  disabled={isLoading}
                />
                <button
                  type="button" className="settings-btn"
                  onClick={handleSendRegisterCode}
                  disabled={countdown > 0 || isLoading}
                  style={{
                    width: '40%', padding: '8px 0', fontSize: '0.75rem',
                    background: countdown > 0 ? 'rgba(0,0,0,0.05)' : 'var(--primary)',
                    color: countdown > 0 ? 'var(--text-secondary)' : 'white',
                    border: countdown > 0 ? '1px solid var(--outline-variant)' : 'none',
                    fontWeight: 600
                  }}
                >
                  {countdown > 0 ? `${countdown}s 后重新发送` : '获取验证码'}
                </button>
              </div>
            </div>
          )}

          {/* Forgot Password Flow: Verification Code + New Password */}
          {isForgot && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label className="settings-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <ShieldCheck size={12} />
                  <span>邮箱验证码</span>
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text" className="settings-input"
                    style={{ width: '60%' }}
                    placeholder="6位验证码"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    maxLength={6}
                    required
                    disabled={isLoading}
                  />
                  <button
                    type="button" className="settings-btn"
                    onClick={handleSendForgotCode}
                    disabled={countdown > 0 || isLoading}
                    style={{
                      width: '40%', padding: '8px 0', fontSize: '0.75rem',
                      background: countdown > 0 ? 'rgba(0,0,0,0.05)' : 'var(--primary)',
                      color: countdown > 0 ? 'var(--text-secondary)' : 'white',
                      border: countdown > 0 ? '1px solid var(--outline-variant)' : 'none',
                      fontWeight: 600
                    }}
                  >
                    {countdown > 0 ? `${countdown}s 后重新发送` : '获取验证码'}
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label className="settings-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <KeyRound size={12} />
                  <span>设置新密码</span>
                </label>
                <input
                  type="password"
                  className="settings-input"
                  placeholder="输入 6 位及以上新密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={isLoading}
                />
              </div>
            </>
          )}

          {/* Messages */}
          {errorMsg && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', background: 'var(--error-container)', color: 'var(--on-error-container)', borderRadius: '8px', fontSize: '0.75rem', border: '1px solid rgba(186, 26, 26, 0.12)' }}>
              <AlertCircle size={14} style={{ flexShrink: 0 }} />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', background: 'rgba(209, 250, 229, 0.95)', color: '#065f46', borderRadius: '8px', fontSize: '0.75rem', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
              <CheckCircle size={14} style={{ flexShrink: 0 }} />
              <span>{successMsg}</span>
            </div>
          )}

          {codeSentMessage && (activeTab === 'register' || isForgot) && !successMsg && !errorMsg && (
            <div style={{ padding: '8px 10px', background: 'rgba(0, 88, 188, 0.05)', color: 'var(--primary)', borderRadius: '8px', fontSize: '0.7rem', border: '1px solid rgba(0, 88, 188, 0.15)', fontWeight: 500, lineHeight: 1.4 }}>
              {codeSentMessage}
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            className="settings-btn save"
            disabled={isLoading}
            style={{
              width: '100%', padding: '12px 0', fontSize: '0.85rem', fontWeight: 700,
              display: 'flex', justifyContent: 'center', alignItems: 'center',
              gap: '6px', marginTop: '4px', opacity: isLoading ? 0.7 : 1
            }}
          >
            <span>
              {isLoading ? '请稍候...' :
               isForgot ? '重置密码' :
               activeTab === 'login' ? '立即登录' : '同意服务条款并注册'}
            </span>
            <ArrowRight size={14} />
          </button>

          {/* Bottom links */}
          <div style={{ textAlign: 'center', marginTop: '6px', display: 'flex', justifyContent: 'center', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
            {activeTab === 'login' && (
              <>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>还没有账号？</span>
                <button type="button" style={{ background: 'none', border: 'none', color: 'var(--primary)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', padding: 0 }} onClick={() => switchTab('register')} disabled={isLoading}>免费注册</button>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>·</span>
                <button type="button" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 500, cursor: 'pointer', textDecoration: 'underline', padding: 0 }} onClick={() => switchTab('forgot')} disabled={isLoading}>忘记密码？</button>
              </>
            )}
            {(activeTab === 'register' || isForgot) && (
              <>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  {isForgot ? '想起密码了？' : '已经有账号了？'}
                </span>
                <button type="button" style={{ background: 'none', border: 'none', color: 'var(--primary)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', padding: 0 }} onClick={() => switchTab('login')} disabled={isLoading}>返回登录</button>
              </>
            )}
          </div>
        </form>
      </motion.div>
    </motion.div>}
    </AnimatePresence>
  );
}
