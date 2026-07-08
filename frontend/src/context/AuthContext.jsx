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

// Create Better Auth client — must use full URL (not relative path)
const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_BETTER_AUTH_URL || 'http://localhost:3000/api/auth',
});

const { useSession, signIn, signUp, signOut, forgetPassword, resetPassword } = authClient;

export const AuthProvider = ({ children }) => {
  const { data: session, isPending } = useSession();
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
      // No session — check legacy localStorage fallback
      const saved = localStorage.getItem('design_studio_current_user');
      if (saved) {
        try {
          setCurrentUser(JSON.parse(saved));
        } catch {
          // ignore
        }
      } else {
        setCurrentUser(null);
      }
    }
  }, [session, isPending]);

  const login = async (email, password) => {
    const result = await signIn.email({ email, password });
    if (result.error) {
      throw new Error(result.error.message || '登录失败');
    }
    // Session auto-updates via useSession hook
    return result;
  };

  const register = async (email, password, name) => {
    const result = await signUp.email({
      email,
      password,
      name: name || email.split('@')[0],
    });
    if (result.error) {
      throw new Error(result.error.message || '注册失败');
    }
    return result;
  };

  const logout = useCallback(async () => {
    try {
      await signOut();
    } catch (err) {
      console.warn('Better Auth signOut failed:', err);
    }
    setCurrentUser(null);
    localStorage.removeItem('design_studio_current_user');
    localStorage.removeItem('auth_token');
  }, []);

  // Forgot password — send reset code to email
  const forgotPassword = useCallback(async (email) => {
    const result = await forgetPassword.email({ email });
    if (result.error) {
      throw new Error(result.error.message || '发送验证码失败');
    }
    return result;
  }, []);

  // Reset password with code
  const resetPasswordHandler = useCallback(async (email, code, newPassword) => {
    // Better Auth uses forgetPassword + resetPassword flow
    const result = await resetPassword.email({
      email,
      token: code,
      newPassword,
    });
    if (result.error) {
      throw new Error(result.error.message || '密码重置失败');
    }
    return result;
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
