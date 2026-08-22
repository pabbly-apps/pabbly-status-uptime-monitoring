#!/bin/bash

################################################################################
# Status Monitor - One-Command Installation Script
################################################################################
# This script will completely set up Status Monitor on your server
# Usage: curl -sSL https://raw.githubusercontent.com/pabbly-apps/pabbly-status-uptime-monitoring/main/install.sh | bash
################################################################################

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Clear screen and show banner
clear
echo -e "${BLUE}${BOLD}"
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                                                                ║"
echo "║           Status Monitor - Automated Installation             ║"
echo "║                                                                ║"
echo "║     Complete setup in ~10 minutes with SSL, Nginx & PM2       ║"
echo "║                                                                ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Error: This script must be run as root${NC}"
    echo "Please run: sudo bash install.sh"
    exit 1
fi

################################################################################
# Detect Linux Distribution
################################################################################

echo -e "${GREEN}Detecting Linux distribution...${NC}"

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
    OS_VERSION=$VERSION_ID
else
    echo -e "${RED}Cannot detect Linux distribution${NC}"
    exit 1
fi

# Determine package manager and commands
case $OS in
    ubuntu|debian)
        PKG_MANAGER="apt-get"
        PKG_UPDATE="apt-get update -qq"
        PKG_INSTALL="apt-get install -y -qq"
        PKG_UPGRADE="apt-get upgrade -y -qq"
        POSTGRES_SERVICE="postgresql"
        echo -e "  ✓ Detected: ${GREEN}$OS $OS_VERSION${NC} (Debian-based)"
        ;;
    centos|rhel|rocky|almalinux)
        PKG_MANAGER="yum"
        PKG_UPDATE="yum check-update"
        PKG_INSTALL="yum install -y -q"
        PKG_UPGRADE="yum upgrade -y -q"
        POSTGRES_SERVICE="postgresql"
        echo -e "  ✓ Detected: ${GREEN}$OS $OS_VERSION${NC} (RHEL-based)"
        ;;
    fedora)
        PKG_MANAGER="dnf"
        PKG_UPDATE="dnf check-update"
        PKG_INSTALL="dnf install -y -q"
        PKG_UPGRADE="dnf upgrade -y -q"
        POSTGRES_SERVICE="postgresql"
        echo -e "  ✓ Detected: ${GREEN}$OS $OS_VERSION${NC} (Fedora)"
        ;;
    arch|manjaro)
        PKG_MANAGER="pacman"
        PKG_UPDATE="pacman -Sy"
        PKG_INSTALL="pacman -S --noconfirm"
        PKG_UPGRADE="pacman -Syu --noconfirm"
        POSTGRES_SERVICE="postgresql"
        echo -e "  ✓ Detected: ${GREEN}$OS $OS_VERSION${NC} (Arch-based)"
        ;;
    *)
        echo -e "${YELLOW}Warning: Unknown distribution: $OS${NC}"
        echo -e "${YELLOW}This script works best on Ubuntu, Debian, CentOS, RHEL, Fedora, or Arch${NC}"
        read -p "Continue anyway? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
        # Default to apt-get
        PKG_MANAGER="apt-get"
        PKG_UPDATE="apt-get update"
        PKG_INSTALL="apt-get install -y"
        PKG_UPGRADE="apt-get upgrade -y"
        POSTGRES_SERVICE="postgresql"
        ;;
esac

echo ""

################################################################################
# Collect User Information
################################################################################

echo -e "${BOLD}Let's set up your Status Monitor!${NC}"
echo ""
echo -e "${YELLOW}Please provide the following information:${NC}"
echo ""

# 1. Domain Name
while true; do
    read -p "Enter your domain (e.g., status.example.com): " DOMAIN </dev/tty
    if [[ -z "$DOMAIN" ]]; then
        echo -e "${RED}Domain cannot be empty!${NC}"
    elif [[ ! "$DOMAIN" =~ ^[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z0-9][-\.a-zA-Z0-9]*$ ]]; then
        echo -e "${RED}Invalid domain format!${NC}"
    else
        break
    fi
done

# 2. Admin Email
while true; do
    read -p "Enter admin email for login: " ADMIN_EMAIL </dev/tty
    if [[ -z "$ADMIN_EMAIL" ]]; then
        echo -e "${RED}Email cannot be empty!${NC}"
    elif [[ ! "$ADMIN_EMAIL" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; then
        echo -e "${RED}Invalid email format!${NC}"
    else
        break
    fi
done

# 3. Generate secure passwords automatically
echo ""
echo -e "${GREEN}Generating secure passwords...${NC}"
DB_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
JWT_SECRET=$(openssl rand -base64 32)
ADMIN_PASSWORD=$(openssl rand -base64 12 | tr -d "=+/" | cut -c1-12)

echo ""
echo -e "${BOLD}Configuration Summary:${NC}"
echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  Domain:        ${GREEN}https://$DOMAIN${NC}"
echo -e "  Admin Email:   ${GREEN}$ADMIN_EMAIL${NC}"
echo -e "  Admin Pass:    ${GREEN}$ADMIN_PASSWORD${NC} ${YELLOW}(Save this!)${NC}"
echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
read -p "Continue with installation? (Y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Nn]$ ]]; then
    echo "Installation cancelled."
    exit 0
fi

################################################################################
# Installation Start
################################################################################

echo ""
echo -e "${BLUE}${BOLD}Starting installation...${NC}"
echo ""

# Standard database and app names (not asking user)
DB_NAME="status_monitor"
DB_USER="statusmonitor"
APP_DIR="/opt/status-monitor"
REPO_URL="https://github.com/pabbly-apps/pabbly-status-uptime-monitoring.git"

################################################################################
# Step 1: System Update
################################################################################
echo -e "${GREEN}[1/10] Updating system packages...${NC}"
export DEBIAN_FRONTEND=noninteractive
$PKG_UPDATE > /dev/null 2>&1 || true
$PKG_UPGRADE > /dev/null 2>&1

################################################################################
# Step 2: Install Node.js
################################################################################
echo -e "${GREEN}[2/10] Installing Node.js 22.x LTS...${NC}"
if ! command -v node &> /dev/null; then
    case $OS in
        ubuntu|debian)
            curl -fsSL https://deb.nodesource.com/setup_22.x | bash - > /dev/null 2>&1
            $PKG_INSTALL nodejs > /dev/null 2>&1
            ;;
        centos|rhel|rocky|almalinux|fedora)
            curl -fsSL https://rpm.nodesource.com/setup_22.x | bash - > /dev/null 2>&1
            $PKG_INSTALL nodejs > /dev/null 2>&1
            ;;
        arch|manjaro)
            $PKG_INSTALL nodejs npm > /dev/null 2>&1
            ;;
        *)
            curl -fsSL https://deb.nodesource.com/setup_22.x | bash - > /dev/null 2>&1
            $PKG_INSTALL nodejs > /dev/null 2>&1
            ;;
    esac
fi
echo -e "  ✓ Node.js $(node --version) installed"

################################################################################
# Step 3: Install PostgreSQL
################################################################################
echo -e "${GREEN}[3/10] Installing PostgreSQL...${NC}"
if ! command -v psql &> /dev/null; then
    case $OS in
        ubuntu|debian)
            $PKG_INSTALL postgresql postgresql-contrib > /dev/null 2>&1
            ;;
        centos|rhel|rocky|almalinux)
            $PKG_INSTALL postgresql-server postgresql-contrib > /dev/null 2>&1
            postgresql-setup --initdb > /dev/null 2>&1 || postgresql-setup initdb > /dev/null 2>&1
            ;;
        fedora)
            $PKG_INSTALL postgresql-server postgresql-contrib > /dev/null 2>&1
            postgresql-setup --initdb > /dev/null 2>&1
            ;;
        arch|manjaro)
            $PKG_INSTALL postgresql > /dev/null 2>&1
            sudo -u postgres initdb -D /var/lib/postgres/data > /dev/null 2>&1
            ;;
        *)
            $PKG_INSTALL postgresql postgresql-contrib > /dev/null 2>&1
            ;;
    esac
    systemctl start $POSTGRES_SERVICE
    systemctl enable $POSTGRES_SERVICE > /dev/null 2>&1
fi
echo -e "  ✓ PostgreSQL installed"

################################################################################
# Step 4: Install Nginx
################################################################################
echo -e "${GREEN}[4/10] Installing Nginx...${NC}"
if ! command -v nginx &> /dev/null; then
    $PKG_INSTALL nginx > /dev/null 2>&1
    systemctl start nginx
    systemctl enable nginx > /dev/null 2>&1
fi
echo -e "  ✓ Nginx installed"

################################################################################
# Step 5: Install PM2
################################################################################
echo -e "${GREEN}[5/10] Installing PM2...${NC}"
if ! command -v pm2 &> /dev/null; then
    npm install -g pm2 > /dev/null 2>&1
fi
echo -e "  ✓ PM2 installed"

################################################################################
# Step 6: Install Git and Certbot
################################################################################
echo -e "${GREEN}[6/10] Installing additional tools...${NC}"
case $OS in
    ubuntu|debian)
        $PKG_INSTALL git certbot python3-certbot-nginx > /dev/null 2>&1
        ;;
    centos|rhel|rocky|almalinux|fedora)
        # Enable EPEL repository for CentOS/RHEL
        if [[ "$OS" == "centos" || "$OS" == "rhel" || "$OS" == "rocky" || "$OS" == "almalinux" ]]; then
            $PKG_INSTALL epel-release > /dev/null 2>&1
        fi
        $PKG_INSTALL git certbot python3-certbot-nginx > /dev/null 2>&1
        ;;
    arch|manjaro)
        $PKG_INSTALL git certbot certbot-nginx > /dev/null 2>&1
        ;;
    *)
        $PKG_INSTALL git certbot > /dev/null 2>&1
        ;;
esac
echo -e "  ✓ Git and Certbot installed"

################################################################################
# Step 7: Setup Database
################################################################################
echo -e "${GREEN}[7/10] Setting up PostgreSQL database...${NC}"

# Create database and user
sudo -u postgres psql << EOF > /dev/null 2>&1
CREATE DATABASE $DB_NAME;
CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;
ALTER DATABASE $DB_NAME OWNER TO $DB_USER;
\c $DB_NAME
GRANT ALL ON SCHEMA public TO $DB_USER;
EOF

# Configure pg_hba.conf for local access
case $OS in
    ubuntu|debian)
        PG_VERSION=$(ls /etc/postgresql/ | head -n 1)
        PG_HBA="/etc/postgresql/$PG_VERSION/main/pg_hba.conf"
        PG_CONF="/etc/postgresql/$PG_VERSION/main/postgresql.conf"
        ;;
    centos|rhel|rocky|almalinux|fedora)
        PG_DATA="/var/lib/pgsql/data"
        PG_HBA="$PG_DATA/pg_hba.conf"
        PG_CONF="$PG_DATA/postgresql.conf"
        ;;
    arch|manjaro)
        PG_DATA="/var/lib/postgres/data"
        PG_HBA="$PG_DATA/pg_hba.conf"
        PG_CONF="$PG_DATA/postgresql.conf"
        ;;
    *)
        PG_VERSION=$(ls /etc/postgresql/ 2>/dev/null | head -n 1)
        if [ -n "$PG_VERSION" ]; then
            PG_HBA="/etc/postgresql/$PG_VERSION/main/pg_hba.conf"
        else
            PG_HBA="/var/lib/pgsql/data/pg_hba.conf"
        fi
        ;;
esac

# Add authentication rule if not exists
if [ -f "$PG_HBA" ]; then
    if ! grep -q "local.*$DB_NAME.*$DB_USER" "$PG_HBA"; then
        sed -i "/^local.*all.*postgres/a local   $DB_NAME   $DB_USER   md5" "$PG_HBA"
        systemctl restart $POSTGRES_SERVICE
    fi
fi

echo -e "  ✓ Database created: $DB_NAME"

################################################################################
# Step 8: Clone and Setup Application
################################################################################
echo -e "${GREEN}[8/10] Setting up application...${NC}"

# Clone repository
if [ -d "$APP_DIR" ]; then
    rm -rf "$APP_DIR"
fi
git clone -q "$REPO_URL" "$APP_DIR"

# Setup backend
cd "$APP_DIR/backend"

# Create .env file
cat > .env << EOF
# Database Configuration
DATABASE_URL=postgresql://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME

# JWT Authentication
JWT_SECRET=$JWT_SECRET
JWT_EXPIRY=7d

# Server Configuration
PORT=5000
NODE_ENV=production
PING_INTERVAL_MINUTES=1
LOG_RETENTION_DAYS=90
FRONTEND_URL=https://$DOMAIN
EOF

# Install backend dependencies
npm install --production --silent > /dev/null 2>&1

# Setup frontend
cd "$APP_DIR/frontend"

# Create frontend .env
cat > .env << EOF
VITE_API_URL=https://$DOMAIN/api
EOF

# Install and build frontend
npm install --silent > /dev/null 2>&1
npm run build > /dev/null 2>&1

echo -e "  ✓ Application files ready"

################################################################################
# Step 9: Run Database Schema with Custom Admin
################################################################################
echo -e "${GREEN}[9/10] Initializing database...${NC}"

# Generate bcrypt hash for admin password
cd "$APP_DIR/backend"
HASHED_PASSWORD=$(node -e "
const bcrypt = require('bcrypt');
const password = process.argv[1];
(async () => {
  const hash = await bcrypt.hash(password, 10);
  console.log(hash);
})();
" "$ADMIN_PASSWORD")

# Wait for async operation to complete
sleep 1

# Create temporary schema with custom admin
cd "$APP_DIR"
cp database/schema.sql /tmp/schema_temp.sql

# Replace admin email and password in schema
sed -i "s/'admin@example.com'/'$ADMIN_EMAIL'/g" /tmp/schema_temp.sql
sed -i "s/\\\$2b\\\$10\\\$VOgA\\.0dig5CThvoXu3JZteOHp5hVLygMmbF9dOP4rHOvLqHEMLAlK/$HASHED_PASSWORD/g" /tmp/schema_temp.sql

# Run schema
PGPASSWORD=$DB_PASSWORD psql -h localhost -U $DB_USER -d $DB_NAME -f /tmp/schema_temp.sql > /dev/null 2>&1
rm /tmp/schema_temp.sql

# Apply migrations. schema.sql already contains everything for a fresh install,
# but migrations are idempotent and this keeps the fresh-install and upgrade
# paths identical, so a missing migration can never silently break the app.
cd "$APP_DIR/backend"
npm run migrate > /dev/null 2>&1
cd "$APP_DIR"

echo -e "  ✓ Database initialized"

################################################################################
# Step 10: Configure Nginx
################################################################################
echo -e "${GREEN}[10/10] Configuring Nginx and SSL...${NC}"

# Determine Nginx config paths based on distribution
case $OS in
    ubuntu|debian)
        NGINX_AVAILABLE="/etc/nginx/sites-available"
        NGINX_ENABLED="/etc/nginx/sites-enabled"
        ;;
    centos|rhel|rocky|almalinux|fedora|arch|manjaro)
        NGINX_AVAILABLE="/etc/nginx/conf.d"
        NGINX_ENABLED="/etc/nginx/conf.d"
        ;;
    *)
        NGINX_AVAILABLE="/etc/nginx/sites-available"
        NGINX_ENABLED="/etc/nginx/sites-enabled"
        ;;
esac

# Create directories if they don't exist
mkdir -p "$NGINX_AVAILABLE" "$NGINX_ENABLED"

# Create Nginx configuration
cat > "$NGINX_AVAILABLE/status-monitor.conf" << 'NGINXEOF'
server {
    listen 80;
    server_name DOMAIN_PLACEHOLDER;

    root /opt/status-monitor/frontend/dist;
    index index.html;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

    # Frontend routes
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API proxy
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
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    # Health check
    location /health {
        proxy_pass http://localhost:5000/health;
    }

    # Uploads
    location /uploads/ {
        alias /opt/status-monitor/backend/uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Hide Nginx version
    server_tokens off;
}
NGINXEOF

# Replace domain placeholder
sed -i "s/DOMAIN_PLACEHOLDER/$DOMAIN/g" "$NGINX_AVAILABLE/status-monitor.conf"

# Enable site (for Debian/Ubuntu that use sites-enabled)
if [ "$NGINX_AVAILABLE" != "$NGINX_ENABLED" ]; then
    ln -sf "$NGINX_AVAILABLE/status-monitor.conf" "$NGINX_ENABLED/"
    rm -f "$NGINX_ENABLED/default"
else
    # For RHEL/Fedora/Arch, rename default.conf if it exists
    [ -f "$NGINX_ENABLED/default.conf" ] && mv "$NGINX_ENABLED/default.conf" "$NGINX_ENABLED/default.conf.disabled"
fi

# Test Nginx config
nginx -t > /dev/null 2>&1

# Reload Nginx
systemctl reload nginx

echo -e "  ✓ Nginx configured"

################################################################################
# Start Backend with PM2
################################################################################
echo -e "${GREEN}Starting backend service...${NC}"
cd "$APP_DIR/backend"
pm2 start src/server.js --name status-monitor --max-memory-restart 1G > /dev/null 2>&1
pm2 save > /dev/null 2>&1
pm2 startup systemd -u root --hp /root > /dev/null 2>&1

echo -e "  ✓ Backend service started"

################################################################################
# Setup SSL Certificate
################################################################################
echo -e "${GREEN}Setting up SSL certificate...${NC}"
echo -e "${YELLOW}Note: Make sure your domain $DOMAIN points to this server's IP!${NC}"
echo ""
read -p "Domain DNS configured? Continue with SSL setup? (Y/n): " -n 1 -r
echo

if [[ ! $REPLY =~ ^[Nn]$ ]]; then
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect > /dev/null 2>&1

    if [ $? -eq 0 ]; then
        echo -e "  ✓ SSL certificate installed"
    else
        echo -e "${YELLOW}  ! SSL setup failed. You can run 'certbot --nginx -d $DOMAIN' manually later${NC}"
    fi
else
    echo -e "${YELLOW}  ! Skipped SSL setup. Run 'certbot --nginx -d $DOMAIN' when DNS is ready${NC}"
fi

################################################################################
# Configure Firewall
################################################################################
echo -e "${GREEN}Configuring firewall...${NC}"
if command -v ufw &> /dev/null; then
    # Ubuntu/Debian with UFW
    ufw --force enable > /dev/null 2>&1
    ufw allow OpenSSH > /dev/null 2>&1
    ufw allow 'Nginx Full' > /dev/null 2>&1
    echo -e "  ✓ Firewall configured (UFW)"
elif command -v firewall-cmd &> /dev/null; then
    # CentOS/RHEL/Fedora with firewalld
    systemctl start firewalld > /dev/null 2>&1
    systemctl enable firewalld > /dev/null 2>&1
    firewall-cmd --permanent --add-service=ssh > /dev/null 2>&1
    firewall-cmd --permanent --add-service=http > /dev/null 2>&1
    firewall-cmd --permanent --add-service=https > /dev/null 2>&1
    firewall-cmd --reload > /dev/null 2>&1
    echo -e "  ✓ Firewall configured (firewalld)"
else
    echo -e "  ${YELLOW}! No firewall detected (UFW/firewalld), skipping firewall setup${NC}"
fi

################################################################################
# Save credentials to file
################################################################################
CREDS_FILE="/root/status-monitor-credentials.txt"
cat > "$CREDS_FILE" << EOF
================================================================================
Status Monitor - Installation Complete!
================================================================================

Your Status Monitor is now installed and running!

ACCESS INFORMATION:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  🌐 Public Status Page:  https://$DOMAIN
  🔐 Admin Dashboard:     https://$DOMAIN/admin/login

  Admin Email:    $ADMIN_EMAIL
  Admin Password: $ADMIN_PASSWORD

  ⚠️  IMPORTANT: Change your password immediately after first login!

DATABASE CREDENTIALS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Database Name:     $DB_NAME
  Database User:     $DB_USER
  Database Password: $DB_PASSWORD

USEFUL COMMANDS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  View logs:          pm2 logs status-monitor
  Check status:       pm2 status
  Restart backend:    pm2 restart status-monitor
  View this file:     cat /root/status-monitor-credentials.txt

APPLICATION DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Installation Directory: $APP_DIR
  Backend Config:         $APP_DIR/backend/.env
  SSL Certificate:        Managed by Let's Encrypt (auto-renewal enabled)

NEXT STEPS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  1. Visit https://$DOMAIN/admin/login
  2. Login with the credentials above
  3. Change your password in Settings > Profile
  4. Add your APIs to monitor in the admin dashboard

================================================================================
Installation completed at: $(date)
================================================================================
EOF

################################################################################
# Display Success Message
################################################################################

clear
echo -e "${GREEN}${BOLD}"
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                                                                ║"
echo "║              ✓ Installation Completed Successfully!           ║"
echo "║                                                                ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""
cat "$CREDS_FILE"
echo ""
echo -e "${YELLOW}${BOLD}⚠️  SAVE YOUR CREDENTIALS!${NC}"
echo -e "Credentials have been saved to: ${GREEN}$CREDS_FILE${NC}"
echo ""
echo -e "${BLUE}Support: https://github.com/pabbly-apps/pabbly-status-uptime-monitoring/issues${NC}"
echo ""
