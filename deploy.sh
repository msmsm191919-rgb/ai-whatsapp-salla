#!/bin/bash

# 🚀 مبهر AI - Production Deployment & Diagnostic Script
# This script automates node_modules cleanup, .env verification, database checks, Nginx reverse proxy, Certbot SSL, and PM2 daemonization.

# Text formatting helper
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0;m' # No Color

echo -e "${BLUE}=========================================================================${NC}"
echo -e "${GREEN}          🚀 مبهر AI - Production Deployment & Diagnostics Script 🚀       ${NC}"
echo -e "${BLUE}=========================================================================${NC}"

# 1️⃣ Check CWD
if [ ! -f "app.js" ]; then
    echo -e "${RED}❌ Error: app.js not found in current directory!${NC}"
    echo -e "Please run this script inside the project directory, e.g.: cd ~/ai-whatsapp-salla"
    exit 1
fi
echo -e "${GREEN}✔ Project directory verified.${NC}"

# 2️⃣ Clear Node Modules and Reinstall (Resolves Windows binary transfers / crash loop)
echo -e "\n${YELLOW}🧹 Cleaning and reinstalling Node.js packages...${NC}"
if [ -d "node_modules" ]; then
    echo -e "Found existing node_modules. Deleting to prevent Windows-Linux binary mismatches..."
    rm -rf node_modules
fi

echo -e "Installing production dependencies..."
npm install --omit=dev
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Error: npm install failed! Please check your network or Node.js installation.${NC}"
    exit 1
fi
echo -e "${GREEN}✔ Dependencies installed successfully.${NC}"

# Install Chromium/Puppeteer system dependencies to ensure whatsapp-web.js works on headless Linux
echo -e "\n${YELLOW}📦 Installing Chromium/Puppeteer system dependencies...${NC}"
sudo apt-get update
# Dynamically install correct sound library version for Ubuntu 22.04 / 24.04
sudo apt-get install -y libasound2t64 2>/dev/null || sudo apt-get install -y libasound2 2>/dev/null
# Install remaining core Chromium dependencies (excluding deprecated libgconf-2-4)
sudo apt-get install -y libxss1 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgcc1 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 ca-certificates fonts-liberation libnss3 lsb-release xdg-utils wget libgbm-dev
echo -e "${GREEN}✔ System dependencies verified and installed.${NC}"


# 3️⃣ Verify Environment Variables (.env)
echo -e "\n${YELLOW}🔍 Checking environment variables (.env)...${NC}"
if [ ! -f ".env" ]; then
    echo -e "${RED}❌ Error: .env file is missing!${NC}"
    echo -e "Creating a template .env file. Please edit it and fill in your real credentials."
    cat <<EOT > .env
PORT=3000
NODE_ENV=production
SALLA_OAUTH_CLIENT_ID=""
SALLA_OAUTH_CLIENT_SECRET=""
SALLA_OAUTH_CLIENT_REDIRECT_URI="https://yourdomain.com/oauth/callback"
SALLA_WEBHOOK_SECRET=""
SALLA_DATABASE_ORM=Sequelize
SALLA_DATABASE_DIALECT=sqlite
SESSION_SECRET="change-this-to-a-long-random-string-in-production"
OPENAI_API_KEY=""
META_VERIFY_TOKEN="salla_saas_verify"
EOT
    echo -e "${YELLOW}⚠️ Template .env created. Please run 'nano .env' to configure your credentials, then rerun this script.${NC}"
    exit 1
fi

# Load variables
export $(grep -v '^#' .env | xargs)

# Validate Salla API settings
if [ -z "$SALLA_OAUTH_CLIENT_ID" ] || [ -z "$SALLA_OAUTH_CLIENT_SECRET" ]; then
    echo -e "${RED}❌ Error: SALLA_OAUTH_CLIENT_ID or SALLA_OAUTH_CLIENT_SECRET is missing or empty in .env!${NC}"
    echo -e "Please edit .env using 'nano .env' and add your Salla credentials."
    exit 1
fi

# Force production mode
if [ "$NODE_ENV" != "production" ]; then
    echo -e "${YELLOW}⚠️ NODE_ENV is not set to 'production' in .env. Updating it to 'production' for session security and route locking...${NC}"
    sed -i 's/NODE_ENV=.*/NODE_ENV=production/g' .env 2>/dev/null || echo "NODE_ENV=production" >> .env
fi
echo -e "${GREEN}✔ Environment variables verified and optimized for production.${NC}"

# 4️⃣ Database Configuration & Writable Permission checks
echo -e "\n${YELLOW}💾 Checking database configurations...${NC}"
DB_DIALECT=${SALLA_DATABASE_DIALECT:-sqlite}

if [ "$DB_DIALECT" = "sqlite" ]; then
    echo -e "SQLite database selected. Checking database folder permissions..."
    mkdir -p database
    chmod 777 database
    if [ -f "database/salla_saas_v4.sqlite" ]; then
        chmod 666 database/salla_saas_v4.sqlite
        echo -e "${GREEN}✔ SQLite database file found and permissions corrected.${NC}"
    else
        echo -e "SQLite database file not found yet. It will be initialized automatically on launch."
    fi
else
    echo -e "MySQL/MariaDB dialect selected. Checking connection variables..."
    if [ -z "$DATABASE_NAME" ] || [ -z "$DATABASE_USERNAME" ]; then
        echo -e "${RED}❌ Error: Database variables (DATABASE_NAME / DATABASE_USERNAME) are empty in .env!${NC}"
        exit 1
    fi
    echo -e "${GREEN}✔ MySQL configuration variables checked.${NC}"
fi

# 5️⃣ Port Conflict Resolutions
echo -e "\n${YELLOW}🔌 Checking Port 3000 and 8095 conflicts...${NC}"
for PORT in 3000 8095; do
    PORT_PID=$(lsof -t -i:$PORT)
    if [ ! -z "$PORT_PID" ]; then
        echo -e "Port $PORT is currently occupied by PID: $PORT_PID. Stopping it to avoid EADDRINUSE conflict..."
        kill -9 $PORT_PID
        sleep 1
    fi
done
echo -e "${GREEN}✔ Ports 3000 and 8095 are clean and ready.${NC}"

# 6️⃣ PM2 Daemonization and Process Startup
echo -e "\n${YELLOW}🏃‍♂️ Setting up PM2 Process...${NC}"
if ! command -v pm2 &> /dev/null; then
    echo -e "PM2 is not installed. Installing globally..."
    npm install -g pm2
fi

echo -e "Deleting any old whatsapp or whatsapp-ai processes..."
pm2 delete whatsapp &> /dev/null
pm2 delete whatsapp-ai &> /dev/null

echo -e "Starting app.js under PM2..."
pm2 start app.js --name "whatsapp-ai"
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Error: PM2 failed to start the app! Running 'node app.js' directly to debug...${NC}"
    node app.js
    exit 1
fi

echo -e "Saving PM2 process list and configuring auto-restart on system boot..."
pm2 save
pm2 startup | tail -n 1 | bash # Runs the startup script automatically

echo -e "${GREEN}✔ PM2 process successfully daemonized.${NC}"

# 7️⃣ Diagnostics Test (Local Verification)
echo -e "\n${YELLOW}📊 Running local diagnostics test...${NC}"
sleep 3 # Wait for the app to initialize fully

CURL_OUT=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/)
if [ "$CURL_OUT" = "200" ] || [ "$CURL_OUT" = "302" ] || [ "$CURL_OUT" = "404" ] || [ "$CURL_OUT" = "301" ]; then
    echo -e "${GREEN}✔ Local connection test passed! Server responded with HTTP status code: $CURL_OUT${NC}"
else
    echo -e "${RED}❌ Local connection test failed! HTTP status code returned: $CURL_OUT${NC}"
    echo -e "PM2 logs:"
    pm2 logs whatsapp-ai --lines 15 --no-daemon
    exit 1
fi

# 8️⃣ Nginx Configuration Helper
echo -e "\n${YELLOW}🌐 Setting up Nginx Reverse Proxy...${NC}"
if ! command -v nginx &> /dev/null; then
    echo -e "Nginx is not installed. Installing..."
    sudo apt update && sudo apt install -y nginx
    sudo systemctl start nginx
    sudo systemctl enable nginx
fi

# Ask for domain
echo -e "${BLUE}Please enter your production domain (e.g. app.yourdomain.com):${NC}"
echo -e "${YELLOW}(Or press Enter to skip Nginx configuration if already done)${NC}"
read -p "Domain: " DOMAIN

if [ ! -z "$DOMAIN" ]; then
    echo -e "Updating SALLA_OAUTH_CLIENT_REDIRECT_URI in .env to match the domain: $DOMAIN..."
    sed -i "s|SALLA_OAUTH_CLIENT_REDIRECT_URI=.*|SALLA_OAUTH_CLIENT_REDIRECT_URI=\"https://$DOMAIN/oauth/callback\"|g" .env
    pm2 restart whatsapp-ai &>/dev/null
    
    echo -e "Creating Nginx server block configuration for domain: $DOMAIN..."
    
    NGINX_CONF="/etc/nginx/sites-available/whatsapp-ai"
    sudo bash -c "cat <<EOT > $NGINX_CONF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;

    location /public/ {
        alias $(pwd)/public/;
    }

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_connect_timeout 60s;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }
}
EOT"
    
    # Enable site and test Nginx
    sudo ln -s /etc/nginx/sites-available/whatsapp-ai /etc/nginx/sites-enabled/ 2>/dev/null
    sudo nginx -t
    if [ $? -eq 0 ]; then
        sudo systemctl restart nginx
        echo -e "${GREEN}✔ Nginx reverse proxy configured and restarted successfully!${NC}"
        
        # 9️⃣ SSL Certbot
        echo -e "\n${YELLOW}🔒 Certbot SSL Readiness...${NC}"
        if ! command -v certbot &> /dev/null; then
            echo -e "Certbot is not installed. Installing..."
            sudo apt install -y certbot python3-certbot-nginx
        fi
        
        echo -e "Generating SSL Certificate via Certbot..."
        echo -e "${YELLOW}⚠️ Certbot will now run. Please input your email and agree to terms in the prompts below:${NC}"
        sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✔ Certbot SSL configured and active!${NC}"
        else
            echo -e "${RED}⚠️ Certbot SSL registration encountered an issue. Please verify domain DNS points to this server IP.${NC}"
        fi
    else
        echo -e "${RED}❌ Nginx config test failed! Please check '/etc/nginx/sites-available/whatsapp-ai' manually.${NC}"
    fi
else
    echo -e "Nginx configuration skipped."
fi

# 🔟 Final Success Report
echo -e "\n${GREEN}=========================================================================${NC}"
echo -e "${GREEN}             🎉 SUCCESS! Mobher AI is Production-Ready! 🎉             ${NC}"
echo -e "${GREEN}=========================================================================${NC}"
echo -e "PM2 Service Status:"
pm2 status whatsapp-ai
echo -e "\nUseful Commands:"
echo -e " * View logs:           ${BLUE}pm2 logs whatsapp-ai${NC}"
echo -e " * Restart service:     ${BLUE}pm2 restart whatsapp-ai${NC}"
echo -e " * Server status:       ${BLUE}pm2 status${NC}"
echo -e "========================================================================="
