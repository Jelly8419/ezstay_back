# Oracle Cloud + Docker 배포 가이드

## 📋 목차
1. [시스템 아키텍처](#시스템-아키텍처)
2. [Oracle Cloud 계정 생성 및 VM 설정](#oracle-cloud-계정-생성-및-vm-설정)
3. [Docker 환경 구축](#docker-환경-구축)
4. [프로젝트별 Docker 설정](#프로젝트별-docker-설정)
5. [Docker Compose 통합](#docker-compose-통합)
6. [SSL 인증서 설정](#ssl-인증서-설정)
7. [배포 자동화](#배포-자동화)
8. [모니터링 및 유지보수](#모니터링-및-유지보수)

---

## 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                    Oracle Cloud VM Instance                 │
│                  (VM.Standard.A1.Flex, ARM)                 │
│                   4 OCPU, 24GB RAM, 200GB                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Nginx Container (Port 80, 443)          │  │
│  │           SSL Termination + Reverse Proxy            │  │
│  └──────────┬────────────────┬───────────────┬──────────┘  │
│             │                │               │              │
│  ┌──────────▼─────┐ ┌───────▼──────┐ ┌─────▼──────────┐  │
│  │  Flutter Web   │ │ React Admin  │ │  Node.js API   │  │
│  │ app.ezstay.com │ │admin.ezstay  │ │api.ezstay.com  │  │
│  │  (Static)      │ │   (Static)   │ │  (Port 3000)   │  │
│  └────────────────┘ └──────────────┘ └────────┬────────┘  │
│                                                │            │
│  ┌─────────────────┐  ┌──────────────────────▼─────────┐  │
│  │     Redis       │  │         MySQL 8.0               │  │
│  │  (Port 6379)    │  │       (Port 3306)               │  │
│  └─────────────────┘  └─────────────────────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Docker Volumes (Persistent)             │  │
│  │  - mysql_data    - redis_data    - uploads          │  │
│  │  - certbot_conf  - certbot_www                       │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘

외부 연결:
  HTTPS (443) → Nginx → app.ezstay.com (Flutter)
  HTTPS (443) → Nginx → admin.ezstay.com (React)
  HTTPS (443) → Nginx → api.ezstay.com (Node.js)
  HTTP (80) → Redirect to HTTPS
```

---

## Oracle Cloud 계정 생성 및 VM 설정

### 1단계: Oracle Cloud 계정 생성

1. **사이트 접속**: https://www.oracle.com/kr/cloud/free/
2. **무료로 시작하기** 클릭
3. **필수 정보 입력**:
   - 이메일 주소
   - 국가/지역: 대한민국
   - 해외 결제 가능한 신용카드 (인증용, 과금 안됨)
4. **리전 선택**:
   - 추천: Japan (Tokyo) - 한국과 가장 가까움
   - 대안: Singapore

### 2단계: VM 인스턴스 생성

```bash
# Oracle Cloud 콘솔에서 진행

1. 좌측 메뉴 > Compute > Instances > Create Instance

2. 인스턴스 설정:
   Name: ezstay-server
   Placement: Japan Central (Tokyo)

3. Image and Shape:
   Image: Oracle Linux 8 (ARM 호환)
   Shape: VM.Standard.A1.Flex
   - OCPU: 4
   - Memory: 24GB

4. Networking:
   VCN: 기본 VCN 사용
   Subnet: 기본 Public Subnet
   ✅ Assign a public IPv4 address

5. SSH Keys:
   ✅ Generate SSH Key Pair (다운로드 필수!)
   또는 기존 키 업로드

6. Boot Volume:
   Size: 200GB (Always Free 한도 내)

7. Create 클릭
```

### 3단계: 방화벽 설정 (Security List)

```bash
# Oracle Cloud 콘솔에서 진행

1. Networking > Virtual Cloud Networks > 기본 VCN 클릭
2. Security Lists > Default Security List 클릭
3. Ingress Rules 추가:

┌──────────────┬───────────┬──────────┬─────────────────────────┐
│ Source CIDR  │ Protocol  │   Port   │      Description        │
├──────────────┼───────────┼──────────┼─────────────────────────┤
│ 0.0.0.0/0    │ TCP       │   22     │ SSH                     │
│ 0.0.0.0/0    │ TCP       │   80     │ HTTP                    │
│ 0.0.0.0/0    │ TCP       │   443    │ HTTPS                   │
└──────────────┴───────────┴──────────┴─────────────────────────┘

4. OS 방화벽도 열기 (SSH 접속 후):
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

### 4단계: SSH 접속

```bash
# Windows (PowerShell)
ssh -i C:\path\to\downloaded-key.key opc@<PUBLIC_IP>

# Linux/Mac
chmod 600 ~/Downloads/downloaded-key.key
ssh -i ~/Downloads/downloaded-key.key opc@<PUBLIC_IP>

# 성공 시 Oracle Linux 프롬프트 표시
[opc@ezstay-server ~]$
```

---

## Docker 환경 구축

### 1단계: Docker 설치 (Oracle Linux 8, ARM)

```bash
# 시스템 업데이트
sudo dnf update -y

# Docker 저장소 추가
sudo dnf config-manager --add-repo=https://download.docker.com/linux/centos/docker-ce.repo

# Docker 설치
sudo dnf install -y docker-ce docker-ce-cli containerd.io

# Docker 서비스 시작 및 자동 시작 설정
sudo systemctl start docker
sudo systemctl enable docker

# 현재 사용자를 docker 그룹에 추가 (sudo 없이 docker 사용)
sudo usermod -aG docker $USER

# 재로그인 또는 다음 명령으로 그룹 적용
newgrp docker

# Docker 설치 확인
docker --version
# 출력: Docker version 24.x.x

# Docker 실행 테스트
docker run hello-world
```

### 2단계: Docker Compose 설치

```bash
# Docker Compose 최신 버전 설치 (ARM64 지원)
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
  -o /usr/local/bin/docker-compose

# 실행 권한 부여
sudo chmod +x /usr/local/bin/docker-compose

# 설치 확인
docker-compose --version
# 출력: Docker Compose version v2.x.x
```

### 3단계: 프로젝트 디렉토리 생성

```bash
# 프로젝트 루트 디렉토리 생성
sudo mkdir -p /opt/ezstay
sudo chown -R $USER:$USER /opt/ezstay

# 프로젝트 구조 생성
cd /opt/ezstay
mkdir -p backend frontend/flutter frontend/admin nginx/conf.d certbot/conf certbot/www
```

---

## 프로젝트별 Docker 설정

### 1. 백엔드 (Node.js) Dockerfile

```bash
# /opt/ezstay/backend/Dockerfile 생성
cat > /opt/ezstay/backend/Dockerfile << 'EOF'
# Node.js 18 Alpine (경량, ARM64 지원)
FROM node:18-alpine

# 작업 디렉토리 설정
WORKDIR /app

# 패키지 파일 복사 및 의존성 설치
COPY package*.json ./
RUN npm ci --only=production

# 소스 코드 복사
COPY . .

# uploads 디렉토리 생성
RUN mkdir -p uploads/rooms uploads/dummy

# 비-root 사용자로 실행 (보안)
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001
RUN chown -R nodejs:nodejs /app
USER nodejs

# 포트 노출
EXPOSE 3000

# 헬스체크
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# 앱 실행
CMD ["node", "server.js"]
EOF
```

### 2. Flutter Web Dockerfile

```bash
# /opt/ezstay/frontend/flutter/Dockerfile 생성
cat > /opt/ezstay/frontend/flutter/Dockerfile << 'EOF'
# 빌드 스테이지
FROM debian:bullseye-slim AS build

# Flutter SDK 설치 (ARM64 지원)
RUN apt-get update && \
    apt-get install -y curl git unzip xz-utils && \
    git clone https://github.com/flutter/flutter.git /flutter -b stable --depth 1

ENV PATH="/flutter/bin:${PATH}"

# 작업 디렉토리
WORKDIR /app

# 프로젝트 파일 복사
COPY pubspec.yaml pubspec.lock ./
RUN flutter pub get

COPY . .

# 웹 빌드
RUN flutter build web --release

# 프로덕션 스테이지 (Nginx로 정적 파일 서빙)
FROM nginx:alpine

# Flutter 빌드 결과물 복사
COPY --from=build /app/build/web /usr/share/nginx/html

# Nginx 설정 (SPA 라우팅 지원)
RUN echo 'server { \
    listen 80; \
    root /usr/share/nginx/html; \
    index index.html; \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
EOF
```

### 3. React Admin Dockerfile

```bash
# /opt/ezstay/frontend/admin/Dockerfile 생성
cat > /opt/ezstay/frontend/admin/Dockerfile << 'EOF'
# 빌드 스테이지
FROM node:18-alpine AS build

WORKDIR /app

# 패키지 파일 복사 및 의존성 설치
COPY package*.json ./
RUN npm ci

# 소스 코드 복사 및 빌드
COPY . .
RUN npm run build

# 프로덕션 스테이지 (Nginx로 정적 파일 서빙)
FROM nginx:alpine

# React 빌드 결과물 복사
COPY --from=build /app/dist /usr/share/nginx/html

# Nginx 설정 (SPA 라우팅 지원)
RUN echo 'server { \
    listen 80; \
    root /usr/share/nginx/html; \
    index index.html; \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
EOF
```

### 4. Nginx 리버스 프록시 설정

```bash
# /opt/ezstay/nginx/conf.d/ezstay.conf 생성
cat > /opt/ezstay/nginx/conf.d/ezstay.conf << 'EOF'
# Rate Limiting 설정
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=100r/m;
limit_req_zone $binary_remote_addr zone=auth_limit:10m rate=5r/m;

# Upstream 정의
upstream backend_api {
    server backend:3000;
}

upstream flutter_app {
    server flutter:80;
}

upstream react_admin {
    server admin:80;
}

# HTTP → HTTPS 리다이렉트
server {
    listen 80;
    server_name api.ezstay.com app.ezstay.com admin.ezstay.com;

    # Let's Encrypt ACME Challenge
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# HTTPS - Backend API
server {
    listen 443 ssl http2;
    server_name api.ezstay.com;

    # SSL 인증서
    ssl_certificate /etc/letsencrypt/live/api.ezstay.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.ezstay.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # 보안 헤더
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;

    # 업로드 파일 크기 제한
    client_max_body_size 10M;

    # Rate Limiting
    location /api/auth {
        limit_req zone=auth_limit burst=3 nodelay;
        proxy_pass http://backend_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /api {
        limit_req zone=api_limit burst=20 nodelay;
        proxy_pass http://backend_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # 업로드 파일 서빙
    location /uploads {
        proxy_pass http://backend_api;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # 헬스체크
    location /health {
        proxy_pass http://backend_api;
        access_log off;
    }
}

# HTTPS - Flutter Web App
server {
    listen 443 ssl http2;
    server_name app.ezstay.com;

    # SSL 인증서
    ssl_certificate /etc/letsencrypt/live/app.ezstay.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.ezstay.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # 보안 헤더
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    # Gzip 압축
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/json;

    location / {
        proxy_pass http://flutter_app;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# HTTPS - React Admin Dashboard
server {
    listen 443 ssl http2;
    server_name admin.ezstay.com;

    # SSL 인증서
    ssl_certificate /etc/letsencrypt/live/admin.ezstay.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/admin.ezstay.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # 보안 헤더
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;

    # Gzip 압축
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/json;

    location / {
        proxy_pass http://react_admin;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
```

---

## Docker Compose 통합

### docker-compose.yml 생성

```bash
# /opt/ezstay/docker-compose.yml 생성
cat > /opt/ezstay/docker-compose.yml << 'EOF'
version: '3.8'

services:
  # MySQL 데이터베이스
  mysql:
    image: mysql:8.0
    container_name: ezstay-mysql
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: ${DB_ROOT_PASSWORD}
      MYSQL_DATABASE: ${DB_NAME}
      MYSQL_USER: ${DB_USER}
      MYSQL_PASSWORD: ${DB_PASSWORD}
    volumes:
      - mysql_data:/var/lib/mysql
      - ./mysql/init:/docker-entrypoint-initdb.d
    ports:
      - "3306:3306"
    command: >
      --default-authentication-plugin=mysql_native_password
      --character-set-server=utf8mb4
      --collation-server=utf8mb4_unicode_ci
      --max_connections=100
      --innodb_buffer_pool_size=512M
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-u", "root", "-p${DB_ROOT_PASSWORD}"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - ezstay-network

  # Redis 캐시
  redis:
    image: redis:7-alpine
    container_name: ezstay-redis
    restart: unless-stopped
    command: >
      redis-server
      --maxmemory 512mb
      --maxmemory-policy allkeys-lru
      --save 60 1
      --loglevel warning
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - ezstay-network

  # Node.js Backend API
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: ezstay-backend
    restart: unless-stopped
    environment:
      NODE_ENV: production
      PORT: 3000
      DB_HOST: mysql
      DB_PORT: 3306
      DB_NAME: ${DB_NAME}
      DB_USER: ${DB_USER}
      DB_PASSWORD: ${DB_PASSWORD}
      REDIS_HOST: redis
      REDIS_PORT: 6379
      JWT_SECRET: ${JWT_SECRET}
      JWT_REFRESH_SECRET: ${JWT_REFRESH_SECRET}
      KAKAO_CLIENT_ID: ${KAKAO_CLIENT_ID}
      KAKAO_CLIENT_SECRET: ${KAKAO_CLIENT_SECRET}
      KAKAO_CALLBACK_URL: ${KAKAO_CALLBACK_URL}
      UPLOADS_PUBLIC_PATH: /uploads
    volumes:
      - uploads_data:/app/uploads
    ports:
      - "3000:3000"
    depends_on:
      mysql:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"]
      interval: 30s
      timeout: 3s
      retries: 3
    networks:
      - ezstay-network

  # Flutter Web App
  flutter:
    build:
      context: ./frontend/flutter
      dockerfile: Dockerfile
    container_name: ezstay-flutter
    restart: unless-stopped
    ports:
      - "8080:80"
    networks:
      - ezstay-network

  # React Admin Dashboard
  admin:
    build:
      context: ./frontend/admin
      dockerfile: Dockerfile
    container_name: ezstay-admin
    restart: unless-stopped
    ports:
      - "8081:80"
    networks:
      - ezstay-network

  # Nginx Reverse Proxy
  nginx:
    image: nginx:alpine
    container_name: ezstay-nginx
    restart: unless-stopped
    volumes:
      - ./nginx/conf.d:/etc/nginx/conf.d
      - ./certbot/conf:/etc/letsencrypt
      - ./certbot/www:/var/www/certbot
    ports:
      - "80:80"
      - "443:443"
    depends_on:
      - backend
      - flutter
      - admin
    networks:
      - ezstay-network
    command: "/bin/sh -c 'while :; do sleep 6h & wait $${!}; nginx -s reload; done & nginx -g \"daemon off;\"'"

  # Certbot for SSL
  certbot:
    image: certbot/certbot
    container_name: ezstay-certbot
    restart: unless-stopped
    volumes:
      - ./certbot/conf:/etc/letsencrypt
      - ./certbot/www:/var/www/certbot
    entrypoint: "/bin/sh -c 'trap exit TERM; while :; do certbot renew; sleep 12h & wait $${!}; done;'"

volumes:
  mysql_data:
    driver: local
  redis_data:
    driver: local
  uploads_data:
    driver: local

networks:
  ezstay-network:
    driver: bridge
EOF
```

### .env 파일 생성

```bash
# /opt/ezstay/.env 생성
cat > /opt/ezstay/.env << 'EOF'
# Database
DB_ROOT_PASSWORD=your_strong_root_password_here
DB_NAME=ezstay_db
DB_USER=ezstay_user
DB_PASSWORD=your_strong_db_password_here

# JWT
JWT_SECRET=your_super_secret_jwt_key_minimum_32_characters_long
JWT_REFRESH_SECRET=your_super_secret_refresh_key_minimum_32_characters_long

# Kakao OAuth
KAKAO_CLIENT_ID=your_kakao_rest_api_key
KAKAO_CLIENT_SECRET=your_kakao_client_secret
KAKAO_CALLBACK_URL=https://api.ezstay.com/api/auth/oauth/kakao/callback

# Domain (수정 필요)
DOMAIN_API=api.ezstay.com
DOMAIN_APP=app.ezstay.com
DOMAIN_ADMIN=admin.ezstay.com
EOF

# 환경변수 파일 권한 설정 (보안)
chmod 600 /opt/ezstay/.env
```

---

## SSL 인증서 설정

### 1단계: 도메인 DNS 설정

```bash
# 도메인 등록 서비스 (가비아, 호스팅케이알 등)에서 A 레코드 추가

레코드 타입: A
호스트명: api
값: <Oracle_VM_Public_IP>
TTL: 3600

레코드 타입: A
호스트명: app
값: <Oracle_VM_Public_IP>
TTL: 3600

레코드 타입: A
호스트명: admin
값: <Oracle_VM_Public_IP>
TTL: 3600
```

### 2단계: 초기 Nginx 설정 (SSL 없이)

```bash
# 임시 Nginx 설정 (Let's Encrypt ACME Challenge용)
cat > /opt/ezstay/nginx/conf.d/temp.conf << 'EOF'
server {
    listen 80;
    server_name api.ezstay.com app.ezstay.com admin.ezstay.com;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 200 'OK';
        add_header Content-Type text/plain;
    }
}
EOF

# Nginx만 먼저 시작
cd /opt/ezstay
docker-compose up -d nginx
```

### 3단계: Let's Encrypt SSL 인증서 발급

```bash
# 각 도메인별로 인증서 발급
docker-compose run --rm certbot certonly --webroot \
  --webroot-path=/var/www/certbot \
  --email your-email@example.com \
  --agree-tos \
  --no-eff-email \
  -d api.ezstay.com

docker-compose run --rm certbot certonly --webroot \
  --webroot-path=/var/www/certbot \
  --email your-email@example.com \
  --agree-tos \
  --no-eff-email \
  -d app.ezstay.com

docker-compose run --rm certbot certonly --webroot \
  --webroot-path=/var/www/certbot \
  --email your-email@example.com \
  --agree-tos \
  --no-eff-email \
  -d admin.ezstay.com

# SSL 설정 파일 다운로드
curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot-nginx/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf > /opt/ezstay/certbot/conf/options-ssl-nginx.conf
curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot/certbot/ssl-dhparams.pem > /opt/ezstay/certbot/conf/ssl-dhparams.pem
```

### 4단계: 전체 Nginx 설정 적용

```bash
# 임시 설정 삭제
rm /opt/ezstay/nginx/conf.d/temp.conf

# 전체 Nginx 설정 다시 로드
docker-compose restart nginx
```

---

## 배포 자동화

### 1. 배포 스크립트 생성

```bash
# /opt/ezstay/deploy.sh 생성
cat > /opt/ezstay/deploy.sh << 'EOF'
#!/bin/bash

set -e  # 에러 발생 시 스크립트 중단

echo "🚀 Ezstay 배포 시작..."

# 컬러 출력 함수
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

print_info() { echo -e "${GREEN}ℹ️  $1${NC}"; }
print_warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
print_error() { echo -e "${RED}❌ $1${NC}"; }

# 프로젝트 디렉토리로 이동
cd /opt/ezstay

# Git Pull (선택사항)
if [ "$1" == "--pull" ]; then
    print_info "Git 저장소에서 최신 코드 가져오기..."
    cd backend && git pull origin main && cd ..
    cd frontend/flutter && git pull origin main && cd ../..
    cd frontend/admin && git pull origin main && cd ../..
fi

# 백업 생성
print_info "데이터베이스 백업 중..."
docker-compose exec -T mysql mysqldump -u root -p${DB_ROOT_PASSWORD} ${DB_NAME} > backups/db_backup_$(date +%Y%m%d_%H%M%S).sql

# Docker 이미지 빌드
print_info "Docker 이미지 빌드 중..."
docker-compose build --no-cache

# 기존 컨테이너 중단
print_info "기존 컨테이너 중단 중..."
docker-compose down

# 새 컨테이너 시작
print_info "새 컨테이너 시작 중..."
docker-compose up -d

# 헬스체크 대기
print_info "서비스 헬스체크 중..."
sleep 10

# 백엔드 헬스체크
if curl -f http://localhost:3000/health > /dev/null 2>&1; then
    print_info "✅ 백엔드 서비스 정상"
else
    print_error "백엔드 서비스 실패"
    exit 1
fi

# Nginx 설정 테스트
if docker-compose exec -T nginx nginx -t > /dev/null 2>&1; then
    print_info "✅ Nginx 설정 정상"
else
    print_error "Nginx 설정 오류"
    exit 1
fi

# 컨테이너 상태 확인
print_info "컨테이너 상태:"
docker-compose ps

print_info "🎉 배포 완료!"
print_info "접속 주소:"
print_info "  - API: https://api.ezstay.com"
print_info "  - App: https://app.ezstay.com"
print_info "  - Admin: https://admin.ezstay.com"
EOF

chmod +x /opt/ezstay/deploy.sh
```

### 2. 로그 확인 스크립트

```bash
# /opt/ezstay/logs.sh 생성
cat > /opt/ezstay/logs.sh << 'EOF'
#!/bin/bash

# 사용법 안내
if [ -z "$1" ]; then
    echo "사용법: ./logs.sh [backend|mysql|redis|nginx|flutter|admin|all]"
    exit 1
fi

cd /opt/ezstay

case "$1" in
    backend)
        docker-compose logs -f --tail=100 backend
        ;;
    mysql)
        docker-compose logs -f --tail=100 mysql
        ;;
    redis)
        docker-compose logs -f --tail=100 redis
        ;;
    nginx)
        docker-compose logs -f --tail=100 nginx
        ;;
    flutter)
        docker-compose logs -f --tail=100 flutter
        ;;
    admin)
        docker-compose logs -f --tail=100 admin
        ;;
    all)
        docker-compose logs -f --tail=100
        ;;
    *)
        echo "잘못된 서비스명: $1"
        exit 1
        ;;
esac
EOF

chmod +x /opt/ezstay/logs.sh
```

### 3. 백업 스크립트

```bash
# /opt/ezstay/backup.sh 생성
cat > /opt/ezstay/backup.sh << 'EOF'
#!/bin/bash

set -e

BACKUP_DIR="/opt/ezstay/backups"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

echo "🗄️  데이터베이스 백업 중..."
docker-compose exec -T mysql mysqldump -u root -p${DB_ROOT_PASSWORD} ${DB_NAME} \
  | gzip > $BACKUP_DIR/db_backup_$DATE.sql.gz

echo "📁 업로드 파일 백업 중..."
tar -czf $BACKUP_DIR/uploads_backup_$DATE.tar.gz -C /opt/ezstay uploads/

echo "🔧 환경변수 백업 중..."
cp /opt/ezstay/.env $BACKUP_DIR/.env_$DATE

# 7일 이상 된 백업 삭제
find $BACKUP_DIR -type f -mtime +7 -delete

echo "✅ 백업 완료: $BACKUP_DIR"
ls -lh $BACKUP_DIR | tail -5
EOF

chmod +x /opt/ezstay/backup.sh

# Cron 작업 추가 (매일 새벽 3시)
(crontab -l 2>/dev/null; echo "0 3 * * * /opt/ezstay/backup.sh >> /opt/ezstay/logs/backup.log 2>&1") | crontab -
```

---

## 모니터링 및 유지보수

### 1. 시스템 모니터링

```bash
# /opt/ezstay/monitor.sh 생성
cat > /opt/ezstay/monitor.sh << 'EOF'
#!/bin/bash

echo "========================================"
echo "   Ezstay 시스템 모니터링"
echo "========================================"

# 시스템 리소스
echo -e "\n📊 시스템 리소스:"
echo "CPU 사용률:"
top -bn1 | grep "Cpu(s)" | sed "s/.*, *\([0-9.]*\)%* id.*/\1/" | awk '{print 100 - $1"%"}'

echo -e "\n메모리 사용량:"
free -h | awk 'NR==2{printf "사용: %s / %s (%.2f%%)\n", $3, $2, $3*100/$2}'

echo -e "\n디스크 사용량:"
df -h / | awk 'NR==2{printf "%s / %s (%s)\n", $3, $2, $5}'

# Docker 컨테이너 상태
echo -e "\n🐳 Docker 컨테이너 상태:"
docker-compose ps

# 컨테이너 리소스 사용량
echo -e "\n📈 컨테이너 리소스:"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"

# MySQL 상태
echo -e "\n🗄️  MySQL 연결 수:"
docker-compose exec -T mysql mysql -u root -p${DB_ROOT_PASSWORD} -e "SHOW STATUS LIKE 'Threads_connected';" 2>/dev/null

# Redis 상태
echo -e "\n💾 Redis 메모리 사용량:"
docker-compose exec -T redis redis-cli INFO memory | grep used_memory_human

# 최근 에러 로그
echo -e "\n⚠️  최근 백엔드 에러 (최근 10개):"
docker-compose logs --tail=100 backend | grep -i error | tail -10

echo -e "\n========================================"
EOF

chmod +x /opt/ezstay/monitor.sh
```

### 2. 헬스체크 스크립트

```bash
# /opt/ezstay/healthcheck.sh 생성
cat > /opt/ezstay/healthcheck.sh << 'EOF'
#!/bin/bash

# 컬러 출력
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

check_service() {
    if curl -f -s "$1" > /dev/null; then
        echo -e "${GREEN}✅ $2: OK${NC}"
        return 0
    else
        echo -e "${RED}❌ $2: FAILED${NC}"
        return 1
    fi
}

echo "🏥 Ezstay 헬스체크..."
echo "========================================"

check_service "http://localhost:3000/health" "Backend API"
check_service "https://api.ezstay.com/health" "Backend API (HTTPS)"
check_service "https://app.ezstay.com" "Flutter Web"
check_service "https://admin.ezstay.com" "React Admin"

# MySQL 연결 테스트
if docker-compose exec -T mysql mysql -u root -p${DB_ROOT_PASSWORD} -e "SELECT 1;" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ MySQL: OK${NC}"
else
    echo -e "${RED}❌ MySQL: FAILED${NC}"
fi

# Redis 연결 테스트
if docker-compose exec -T redis redis-cli ping > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Redis: OK${NC}"
else
    echo -e "${RED}❌ Redis: FAILED${NC}"
fi

echo "========================================"
EOF

chmod +x /opt/ezstay/healthcheck.sh
```

### 3. Docker Compose 유용한 명령어

```bash
# 전체 서비스 시작
docker-compose up -d

# 특정 서비스만 재시작
docker-compose restart backend

# 로그 확인 (실시간)
docker-compose logs -f backend

# 컨테이너 내부 접속
docker-compose exec backend sh

# 모든 컨테이너 중단 및 삭제
docker-compose down

# 볼륨까지 전부 삭제 (⚠️ 데이터 손실 주의)
docker-compose down -v

# 이미지 재빌드
docker-compose build --no-cache backend

# 리소스 사용량 확인
docker stats
```

---

## 최초 배포 단계별 가이드

### Step 1: 로컬에서 코드 준비 (Windows)

```bash
# 1. 백엔드 코드 정리
cd c:\study\ezstay_back
git add .
git commit -m "feat: 프로덕션 배포 준비"
git push origin main

# 2. Flutter 코드 정리
cd c:\study\ezstay_front\building_map_app
# pubspec.yaml에서 API URL 환경변수 설정 확인
git add .
git commit -m "feat: 프로덕션 배포 준비"
git push origin main

# 3. React Admin 코드 정리
cd c:\study\admin-dashboard
# .env 파일에서 API URL 확인
git add .
git commit -m "feat: 프로덕션 배포 준비"
git push origin main
```

### Step 2: Oracle Cloud VM에 코드 배포

```bash
# SSH 접속
ssh -i ~/your-key.key opc@<PUBLIC_IP>

# Git 설치
sudo dnf install -y git

# 프로젝트 클론
cd /opt/ezstay

# 백엔드
git clone https://github.com/your-username/ezstay_back.git backend

# Flutter (building_map_app 디렉토리만 필요)
mkdir -p frontend/flutter
cd frontend/flutter
git clone https://github.com/your-username/ezstay_front.git temp
mv temp/building_map_app/* .
rm -rf temp
cd ../..

# React Admin
git clone https://github.com/your-username/admin-dashboard.git frontend/admin
```

### Step 3: Dockerfile 및 설정 파일 복사

```bash
# 위에서 작성한 Dockerfile들을 각 프로젝트에 복사
# (이 가이드의 "프로젝트별 Docker 설정" 섹션 참조)

# backend/Dockerfile
# frontend/flutter/Dockerfile
# frontend/admin/Dockerfile
# docker-compose.yml
# .env
# nginx/conf.d/ezstay.conf
```

### Step 4: 환경변수 설정

```bash
# .env 파일 수정
cd /opt/ezstay
nano .env

# 실제 값으로 변경:
# - DB 비밀번호
# - JWT Secret (32자 이상 랜덤 문자열)
# - Kakao API 키
# - 도메인 주소
```

### Step 5: 초기 배포

```bash
cd /opt/ezstay

# 1. MySQL, Redis만 먼저 시작
docker-compose up -d mysql redis

# 2. DB 초기화 대기 (30초)
sleep 30

# 3. 백엔드 빌드 및 시작
docker-compose up -d backend

# 4. 프론트엔드 빌드 및 시작 (시간 소요: 5-10분)
docker-compose up -d flutter admin

# 5. Nginx 시작 (SSL 설정 후)
# (SSL 인증서 설정 섹션 참조)
```

### Step 6: 초기 데이터 설정

```bash
# 관리자 계정 생성 스크립트 실행
docker-compose exec backend node scripts/createAdmin.js

# 또는 MySQL 직접 접속
docker-compose exec mysql mysql -u root -p${DB_ROOT_PASSWORD} ${DB_NAME}
```

---

## 트러블슈팅

### 1. 컨테이너가 시작되지 않을 때

```bash
# 로그 확인
docker-compose logs backend

# 일반적인 원인:
# - 환경변수 오류 (.env 파일 확인)
# - MySQL 연결 실패 (DB 컨테이너 상태 확인)
# - 포트 충돌 (다른 프로세스가 사용 중)

# 포트 사용 확인
sudo netstat -tulpn | grep :3000
```

### 2. SSL 인증서 발급 실패

```bash
# DNS 설정 확인
nslookup api.ezstay.com

# 방화벽 확인
sudo firewall-cmd --list-all

# Nginx 로그 확인
docker-compose logs nginx

# 수동으로 인증서 갱신
docker-compose run --rm certbot renew --dry-run
```

### 3. 메모리 부족

```bash
# 메모리 사용량 확인
free -h
docker stats

# 스왑 메모리 추가 (임시 해결)
sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# 영구 적용
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 4. 데이터베이스 연결 실패

```bash
# MySQL 컨테이너 상태 확인
docker-compose ps mysql

# MySQL 로그 확인
docker-compose logs mysql

# MySQL 직접 접속 테스트
docker-compose exec mysql mysql -u root -p

# 백엔드에서 MySQL 연결 테스트
docker-compose exec backend ping mysql
```

---

## 성능 최적화

### 1. Docker 이미지 최적화

```dockerfile
# Multi-stage 빌드 사용 (이미 적용됨)
# .dockerignore 파일 생성

# backend/.dockerignore
node_modules
npm-debug.log
.git
.env
README.md
```

### 2. Nginx 캐싱 설정 추가

```nginx
# nginx/conf.d/ezstay.conf에 추가

# 정적 파일 캐싱
location ~* \.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

### 3. 로그 로테이션

```bash
# /etc/logrotate.d/docker-compose 생성
sudo tee /etc/logrotate.d/docker-compose << EOF
/opt/ezstay/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0644 opc opc
}
EOF
```

---

## CI/CD 파이프라인 (GitHub Actions)

### .github/workflows/deploy.yml

```yaml
name: Deploy to Oracle Cloud

on:
  push:
    branches: [ main ]
  workflow_dispatch:

jobs:
  deploy-backend:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v3

      - name: Deploy to Oracle Cloud
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.ORACLE_HOST }}
          username: opc
          key: ${{ secrets.ORACLE_SSH_KEY }}
          script: |
            cd /opt/ezstay
            git -C backend pull origin main
            docker-compose build backend
            docker-compose up -d backend
            docker-compose exec -T backend npm run migrate
            echo "✅ Backend deployed successfully"

  deploy-frontend:
    runs-on: ubuntu-latest
    needs: deploy-backend
    steps:
      - name: Checkout code
        uses: actions/checkout@v3

      - name: Deploy Flutter
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.ORACLE_HOST }}
          username: opc
          key: ${{ secrets.ORACLE_SSH_KEY }}
          script: |
            cd /opt/ezstay/frontend/flutter
            git pull origin main
            cd /opt/ezstay
            docker-compose build flutter
            docker-compose up -d flutter
            echo "✅ Flutter deployed successfully"

      - name: Deploy Admin
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.ORACLE_HOST }}
          username: opc
          key: ${{ secrets.ORACLE_SSH_KEY }}
          script: |
            cd /opt/ezstay/frontend/admin
            git pull origin main
            cd /opt/ezstay
            docker-compose build admin
            docker-compose up -d admin
            echo "✅ Admin deployed successfully"
```

---

## 보안 강화

### 1. 방화벽 강화

```bash
# Fail2Ban 설치 (Brute Force 방어)
sudo dnf install -y epel-release
sudo dnf install -y fail2ban

# Fail2Ban 설정
sudo tee /etc/fail2ban/jail.local << EOF
[sshd]
enabled = true
port = 22
filter = sshd
logpath = /var/log/secure
maxretry = 3
bantime = 3600
EOF

sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

### 2. Docker 보안 설정

```bash
# Docker 데몬 설정
sudo tee /etc/docker/daemon.json << EOF
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "live-restore": true,
  "userland-proxy": false
}
EOF

sudo systemctl restart docker
```

---

## 예상 비용

```yaml
Oracle Cloud Always Free Tier:
  VM Instance: $0/월 (영구 무료)
  Block Storage: $0/월 (200GB 포함)
  Outbound Traffic: $0/월 (10TB 포함)

추가 비용:
  도메인 (.com): 약 ₩15,000/년 (가비아 기준)

총 월 비용: $0 (도메인 제외)
```

---

## 마무리 체크리스트

- [ ] Oracle Cloud 계정 생성 완료
- [ ] VM 인스턴스 생성 (4 OCPU, 24GB RAM)
- [ ] 방화벽 설정 (80, 443, 22 포트 오픈)
- [ ] Docker 및 Docker Compose 설치
- [ ] 프로젝트 코드 클론 (backend, flutter, admin)
- [ ] Dockerfile 작성 (3개 프로젝트)
- [ ] docker-compose.yml 작성
- [ ] .env 환경변수 설정 (실제 값으로 변경)
- [ ] 도메인 DNS A 레코드 설정
- [ ] Let's Encrypt SSL 인증서 발급
- [ ] 전체 서비스 시작 (`docker-compose up -d`)
- [ ] 헬스체크 확인 (`./healthcheck.sh`)
- [ ] 관리자 계정 생성
- [ ] 백업 스크립트 Cron 등록
- [ ] 모니터링 설정 완료

---

## 다음 단계

1. **성능 테스트**: Apache Bench, k6 등으로 부하 테스트
2. **CDN 연동**: Cloudflare Free Tier로 정적 파일 캐싱
3. **모니터링 고도화**: Prometheus + Grafana 연동
4. **로그 수집**: ELK Stack 또는 Loki 연동
5. **DB 이중화**: MySQL 복제 설정 (Read Replica)

---

**작성일**: 2025-10-30
**버전**: 1.0.0
**문의**: ezstay-support@example.com
