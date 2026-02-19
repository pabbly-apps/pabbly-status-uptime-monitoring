import express from 'express';
import {
  getAllAPIs,
  getAPIById,
  createAPI,
  updateAPI,
  deleteAPI,
  reorderAPIs,
  getDashboardStats,
  getPingLogs,
  getAPIAnalytics,
  getIncidents,
  createIncident,
  updateIncident,
  deleteIncident,
  getSettings,
  updateSettings,
  getWebhookLogs,
  testWebhookEndpoint,
  testWebhook,
  uploadLogo,
  getEmailSettings,
  updateEmailSettings,
  testEmailSettings,
  getVersion,
  getAPIGroups,
  getAPIGroup,
  createAPIGroup,
  updateAPIGroup,
  deleteAPIGroup,
  reorderAPIGroups,
  testGoogleChat,
} from '../controllers/adminController.js';
import { authenticateToken } from '../middleware/auth.js';
import upload from '../config/upload.js';

const router = express.Router();

// All admin routes require authentication
router.use(authenticateToken);

// API Management
router.get('/apis', getAllAPIs);
router.get('/apis/:id', getAPIById);
router.post('/apis', createAPI);
router.put('/apis/:id', updateAPI);
router.delete('/apis/:id', deleteAPI);
router.put('/apis-reorder', reorderAPIs);

// API Groups Management
router.get('/api-groups', getAPIGroups);
router.get('/api-groups/:id', getAPIGroup);
router.post('/api-groups', createAPIGroup);
router.put('/api-groups/:id', updateAPIGroup);
router.delete('/api-groups/:id', deleteAPIGroup);
router.put('/api-groups-reorder', reorderAPIGroups);

// Dashboard Stats
router.get('/dashboard-stats', getDashboardStats);

// Logs & Analytics
router.get('/logs/:apiId', getPingLogs);
router.get('/analytics/:apiId', getAPIAnalytics);

// Incidents
router.get('/incidents', getIncidents);
router.post('/incidents', createIncident);
router.put('/incidents/:id', updateIncident);
router.delete('/incidents/:id', deleteIncident);

// Settings
router.get('/settings', getSettings);
router.put('/settings', updateSettings);

// Logo Upload
router.post('/upload-logo', upload.single('logo'), uploadLogo);

// Email SMTP Settings
router.get('/email-settings', getEmailSettings);
router.put('/email-settings', updateEmailSettings);
router.post('/email-test', testEmailSettings);

// Webhooks
router.get('/webhook-logs', getWebhookLogs);
router.post('/webhook-test', testWebhook);
router.post('/test-webhook-endpoint', testWebhookEndpoint);

// Google Chat Webhook
router.post('/google-chat-test', testGoogleChat);

// Version
router.get('/version', getVersion);

export default router;
