#!/usr/bin/env bash
# Isso comment server setup for a fresh Ubuntu droplet.
# Run as root: bash setup.sh
set -euo pipefail

echo "==> Updating packages..."
apt-get update && apt-get upgrade -y

echo "==> Installing Docker..."
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

echo "==> Enabling swap (1GB)..."
if [ ! -f /swapfile ]; then
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Setting up firewall..."
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> Creating app directory..."
mkdir -p /opt/isso
echo "Copy docker-compose.yml, isso.conf, and Caddyfile to /opt/isso/, then run:"
echo "  cd /opt/isso && docker compose up -d"
echo ""
echo "Done! Next steps:"
echo "  1. scp your config files to /opt/isso/"
echo "  2. cd /opt/isso && docker compose up -d"
echo "  3. Check logs: docker compose logs -f"
