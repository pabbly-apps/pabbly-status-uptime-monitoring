import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { googleLogin } from '../services/authService';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

export default function Login() {
  const navigate = useNavigate();
  const { login, isAuthenticated } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const googleButtonRef = useRef(null);

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/admin/dashboard');
      return;
    }

    // Initialize Google Identity Services
    if (window.google?.accounts?.id) {
      initializeGIS();
    } else {
      // Wait for the script to load
      const checkGoogle = setInterval(() => {
        if (window.google?.accounts?.id) {
          clearInterval(checkGoogle);
          initializeGIS();
        }
      }, 100);
      return () => clearInterval(checkGoogle);
    }
  }, [isAuthenticated, navigate]);

  const initializeGIS = () => {
    window.google.accounts.id.initialize({
      client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
      callback: handleGoogleCallback,
      auto_select: false,
      context: 'signin',
    });

    if (googleButtonRef.current) {
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        width: 300,
      });
    }
  };

  const handleGoogleCallback = async (response) => {
    setLoading(true);
    setError('');

    try {
      const result = await googleLogin(response.credential);

      if (result.success) {
        login(result.user, result.token);
        toast.success('Login successful!');
        navigate('/admin/dashboard');
      } else {
        setError(result.message || 'Login failed');
        toast.error(result.message || 'Login failed');
      }
    } catch (err) {
      const message = err.response?.data?.message || 'Authentication failed';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
          Admin Login
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Sign in with your Google account
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <div className="flex flex-col items-center space-y-4">
            {/* Google Sign-In Button */}
            <div ref={googleButtonRef}></div>

            {loading && (
              <div className="flex items-center space-x-2">
                <svg className="animate-spin h-5 w-5 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <p className="text-sm text-gray-500">Verifying your account...</p>
              </div>
            )}

            {error && (
              <div className="w-full p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <p className="text-xs text-gray-400 mt-4">
              Only pre-approved accounts can sign in
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
