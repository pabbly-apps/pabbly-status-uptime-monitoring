import api from './api';

// API Management
export const getAllAPIs = async () => {
  const response = await api.get('/admin/apis');
  return response.data;
};

export const getAPIById = async (id) => {
  const response = await api.get(`/admin/apis/${id}`);
  return response.data;
};

export const createAPI = async (apiData) => {
  const response = await api.post('/admin/apis', apiData);
  return response.data;
};

export const updateAPI = async (id, apiData) => {
  const response = await api.put(`/admin/apis/${id}`, apiData);
  return response.data;
};

export const deleteAPI = async (id) => {
  const response = await api.delete(`/admin/apis/${id}`);
  return response.data;
};

export const reorderAPIs = async (apiIds) => {
  const response = await api.put('/admin/apis-reorder', { apiIds });
  return response.data;
};

// API Groups Management
export const getAPIGroups = async () => {
  const response = await api.get('/admin/api-groups');
  return response.data;
};

export const getAPIGroup = async (id) => {
  const response = await api.get(`/admin/api-groups/${id}`);
  return response.data;
};

export const createAPIGroup = async (groupData) => {
  const response = await api.post('/admin/api-groups', groupData);
  return response.data;
};

export const updateAPIGroup = async (id, groupData) => {
  const response = await api.put(`/admin/api-groups/${id}`, groupData);
  return response.data;
};

export const deleteAPIGroup = async (id) => {
  const response = await api.delete(`/admin/api-groups/${id}`);
  return response.data;
};

export const reorderAPIGroups = async (groupIds) => {
  const response = await api.put('/admin/api-groups-reorder', { groupIds });
  return response.data;
};

// Dashboard Stats
export const getDashboardStats = async () => {
  const response = await api.get('/admin/dashboard-stats');
  return response.data;
};

// Ping Logs
export const getPingLogs = async (apiId, limit = 100) => {
  const response = await api.get(`/admin/logs/${apiId}`, {
    params: { limit },
  });
  return response.data;
};

// Analytics
export const getAPIAnalytics = async (apiId, days = 7) => {
  const response = await api.get(`/admin/analytics/${apiId}`, {
    params: { days },
  });
  return response.data;
};

// Incidents
export const getAllIncidents = async () => {
  const response = await api.get('/admin/incidents');
  return response.data;
};

export const createIncident = async (incidentData) => {
  const response = await api.post('/admin/incidents', incidentData);
  return response.data;
};

export const updateIncident = async (id, incidentData) => {
  const response = await api.put(`/admin/incidents/${id}`, incidentData);
  return response.data;
};

export const deleteIncident = async (id) => {
  const response = await api.delete(`/admin/incidents/${id}`);
  return response.data;
};

// Settings
export const getSettings = async () => {
  const response = await api.get('/admin/settings');
  return response.data;
};

export const updateSettings = async (settingsData) => {
  const response = await api.put('/admin/settings', settingsData);
  return response.data;
};

export const uploadLogo = async (file) => {
  const formData = new FormData();
  formData.append('logo', file);

  const response = await api.post('/admin/upload-logo', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
};

// Webhooks
export const getWebhookLogs = async (limit = 50, offset = 0, apiId = null) => {
  const params = { limit, offset };
  if (apiId) {
    params.apiId = apiId;
  }
  const response = await api.get('/admin/webhook-logs', { params });
  return response.data;
};

export const testWebhook = async () => {
  const response = await api.post('/admin/webhook-test');
  return response.data;
};

// Google Chat Webhook
export const testGoogleChat = async () => {
  const response = await api.post('/admin/google-chat-test');
  return response.data;
};

// Critical Phone Alarm (Home Assistant)
export const testCriticalAlert = async () => {
  const response = await api.post('/admin/critical-alert-test');
  return response.data;
};

// Email SMTP Settings
export const getEmailSettings = async () => {
  const response = await api.get('/admin/email-settings');
  return response.data;
};

export const updateEmailSettings = async (emailData) => {
  const response = await api.put('/admin/email-settings', emailData);
  return response.data;
};

export const testEmail = async () => {
  const response = await api.post('/admin/email-test');
  return response.data;
};

// Version
export const getVersion = async () => {
  const response = await api.get('/admin/version');
  return response.data;
};
