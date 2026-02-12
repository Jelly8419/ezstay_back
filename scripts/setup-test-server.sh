#!/bin/bash
# 테스트 서버 초기 설정 스크립트

set -e

echo "🔧 Ezstay Backend Test Server Setup"
echo "===================================="

# 1. 필수 패키지 설치
echo "📦 Installing dependencies..."
sudo apt update
sudo apt install -y git curl

# 2. Node.js 설치 (v18 LTS)
echo "📦 Installing Node.js v18..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# 3. PM2 설치 (프로세스 관리자)
echo "📦 Installing PM2..."
sudo npm install -g pm2

# 4. 프로젝트 디렉토리 생성
echo "📁 Setting up project directory..."
PROJECT_DIR="/opt/ezstay/backend"
sudo mkdir -p "$PROJECT_DIR"
sudo chown -R ec2-user:ec2-user /opt/ezstay
cd "$PROJECT_DIR"

# 5. Git 저장소 클론 (이미 있다면 스킵)
if [ ! -d ".git" ]; then
  echo "📥 Cloning repository..."
  git clone https://github.com/Jelly8419/ezstay_back.git .
  git checkout develop
else
  echo "✅ Repository already exists"
fi

# 6. 환경변수 파일 생성 (.env)
echo "⚙️ Creating .env file..."
cat > .env << 'EOF'
NODE_ENV=development
PORT=3000

# Database Configuration
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=ezstay_db
DB_LOGGING=false

# JWT Configuration
JWT_SECRET=your_jwt_secret_min_32_characters_long
JWT_REFRESH_SECRET=your_refresh_secret_min_32_characters_long

# OAuth Configuration
KAKAO_CLIENT_ID=your_kakao_rest_api_key
KAKAO_CLIENT_SECRET=your_kakao_client_secret
KAKAO_CALLBACK_URL=http://your-test-server-ip:3000/api/auth/oauth/kakao/callback

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Upload Configuration
UPLOADS_PUBLIC_PATH=/uploads
EOF

echo "⚠️  .env 파일을 수정하세요: nano .env"

# 7. 의존성 설치
echo "📦 Installing npm packages..."
npm ci  # 테스트 환경: 모든 의존성 설치 (devDependencies 포함)

# 8. PM2 ecosystem 파일 생성
echo "⚙️ Creating PM2 ecosystem..."
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'ezstay-api',
    script: './server.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'development',
      PORT: 8080
    },
    error_file: './logs/error.log',
    out_file: './logs/output.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true
  }]
};
EOF

# 9. 로그 디렉토리 생성
mkdir -p logs

# 10. PM2 시작 및 자동 실행 설정
echo "🚀 Starting application with PM2..."
pm2 start ecosystem.config.js
pm2 save
pm2 startup

echo ""
echo "📝 PM2 자동 시작 설정:"
echo "다음 명령어를 복사해서 실행하세요 (sudo 권한 필요):"
pm2 startup | grep "sudo"

echo ""
echo "✅ Setup completed!"
echo ""
echo "📝 Next steps:"
echo "1. Edit .env file: nano .env"
echo "2. Setup MySQL database and Redis"
echo "3. Test deployment: pm2 logs ezstay-api"
echo "4. Configure GitHub Actions secrets"
echo ""
echo "🔗 Application URL: http://$(curl -s ifconfig.me):3000"
