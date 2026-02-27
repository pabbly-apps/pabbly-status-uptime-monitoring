import api from './api';

// Google SSO Login
export const googleLogin = async (credential) => {
  const response = await api.post('/auth/google-login', { credential });

  if (response.data.success && response.data.token) {
    localStorage.setItem('token', response.data.token);
    if (response.data.user) {
      localStorage.setItem('user', JSON.stringify(response.data.user));
    }
  }

  return response.data;
};

// Logout
export const logout = async () => {
  try {
    await api.post('/auth/logout');
  } catch (error) {
    console.error('Logout error:', error);
  } finally {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    // Disable Google auto-select on logout
    if (window.google?.accounts?.id) {
      window.google.accounts.id.disableAutoSelect();
    }
  }
};

// Verify token
export const verifyToken = async () => {
  const response = await api.get('/auth/verify');
  return response.data;
};

// Get profile
export const getProfile = async () => {
  const response = await api.get('/auth/profile');
  return response.data;
};

// Check if user is authenticated
export const isAuthenticated = () => {
  return !!localStorage.getItem('token');
};

// Get current user from localStorage
export const getCurrentUser = () => {
  try {
    const userStr = localStorage.getItem('user');
    if (!userStr || userStr === 'undefined' || userStr === 'null') {
      return null;
    }
    return JSON.parse(userStr);
  } catch (error) {
    console.error('Error parsing user from localStorage:', error);
    return null;
  }
};

// User Management
export const getUsers = async () => {
  const response = await api.get('/auth/users');
  return response.data;
};

export const addUser = async (email) => {
  const response = await api.post('/auth/users', { email });
  return response.data;
};

export const removeUser = async (id) => {
  const response = await api.delete(`/auth/users/${id}`);
  return response.data;
};

export default {
  googleLogin,
  logout,
  verifyToken,
  getProfile,
  isAuthenticated,
  getCurrentUser,
  getUsers,
  addUser,
  removeUser,
};
