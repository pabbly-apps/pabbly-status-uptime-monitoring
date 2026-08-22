import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getUsers, addUser as addUserService, removeUser as removeUserService } from '../services/authService';
import { getSettings, updateSettings, uploadLogo, getEmailSettings, updateEmailSettings, testEmail, testWebhook, testGoogleChat, testCriticalAlert, getVersion } from '../services/adminService';
import { getGroupedTimezones, getTimezoneLabel, getTimezoneAbbreviation, findTimezone } from '../utils/timezone';
import Loading from '../components/shared/Loading';
import toast from 'react-hot-toast';

export default function Settings() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [testingGoogleChat, setTestingGoogleChat] = useState(false);
  const [testingCriticalAlert, setTestingCriticalAlert] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [version, setVersion] = useState('');
  const [emailInputValue, setEmailInputValue] = useState('');
  const [emailTags, setEmailTags] = useState([]);
  const [timezoneSearch, setTimezoneSearch] = useState('');

  // Get active tab from URL params, default to 'users'
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'users');

  // User Management
  const [users, setUsers] = useState([]);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [addingUser, setAddingUser] = useState(false);
  const [removingUserId, setRemovingUserId] = useState(null);

  // Domain Management
  const [domainTags, setDomainTags] = useState([]);
  const [domainInputValue, setDomainInputValue] = useState('');
  const [allDomainsAllowed, setAllDomainsAllowed] = useState(true);
  const [savingDomains, setSavingDomains] = useState(false);

  // System Settings
  const [systemSettings, setSystemSettings] = useState({
    page_title: '',
    brand_color: '',
    custom_message: '',
    notification_email: '',
    notifications_enabled: false,
    webhook_url: '',
    webhook_enabled: false,
    google_chat_webhook_url: '',
    google_chat_webhook_enabled: false,
    logo_url: '',
    admin_timezone: 'UTC',
    allowed_domains: '*',
    ha_base_url: '',
    ha_token: '',
    ha_notify_targets: '',
    critical_alert_enabled: false,
    critical_alert_repeat_seconds: 30,
    critical_alert_max_minutes: 15,
  });

  // Email SMTP Settings
  const [emailSettings, setEmailSettings] = useState({
    smtp_host: '',
    smtp_port: '587',
    smtp_user: '',
    smtp_pass: '',
    smtp_from: '',
    smtp_recipients: '',
  });

  // Logo Upload
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // Sync activeTab with URL params
  useEffect(() => {
    const tabFromUrl = searchParams.get('tab');
    if (tabFromUrl && tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl);
    }
  }, [searchParams]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      // Fetch settings
      const settingsRes = await getSettings();
      if (settingsRes && settingsRes.settings) {
        const domains = settingsRes.settings.allowed_domains || '*';
        setSystemSettings({
          page_title: settingsRes.settings.page_title || '',
          brand_color: settingsRes.settings.brand_color || '#3b82f6',
          custom_message: settingsRes.settings.custom_message || '',
          notification_email: settingsRes.settings.notification_email || '',
          notifications_enabled: settingsRes.settings.notifications_enabled || false,
          webhook_url: settingsRes.settings.webhook_url || '',
          webhook_enabled: settingsRes.settings.webhook_enabled || false,
          google_chat_webhook_url: settingsRes.settings.google_chat_webhook_url || '',
          google_chat_webhook_enabled: settingsRes.settings.google_chat_webhook_enabled || false,
          logo_url: settingsRes.settings.logo_url || '',
          admin_timezone: settingsRes.settings.admin_timezone || 'UTC',
          allowed_domains: domains,
          ha_base_url: settingsRes.settings.ha_base_url || '',
          ha_token: settingsRes.settings.ha_token || '',
          ha_notify_targets: settingsRes.settings.ha_notify_targets || '',
          critical_alert_enabled: settingsRes.settings.critical_alert_enabled || false,
          critical_alert_repeat_seconds: settingsRes.settings.critical_alert_repeat_seconds ?? 30,
          critical_alert_max_minutes: settingsRes.settings.critical_alert_max_minutes ?? 15,
        });

        // Initialize domain tags from settings
        if (domains.trim() === '*') {
          setAllDomainsAllowed(true);
          setDomainTags([]);
        } else {
          setAllDomainsAllowed(false);
          const tags = domains.split(',').map(d => d.trim()).filter(Boolean);
          setDomainTags(tags);
        }

        // Set logo preview if logo exists
        if (settingsRes.settings.logo_url) {
          const apiBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
          const baseUrl = apiBaseUrl.replace('/api', '');
          setLogoPreview(baseUrl + settingsRes.settings.logo_url);
        }
      }

      // Fetch email settings
      try {
        const emailRes = await getEmailSettings();
        if (emailRes && emailRes.emailSettings) {
          setEmailSettings({
            smtp_host: emailRes.emailSettings.smtp_host || '',
            smtp_port: emailRes.emailSettings.smtp_port || '587',
            smtp_user: emailRes.emailSettings.smtp_user || '',
            smtp_pass: emailRes.emailSettings.smtp_pass || '',
            smtp_from: emailRes.emailSettings.smtp_from || '',
            smtp_recipients: emailRes.emailSettings.smtp_recipients || '',
          });

          // Initialize email tags from comma-separated string
          if (emailRes.emailSettings.smtp_recipients) {
            const tags = emailRes.emailSettings.smtp_recipients
              .split(',')
              .map(email => email.trim())
              .filter(email => email);
            setEmailTags(tags);
          }
        }
      } catch (error) {
        console.error('Error fetching email settings:', error);
        // Don't show error toast for email settings, they might not be configured yet
      }

      // Fetch version
      try {
        const versionRes = await getVersion();
        if (versionRes && versionRes.version) {
          setVersion(versionRes.version);
        }
      } catch (error) {
        console.error('Error fetching version:', error);
      }

      // Fetch users
      try {
        const usersRes = await getUsers();
        if (usersRes && usersRes.users) {
          setUsers(usersRes.users);
        }
      } catch (error) {
        console.error('Error fetching users:', error);
      }

      setLoading(false);
    } catch (error) {
      console.error('Error fetching settings:', error);
      toast.error('Failed to load settings');
      setLoading(false);
    }
  };

  // Handle tab change and update URL
  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  const handleSystemChange = (e) => {
    const { name, value, type, checked } = e.target;
    setSystemSettings({
      ...systemSettings,
      [name]: type === 'checkbox' ? checked : value,
    });
  };

  const handleEmailChange = (e) => {
    setEmailSettings({
      ...emailSettings,
      [e.target.name]: e.target.value,
    });
  };

  const handleAddUser = async (e) => {
    e.preventDefault();
    const trimmedEmail = newUserEmail.trim().toLowerCase();

    if (!trimmedEmail) {
      toast.error('Please enter an email address');
      return;
    }

    // Validate against allowed domains (client-side check, backend also validates)
    if (!allDomainsAllowed && domainTags.length > 0) {
      const emailDomain = trimmedEmail.split('@')[1];
      if (!domainTags.includes(emailDomain)) {
        toast.error(`Only emails from allowed domains (${domainTags.map(d => '@' + d).join(', ')}) can be added`);
        return;
      }
    }

    setAddingUser(true);
    try {
      await addUserService(trimmedEmail);
      toast.success('User added successfully');
      setNewUserEmail('');
      // Refresh user list
      const usersRes = await getUsers();
      if (usersRes?.users) setUsers(usersRes.users);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to add user');
    } finally {
      setAddingUser(false);
    }
  };

  const handleRemoveUser = async (userId) => {
    if (!confirm('Are you sure you want to remove this user? They will no longer be able to log in.')) return;
    setRemovingUserId(userId);
    try {
      await removeUserService(userId);
      toast.success('User removed successfully');
      setUsers(users.filter(u => u.id !== userId));
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to remove user');
    } finally {
      setRemovingUserId(null);
    }
  };

  const handleSystemSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setSaving(true);

    try {
      await updateSettings(systemSettings);
      toast.success('System settings updated successfully');
    } catch (error) {
      console.error('Update error:', error);
      toast.error(error.response?.data?.message || 'Failed to update settings');
    } finally {
      setSaving(false);
    }
  };

  // Domain management handlers
  const handleDomainInputKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      addDomainTag();
    } else if (e.key === 'Backspace' && !domainInputValue && domainTags.length > 0) {
      removeDomainTag(domainTags.length - 1);
    }
  };

  const addDomainTag = (showError = true) => {
    const trimmed = domainInputValue.trim().toLowerCase().replace(/^@/, '');
    if (trimmed && !domainTags.includes(trimmed)) {
      // Basic domain validation
      if (/^[a-z0-9]+([\-.][a-z0-9]+)*\.[a-z]{2,}$/.test(trimmed)) {
        setDomainTags([...domainTags, trimmed]);
        setDomainInputValue('');
      } else if (showError) {
        toast.error('Please enter a valid domain (e.g., example.com)');
      }
    } else {
      setDomainInputValue('');
    }
  };

  const removeDomainTag = (indexToRemove) => {
    setDomainTags(domainTags.filter((_, index) => index !== indexToRemove));
  };

  const handleSaveDomains = async () => {
    // If there's text in the input, validate it before saving
    const pendingText = domainInputValue.trim().toLowerCase().replace(/^@/, '');
    if (pendingText) {
      if (/^[a-z0-9]+([\-.][a-z0-9]+)*\.[a-z]{2,}$/.test(pendingText)) {
        // Valid domain — auto-add it as a tag
        if (!domainTags.includes(pendingText)) {
          domainTags.push(pendingText);
          setDomainTags([...domainTags]);
        }
        setDomainInputValue('');
      } else {
        toast.error('Please enter a valid domain (e.g., example.com)');
        return;
      }
    }

    let domainsValue;
    if (allDomainsAllowed) {
      domainsValue = '*';
    } else {
      if (domainTags.length === 0) {
        toast.error('Please add at least one domain or select "Allow all domains"');
        return;
      }
      domainsValue = domainTags.join(', ');
    }

    setSavingDomains(true);
    try {
      await updateSettings({ allowed_domains: domainsValue });
      setSystemSettings({ ...systemSettings, allowed_domains: domainsValue });
      toast.success('Allowed domains updated successfully');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update allowed domains');
    } finally {
      setSavingDomains(false);
    }
  };

  const handleEmailTagInput = (e) => {
    setEmailInputValue(e.target.value);
  };

  const handleEmailTagKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      addEmailTag();
    } else if (e.key === 'Backspace' && !emailInputValue && emailTags.length > 0) {
      // Remove last tag if backspace is pressed on empty input
      removeEmailTag(emailTags.length - 1);
    }
  };

  const addEmailTag = () => {
    const trimmedEmail = emailInputValue.trim();
    if (trimmedEmail && !emailTags.includes(trimmedEmail)) {
      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (emailRegex.test(trimmedEmail)) {
        const newTags = [...emailTags, trimmedEmail];
        setEmailTags(newTags);
        setEmailInputValue('');

        // Update the emailSettings state with comma-separated emails
        setEmailSettings({
          ...emailSettings,
          smtp_recipients: newTags.join(', '),
        });
      } else {
        toast.error('Please enter a valid email address');
      }
    }
  };

  const removeEmailTag = (indexToRemove) => {
    const newTags = emailTags.filter((_, index) => index !== indexToRemove);
    setEmailTags(newTags);

    // Update the emailSettings state
    setEmailSettings({
      ...emailSettings,
      smtp_recipients: newTags.join(', '),
    });
  };

  const handleEmailSubmit = async (e) => {
    e.preventDefault();

    // Validate that at least one email recipient exists
    if (emailTags.length === 0) {
      toast.error('Please add at least one recipient email address');
      return;
    }

    setSaving(true);

    try {
      const response = await updateEmailSettings(emailSettings);
      toast.success(response.message || 'Email settings updated successfully');
    } catch (error) {
      console.error('Update email error:', error);
      toast.error(error.response?.data?.message || 'Failed to update email settings');
    } finally {
      setSaving(false);
    }
  };

  const handleTestEmail = async () => {
    setTestingEmail(true);

    try {
      const response = await testEmail();
      toast.success(response.message || 'Test email sent successfully');
    } catch (error) {
      console.error('Test email error:', error);
      toast.error(error.response?.data?.message || 'Failed to send test email. Please check your SMTP configuration.');
    } finally {
      setTestingEmail(false);
    }
  };

  const handleTestWebhook = async () => {
    setTestingWebhook(true);

    try {
      const response = await testWebhook();
      toast.success(response.message || 'Test webhook sent successfully');
    } catch (error) {
      console.error('Test webhook error:', error);
      toast.error(error.response?.data?.message || 'Failed to send test webhook. Please check your webhook URL.');
    } finally {
      setTestingWebhook(false);
    }
  };

  const handleTestGoogleChat = async () => {
    setTestingGoogleChat(true);

    try {
      const response = await testGoogleChat();
      toast.success(response.message || 'Test notification sent to Google Chat');
    } catch (error) {
      console.error('Test Google Chat error:', error);
      toast.error(error.response?.data?.message || 'Failed to send test notification. Please check your Google Chat webhook URL.');
    } finally {
      setTestingGoogleChat(false);
    }
  };

  const handleTestCriticalAlert = async () => {
    setTestingCriticalAlert(true);

    try {
      const response = await testCriticalAlert();
      toast.success(response.message || 'Test alarm sent to your phone');
    } catch (error) {
      console.error('Test critical alarm error:', error);
      toast.error(error.response?.data?.message || 'Failed to send test alarm. Check the Home Assistant URL, token and targets.');
    } finally {
      setTestingCriticalAlert(false);
    }
  };

  const handleLogoChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      // Validate file type
      const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml'];
      if (!allowedTypes.includes(file.type)) {
        toast.error('Please select a PNG, JPG, JPEG, or SVG file');
        return;
      }

      // Validate file size (2MB max)
      if (file.size > 2 * 1024 * 1024) {
        toast.error('File size must be less than 2MB');
        return;
      }

      setLogoFile(file);

      // Create preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setLogoPreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleLogoUpload = async () => {
    if (!logoFile) {
      toast.error('Please select a logo file first');
      return;
    }

    setUploadingLogo(true);

    try {
      const result = await uploadLogo(logoFile);
      toast.success('Logo uploaded successfully');

      // Update system settings with new logo URL
      setSystemSettings({
        ...systemSettings,
        logo_url: result.logo_url,
      });

      // Clear the file input
      setLogoFile(null);

      // Refresh settings to get updated data
      await fetchData();
    } catch (error) {
      console.error('Logo upload error:', error);
      toast.error(error.response?.data?.message || 'Failed to upload logo');
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleLogoRemove = () => {
    setLogoFile(null);
    setLogoPreview(null);
  };

  const handleLogout = () => {
    logout();
    navigate('/admin/login');
    toast.success('Logged out successfully');
  };

  if (loading) {
    return <Loading message="Loading settings..." />;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          {/* Mobile Layout */}
          <div className="sm:hidden">
            <div className="flex flex-col items-center gap-3">
              {/* Logo */}
              {logoPreview && (
                <a href="/admin/dashboard" className="inline-block">
                  <img
                    src={logoPreview}
                    alt="Logo"
                    className="h-8 w-auto object-contain cursor-pointer hover:opacity-80 transition-opacity"
                  />
                </a>
              )}
              <h1 className="text-lg font-bold text-gray-900">Admin Settings</h1>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                <a
                  href="/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 border border-gray-300 rounded-md transition-colors"
                >
                  <svg className="h-3.5 w-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  Public
                </a>
                <a
                  href="/admin/dashboard"
                  className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 border border-gray-300 rounded-md transition-colors"
                >
                  <svg className="h-3.5 w-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                  Dashboard
                </a>

                {/* Profile Dropdown */}
                <div className="relative">
                  <button
                    onClick={() => setIsProfileOpen(!isProfileOpen)}
                    className="p-1 rounded-full hover:bg-gray-100 transition-colors"
                  >
                    <div className="h-7 w-7 rounded-full bg-gray-200 flex items-center justify-center ring-2 ring-gray-300">
                      <svg className="h-4 w-4 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                      </svg>
                    </div>
                  </button>

                  {/* Dropdown Menu */}
                  {isProfileOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setIsProfileOpen(false)}></div>
                      <div className="absolute right-0 mt-2 w-64 bg-white rounded-md shadow-lg border border-gray-200 py-1 z-20">
                        <div className="px-4 py-3 border-b border-gray-200">
                          <p className="text-xs text-gray-500">Signed in as</p>
                          <p className="text-sm font-medium text-gray-900 truncate">{user?.email || 'Admin'}</p>
                        </div>
                        <button
                          onClick={() => {
                            setIsProfileOpen(false);
                            handleLogout();
                          }}
                          className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                          </svg>
                          Logout
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Desktop Layout */}
          <div className="hidden sm:flex items-center justify-between">
            <div>
              {/* Logo */}
              {logoPreview && (
                <a href="/admin/dashboard" className="inline-block mb-2">
                  <img
                    src={logoPreview}
                    alt="Logo"
                    className="h-8 sm:h-10 w-auto object-contain cursor-pointer hover:opacity-80 transition-opacity"
                  />
                </a>
              )}
              <h1 className="text-lg sm:text-xl font-bold text-gray-900">Admin Settings</h1>
            </div>
            <div className="flex items-center gap-4">
              <a
                href="/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-600 hover:text-gray-900 text-sm font-medium inline-flex items-center gap-1"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                View Public Page
              </a>
              <a
                href="/admin/dashboard"
                className="text-gray-600 hover:text-gray-900 text-sm font-medium"
              >
                Back to Dashboard
              </a>

              {/* Profile Dropdown */}
              <div className="relative">
                <button
                  onClick={() => setIsProfileOpen(!isProfileOpen)}
                  className="flex items-center gap-2 p-1.5 rounded-full hover:bg-gray-100 transition-colors"
                >
                  <div className="h-9 w-9 rounded-full bg-gray-200 flex items-center justify-center ring-2 ring-gray-300 hover:ring-gray-400 transition-all">
                    <svg className="h-5 w-5 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                    </svg>
                  </div>
                </button>

                {/* Dropdown Menu */}
                {isProfileOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setIsProfileOpen(false)}></div>
                    <div className="absolute right-0 mt-2 w-64 bg-white rounded-md shadow-lg border border-gray-200 py-1 z-20">
                      <div className="px-4 py-3 border-b border-gray-200">
                        <p className="text-xs text-gray-500">Signed in as</p>
                        <p className="text-sm font-medium text-gray-900 truncate">{user?.email || 'Admin'}</p>
                      </div>
                      <button
                        onClick={() => {
                          setIsProfileOpen(false);
                          handleLogout();
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                        Logout
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-grow max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {/* Tab Navigation */}
        <div className="bg-white rounded-t-lg border border-gray-200 border-b-0">
          <div className="flex overflow-x-auto border-b border-gray-200 overflow-y-hidden" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
            <button
              onClick={() => handleTabChange('users')}
              className={`px-4 sm:px-6 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex-shrink-0 ${
                activeTab === 'users'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Users
            </button>
            <button
              onClick={() => handleTabChange('system')}
              className={`px-4 sm:px-6 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex-shrink-0 ${
                activeTab === 'system'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              System
            </button>
            <button
              onClick={() => handleTabChange('webhook')}
              className={`px-4 sm:px-6 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex-shrink-0 ${
                activeTab === 'webhook'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Webhook
            </button>
            <button
              onClick={() => handleTabChange('googlechat')}
              className={`px-4 sm:px-6 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex-shrink-0 ${
                activeTab === 'googlechat'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Google Chat
            </button>
            <button
              onClick={() => handleTabChange('criticalalert')}
              className={`px-4 sm:px-6 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex-shrink-0 ${
                activeTab === 'criticalalert'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Phone Alarm
            </button>
            <button
              onClick={() => handleTabChange('email')}
              className={`px-4 sm:px-6 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex-shrink-0 ${
                activeTab === 'email'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Email
            </button>
            <button
              onClick={() => handleTabChange('timezone')}
              className={`px-4 sm:px-6 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex-shrink-0 ${
                activeTab === 'timezone'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Timezone
            </button>
          </div>
        </div>

        {/* Tab Content */}
        <div className="bg-white rounded-b-lg border border-gray-200 p-6">
          {/* Users Management Tab */}
          {activeTab === 'users' && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              User Management
            </h2>

            <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-6">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3 flex-1">
                  <p className="text-sm text-blue-700">
                    Configure which email domains can sign in via Google SSO, then add specific users. Both the domain and the user must be allowed for login to succeed.
                  </p>
                </div>
              </div>
            </div>

            {/* Allowed Domains Section */}
            <div className="mb-8 p-4 border border-gray-200 rounded-md bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Allowed Domains</h3>

              <div className="flex items-center mb-3">
                <input
                  type="checkbox"
                  id="all_domains_allowed"
                  checked={allDomainsAllowed}
                  onChange={(e) => {
                    setAllDomainsAllowed(e.target.checked);
                    if (e.target.checked) {
                      setDomainTags([]);
                    }
                  }}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="all_domains_allowed" className="ml-2 block text-sm text-gray-900">
                  Allow all Google account domains
                </label>
              </div>

              {!allDomainsAllowed && (
                <div className="mb-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Specific Domains
                  </label>
                  <div className="w-full min-h-[42px] px-3 py-2 border border-gray-300 rounded-md shadow-sm focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 bg-white">
                    <div className="flex flex-wrap gap-2 items-center">
                      {domainTags.map((domain, index) => (
                        <span
                          key={index}
                          className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 text-sm rounded-md"
                        >
                          @{domain}
                          <button
                            type="button"
                            onClick={() => removeDomainTag(index)}
                            className="hover:bg-blue-200 rounded-full p-0.5 transition-colors"
                          >
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                            </svg>
                          </button>
                        </span>
                      ))}
                      <input
                        type="text"
                        value={domainInputValue}
                        onChange={(e) => setDomainInputValue(e.target.value)}
                        onKeyDown={handleDomainInputKeyDown}
                        onBlur={() => addDomainTag(false)}
                        placeholder={domainTags.length === 0 ? "e.g., example.com or @example.com" : "@"}
                        className="flex-1 min-w-[200px] outline-none border-0 focus:ring-0 p-0 text-sm"
                      />
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    Type a domain (e.g., example.com or @example.com) and press Enter, comma, or space to add. Only users from these domains can be added and can log in.
                  </p>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleSaveDomains}
                  disabled={savingDomains}
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                >
                  {savingDomains ? 'Saving...' : 'Save Domains'}
                </button>
              </div>
            </div>

            {/* Add User Form */}
            <form onSubmit={handleAddUser} className="mb-6">
              <label htmlFor="new_user_email" className="block text-sm font-medium text-gray-700 mb-1">
                Add New User
              </label>
              <div className="flex gap-3">
                <input
                  type="email"
                  id="new_user_email"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  required
                />
                <button
                  type="submit"
                  disabled={addingUser}
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 whitespace-nowrap"
                >
                  {addingUser ? 'Adding...' : 'Add User'}
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {allDomainsAllowed
                  ? 'Any Google account can be added (user must still be pre-added here)'
                  : `Only Google accounts from: ${domainTags.map(d => '@' + d).join(', ') || '(no domains configured)'}`
                }
              </p>
            </form>

            {/* Users List */}
            <div className="border border-gray-200 rounded-md overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden sm:table-cell">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden sm:table-cell">Added By</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden sm:table-cell">Last Login</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {u.profile_picture ? (
                            <img src={u.profile_picture} alt="" className="h-8 w-8 rounded-full" referrerPolicy="no-referrer" />
                          ) : (
                            <div className="h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center">
                              <svg className="h-4 w-4 text-gray-500" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                              </svg>
                            </div>
                          )}
                          <div>
                            <p className="text-sm font-medium text-gray-900">{u.full_name || u.email}</p>
                            {u.full_name && <p className="text-xs text-gray-500">{u.email}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        {u.last_login ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 hidden sm:table-cell">
                        {u.added_by_name || u.added_by_email || 'System'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 hidden sm:table-cell">
                        {u.last_login ? new Date(u.last_login).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Never'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {u.id === user?.id ? (
                          <span className="text-xs text-gray-400">You</span>
                        ) : (
                          <button
                            onClick={() => handleRemoveUser(u.id)}
                            disabled={removingUserId === u.id}
                            className="text-red-600 hover:text-red-800 text-sm font-medium disabled:opacity-50"
                          >
                            {removingUserId === u.id ? 'Removing...' : 'Remove'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan="5" className="px-4 py-8 text-center text-gray-500 text-sm">
                        No users found. Add an email above to get started.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          )}

          {/* System Settings Tab */}
          {activeTab === 'system' && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              System Settings
            </h2>
            <form onSubmit={handleSystemSubmit} className="space-y-4">
              {/* Logo Upload Section */}
              <div className="border-b border-gray-200 pb-4 mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Custom Logo
                </label>
                <p className="text-sm text-gray-500 mb-3">
                  Upload your custom logo (PNG, JPG, JPEG, or SVG, max 2MB)
                </p>

                {logoPreview && (
                  <div className="mb-3">
                    <div className="flex items-center gap-4">
                      <div className="flex-shrink-0">
                        <img
                          src={logoPreview}
                          alt="Logo preview"
                          className="h-16 w-auto max-w-xs object-contain border border-gray-200 rounded p-2 bg-white"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleLogoRemove}
                        className="text-sm text-red-600 hover:text-red-700"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <input
                    type="file"
                    id="logo"
                    accept="image/png,image/jpeg,image/jpg,image/svg+xml"
                    onChange={handleLogoChange}
                    className="block w-full text-sm text-gray-500
                      file:mr-4 file:py-2 file:px-4
                      file:rounded-md file:border-0
                      file:text-sm file:font-medium
                      file:bg-blue-50 file:text-blue-700
                      hover:file:bg-blue-100"
                  />
                  {logoFile && (
                    <button
                      type="button"
                      onClick={handleLogoUpload}
                      disabled={uploadingLogo}
                      className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 whitespace-nowrap"
                    >
                      {uploadingLogo ? 'Uploading...' : 'Upload Logo'}
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label htmlFor="page_title" className="block text-sm font-medium text-gray-700 mb-1">
                  Status Page Title
                </label>
                <input
                  type="text"
                  id="page_title"
                  name="page_title"
                  value={systemSettings.page_title}
                  onChange={handleSystemChange}
                  placeholder="System Status"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Update Settings'}
                </button>
              </div>
            </form>
          </div>
          )}

          {/* Webhook Configuration Tab */}
          {activeTab === 'webhook' && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Webhook Configuration
            </h2>
            <form onSubmit={handleSystemSubmit} className="space-y-4">
              <div>
                <label htmlFor="webhook_url" className="block text-sm font-medium text-gray-700 mb-1">
                  Webhook URL
                </label>
                <input
                  type="url"
                  id="webhook_url"
                  name="webhook_url"
                  value={systemSettings.webhook_url}
                  onChange={handleSystemChange}
                  placeholder="https://your-webhook-endpoint.com/webhook"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Webhook notifications will be sent to this URL when APIs go down or come back up
                </p>
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="webhook_enabled"
                  name="webhook_enabled"
                  checked={systemSettings.webhook_enabled}
                  onChange={handleSystemChange}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="webhook_enabled" className="ml-2 block text-sm text-gray-900">
                  Enable webhook notifications
                </label>
              </div>

              {/* Webhook Payload Documentation */}
              <div className="mt-4 p-4 bg-gray-50 rounded-md border border-gray-200">
                <h3 className="text-sm font-semibold text-gray-900 mb-2">Webhook Payload Structure</h3>
                <p className="text-xs text-gray-600 mb-3">
                  When an API status changes, a POST request with this JSON payload will be sent:
                </p>
                <pre className="text-xs bg-gray-900 text-gray-100 p-3 rounded overflow-x-auto">
{`{
  "event_type": "api_down" | "api_up",
  "status": "down" | "up",
  "timestamp": "2025-12-26T10:30:00.000Z",
  "api": {
    "id": 1,
    "name": "API Name",
    "url": "https://api.example.com",
    "monitoring_interval": 60,
    "expected_status_code": 200
  },
  "incident": {
    "id": 42,
    "title": "API is down",
    "description": "Incident details...",
    "status": "ongoing" | "resolved",
    "started_at": "2025-12-26T10:30:00.000Z",
    "resolved_at": "2025-12-26T10:35:00.000Z",
    "downtime_minutes": 5
  }
}`}
                </pre>
                <p className="text-xs text-gray-600 mt-2">
                  <strong>Note:</strong> For <code className="bg-gray-200 px-1 rounded">api_down</code> events, <code className="bg-gray-200 px-1 rounded">resolved_at</code> will be <code className="bg-gray-200 px-1 rounded">null</code> and <code className="bg-gray-200 px-1 rounded">downtime_minutes</code> will not be included. For <code className="bg-gray-200 px-1 rounded">api_up</code> events, both fields will be present showing when and for how long the API was down.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row justify-end gap-3">
                <button
                  type="button"
                  onClick={handleTestWebhook}
                  disabled={testingWebhook || saving}
                  className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                >
                  {testingWebhook ? 'Sending Test Webhook...' : 'Send Test Webhook'}
                </button>
                <button
                  type="submit"
                  disabled={saving || testingWebhook}
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Update Webhook Settings'}
                </button>
              </div>
            </form>
          </div>
          )}

          {/* Google Chat Configuration Tab */}
          {activeTab === 'googlechat' && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Google Chat Webhook
            </h2>

            <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3 flex-1">
                  <p className="text-sm text-blue-700">
                    Send incident notifications directly to a Google Chat space. This works independently of the generic webhook and does not require Pabbly Connect.
                  </p>
                </div>
              </div>
            </div>

            <form onSubmit={handleSystemSubmit} className="space-y-4">
              <div>
                <label htmlFor="google_chat_webhook_url" className="block text-sm font-medium text-gray-700 mb-1">
                  Google Chat Webhook URL
                </label>
                <input
                  type="url"
                  id="google_chat_webhook_url"
                  name="google_chat_webhook_url"
                  value={systemSettings.google_chat_webhook_url}
                  onChange={handleSystemChange}
                  placeholder="https://chat.googleapis.com/v1/spaces/SPACE_ID/messages?key=KEY&token=TOKEN"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  The incoming webhook URL from your Google Chat space
                </p>
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="google_chat_webhook_enabled"
                  name="google_chat_webhook_enabled"
                  checked={systemSettings.google_chat_webhook_enabled}
                  onChange={handleSystemChange}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="google_chat_webhook_enabled" className="ml-2 block text-sm text-gray-900">
                  Enable Google Chat notifications
                </label>
              </div>

              {/* How to get the webhook URL */}
              <div className="mt-4 p-4 bg-gray-50 rounded-md border border-gray-200">
                <h3 className="text-sm font-semibold text-gray-900 mb-2">How to get your Google Chat Webhook URL</h3>
                <ol className="text-xs text-gray-600 space-y-1 list-decimal list-inside">
                  <li>Open Google Chat and go to the space where you want notifications</li>
                  <li>Click the space name at the top, then select <strong>Apps & integrations</strong></li>
                  <li>Click <strong>Manage webhooks</strong></li>
                  <li>Click <strong>Add another</strong> (or create a new webhook)</li>
                  <li>Give it a name (e.g., "Status Monitor") and optionally set an avatar URL</li>
                  <li>Copy the webhook URL and paste it above</li>
                </ol>
                <p className="text-xs text-gray-500 mt-2">
                  The URL should look like: <code className="bg-gray-200 px-1 rounded text-xs">https://chat.googleapis.com/v1/spaces/.../messages?key=...&token=...</code>
                </p>
              </div>

              <div className="flex flex-col sm:flex-row justify-end gap-3">
                <button
                  type="button"
                  onClick={handleTestGoogleChat}
                  disabled={testingGoogleChat || saving}
                  className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                >
                  {testingGoogleChat ? 'Sending Test...' : 'Send Test Notification'}
                </button>
                <button
                  type="submit"
                  disabled={saving || testingGoogleChat}
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Update Google Chat Settings'}
                </button>
              </div>
            </form>
          </div>
          )}

          {/* Critical Phone Alarm Tab */}
          {activeTab === 'criticalalert' && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Critical Phone Alarm
            </h2>

            <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-4">
              <p className="text-sm text-red-700">
                When an API marked <strong>Critical</strong> goes down, this rings a loud alarm on
                on-call phones and repeats until someone taps the notification to acknowledge it.
                On iPhone it plays through the silent switch and Focus/Do Not Disturb; on Android it
                rings at max alarm volume.
              </p>
            </div>

            <form onSubmit={handleSystemSubmit} className="space-y-4">
              <div>
                <label htmlFor="ha_base_url" className="block text-sm font-medium text-gray-700 mb-1">
                  Home Assistant URL
                </label>
                <input
                  type="url"
                  id="ha_base_url"
                  name="ha_base_url"
                  value={systemSettings.ha_base_url}
                  onChange={handleSystemChange}
                  placeholder="https://ha.example.com"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Base URL of your self-hosted Home Assistant instance (no trailing slash needed)
                </p>
              </div>

              <div>
                <label htmlFor="ha_token" className="block text-sm font-medium text-gray-700 mb-1">
                  Long-Lived Access Token
                </label>
                <input
                  type="password"
                  id="ha_token"
                  name="ha_token"
                  value={systemSettings.ha_token}
                  onChange={handleSystemChange}
                  placeholder="Paste the token from your HA profile page"
                  autoComplete="new-password"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Stored encrypted when ENCRYPTION_KEY is set. Leave the masked value untouched to keep the current token.
                </p>
              </div>

              <div>
                <label htmlFor="ha_notify_targets" className="block text-sm font-medium text-gray-700 mb-1">
                  Device Targets
                </label>
                <input
                  type="text"
                  id="ha_notify_targets"
                  name="ha_notify_targets"
                  value={systemSettings.ha_notify_targets}
                  onChange={handleSystemChange}
                  placeholder="mobile_app_pixel_8:Ravi (Pixel), mobile_app_iphone_15:Priya (iPhone)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Comma-separated Home Assistant notify services, one per phone. Add
                  <code className="bg-gray-100 px-1 rounded">:Name</code> after a service to show a
                  friendly label when picking who an API should wake &mdash; e.g.
                  <code className="bg-gray-100 px-1 rounded">mobile_app_pixel_8:Ravi (Pixel)</code>.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="critical_alert_repeat_seconds" className="block text-sm font-medium text-gray-700 mb-1">
                    Repeat Every (seconds)
                  </label>
                  <input
                    type="number"
                    id="critical_alert_repeat_seconds"
                    name="critical_alert_repeat_seconds"
                    min="10"
                    max="300"
                    value={systemSettings.critical_alert_repeat_seconds}
                    onChange={handleSystemChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Neither phone OS can loop a sound, so the alarm re-sends on this interval (default 30s)
                  </p>
                </div>

                <div>
                  <label htmlFor="critical_alert_max_minutes" className="block text-sm font-medium text-gray-700 mb-1">
                    Give Up After (minutes)
                  </label>
                  <input
                    type="number"
                    id="critical_alert_max_minutes"
                    name="critical_alert_max_minutes"
                    min="1"
                    max="120"
                    value={systemSettings.critical_alert_max_minutes}
                    onChange={handleSystemChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Stop repeating after this long, even if nobody acknowledged (default 15m)
                  </p>
                </div>
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="critical_alert_enabled"
                  name="critical_alert_enabled"
                  checked={systemSettings.critical_alert_enabled}
                  onChange={handleSystemChange}
                  className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                />
                <label htmlFor="critical_alert_enabled" className="ml-2 block text-sm text-gray-900">
                  Enable critical phone alarms
                </label>
              </div>

              <div className="mt-4 p-4 bg-gray-50 rounded-md border border-gray-200">
                <h3 className="text-sm font-semibold text-gray-900 mb-2">Setup checklist</h3>
                <ol className="text-xs text-gray-600 space-y-1 list-decimal list-inside">
                  <li>Run Home Assistant on your server and expose it over HTTPS</li>
                  <li>In HA, open your profile page and create a <strong>Long-Lived Access Token</strong></li>
                  <li>Each on-call person installs the <strong>Home Assistant</strong> app and signs in</li>
                  <li>On iPhone: allow <strong>Critical Alerts</strong> when prompted (Settings &rarr; Notifications if missed)</li>
                  <li>Find each device name under HA <strong>Developer Tools &rarr; Actions &rarr; notify</strong> and list them above</li>
                  <li>Send a test alarm, then mark an API as <strong>Critical</strong> on the dashboard</li>
                </ol>
                <p className="text-xs text-gray-500 mt-2">
                  Only APIs explicitly marked Critical will ring. Everything else keeps using Google Chat and email as before.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row justify-end gap-3">
                <button
                  type="button"
                  onClick={handleTestCriticalAlert}
                  disabled={testingCriticalAlert || saving}
                  className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                >
                  {testingCriticalAlert ? 'Sending Test...' : 'Send Test Alarm'}
                </button>
                <button
                  type="submit"
                  disabled={saving || testingCriticalAlert}
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Update Alarm Settings'}
                </button>
              </div>
            </form>
          </div>
          )}

          {/* Timezone Configuration Tab */}
          {activeTab === 'timezone' && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Timezone Settings
            </h2>

            <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-6">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3 flex-1">
                  <p className="text-sm text-blue-700">
                    Controls timestamps shown on admin pages and in notifications (webhook, Google Chat, email). The public status page is not affected — it uses the visitor's browser timezone.
                  </p>
                </div>
              </div>
            </div>

            {/* Current timezone display */}
            <div className="mb-6 p-4 bg-gray-50 rounded-md border border-gray-200">
              <div className="flex items-center gap-3">
                <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    Current: {findTimezone(systemSettings.admin_timezone)?.label || getTimezoneLabel(systemSettings.admin_timezone)} ({getTimezoneAbbreviation(systemSettings.admin_timezone)})
                  </p>
                  <p className="text-xs text-gray-500">IANA: {systemSettings.admin_timezone}</p>
                </div>
              </div>
            </div>

            {/* Search box */}
            <div className="mb-4">
              <div className="relative">
                <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search timezones..."
                  value={timezoneSearch}
                  onChange={(e) => setTimezoneSearch(e.target.value)}
                  className="w-full pl-10 pr-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Timezone list grouped by region */}
            <div className="border border-gray-200 rounded-md overflow-hidden max-h-96 overflow-y-auto mb-6">
              {Object.entries(getGroupedTimezones()).map(([region, timezones]) => {
                const filtered = timezoneSearch
                  ? timezones.filter((tz) =>
                      tz.label.toLowerCase().includes(timezoneSearch.toLowerCase()) ||
                      tz.abbr.toLowerCase().includes(timezoneSearch.toLowerCase()) ||
                      tz.value.toLowerCase().includes(timezoneSearch.toLowerCase())
                    )
                  : timezones;

                if (filtered.length === 0) return null;

                return (
                  <div key={region} className="border-b border-gray-100 last:border-b-0">
                    <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50 sticky top-0">
                      {region}
                    </div>
                    <div>
                      {filtered.map((tz) => (
                        <button
                          key={tz.value}
                          type="button"
                          onClick={() => setSystemSettings({ ...systemSettings, admin_timezone: tz.value })}
                          className={`w-full text-left px-4 py-2.5 text-sm hover:bg-blue-50 flex items-center justify-between ${
                            systemSettings.admin_timezone === tz.value
                              ? 'bg-blue-50 text-blue-700'
                              : 'text-gray-700'
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            {systemSettings.admin_timezone === tz.value && (
                              <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            )}
                            <span>{tz.label}</span>
                          </span>
                          <span className="text-xs text-gray-500">({tz.abbr})</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}

              {/* No results */}
              {timezoneSearch &&
                Object.values(getGroupedTimezones()).every(
                  (tzs) =>
                    tzs.filter(
                      (tz) =>
                        tz.label.toLowerCase().includes(timezoneSearch.toLowerCase()) ||
                        tz.abbr.toLowerCase().includes(timezoneSearch.toLowerCase()) ||
                        tz.value.toLowerCase().includes(timezoneSearch.toLowerCase())
                    ).length === 0
                ) && (
                  <div className="px-4 py-8 text-center text-gray-500 text-sm">
                    No timezones found matching "{timezoneSearch}"
                  </div>
                )}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleSystemSubmit}
                disabled={saving}
                className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Timezone'}
              </button>
            </div>
          </div>
          )}

          {/* Email SMTP Configuration Tab */}
          {activeTab === 'email' && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Email SMTP Configuration
            </h2>
            <form onSubmit={handleEmailSubmit} className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-4">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="ml-3 flex-1">
                    <p className="text-sm text-blue-700">
                      Configure SMTP settings to enable email notifications for downtime alerts. Changes take effect immediately without requiring a restart.
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <label htmlFor="smtp_host" className="block text-sm font-medium text-gray-700 mb-1">
                  SMTP Host <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="smtp_host"
                  name="smtp_host"
                  value={emailSettings.smtp_host}
                  onChange={handleEmailChange}
                  placeholder="smtp.gmail.com"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  required
                />
                <p className="mt-1 text-xs text-gray-500">
                  Your SMTP server hostname (e.g., smtp.gmail.com, smtp.sendgrid.net)
                </p>
              </div>

              <div>
                <label htmlFor="smtp_port" className="block text-sm font-medium text-gray-700 mb-1">
                  SMTP Port <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  id="smtp_port"
                  name="smtp_port"
                  value={emailSettings.smtp_port}
                  onChange={handleEmailChange}
                  placeholder="587"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  required
                />
                <p className="mt-1 text-xs text-gray-500">
                  Common ports: 587 (TLS), 465 (SSL), 25 (unsecured)
                </p>
              </div>

              <div>
                <label htmlFor="smtp_user" className="block text-sm font-medium text-gray-700 mb-1">
                  SMTP Username <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="smtp_user"
                  name="smtp_user"
                  value={emailSettings.smtp_user}
                  onChange={handleEmailChange}
                  placeholder="your-email@gmail.com"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  required
                />
                <p className="mt-1 text-xs text-gray-500">
                  Your SMTP authentication username (usually your email address)
                </p>
              </div>

              <div>
                <label htmlFor="smtp_pass" className="block text-sm font-medium text-gray-700 mb-1">
                  SMTP Password <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  id="smtp_pass"
                  name="smtp_pass"
                  value={emailSettings.smtp_pass}
                  onChange={handleEmailChange}
                  placeholder="••••••••••••••••"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  required
                />
                <p className="mt-1 text-xs text-gray-500">
                  For Gmail, use an App Password (not your regular password). <a href="https://support.google.com/accounts/answer/185833" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-700 underline">Learn more</a>
                </p>
              </div>

              <div>
                <label htmlFor="smtp_from" className="block text-sm font-medium text-gray-700 mb-1">
                  From Address <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="smtp_from"
                  name="smtp_from"
                  value={emailSettings.smtp_from}
                  onChange={handleEmailChange}
                  placeholder="Status Monitor <noreply@example.com>"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  required
                />
                <p className="mt-1 text-xs text-gray-500">
                  The "From" name and email address for outgoing emails
                </p>
              </div>

              <div>
                <label htmlFor="smtp_recipients" className="block text-sm font-medium text-gray-700 mb-1">
                  Recipient Email(s) <span className="text-red-500">*</span>
                </label>
                <div className="w-full min-h-[42px] px-3 py-2 border border-gray-300 rounded-md shadow-sm focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 bg-white">
                  <div className="flex flex-wrap gap-2 items-center">
                    {emailTags.map((email, index) => (
                      <span
                        key={index}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 text-sm rounded-md"
                      >
                        {email}
                        <button
                          type="button"
                          onClick={() => removeEmailTag(index)}
                          className="hover:bg-blue-200 rounded-full p-0.5 transition-colors"
                        >
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                          </svg>
                        </button>
                      </span>
                    ))}
                    <input
                      type="text"
                      id="smtp_recipients"
                      value={emailInputValue}
                      onChange={handleEmailTagInput}
                      onKeyDown={handleEmailTagKeyDown}
                      onBlur={addEmailTag}
                      placeholder={emailTags.length === 0 ? "Type email and press Enter or comma" : ""}
                      className="flex-1 min-w-[200px] outline-none border-0 focus:ring-0 p-0"
                    />
                  </div>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Type an email address and press Enter, comma, or space to add. Click × to remove.
                </p>
              </div>

              {/* Example Configuration */}
              <div className="mt-4 p-4 bg-gray-50 rounded-md border border-gray-200">
                <h3 className="text-sm font-semibold text-gray-900 mb-2">Example: Gmail Configuration</h3>
                <div className="text-xs text-gray-600 space-y-1 font-mono">
                  <p><strong>Host:</strong> smtp.gmail.com</p>
                  <p><strong>Port:</strong> 587</p>
                  <p><strong>Username:</strong> your-email@gmail.com</p>
                  <p><strong>Password:</strong> Your 16-character App Password</p>
                  <p><strong>From:</strong> Status Monitor &lt;your-email@gmail.com&gt;</p>
                </div>
                <div className="mt-2">
                  <p className="text-xs text-gray-600 mb-1"><strong>Recipients:</strong></p>
                  <div className="flex flex-wrap gap-2">
                    <span className="inline-flex items-center px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-md">admin@company.com</span>
                    <span className="inline-flex items-center px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-md">alerts@company.com</span>
                  </div>
                </div>
                <p className="text-xs text-gray-600 mt-2">
                  <strong>Note:</strong> Don't forget to enable "Email Notifications" checkbox above to start receiving alerts.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row justify-end gap-3">
                <button
                  type="button"
                  onClick={handleTestEmail}
                  disabled={testingEmail || saving}
                  className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                >
                  {testingEmail ? 'Sending Test Email...' : 'Send Test Email'}
                </button>
                <button
                  type="submit"
                  disabled={saving || testingEmail}
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Update Email Settings'}
                </button>
              </div>
            </form>
          </div>
          )}
        </div>
      </main>

      {/* Footer with Version */}
      <footer className="bg-white border-t border-gray-200 mt-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="text-center text-sm text-gray-500">
            {version && (
              <p>Pabbly Status Monitor v{version}</p>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
