# Automated Deployment Guide - Hetzner Server

This guide explains how to automatically deploy updates to your Hetzner server running the Pabbly Status Monitor application.

## Prerequisites

Before using automated deployment, you must complete the initial manual setup once. See [DEPLOYMENT.md](DEPLOYMENT.md) for the complete initial setup guide.

### One-Time Setup Requirements

1. ✅ Server provisioned with Ubuntu 22.04
2. ✅ Node.js, PostgreSQL, Nginx, PM2 installed
3. ✅ Database created and initial migrations run
4. ✅ Environment files (.env) configured
5. ✅ SSL certificate installed
6. ✅ Application running and accessible at https://monitor.pabbly.com

## Automated Deployment Methods

### Method 1: Using Deployment Script (Recommended)

The `deploy.sh` script automates the deployment process from your local machine.

#### Setup SSH Key Authentication

First, set up passwordless SSH access to your server:

```bash
# On your local machine (Windows users: use Git Bash or WSL)

# Generate SSH key if you don't have one
ssh-keygen -t ed25519 -C "your-email@example.com"

# Copy SSH key to server
ssh-copy-id root@your-server-ip
```

#### Run Deployment Script

```bash
# Make script executable (Linux/Mac/Git Bash)
chmod +x deploy.sh

# Deploy to production
./deploy.sh your-server-ip root

# Example:
./deploy.sh 123.45.67.89 root
```

**What the script does:**
1. ✅ Pulls latest code from GitHub
2. ✅ Installs backend dependencies
3. ✅ Builds frontend production bundle
4. ✅ Runs any pending database migrations
5. ✅ Restarts backend with PM2
6. ✅ Reloads Nginx
7. ✅ Verifies service health
8. ✅ Displays deployment summary

### Method 2: GitHub Actions CI/CD

Set up automated deployment on every push to the `main` branch.

#### Step 1: Add Server SSH Key to GitHub Secrets

1. Go to your GitHub repository: https://github.com/pabbly-apps/pabbly-status-uptime-monitoring
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add these secrets:

| Secret Name | Value |
|------------|-------|
| `SSH_PRIVATE_KEY` | Your private SSH key (`~/.ssh/id_ed25519` content) |
| `SSH_HOST` | Your server IP (e.g., `123.45.67.89`) |
| `SSH_USER` | SSH username (`root`) |

#### Step 2: Create GitHub Actions Workflow

The workflow file `.github/workflows/deploy.yml` is already included in the repository. It will:
- Trigger on push to `main` branch
- SSH into your server
- Pull latest code
- Install dependencies
- Build frontend
- Run migrations
- Restart services

#### Step 3: Enable GitHub Actions

Push your code to trigger the first automated deployment:

```bash
git add .
git commit -m "Enable automated deployment"
git push origin main
```

Monitor the deployment progress at:
https://github.com/pabbly-apps/pabbly-status-uptime-monitoring/actions

### Method 3: Manual Server-Side Deployment

SSH into your server and run these commands manually:

```bash
# SSH into server
ssh root@your-server-ip

# Navigate to app directory
cd /root/pabbly-status-uptime-monitoring

# Pull latest code
git pull origin main

# Update backend
cd backend
npm install --production
cd ..

# Update frontend
cd frontend
npm install
npm run build
cd ..

# Run migrations (REQUIRED - the app will not start correctly without this)
cd backend
npm run migrate
cd ..

# Restart backend
pm2 restart pabbly-status-backend

# Reload Nginx
systemctl reload nginx

# Check status
pm2 status
pm2 logs pabbly-status-backend --lines 20
```

## Deployment Workflow

### Development → Production Flow

1. **Local Development**
   ```bash
   # Make your changes locally
   git add .
   git commit -m "Your changes"
   git push origin main
   ```

2. **Automated Deployment** (if GitHub Actions enabled)
   - GitHub Actions automatically deploys to production
   - Monitor at: https://github.com/pabbly-apps/pabbly-status-uptime-monitoring/actions

3. **Manual Deployment** (if using deploy script)
   ```bash
   ./deploy.sh your-server-ip pabbly
   ```

4. **Verify Deployment**
   - Visit: https://monitor.pabbly.com
   - Check backend logs: `ssh root@server-ip 'pm2 logs pabbly-status-backend --lines 50'`
   - Check PM2 status: `ssh root@server-ip 'pm2 status'`

## Database Migrations

Migrations are automatically run during deployment. The script is idempotent - it's safe to run multiple times.

### Manual Migration Execution

If you need to run migrations manually:

```bash
ssh root@your-server-ip

cd /root/pabbly-status-uptime-monitoring

# Run specific migration
psql -U status_user -d status_monitor -f database/migrations/013_your_migration.sql

# Or run all migrations
for file in database/migrations/*.sql; do
  psql -U status_user -d status_monitor -f "$file"
done
```

## Rollback Procedure

If a deployment fails, you can rollback:

```bash
ssh root@your-server-ip

cd /root/pabbly-status-uptime-monitoring

# View commit history
git log --oneline -10

# Rollback to previous commit
git reset --hard <commit-hash>

# Rebuild frontend
cd frontend
npm run build
cd ..

# Restart backend
pm2 restart pabbly-status-backend

# Reload Nginx
systemctl reload nginx
```

## Monitoring Deployment

### View Real-time Logs

```bash
# Backend application logs
ssh root@your-server-ip 'pm2 logs pabbly-status-backend'

# PM2 status
ssh root@your-server-ip 'pm2 status'

# Nginx access logs
ssh root@your-server-ip 'tail -f /var/log/nginx/access.log'

# Nginx error logs
ssh root@your-server-ip 'tail -f /var/log/nginx/error.log'
```

### Health Checks

```bash
# Check backend health endpoint
curl https://monitor.pabbly.com/health

# Check PM2 process
ssh root@your-server-ip 'pm2 describe pabbly-status-backend'

# Check Nginx status
ssh root@your-server-ip 'systemctl status nginx'

# Check PostgreSQL status
ssh root@your-server-ip 'systemctl status postgresql'
```

## Troubleshooting Deployments

### Backend Won't Start After Deployment

```bash
# Check logs
ssh root@your-server-ip 'pm2 logs pabbly-status-backend --lines 100'

# Check if .env exists
ssh root@your-server-ip 'ls -la /root/pabbly-status-uptime-monitoring/backend/.env'

# Verify database connection
ssh root@your-server-ip 'psql -U status_user -d status_monitor -c "SELECT 1"'
```

### Frontend Not Updating

```bash
# Rebuild frontend
ssh root@your-server-ip 'cd /root/pabbly-status-uptime-monitoring/frontend && npm run build'

# Check build directory
ssh root@your-server-ip 'ls -la /root/pabbly-status-uptime-monitoring/frontend/dist'

# Clear browser cache and reload
# Use Ctrl+Shift+R or Cmd+Shift+R
```

### Migration Errors

```bash
# Check PostgreSQL logs
ssh root@your-server-ip 'tail -100 /var/log/postgresql/postgresql-14-main.log'

# Manually run failed migration
ssh root@your-server-ip
psql -U status_user -d status_monitor -f database/migrations/XXX_migration_name.sql
```

### 502 Bad Gateway After Deployment

```bash
# Check if backend is running
ssh root@your-server-ip 'pm2 status'

# Restart backend
ssh root@your-server-ip 'pm2 restart pabbly-status-backend'

# Check Nginx error log
ssh root@your-server-ip 'tail -50 /var/log/nginx/error.log'
```

## Best Practices

### 1. **Test Before Deploying**
```bash
# Run tests locally first
cd backend
npm test  # If you have tests

# Build frontend locally to catch errors
cd frontend
npm run build
```

### 2. **Deploy During Low Traffic**
- Schedule deployments during off-peak hours
- Notify users of maintenance window if needed

### 3. **Monitor After Deployment**
```bash
# Watch logs for 5 minutes after deployment
ssh root@your-server-ip 'pm2 logs pabbly-status-backend'

# Check health endpoint
curl https://monitor.pabbly.com/health
```

### 4. **Keep Backups**
```bash
# Database backup before major changes
ssh root@your-server-ip 'pg_dump -U status_user status_monitor > ~/backup_$(date +%Y%m%d_%H%M%S).sql'
```

### 5. **Use Git Tags for Releases**
```bash
# Tag stable releases
git tag -a v1.0.0 -m "Release version 1.0.0"
git push origin v1.0.0

# Deploy specific version
ssh root@your-server-ip 'cd /root/pabbly-status-uptime-monitoring && git checkout v1.0.0'
```

## Zero-Downtime Deployment

For production environments with high availability requirements:

1. **Use PM2 Cluster Mode**
   ```bash
   pm2 start src/server.js --name pabbly-status-backend -i 2  # 2 instances
   pm2 reload pabbly-status-backend  # Reload without downtime
   ```

2. **Use Blue-Green Deployment**
   - Keep two application directories
   - Switch Nginx upstream between them
   - Rollback by switching back

## Environment-Specific Configurations

### Production vs Staging

If you have multiple environments:

```bash
# Deploy to staging
./deploy.sh staging-server-ip root

# Deploy to production
./deploy.sh production-server-ip root
```

Create environment-specific branches:
- `main` → Production
- `staging` → Staging environment
- `develop` → Development environment

## Security Considerations

1. **Never commit .env files** - Already in .gitignore
2. **Use SSH keys** - No password authentication
3. **Restrict SSH access** - Only allow specific IPs if possible
4. **Rotate secrets regularly** - Update JWT_SECRET periodically
5. **Keep dependencies updated** - Run `npm audit` regularly

## Support

For deployment issues:
1. Check logs: `pm2 logs pabbly-status-backend`
2. Verify environment: `ssh root@server-ip 'cat /root/pabbly-status-uptime-monitoring/backend/.env'`
3. Review this guide: [DEPLOYMENT.md](DEPLOYMENT.md)
4. Open issue: https://github.com/pabbly-apps/pabbly-status-uptime-monitoring/issues

## Quick Reference Commands

```bash
# Deploy (automated)
./deploy.sh your-server-ip root

# Deploy (manual)
ssh root@server-ip 'cd ~/pabbly-status-uptime-monitoring && git pull && cd backend && npm install --production && npm run migrate && cd ../frontend && npm install && npm run build && pm2 restart pabbly-status-backend'

# Rollback
ssh root@server-ip 'cd ~/pabbly-status-uptime-monitoring && git reset --hard HEAD~1 && cd frontend && npm run build && pm2 restart pabbly-status-backend'

# View logs
ssh root@server-ip 'pm2 logs pabbly-status-backend'

# Check status
ssh root@server-ip 'pm2 status && curl -I https://monitor.pabbly.com/health'
```
