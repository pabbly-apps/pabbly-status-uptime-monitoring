# Deployment Guide - Hetzner Server

This guide will help you deploy the Pabbly Status Monitoring application on a Hetzner server with 4GB RAM.

## Server Requirements

- Ubuntu 22.04 LTS (recommended)
- 4GB RAM
- 2 CPU cores
- 40GB+ SSD storage
- Root or sudo access

## Step 1: Initial Server Setup

### 1.1 Connect to your server
```bash
ssh root@your-server-ip
```

### 1.2 Update system packages
```bash
apt update && apt upgrade -y
```

## Step 2: Install Required Software

### 2.1 Install Node.js 22.x LTS
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node --version  # Should show v22.x
npm --version
```

### 2.2 Install PostgreSQL 14
```bash
apt install -y postgresql postgresql-contrib
systemctl start postgresql
systemctl enable postgresql
```

### 2.3 Install Nginx
```bash
apt install -y nginx
systemctl start nginx
systemctl enable nginx
```

### 2.4 Install PM2 (Process Manager)
```bash
npm install -g pm2
```

### 2.5 Install Git
```bash
apt install -y git
```

## Step 3: Setup PostgreSQL Database

### 3.1 Create database and user
```bash
sudo -u postgres psql
```

```sql
CREATE DATABASE status_monitor;
CREATE USER status_user WITH PASSWORD 'your_secure_password_here';
GRANT ALL PRIVILEGES ON DATABASE status_monitor TO status_user;
\q
```

### 3.2 Configure PostgreSQL for local access
```bash
nano /etc/postgresql/14/main/pg_hba.conf
```

Add this line before other entries:
```
local   status_monitor   status_user   md5
```

Restart PostgreSQL:
```bash
systemctl restart postgresql
```

## Step 4: Clone and Setup Application

### 4.1 Clone repository
```bash
cd /root
git clone https://github.com/pabbly-apps/pabbly-status-uptime-monitoring.git
cd pabbly-status-uptime-monitoring
```

### 4.2 Setup Database Schema
```bash
# Run all migrations in order
for file in database/migrations/*.sql; do
  echo "Running $file..."
  psql -U status_user -d status_monitor -f "$file"
done

# Seed initial data
psql -U status_user -d status_monitor -f database/seeds/001_default_admin.sql
```

### 4.3 Setup Backend
```bash
cd backend
npm install --production

# Create production .env file
nano .env
```

Add the following (update values accordingly):
```env
DATABASE_URL=postgresql://status_user:your_secure_password_here@localhost:5432/status_monitor
JWT_SECRET=generate-a-long-random-secret-key-here
JWT_EXPIRY=7d
PORT=5000
NODE_ENV=production
PING_INTERVAL_MINUTES=1
LOG_RETENTION_DAYS=90
FRONTEND_URL=https://status.yourdomain.com
```

### 4.4 Setup Frontend
```bash
cd ../frontend
npm install

# Create production .env file
nano .env
```

Add:
```env
VITE_API_URL=https://status.yourdomain.com/api
```

Build frontend:
```bash
npm run build
```

## Step 5: Setup PM2 for Backend

### 5.1 Start backend with PM2
```bash
cd /root/pabbly-status-uptime-monitoring/backend
pm2 start src/server.js --name pabbly-status-backend
pm2 save
pm2 startup
```

Copy and run the command that PM2 outputs.

### 5.2 Verify backend is running
```bash
pm2 status
pm2 logs pabbly-status-backend
```

## Step 6: Configure Nginx

### 6.1 Create Nginx configuration
```bash
nano /etc/nginx/sites-available/pabbly-status
```

Add the following configuration:
```nginx
server {
    listen 80;
    server_name status.yourdomain.com;

    # Frontend - Serve built React app
    root /root/pabbly-status-uptime-monitoring/frontend/dist;
    index index.html;

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

    # Frontend routes - try files first, then fallback to index.html for SPA routing
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Backend API proxy
    location /api/ {
        proxy_pass http://localhost:5000/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Health check endpoint
    location /health {
        proxy_pass http://localhost:5000/health;
    }
}
```

### 6.2 Enable the site
```bash
ln -s /etc/nginx/sites-available/pabbly-status /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

## Step 7: Setup SSL with Let's Encrypt (Optional but Recommended)

### 7.1 Install Certbot
```bash
apt install -y certbot python3-certbot-nginx
```

### 7.2 Obtain SSL certificate
```bash
certbot --nginx -d status.yourdomain.com
```

Follow the prompts. Certbot will automatically configure Nginx for HTTPS.

### 7.3 Setup auto-renewal
```bash
systemctl status certbot.timer
```

## Step 8: Configure Firewall

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
ufw status
```

## Step 9: Post-Deployment Steps

### 9.1 Change default admin password
1. Visit https://status.yourdomain.com/admin/login
2. Login with default credentials (see database seed file)
3. Go to Settings and change your password immediately
4. Update your email if needed

### 9.2 Configure webhook and email settings
1. In Settings, add your webhook URL for notifications
2. Configure email notifications in Admin Settings → Email tab (changes take effect immediately)

### 9.3 Add your APIs to monitor
1. Go to Admin Dashboard → APIs
2. Add your APIs with their endpoints

## Monitoring and Maintenance

### View application logs
```bash
# Backend logs
pm2 logs pabbly-status-backend

# Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### Restart services
```bash
# Restart backend
pm2 restart pabbly-status-backend

# Restart Nginx
sudo systemctl restart nginx

# Restart PostgreSQL
sudo systemctl restart postgresql
```

### Update application
```bash
cd /root/pabbly-status-uptime-monitoring
git pull origin main

# Update backend
cd backend
npm install --production

# Apply any new database migrations (REQUIRED - skipping this breaks the
# admin dashboard when a release adds columns)
npm run migrate

pm2 restart pabbly-status-backend

# Update frontend
cd ../frontend
npm install
npm run build
```

### Database backup
```bash
# Create backup
pg_dump -U status_user status_monitor > backup_$(date +%Y%m%d_%H%M%S).sql

# Restore backup
psql -U status_user status_monitor < backup_file.sql
```

### Setup automated backups (cron)
```bash
crontab -e
```

Add:
```cron
# Daily database backup at 2 AM
0 2 * * * pg_dump -U status_user status_monitor > /root/backups/db_$(date +\%Y\%m\%d).sql

# Keep only last 7 days of backups
0 3 * * * find /root/backups -name "db_*.sql" -mtime +7 -delete
```

## Troubleshooting

### Backend not starting
```bash
pm2 logs pabbly-status-backend --lines 100
```

### Database connection issues
```bash
psql -U status_user -d status_monitor
# If this works, check DATABASE_URL in .env
```

### Nginx 502 Bad Gateway
```bash
# Check if backend is running
pm2 status

# Check Nginx error log
tail -f /var/log/nginx/error.log
```

### Frontend not loading
```bash
# Check if build exists
ls -la /root/pabbly-status-uptime-monitoring/frontend/dist

# Rebuild if needed
cd /root/pabbly-status-uptime-monitoring/frontend
npm run build
```

## Performance Optimization

### For 4GB RAM server
```bash
# Limit PM2 instances
pm2 start src/server.js --name pabbly-status-backend --max-memory-restart 1G

# Configure PostgreSQL for 4GB RAM
nano /etc/postgresql/14/main/postgresql.conf
```

Recommended PostgreSQL settings for 4GB RAM:
```conf
shared_buffers = 1GB
effective_cache_size = 3GB
maintenance_work_mem = 256MB
checkpoint_completion_target = 0.9
wal_buffers = 16MB
default_statistics_target = 100
random_page_cost = 1.1
effective_io_concurrency = 200
work_mem = 5242kB
min_wal_size = 1GB
max_wal_size = 4GB
```

Then restart PostgreSQL:
```bash
systemctl restart postgresql
```

## Security Hardening

1. **Change default admin credentials immediately**
2. **Use strong JWT_SECRET** (generate with: `openssl rand -base64 32`)
3. **Keep system updated**: `apt update && apt upgrade`
4. **Setup fail2ban** to prevent brute force attacks:
   ```bash
   apt install fail2ban
   systemctl enable fail2ban
   ```
5. **Use SSH keys instead of passwords**
6. **Regular database backups**

## Support

For issues, check logs first:
- Backend: `pm2 logs pabbly-status-backend`
- Nginx: `/var/log/nginx/error.log`
- PostgreSQL: `/var/log/postgresql/postgresql-14-main.log`

For additional help, open an issue on GitHub.
