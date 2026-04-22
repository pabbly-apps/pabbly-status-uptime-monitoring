import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './config/database.js';
import { query } from './config/database.js';
import { startMonitoring } from './services/monitorService.js';
import { startUptimeCalculations } from './services/uptimeService.js';

// Load environment variables
dotenv.config();

// ES modules __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files statically with security headers
app.use('/uploads', express.static(path.join(__dirname, '../uploads'), {
  setHeaders: (res) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'public, max-age=86400');
  }
}));


// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Test database connection
    await pool.query('SELECT 1');
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: 'Database connection failed',
    });
  }
});

// API routes (to be added)
app.get('/api', (req, res) => {
  res.json({
    message: 'Status Monitor API',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      admin: '/api/admin',
      public: '/api/public',
    },
  });
});

// Import routes
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import publicRoutes from './routes/public.js';

// Use routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/public', publicRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.path}`,
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// Start server
app.listen(PORT, async () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📍 API: http://localhost:${PORT}/api`);
  console.log(`💚 Health check: http://localhost:${PORT}/health`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}\n`);

  // Seed default admin(s) if no users exist
  try {
    const userCount = await query('SELECT COUNT(*) as count FROM admin_user');
    if (parseInt(userCount.rows[0].count) === 0) {
      const adminEmails = process.env.ADMIN_EMAIL;
      if (adminEmails) {
        const emails = adminEmails.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
        for (const email of emails) {
          await query(
            'INSERT INTO admin_user (email, full_name, is_active) VALUES ($1, $2, TRUE) ON CONFLICT (email) DO NOTHING',
            [email, 'Admin']
          );
        }
        console.log(`✅ Default admin(s) created: ${emails.join(', ')}`);
      } else {
        console.warn('⚠️  No users found and ADMIN_EMAIL is not set in .env. No one will be able to login.');
      }
    }
  } catch (error) {
    console.error('Failed to seed default admin:', error.message);
  }

  // Start background services
  console.log('═══════════════════════════════════════════════════');
  console.log('🔧 Starting background services...\n');

  // Start monitoring service (pings APIs every minute)
  startMonitoring();

  // Start uptime calculation service (calculates summaries hourly)
  startUptimeCalculations();

  console.log('═══════════════════════════════════════════════════\n');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server');
  await pool.end();
  process.exit(0);
});

export default app;

 
