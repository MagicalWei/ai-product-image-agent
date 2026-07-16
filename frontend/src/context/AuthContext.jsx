// src/context/AuthContext.jsx
// Better Auth — cookie-based session management replaces manual JWT tokens.
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { createAuthClient } from 'better-auth/react';

const AuthContext = createContext(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

const DEFAULT_AUTH_BASE = typeof window !== 'undefined'
  ? `${window.location.origin}/api/auth`
  : '/api/auth';

const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_BETTER_AUTH_URL || DEFAULT_AUTH_BASE,
});

const { useSession, signIn, signUp, signOut } = authClient;

const AUTH_BASE = import.meta.env.VITE_BETTER_AUTH_URL || DEFAULT_AUTH_BASE;

export const AuthProvider = ({ children }) => {
  const { data: session, isPending, refetch } = useSession();
  const [currentUser, setCurrentUser] = useState(null);

  // When Better Auth session changes, map to our legacy currentUser shape
  useEffect(() => {
    if (session?.user) {
      const user = session.user;
      const mappedUser = {
        ...user,
        uid: user.id, // Better Auth uses 'id', we use 'uid'
        remainingCredits: user.remainingCredits ?? 10,
        membershipType: user.membershipType || user.membership_type || 'free',
      };
      setCurrentUser(mappedUser);
      localStorage.setItem('design_studio_current_user', JSON.stringify(mappedUser));
    } else if (!isPending) {
      // Once the server confirms there is no valid cookie session, never
      // restore a stale local profile. Doing so leaves the UI looking logged
      // in while every protected request returns 401.
      setCurrentUser(null);
      localStorage.removeItem('design_studio_current_user');
    }
  }, [session, isPending]);

  const login = async (email, password) => {
    const credentials = { email: email.trim().toLowerCase(), password };
    let result;
    try {
      result = await signIn.email(credentials);
      const status = Number(result?.error?.status || result?.error?.statusCode || 0);
      if (result?.error && status >= 500) {
        await new Promise(resolve => setTimeout(resolve, 300));
        result = await signIn.email(credentials);
      }
    } catch (error) {
      // One short retry handles a backend restart or a transient network drop.
      await new Promise(resolve => setTimeout(resolve, 300));
      try {
        result = await signIn.email(credentials);
      } catch {
        throw new Error('登录服务暂时不可用，请稍后重试');
      }
    }
    if (result.error) {
      throw new Error(result.error.message || '登录失败');
    }
    // Explicitly refetch session to ensure cookie is processed and state is synced
    await refetch();
    return result;
  };

  const register = async (email, password, name, code) => {
    // Step 1: Verify the 6-digit code via our custom endpoint
    const verifyRes = await fetch(`${AUTH_BASE}/../custom-auth/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    });
    const verifyData = await verifyRes.json();
    if (!verifyRes.ok || !verifyData.success) {
      throw new Error(verifyData.message || '验证码无效或已过期');
    }

    // Step 2: Auto-login after successful verification
    const result = await signIn.email({ email, password });
    if (result.error) {
      throw new Error(result.error.message || '登录失败');
    }
    await refetch();
    return result;
  };

  const logout = useCallback(async () => {
    try {
      await signOut();
    } catch (err) {
      console.warn('Better Auth signOut failed:', err);
    }
    // Explicitly refetch to ensure useSession is synced with server state
    try {
      await refetch();
    } catch {
      // refetch may fail if network is unavailable, that's ok
    }
    setCurrentUser(null);
    localStorage.removeItem('design_studio_current_user');
    localStorage.removeItem('auth_token');
  }, [refetch]);

  // Forgot password — send reset code to email
  const forgotPassword = useCallback(async (email) => {
    const result = await fetch(`${AUTH_BASE}/request-password-reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await result.json();
    if (!result.ok || data.error) {
      throw new Error(data.message || data.error?.message || '发送验证码失败');
    }
    return data;
  }, []);

  // Reset password with code
  const resetPasswordHandler = useCallback(async (email, code, newPassword) => {
    // Step 1: Verify the 6-digit code via our custom endpoint
    const verifyRes = await fetch(`${AUTH_BASE}/../custom-auth/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    });
    const verifyData = await verifyRes.json();
    if (!verifyRes.ok || !verifyData.success) {
      throw new Error(verifyData.message || '验证码无效或已过期');
    }

    // Step 2: Reset password via Better Auth using the verified code as token
    const result = await fetch(`${AUTH_BASE}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, token: code, newPassword }),
    });
    const data = await result.json();
    if (!result.ok || data.error) {
      throw new Error(data.message || data.error?.message || '密码重置失败');
    }
    return data;
  }, []);

  // Send verification code for registration
  const sendVerificationCode = useCallback(async (email, password, name) => {
    const result = await signUp.email({
      email,
      password,
      name: name || email.split('@')[0],
    });
    if (result.error) {
      throw new Error(result.error.message || '发送验证码失败');
    }
    return result;
  }, []);

  const updateUser = useCallback((user) => {
    setCurrentUser(user);
    localStorage.setItem('design_studio_current_user', JSON.stringify(user));

    const users = JSON.parse(localStorage.getItem('design_studio_users') || '[]');
    const index = users.findIndex(u => u.uid === user.uid);
    if (index !== -1) {
      users[index] = user;
      localStorage.setItem('design_studio_users', JSON.stringify(users));
    }
  }, []);

  const refreshToken = useCallback(async () => {
    // Better Auth handles session refresh automatically via cookies
    // This method is kept for backwards compatibility
    if (session?.user) {
      const user = session.user;
      const mappedUser = {
        ...user,
        uid: user.id,
        remainingCredits: user.remainingCredits ?? 10,
        membershipType: user.membershipType || user.membership_type || 'free',
      };
      setCurrentUser(mappedUser);
      return mappedUser;
    }
    return currentUser;
  }, [session, currentUser]);

  const isAuthenticated = !!currentUser;

  const value = {
    currentUser,
    isAuthenticated,
    isAuthLoading: isPending,
    login,
    register,
    logout,
    updateUser,
    refreshToken,
    forgotPassword,
    resetPassword: resetPasswordHandler,
    sendVerificationCode,
    // Backwards compatibility — these are no-ops since cookie handles auth
    token: null,
    setToken: () => {},
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;
