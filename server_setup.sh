#!/bin/bash

# ==========================================
# Mobher AI - Auto Provisioning Script
# for Ubuntu 20.04/22.04 (Hostinger VPS)
# ==========================================

set -e

APP_DIR="/var/www/mobher-ai"
DOMAIN_NAME=$1
EMAIL_ADDR=$2

if [ -z "$DOMAIN_NAME" ]; then
    echo "Usage: ./server_setup.sh <DOMAIN_NAME> <EMAIL_FOR_SSL>"
    exit 1
fi

echo "🚀 Starting Server Provisioning for $DOMAIN_NAME..."

# 1. Update & Install Dependencies
echo "📦 Updating system..."
export DEBIAN_FRONTEND=noninteractive
apt-get update && apt-get upgrade -y
apt-get install -y curl git nginx unzip build-essential

# 2. Install Node.js 18
if ! command -v node &> /dev/null; then
    echo "🟢 Installing Node.js 18..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
fi

# 3. Install PM2
if ! command -v pm2 &> /dev/null; then
    echo "🔄 Installing PM2..."
    npm install -g pm2
fi

# 4. Setup MySQL (If not exists)
if ! command -v mysql &> /dev/null; then
    echo "🗄️ Installing MySQL..."
    apt-get install -y mysql-server
    # Note: User needs to run mysql_secure_installation manually or we configure via SQL
fi

# 5. Prepare App Directory
echo "📂 Creating App Directory: $APP_DIR"
mkdir -p $APP_DIR
chown -R $USER:$USER $APP_DIR

# 6. Configure Nginx
echo "🌐 Configuring Nginx..."
cat > /etc/nginx/sites-available/mobher-ai <<EOL
server {
    server_name $DOMAIN_NAME;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOL

# Enable Site
ln -sf /etc/nginx/sites-available/mobher-ai /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

# 7. Setup SSL with Certbot
echo "🔒 Setting up SSL..."
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d $DOMAIN_NAME --non-interactive --agree-tos -m $EMAIL_ADDR --redirect

echo "✅ Server Provisioning Complete!"
echo "👉 Now upload your code to $APP_DIR and run 'npm install && pm2 start ecosystem.config.js'"
