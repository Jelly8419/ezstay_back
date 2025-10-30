# AWS EC2 테스트 서버 배포 가이드

> **환경**: 개발 및 기능 테스트용 테스트 서버
> **인스턴스**: AWS EC2 t2.small (1 vCPU, 2GB RAM, 월 $17)
> **용도**: 개발 중인 기능 테스트 및 버그 디버깅
> **도메인**: ezstay-api.duckdns.org (무료 DuckDNS, 경로 기반 라우팅)

## 📋 목차
1. [시스템 아키텍처](#시스템-아키텍처)
2. [AWS EC2 인스턴스 생성](#aws-ec2-인스턴스-생성)
3. [서버 초기 설정](#서버-초기-설정)
4. [MySQL 설치 및 설정](#mysql-설치-및-설정)
5. [Redis 설치 및 설정](#redis-설치-및-설정)
6. [Node.js 및 PM2 설치](#nodejs-및-pm2-설치)
7. [Nginx 설치 및 설정](#nginx-설치-및-설정)
8. [프로젝트 배포](#프로젝트-배포)
9. [SSL 인증서 설정](#ssl-인증서-설정)
10. [배포 자동화](#배포-자동화)
11. [모니터링 및 유지보수](#모니터링-및-유지보수)

---

## 🎯 테스트 서버란?

**테스트 서버의 목적**:
- ✅ 개발 중인 기능 **실시간 테스트**
- ✅ 상세한 **에러 메시지 및 디버깅**
- ✅ 프론트엔드와 백엔드 **통합 테스트**
- ✅ 버그 수정 및 **빠른 반복 개발**

**테스트 서버 vs 다른 환경**:

| 구분 | 로컬(Local) | **테스트(Test)** | 스테이징(Staging) | 프로덕션(Production) |
|------|------------|-----------------|------------------|---------------------|
| **백엔드 NODE_ENV** | `development` | **`development`** | `production` | `production` |
| **백엔드 npm** | 모든 의존성 | **모든 의존성** | 프로덕션만 | 프로덕션만 |
| **프론트엔드 빌드** | `dev` | **`build:test`** | `build:prod` | `build:prod` |
| **프론트엔드 환경** | `.env.development` | **`.env.test`** | `.env.production` | `.env.production` |
| **최적화** | ❌ | **✅ (프론트만)** | ✅ | ✅ |
| **디버깅** | 상세 | **상세** | 제한적 | 제한적 |
| **용도** | 개발 | **기능 테스트** | 최종 검증 | 실제 서비스 |
| **가동시간** | 개발 중 | **필요시** | 필요시 | 24/7 |
| **비용** | 무료 | **중간** | 중간 | 최대 |

**이 문서의 설정**:
```yaml
환경: 테스트 서버 (Test)
설정: NODE_ENV=development
이유: 상세한 에러 로그로 디버깅 편의성 극대화
도메인: ezstay-api.duckdns.org (무료 DuckDNS, 경로 기반 라우팅)
백엔드: https://ezstay-api.duckdns.org/api
프론트(Flutter): https://ezstay-api.duckdns.org/app
관리자(React): https://ezstay-api.duckdns.org/admin
```

---

## 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                    AWS EC2 Instance                         │
│              t2.small (1 vCPU, 2GB RAM)                     │
│                 Amazon Linux 2023                            │
│              Elastic IP: 98.94.160.132                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         Nginx (Port 80, 443)                         │  │
│  │     SSL Termination + Reverse Proxy                  │  │
│  │     Domain: ezstay-api.duckdns.org                   │  │
│  └──────────┬────────────────┬───────────────┬──────────┘  │
│             │                │               │              │
│  ┌──────────▼─────┐ ┌───────▼──────┐ ┌─────▼──────────┐  │
│  │  Flutter Web   │ │ React Admin  │ │  Node.js API   │  │
│  │   /app/*       │ │  /admin/*    │ │    /api/*      │  │
│  │  (Static)      │ │   (Static)   │ │  PM2 (8080)    │  │
│  └────────────────┘ └──────────────┘ └────────┬────────┘  │
│                                                │            │
│  ┌─────────────────┐  ┌──────────────────────▼─────────┐  │
│  │     Redis       │  │         MySQL 8.0               │  │
│  │  (Port 6379)    │  │       (Port 3306)               │  │
│  │  Systemd        │  │        Systemd                  │  │
│  └─────────────────┘  └─────────────────────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Data Directories                        │  │
│  │  - /var/lib/mysql    - /var/lib/redis               │  │
│  │  - /opt/ezstay/uploads                               │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘

외부 연결 (경로 기반 라우팅):
  https://ezstay-api.duckdns.org/app   → Flutter Web (Static)
  https://ezstay-api.duckdns.org/admin → React Admin (Static)
  https://ezstay-api.duckdns.org/api   → Node.js API (8080)
  https://ezstay-api.duckdns.org/uploads → Static Files
  HTTP (80) → Redirect to HTTPS
```

**메모리 사용량 예상**:
```yaml
시스템: 150MB
MySQL: 300MB
Redis: 100MB
Node.js (PM2): 200MB
Nginx: 50MB
여유 메모리: 1.2GB ✅
```

---

## AWS EC2 인스턴스 생성

### 1단계: AWS 콘솔 접속

1. **AWS Console 로그인**: https://console.aws.amazon.com
2. **EC2 대시보드** 이동: 서비스 → EC2
3. **인스턴스 시작** 클릭

### 2단계: 인스턴스 설정

#### 이름 및 태그
```
Name: ezstay-test
Environment: test
Purpose: development-testing
```

#### AMI 선택
```
Amazon Linux 2 AMI (HVM) - Kernel 5.10, SSD Volume Type
- 64비트 (x86)
- 안정적이고 검증된 OS
```

#### 인스턴스 유형
```
✅ t2.small
   - 1 vCPU
   - 2 GiB RAM
   - 월 비용: 약 $17
```

#### 키 페어 (로그인)
```
옵션 1: 기존 키 페어 사용
옵션 2: 새 키 페어 생성
  - 키 페어 이름: ezstay-key
  - 키 페어 유형: RSA
  - 프라이빗 키 파일 형식: .pem (Mac/Linux) 또는 .ppk (Windows/PuTTY)

⚠️ .pem 파일 다운로드 후 안전한 곳에 보관!
```

#### 네트워크 설정
```
✅ 새 보안 그룹 생성
  보안 그룹 이름: ezstay-sg
  설명: Security group for Ezstay application

규칙 추가:
┌──────────┬────────┬────────────┬─────────────────┐
│   유형   │ 프로토콜│   포트    │    소스         │
├──────────┼────────┼────────────┼─────────────────┤
│   SSH    │  TCP   │     22     │ 내 IP (추천)    │
│   HTTP   │  TCP   │     80     │ 0.0.0.0/0       │
│   HTTPS  │  TCP   │    443     │ 0.0.0.0/0       │
└──────────┴────────┴────────────┴─────────────────┘
```

#### 스토리지 구성
```
루트 볼륨:
  - 크기: 30 GiB
  - 볼륨 유형: 범용 SSD (gp3)
  - 종료 시 삭제: ✅ 체크 (테스트 환경이므로)
```

#### 고급 세부 정보
```
종료 방지 활성화: ✅ (실수로 삭제 방지)
```

### 3단계: 인스턴스 시작

- **"인스턴스 시작"** 클릭
- 생성 완료 대기 (약 1-2분)
- **퍼블릭 IPv4 주소** 복사 (예: `54.180.123.45`)

---

## 서버 초기 설정

### 1단계: SSH 접속

#### Windows (PowerShell)
```powershell
# .pem 파일 위치로 이동
cd C:\Users\user\Downloads

# SSH 접속
ssh -i ezstay-key.pem ec2-user@54.180.123.45
```

#### Mac/Linux
```bash
# 키 파일 권한 설정
chmod 400 ~/Downloads/ezstay-key.pem

# SSH 접속
ssh -i ~/Downloads/ezstay-key.pem ec2-user@54.180.123.45
```

**접속 성공 시**:
```
[ec2-user@ip-172-31-x-x ~]$
```

### 2단계: 시스템 업데이트

```bash
# 시스템 패키지 업데이트
sudo yum update -y

# 필수 유틸리티 설치
sudo yum install -y git wget curl vim htop
```

### 3단계: 타임존 설정

```bash
# 서울 타임존 설정
sudo timedatectl set-timezone Asia/Seoul

# 확인
date
# 출력: 2025년 10월 30일 목요일 오후 3시...
```

### 4단계: Swap 메모리 추가 (메모리 부족 방지)

```bash
# 2GB Swap 파일 생성
sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# 부팅 시 자동 활성화
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# 확인
free -h
# Swap: 2.0Gi로 표시되어야 함
```

### 5단계: 방화벽 설정

```bash
# firewalld 설치 및 시작 (Amazon Linux 2는 기본 비활성화)
sudo yum install -y firewalld
sudo systemctl start firewalld
sudo systemctl enable firewalld

# 필요한 포트 열기
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --reload

# 확인
sudo firewall-cmd --list-all
```

---

## MySQL 설치 및 설정

### 1단계: MySQL 8.0 설치

```bash
# MySQL 8.0 리포지토리 추가
sudo yum install -y https://dev.mysql.com/get/mysql80-community-release-el7-7.noarch.rpm

# GPG 키 가져오기
sudo rpm --import https://repo.mysql.com/RPM-GPG-KEY-mysql-2022

# MySQL 서버 설치
sudo yum install -y mysql-community-server

# MySQL 서비스 시작
sudo systemctl start mysqld
sudo systemctl enable mysqld

# 설치 확인
mysql --version
# mysql  Ver 8.0.x for Linux on x86_64
```

### 2단계: MySQL 초기 설정

```bash
# 임시 root 비밀번호 확인
sudo grep 'temporary password' /var/log/mysqld.log
# 출력 예: 2025-10-30T... A temporary password is generated for root@localhost: Xy3k#mP9qR

# MySQL 보안 설정
sudo mysql_secure_installation

# 대화형 프롬프트:
# 1. Enter password for user root: [위에서 확인한 임시 비밀번호 입력]
# 2. New password: [새로운 강력한 비밀번호 - 대문자+소문자+숫자+특수문자 최소 8자]
# 3. Re-enter new password: [비밀번호 재입력]
# 4. Remove anonymous users? Y
# 5. Disallow root login remotely? Y
# 6. Remove test database? Y
# 7. Reload privilege tables? Y
```

### 3단계: 데이터베이스 및 사용자 생성

```bash
# MySQL 접속
mysql -u root -p
# 위에서 설정한 root 비밀번호 입력
```

```sql
-- Ezstay 데이터베이스 생성
CREATE DATABASE ezstay_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Ezstay 전용 사용자 생성 (강력한 비밀번호 사용)
CREATE USER 'ezstay_user'@'localhost' IDENTIFIED BY 'Your_Strong_Password_123!';

-- 권한 부여
GRANT ALL PRIVILEGES ON ezstay_db.* TO 'ezstay_user'@'localhost';
FLUSH PRIVILEGES;

-- 확인
SHOW DATABASES;
SELECT User, Host FROM mysql.user;

-- 종료
EXIT;
```

### 4단계: MySQL 성능 최적화

```bash
# MySQL 설정 파일 백업
sudo cp /etc/my.cnf /etc/my.cnf.backup

# 설정 파일 편집
sudo vim /etc/my.cnf
```

```ini
# /etc/my.cnf에 아래 내용 추가
[mysqld]
# 기본 설정
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci

# 성능 최적화 (2GB RAM 기준)
max_connections=50
innodb_buffer_pool_size=384M
innodb_log_file_size=128M
innodb_flush_method=O_DIRECT

# 쿼리 캐시
query_cache_type=1
query_cache_size=32M

# 로그 설정
slow_query_log=1
slow_query_log_file=/var/log/mysql/slow-query.log
long_query_time=2

# 타임존
default-time-zone='+09:00'
```

```bash
# 로그 디렉토리 생성
sudo mkdir -p /var/log/mysql
sudo chown mysql:mysql /var/log/mysql

# MySQL 재시작
sudo systemctl restart mysqld

# 설정 확인
mysql -u root -p -e "SHOW VARIABLES LIKE 'innodb_buffer_pool_size';"
```

---

## Redis 설치 및 설정

### 1단계: Redis 설치

```bash
# Amazon Linux Extras에서 Redis 설치
sudo amazon-linux-extras install redis6 -y

# Redis 서비스 시작
sudo systemctl start redis
sudo systemctl enable redis

# 설치 확인
redis-cli --version
# redis-cli 6.x.x
```

### 2단계: Redis 설정

```bash
# 설정 파일 백업
sudo cp /etc/redis.conf /etc/redis.conf.backup

# 설정 파일 편집
sudo vim /etc/redis.conf
```

```ini
# /etc/redis.conf에서 다음 항목 수정

# 메모리 제한 (256MB)
maxmemory 256mb
maxmemory-policy allkeys-lru

# 영속성 설정 (백업)
save 900 1
save 300 10
save 60 10000

# AOF 활성화 (추가 안정성)
appendonly yes
appendfsync everysec

# 로그 레벨
loglevel notice

# 보안 (비밀번호 설정 권장)
# requirepass your_strong_redis_password_here
```

```bash
# Redis 재시작
sudo systemctl restart redis

# 연결 테스트
redis-cli ping
# 출력: PONG

# 메모리 설정 확인
redis-cli CONFIG GET maxmemory
```

---

## Node.js 및 PM2 설치

### 1단계: Node.js 18 설치 (NVM 사용)

```bash
# NVM 설치
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash

# NVM 활성화
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# bashrc에 추가 (영구 적용)
echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.bashrc
echo '[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"' >> ~/.bashrc

# Node.js 18 LTS 설치
nvm install 18
nvm use 18
nvm alias default 18

# 설치 확인
node --version
# v18.x.x
npm --version
# 10.x.x
```

### 2단계: PM2 설치

```bash
# PM2 글로벌 설치
npm install -g pm2

# PM2 버전 확인
pm2 --version

# 부팅 시 PM2 자동 시작 설정
pm2 startup systemd -u ec2-user --hp /home/ec2-user
# 출력된 명령어를 복사해서 실행 (sudo 명령어)

# PM2 저장
pm2 save
```

---

## Nginx 설치 및 설정

### 1단계: Nginx 설치

```bash
# Nginx 설치
sudo amazon-linux-extras install nginx1 -y

# Nginx 버전 확인
nginx -v
# nginx version: nginx/1.22.x

# Nginx 시작
sudo systemctl start nginx
sudo systemctl enable nginx

# 상태 확인
sudo systemctl status nginx
```

### 2단계: Nginx 기본 설정

```bash
# 설정 디렉토리 생성
sudo mkdir -p /etc/nginx/sites-available
sudo mkdir -p /etc/nginx/sites-enabled

# 메인 설정 파일 편집
sudo vim /etc/nginx/nginx.conf
```

```nginx
# /etc/nginx/nginx.conf
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log;
pid /run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    log_format  main  '$remote_addr - $remote_user [$time_local] "$request" '
                      '$status $body_bytes_sent "$http_referer" '
                      '"$http_user_agent" "$http_x_forwarded_for"';

    access_log  /var/log/nginx/access.log  main;

    sendfile            on;
    tcp_nopush          on;
    tcp_nodelay         on;
    keepalive_timeout   65;
    types_hash_max_size 4096;
    client_max_body_size 10M;

    include             /etc/nginx/mime.types;
    default_type        application/octet-stream;

    # Gzip 압축
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/json;

    # Rate Limiting
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=100r/m;
    limit_req_zone $binary_remote_addr zone=auth_limit:10m rate=5r/m;

    # sites-enabled 포함
    include /etc/nginx/sites-enabled/*.conf;
}
```

### 3단계: Ezstay 사이트 설정 (임시 - SSL 없이)

```bash
# 사이트 설정 파일 생성
sudo vim /etc/nginx/sites-available/ezstay.conf
```

```nginx
# /etc/nginx/sites-available/ezstay.conf
# 임시 설정 (SSL 인증서 발급용)

server {
    listen 80;
    server_name ezstay-api.duckdns.org;

    # Let's Encrypt ACME Challenge
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 200 'Server is ready';
        add_header Content-Type text/plain;
    }
}
```

```bash
# 심볼릭 링크 생성
sudo ln -s /etc/nginx/sites-available/ezstay.conf /etc/nginx/sites-enabled/

# certbot 디렉토리 생성
sudo mkdir -p /var/www/certbot

# 설정 테스트
sudo nginx -t

# Nginx 재시작
sudo systemctl restart nginx
```

---

## 프로젝트 배포

### 1단계: 프로젝트 디렉토리 생성

```bash
# 프로젝트 루트 디렉토리 생성
sudo mkdir -p /opt/ezstay
sudo chown -R ec2-user:ec2-user /opt/ezstay

cd /opt/ezstay
```

### 2단계: 백엔드 배포

```bash
# Git으로 백엔드 코드 클론
cd /opt/ezstay
git clone https://github.com/your-username/ezstay_back.git backend

cd backend

# package-lock.json 파일 확인
ls -la package-lock.json

# 의존성 설치 - 테스트 환경 (모든 의존성 포함)
npm install

# 💡 테스트 환경 설명:
# - NODE_ENV=development: 상세한 에러 로그 및 디버깅
# - npm install: 개발 의존성 포함 (디버깅 도구 사용 가능)
# - 개발 중인 기능 테스트 및 버그 수정용

# ⚠️ package-lock.json이 있는 경우 (권장)
# npm ci  # 정확한 버전 설치

# 설치 확인
npm list --depth=0

# 환경변수 파일 생성
vim .env
```

```.env
# /opt/ezstay/backend/.env

# Server
NODE_ENV=development  # 테스트 환경: 상세한 에러 로그 및 디버깅
PORT=8080

# Database
DB_HOST=localhost
DB_PORT=3306
DB_NAME=ezstay_test_db  # 테스트 전용 DB
DB_USER=ezstay_user
DB_PASSWORD=Your_Strong_Password_123!

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT (32자 이상 랜덤 문자열 사용!)
JWT_SECRET=your_super_secret_jwt_key_minimum_32_characters_long_random_string
JWT_REFRESH_SECRET=your_super_secret_refresh_key_minimum_32_characters_long_random_string

# Kakao OAuth (테스트용 콜백 URL)
KAKAO_CLIENT_ID=your_kakao_rest_api_key
KAKAO_CLIENT_SECRET=your_kakao_client_secret
KAKAO_CALLBACK_URL=https://ezstay-api.duckdns.org/api/auth/oauth/kakao/callback

# Uploads
UPLOADS_PUBLIC_PATH=/uploads
```

```bash
# 환경변수 파일 권한 설정
chmod 600 .env

# uploads 디렉토리 생성
mkdir -p uploads/rooms uploads/dummy

# DB 마이그레이션 (Sequelize 사용 시)
# npx sequelize-cli db:migrate

# PM2로 백엔드 시작 (포트 8080)
pm2 start server.js --name ezstay-api \
  --max-memory-restart 200M \
  --node-args="--max-old-space-size=256"

# PM2 설정 저장
pm2 save

# 상태 확인
pm2 status
pm2 logs ezstay-api --lines 50
```

### 3단계: Flutter Web 빌드 및 배포

```bash
cd /opt/ezstay

# Flutter 프로젝트 클론
git clone https://github.com/your-username/ezstay_front.git flutter_temp
mkdir -p frontend/flutter
mv flutter_temp/building_map_app/* frontend/flutter/
rm -rf flutter_temp

cd frontend/flutter

# Flutter SDK 설치 (선택사항 - 로컬에서 빌드 추천)
# 또는 로컬에서 빌드 후 build/web 디렉토리만 업로드
```

**로컬 PC에서 빌드 (추천)**:
```bash
# 로컬 Windows PC에서 실행
cd c:\study\ezstay_front\building_map_app

# 테스트 환경용 API URL 설정
# lib/config/env_config.dart 파일 생성 (환경별 구분)
```

```dart
// lib/config/env_config.dart
class EnvConfig {
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:8080', // 로컬 개발 기본값
  );
}

// 사용: EnvConfig.apiBaseUrl
```

```bash
# 💡 환경별 빌드/실행 명령어:
# - 로컬 실행: flutter run -d chrome --dart-define=API_BASE_URL=http://localhost:8080
# - 테스트 빌드: flutter build web --release --dart-define=API_BASE_URL=https://ezstay-api.duckdns.org
# - 프로덕션 빌드: flutter build web --release --dart-define=API_BASE_URL=https://api.ezstay.com

# 테스트 환경 빌드
flutter build web --release --dart-define=API_BASE_URL=https://ezstay-api.duckdns.org

# 빌드 결과물을 서버로 업로드 (SCP 사용)
scp -i C:\Users\user\Downloads\ezstay-key.pem -r build\web ec2-user@54.180.123.45:/opt/ezstay/frontend/flutter/
```

**서버에서 배포**:
```bash
# Nginx가 서빙할 디렉토리로 이동
sudo mkdir -p /var/www/flutter
sudo cp -r /opt/ezstay/frontend/flutter/web/* /var/www/flutter/
sudo chown -R nginx:nginx /var/www/flutter
```

### 4단계: React Admin 빌드 및 배포

```bash
cd /opt/ezstay

# React Admin 프로젝트 클론
git clone https://github.com/your-username/admin-dashboard.git frontend/admin

cd frontend/admin
```

**로컬 PC에서 환경별 설정 파일 생성**:
```bash
# 로컬 Windows PC에서 실행
cd c:\study\admin-dashboard

# 환경별 설정 파일 생성
vim .env.development
```

```.env.development
# 로컬 개발 환경
VITE_API_BASE_URL=http://localhost:8080
```

```bash
vim .env.test
```

```.env.test
# 테스트 서버 환경
VITE_API_BASE_URL=https://ezstay-api.duckdns.org
```

```bash
vim .env.production
```

```.env.production
# 실제 프로덕션 환경
VITE_API_BASE_URL=https://api.ezstay.com
```

**package.json에 빌드 스크립트 추가**:
```bash
vim package.json
```

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "build:test": "vite build --mode test",
    "build:prod": "vite build --mode production",
    "preview": "vite preview"
  }
}
```

**테스트 환경 빌드 및 배포**:
```bash
# 테스트 서버용 빌드
npm run build:test

# 💡 환경별 빌드 명령어:
# - 로컬 개발: npm run dev (vite → .env.development)
# - 테스트 빌드: npm run build:test (vite build --mode test → .env.test)
# - 프로덕션 빌드: npm run build:prod (vite build → .env.production)

# 빌드 결과물을 서버로 업로드
scp -i C:\Users\user\Downloads\ezstay-key.pem -r dist ec2-user@54.180.123.45:/opt/ezstay/frontend/admin/
```

**서버에서 배포**:
```bash
# Nginx가 서빙할 디렉토리로 이동
sudo mkdir -p /var/www/admin
sudo cp -r /opt/ezstay/frontend/admin/dist/* /var/www/admin/
sudo chown -R nginx:nginx /var/www/admin
```

---

## SSL 인증서 설정

### 1단계: DuckDNS 무료 도메인 설정

**DuckDNS란?**
- 무료 동적 DNS 서비스 (https://www.duckdns.org)
- 회원가입 불필요 (소셜 로그인만으로 사용)
- Let's Encrypt SSL 인증서 완벽 지원
- 테스트 서버에 이상적

**DuckDNS 설정 방법**:

1. **DuckDNS 웹사이트 접속**: https://www.duckdns.org
2. **소셜 로그인** (Google, GitHub 등)
3. **도메인 이름 등록**:
   - 원하는 도메인 입력 (예: ezstay-api)
   - 최종 도메인: `ezstay-api.duckdns.org`
4. **IP 주소 입력**:
   - EC2 Elastic IP 입력: `98.94.160.132`
   - "update ip" 버튼 클릭
5. **토큰 저장**: DuckDNS 토큰을 안전한 곳에 저장 (갱신용)

**DNS 전파 확인 (즉시 반영)**:
```bash
# 로컬 PC에서 확인
nslookup ezstay-api.duckdns.org

# 출력 예시:
# Server:  8.8.8.8
# Address:  8.8.8.8
#
# Non-authoritative answer:
# Name:    ezstay-api.duckdns.org
# Address: 98.94.160.132

# 서버에서도 확인
curl -I http://ezstay-api.duckdns.org
# HTTP/1.1 200 OK (Nginx 응답 확인)
```

### 2단계: Certbot 설치 (Amazon Linux 2023)

```bash
# ⚠️ Amazon Linux 2023은 amazon-linux-extras가 없음!
# dnf 패키지 매니저 사용

# Certbot 설치
sudo dnf install -y certbot python3-certbot-nginx

# 버전 확인
certbot --version
# certbot 2.x.x
```

### 3단계: SSL 인증서 발급 (단일 도메인)

```bash
# DuckDNS 도메인에 대한 SSL 인증서 발급
sudo certbot certonly --webroot \
  -w /var/www/certbot \
  -d ezstay-api.duckdns.org \
  --email your-email@example.com \
  --agree-tos \
  --no-eff-email

# 💡 설명:
# - --webroot: 웹루트 인증 방식 (Nginx가 80포트에서 실행 중)
# - -w /var/www/certbot: ACME Challenge 파일 저장 위치
# - -d ezstay-api.duckdns.org: 인증서를 발급받을 도메인
# - --email: Let's Encrypt 알림 수신 이메일
# - --agree-tos: 서비스 약관 동의
# - --no-eff-email: EFF 이메일 수신 거부

# 인증서 발급 성공 메시지:
# Successfully received certificate.
# Certificate is saved at: /etc/letsencrypt/live/ezstay-api.duckdns.org/fullchain.pem
# Key is saved at:         /etc/letsencrypt/live/ezstay-api.duckdns.org/privkey.pem

# 인증서 확인
sudo ls -la /etc/letsencrypt/live/
# total 4
# drwx------ 3 root root  41 Oct 30 12:34 .
# drwxr-xr-x 9 root root 108 Oct 30 12:34 ..
# drwxr-xr-x 2 root root  93 Oct 30 12:34 ezstay-api.duckdns.org

sudo ls -la /etc/letsencrypt/live/ezstay-api.duckdns.org/
# cert.pem  chain.pem  fullchain.pem  privkey.pem  README
```

### 4단계: 전체 Nginx 설정 (경로 기반 라우팅 + SSL)

```bash
# 기존 임시 설정 백업
sudo mv /etc/nginx/sites-available/ezstay.conf /etc/nginx/sites-available/ezstay.conf.backup

# 새 설정 파일 작성
sudo vim /etc/nginx/sites-available/ezstay.conf
```

```nginx
# /etc/nginx/sites-available/ezstay.conf
# 경로 기반 라우팅: 단일 도메인에 모든 서비스 통합

# HTTP → HTTPS 리다이렉트
server {
    listen 80;
    server_name ezstay-api.duckdns.org;

    # Let's Encrypt ACME Challenge (SSL 갱신용)
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # 나머지 모든 요청은 HTTPS로 리다이렉트
    location / {
        return 301 https://$host$request_uri;
    }
}

# HTTPS - 모든 서비스 통합 (경로 기반)
server {
    listen 443 ssl http2;
    server_name ezstay-api.duckdns.org;

    # SSL 인증서 (단일 인증서로 모든 서비스 보호)
    ssl_certificate /etc/letsencrypt/live/ezstay-api.duckdns.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ezstay-api.duckdns.org/privkey.pem;

    # SSL 설정
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # 보안 헤더
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;

    # 업로드 파일 크기 제한
    client_max_body_size 10M;

    # ===========================
    # Backend API (Node.js)
    # ===========================
    location /api {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket 지원 (채팅용)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_cache_bypass $http_upgrade;

        # 타임아웃 설정
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # ===========================
    # 업로드 파일 서빙
    # ===========================
    location /uploads {
        alias /opt/ezstay/backend/uploads;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # ===========================
    # Flutter Web (SPA)
    # ===========================
    location /app {
        alias /var/www/flutter;
        index index.html;
        try_files $uri $uri/ /app/index.html;

        # 정적 파일 캐싱
        location ~* \.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }

    # ===========================
    # React Admin (SPA)
    # ===========================
    location /admin {
        alias /var/www/admin;
        index index.html;
        try_files $uri $uri/ /admin/index.html;

        # 정적 파일 캐싱
        location ~* \.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }

    # ===========================
    # 루트 경로 (기본 페이지)
    # ===========================
    location = / {
        return 200 'Ezstay API Server\nAvailable paths:\n- /api (Backend API)\n- /app (Flutter Web)\n- /admin (React Admin)';
        add_header Content-Type text/plain;
    }
}
```

```bash
# 설정 테스트
sudo nginx -t

# Nginx 재시작
sudo systemctl restart nginx
```

### 5단계: SSL 자동 갱신 설정 (Webroot 방식)

**중요**: Certbot 갱신 시 webroot 인증 방식을 사용해야 Nginx와 포트 충돌이 발생하지 않습니다.

```bash
# 갱신 설정 파일 편집
sudo vim /etc/letsencrypt/renewal/ezstay-api.duckdns.org.conf
```

```ini
# /etc/letsencrypt/renewal/ezstay-api.duckdns.org.conf
# 아래 내용이 있는지 확인 (없으면 추가)

[renewalparams]
account = YOUR_ACCOUNT_ID
authenticator = webroot
webroot_path = /var/www/certbot
server = https://acme-v02.api.letsencrypt.org/directory

[[webroot_map]]
ezstay-api.duckdns.org = /var/www/certbot
```

```bash
# Certbot 자동 갱신 테스트 (webroot 방식)
sudo certbot renew --dry-run --webroot -w /var/www/certbot

# 성공 메시지:
# Congratulations, all simulated renewals succeeded:
#   /etc/letsencrypt/live/ezstay-api.duckdns.org/fullchain.pem (success)

# Cron 작업 추가 (매일 새벽 3시)
sudo crontab -e
```

```cron
# 매일 새벽 3시에 SSL 인증서 자동 갱신 (webroot 방식)
0 3 * * * /usr/bin/certbot renew --webroot -w /var/www/certbot --post-hook "systemctl reload nginx" --quiet
```

**갱신 실패 시 트러블슈팅**:
```bash
# 에러: "Could not bind TCP port 80 because it is already in use"
# 원인: Certbot이 standalone 모드로 실행되어 Nginx와 포트 충돌

# 해결: renewal 설정에 webroot 명시
sudo vim /etc/letsencrypt/renewal/ezstay-api.duckdns.org.conf
# authenticator = webroot 확인

# 수동 갱신 테스트
sudo certbot renew --webroot -w /var/www/certbot --dry-run
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

# 프로젝트 디렉토리
BACKEND_DIR="/opt/ezstay/backend"

# 백업 디렉토리
BACKUP_DIR="/opt/ezstay/backups"
mkdir -p $BACKUP_DIR

# 데이터베이스 백업
print_info "데이터베이스 백업 중..."
mysqldump -u ezstay_user -p'Your_Strong_Password_123!' ezstay_db \
  | gzip > $BACKUP_DIR/db_backup_$(date +%Y%m%d_%H%M%S).sql.gz

# Git Pull
print_info "최신 코드 가져오기..."
cd $BACKEND_DIR
git pull origin main

# 의존성 업데이트 확인
if git diff HEAD@{1} HEAD --name-only | grep -q "package.json"; then
    print_info "package.json 변경 감지 - 의존성 재설치..."
    if [ -f "package-lock.json" ]; then
        npm ci  # 테스트 환경: 모든 의존성 설치
    else
        print_warn "package-lock.json 없음 - npm install 사용"
        npm install  # 테스트 환경: 모든 의존성 포함
    fi
fi

# PM2로 재시작 (무중단 배포)
print_info "백엔드 서비스 재시작..."
pm2 reload ezstay-api

# 헬스체크
print_info "서비스 헬스체크 중..."
sleep 5

if curl -f http://localhost:8080/health > /dev/null 2>&1; then
    print_info "✅ 백엔드 서비스 정상"
else
    print_error "백엔드 서비스 실패"
    print_warn "이전 버전으로 롤백 중..."
    cd $BACKEND_DIR
    git reset --hard HEAD@{1}
    pm2 reload ezstay-api
    exit 1
fi

# Nginx 설정 테스트
if sudo nginx -t > /dev/null 2>&1; then
    print_info "✅ Nginx 설정 정상"
    sudo systemctl reload nginx
else
    print_error "Nginx 설정 오류"
    exit 1
fi

# PM2 상태 확인
print_info "PM2 프로세스 상태:"
pm2 status

# 7일 이상 된 백업 삭제
find $BACKUP_DIR -type f -name "*.sql.gz" -mtime +7 -delete

print_info "🎉 배포 완료!"
print_info "접속 주소:"
print_info "  - API: https://ezstay-api.duckdns.org/api"
print_info "  - App: https://ezstay-api.duckdns.org/app"
print_info "  - Admin: https://ezstay-api.duckdns.org/admin"
EOF

chmod +x /opt/ezstay/deploy.sh
```

### 2. 프론트엔드 배포 스크립트

```bash
# /opt/ezstay/deploy-frontend.sh 생성
cat > /opt/ezstay/deploy-frontend.sh << 'EOF'
#!/bin/bash

set -e

echo "🎨 프론트엔드 배포 시작..."

GREEN='\033[0;32m'
NC='\033[0m'
print_info() { echo -e "${GREEN}ℹ️  $1${NC}"; }

# Flutter Web
if [ "$1" == "flutter" ] || [ "$1" == "all" ]; then
    print_info "Flutter Web 배포 중..."
    cd /opt/ezstay/frontend/flutter
    git pull origin main

    # 로컬에서 빌드한 web 디렉토리를 서버로 업로드했다고 가정
    # 또는 서버에서 직접 빌드 (Flutter SDK 필요)

    sudo cp -r web/* /var/www/flutter/
    sudo chown -R nginx:nginx /var/www/flutter
    print_info "✅ Flutter Web 배포 완료"
fi

# React Admin
if [ "$1" == "admin" ] || [ "$1" == "all" ]; then
    print_info "React Admin 배포 중..."
    cd /opt/ezstay/frontend/admin
    git pull origin main

    # 로컬에서 빌드한 dist 디렉토리를 서버로 업로드했다고 가정

    sudo cp -r dist/* /var/www/admin/
    sudo chown -R nginx:nginx /var/www/admin
    print_info "✅ React Admin 배포 완료"
fi

print_info "🎉 프론트엔드 배포 완료!"
EOF

chmod +x /opt/ezstay/deploy-frontend.sh
```

### 3. 로그 확인 스크립트

```bash
# /opt/ezstay/logs.sh 생성
cat > /opt/ezstay/logs.sh << 'EOF'
#!/bin/bash

case "$1" in
    backend|api)
        pm2 logs ezstay-api --lines 100
        ;;
    mysql)
        sudo tail -f /var/log/mysqld.log
        ;;
    redis)
        sudo tail -f /var/log/redis/redis.log
        ;;
    nginx)
        sudo tail -f /var/log/nginx/error.log
        ;;
    access)
        sudo tail -f /var/log/nginx/access.log
        ;;
    all)
        pm2 logs ezstay-api
        ;;
    *)
        echo "사용법: ./logs.sh [backend|mysql|redis|nginx|access|all]"
        exit 1
        ;;
esac
EOF

chmod +x /opt/ezstay/logs.sh
```

### 4. 백업 스크립트

```bash
# /opt/ezstay/backup.sh 생성
cat > /opt/ezstay/backup.sh << 'EOF'
#!/bin/bash

set -e

BACKUP_DIR="/opt/ezstay/backups"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

echo "🗄️  데이터베이스 백업 중..."
mysqldump -u ezstay_user -p'Your_Strong_Password_123!' ezstay_db \
  | gzip > $BACKUP_DIR/db_backup_$DATE.sql.gz

echo "📁 업로드 파일 백업 중..."
tar -czf $BACKUP_DIR/uploads_backup_$DATE.tar.gz \
  -C /opt/ezstay/backend uploads/

echo "🔧 환경변수 백업 중..."
cp /opt/ezstay/backend/.env $BACKUP_DIR/.env_$DATE

# 7일 이상 된 백업 삭제
find $BACKUP_DIR -type f -mtime +7 -delete

echo "✅ 백업 완료: $BACKUP_DIR"
ls -lh $BACKUP_DIR | tail -5
EOF

chmod +x /opt/ezstay/backup.sh

# Cron 작업 추가 (매일 새벽 3시 30분)
(crontab -l 2>/dev/null; echo "30 3 * * * /opt/ezstay/backup.sh >> /opt/ezstay/logs/backup.log 2>&1") | crontab -

# 로그 디렉토리 생성
mkdir -p /opt/ezstay/logs
```

---

## 모니터링 및 유지보수

### 1. 시스템 모니터링 스크립트

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

echo -e "\n스왑 사용량:"
free -h | awk 'NR==3{printf "사용: %s / %s\n", $3, $2}'

# 서비스 상태
echo -e "\n🔧 서비스 상태:"
services=("mysqld" "redis" "nginx")
for service in "${services[@]}"; do
    if systemctl is-active --quiet $service; then
        echo "✅ $service: Running"
    else
        echo "❌ $service: Stopped"
    fi
done

# PM2 프로세스
echo -e "\n📦 PM2 프로세스:"
pm2 jlist | jq -r '.[] | "\(.name): \(.pm2_env.status) (메모리: \(.monit.memory / 1024 / 1024 | floor)MB, CPU: \(.monit.cpu)%)"'

# MySQL 연결 수
echo -e "\n🗄️  MySQL 연결 수:"
mysql -u ezstay_user -p'Your_Strong_Password_123!' -e "SHOW STATUS LIKE 'Threads_connected';" 2>/dev/null | awk 'NR==2{print $2}'

# Redis 메모리
echo -e "\n💾 Redis 메모리 사용량:"
redis-cli INFO memory | grep used_memory_human | cut -d: -f2

# Nginx 상태
echo -e "\n🌐 Nginx 활성 연결:"
curl -s http://localhost/nginx_status 2>/dev/null || echo "nginx_status 미설정"

# 최근 에러 로그
echo -e "\n⚠️  최근 백엔드 에러 (최근 5개):"
pm2 logs ezstay-api --nostream --lines 100 | grep -i error | tail -5

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
    if curl -f -s "$1" > /dev/null 2>&1; then
        echo -e "${GREEN}✅ $2: OK${NC}"
        return 0
    else
        echo -e "${RED}❌ $2: FAILED${NC}"
        return 1
    fi
}

echo "🏥 Ezstay 헬스체크..."
echo "========================================"

# 로컬 확인
check_service "http://localhost:8080/health" "Backend API (Local)"

# HTTPS 확인 (경로 기반)
check_service "https://ezstay-api.duckdns.org/api/health" "Backend API (HTTPS)"
check_service "https://ezstay-api.duckdns.org/app" "Flutter Web"
check_service "https://ezstay-api.duckdns.org/admin" "React Admin"

# MySQL 연결
if mysql -u ezstay_user -p'Your_Strong_Password_123!' -e "SELECT 1;" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ MySQL: OK${NC}"
else
    echo -e "${RED}❌ MySQL: FAILED${NC}"
fi

# Redis 연결
if redis-cli ping > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Redis: OK${NC}"
else
    echo -e "${RED}❌ Redis: FAILED${NC}"
fi

# Nginx 상태
if systemctl is-active --quiet nginx; then
    echo -e "${GREEN}✅ Nginx: Running${NC}"
else
    echo -e "${RED}❌ Nginx: Stopped${NC}"
fi

echo "========================================"
EOF

chmod +x /opt/ezstay/healthcheck.sh
```

### 3. 유용한 명령어 모음

```bash
# 백엔드 서비스 관리
pm2 start server.js --name ezstay-api      # 시작
pm2 restart ezstay-api                      # 재시작
pm2 reload ezstay-api                       # 무중단 재시작
pm2 stop ezstay-api                         # 중지
pm2 delete ezstay-api                       # 삭제
pm2 logs ezstay-api                         # 로그 확인 (실시간)
pm2 logs ezstay-api --lines 100             # 최근 100줄
pm2 monit                                   # 실시간 모니터링

# MySQL 관리
sudo systemctl status mysqld                # 상태 확인
sudo systemctl restart mysqld               # 재시작
mysql -u ezstay_user -p                     # 접속
sudo tail -f /var/log/mysqld.log            # 로그 확인

# Redis 관리
sudo systemctl status redis                 # 상태 확인
sudo systemctl restart redis                # 재시작
redis-cli                                   # 접속
redis-cli MONITOR                           # 실시간 명령 모니터링

# Nginx 관리
sudo systemctl status nginx                 # 상태 확인
sudo nginx -t                               # 설정 테스트
sudo systemctl reload nginx                 # 설정 재로드
sudo systemctl restart nginx                # 재시작
sudo tail -f /var/log/nginx/error.log       # 에러 로그
sudo tail -f /var/log/nginx/access.log      # 액세스 로그

# 시스템 리소스 확인
htop                                        # 실시간 리소스 모니터
free -h                                     # 메모리 사용량
df -h                                       # 디스크 사용량
netstat -tulpn | grep LISTEN                # 리스닝 포트 확인
```

---

## 트러블슈팅

### 1. 메모리 부족 (OOM)

**증상**: 서비스가 갑자기 중단됨

```bash
# 메모리 사용량 확인
free -h

# OOM Killer 로그 확인
dmesg | grep -i kill

# 해결책 1: Swap 메모리 늘리기
sudo swapoff /swapfile
sudo dd if=/dev/zero of=/swapfile bs=1M count=4096  # 4GB
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# 해결책 2: PM2 메모리 제한
pm2 restart ezstay-api --max-memory-restart 150M
```

### 2. 백엔드 서비스 다운

**증상**: API 응답 없음

```bash
# PM2 상태 확인
pm2 status

# 로그 확인
pm2 logs ezstay-api --lines 100

# 재시작
pm2 restart ezstay-api

# MySQL/Redis 연결 확인
mysql -u ezstay_user -p -e "SELECT 1;"
redis-cli ping
```

### 3. Nginx 502 Bad Gateway

**증상**: 웹사이트 접속 시 502 에러

```bash
# 백엔드가 실행 중인지 확인
pm2 status
curl http://localhost:8080/health

# Nginx 에러 로그 확인
sudo tail -f /var/log/nginx/error.log

# Nginx 설정 테스트
sudo nginx -t

# Nginx 재시작
sudo systemctl restart nginx
```

### 4. SSL 인증서 갱신 실패

**증상**: HTTPS 접속 불가

```bash
# 인증서 만료일 확인
sudo certbot certificates

# 수동 갱신
sudo certbot renew --dry-run  # 테스트
sudo certbot renew             # 실제 갱신
sudo systemctl reload nginx

# Certbot 로그 확인
sudo tail -f /var/log/letsencrypt/letsencrypt.log
```

### 5. 디스크 공간 부족

**증상**: 파일 쓰기 실패

```bash
# 디스크 사용량 확인
df -h

# 큰 파일 찾기
sudo du -h / | sort -hr | head -20

# 로그 파일 정리
sudo find /var/log -type f -name "*.log" -mtime +7 -delete
sudo journalctl --vacuum-time=7d

# PM2 로그 정리
pm2 flush

# MySQL 로그 정리
sudo rm -f /var/log/mysql/slow-query.log
sudo systemctl restart mysqld
```

### 6. npm 의존성 설치 에러

**증상**: `npm ci` 실행 시 `package-lock.json not found` 에러

```bash
npm error The `npm ci` command can only install with an existing package-lock.json
```

**원인**:
1. `package-lock.json` 파일이 Git 저장소에 없음
2. Git clone 시 파일이 누락됨
3. Deprecated된 `--only=production` 플래그 사용

**해결 방법**:

```bash
# 1. package-lock.json 파일 확인
cd /opt/ezstay/backend
ls -la package-lock.json

# 2-A. 파일이 있는 경우: 최신 npm 명령어 사용
npm ci --omit=dev

# 2-B. 파일이 없는 경우: Git에서 복구 시도
git log --all --full-history -- package-lock.json
git checkout main -- package-lock.json

# 2-C. 그래도 없는 경우: npm install 사용
npm install --production

# 3. npm 버전 확인 및 업데이트
npm --version
npm install -g npm@latest  # 필요 시

# 4. 캐시 정리 후 재시도 (마지막 수단)
npm cache clean --force
rm -rf node_modules
npm install --production

# 5. 설치 확인
npm list --depth=0
```

**로컬 PC에서 package-lock.json 생성 및 커밋**:

```bash
# Windows 로컬 PC에서 실행
cd c:\study\ezstay_back

# package-lock.json 생성
npm install

# Git 상태 확인
git status

# 커밋 및 푸시
git add package-lock.json
git commit -m "chore: add package-lock.json for reproducible builds"
git push origin main

# 서버에서 다시 pull
# (SSH로 서버 접속 후)
cd /opt/ezstay/backend
git pull origin main
ls -la package-lock.json  # 파일 확인
npm ci --omit=dev
```

**npm 명령어 변경 사항**:

| 구분 | Deprecated (구버전) | Recommended (최신) |
|------|---------------------|-------------------|
| 프로덕션 설치 | `npm ci --only=production` | `npm ci --omit=dev` |
| 개발 제외 | `npm install --only=production` | `npm install --production` |
| 경고 메시지 | ⚠️ `npm warn config only` | ✅ 경고 없음 |

---

## 보안 강화

### 1. Fail2Ban 설치 (Brute Force 방어)

```bash
# Fail2Ban 설치
sudo yum install -y fail2ban

# 설정 파일 생성
sudo vim /etc/fail2ban/jail.local
```

```ini
# /etc/fail2ban/jail.local
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 3

[sshd]
enabled = true
port = 22
filter = sshd
logpath = /var/log/secure
maxretry = 3

[nginx-http-auth]
enabled = true
port = http,https
filter = nginx-http-auth
logpath = /var/log/nginx/error.log

[nginx-limit-req]
enabled = true
port = http,https
filter = nginx-limit-req
logpath = /var/log/nginx/error.log
maxretry = 5
```

```bash
# Fail2Ban 시작
sudo systemctl start fail2ban
sudo systemctl enable fail2ban

# 상태 확인
sudo fail2ban-client status
```

### 2. 자동 보안 업데이트

```bash
# yum-cron 설치
sudo yum install -y yum-cron

# 설정 파일 편집
sudo vim /etc/yum/yum-cron.conf
```

```ini
# /etc/yum/yum-cron.conf
[commands]
update_cmd = security
apply_updates = yes
```

```bash
# 시작
sudo systemctl start yum-cron
sudo systemctl enable yum-cron
```

### 3. SSH 보안 강화

```bash
# SSH 설정 편집
sudo vim /etc/ssh/sshd_config
```

```ini
# /etc/ssh/sshd_config에서 다음 항목 수정
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
ClientAliveInterval 300
ClientAliveCountMax 2
```

```bash
# SSH 재시작
sudo systemctl restart sshd
```

---

## 예상 비용 (월간)

### 테스트 서버 비용 (t2.small)

```yaml
AWS 비용:
  EC2 t2.small (On-Demand): $17.28/월
  EBS 30GB (gp3): $2.40/월
  데이터 전송 (50GB 가정): $4.50/월
  ─────────────────────────────
  소계: $24.18/월 (약 ₩32,000)

도메인 (선택사항):
  .com 도메인: ₩15,000/년 (₩1,250/월)

총 월 비용: 약 $25 (₩33,000)
```

### 비용 최적화 옵션

**테스트 서버 특성상 비용 절감 매우 용이**:

1. **개발 시간만 운영** ⭐ 추천
   - 월-금 9시-18시만 가동 (주 40시간)
   - EventBridge + Lambda로 자동 시작/중지
   - 비용 절감: 약 **75%** 절감
   - **예상 비용: 약 $6-8/월** (₩8,000-10,000)

2. **주말 자동 종료**
   - 금요일 저녁 자동 종료, 월요일 아침 자동 시작
   - 비용 절감: 약 30% 절감
   - 예상 비용: 약 $17/월

3. **Spot Instance 활용**
   - 최대 90% 할인 가능
   - 중단 가능성 있음 (테스트 서버는 OK)
   - 예상 비용: 약 $2-3/월
   - ⚠️ 주의: 갑작스러운 종료 가능

### 자동 시작/중지 스크립트 예시

```bash
# AWS CLI로 자동 시작/중지 설정
# EventBridge 규칙으로 cron 스케줄 설정
# 평일 9시 시작: cron(0 0 * * MON-FRI)  # UTC 기준
# 평일 18시 종료: cron(0 9 * * MON-FRI)  # UTC 기준
```

---

## 최초 배포 체크리스트

### 테스트 환경 설정
- [ ] AWS EC2 인스턴스 생성 (t2.small)
- [ ] 인스턴스 태그 설정 (Environment: test)
- [ ] 보안 그룹 설정 (22, 80, 443 포트)
- [ ] Elastic IP 할당 (선택사항, 테스트는 불필요)
- [ ] SSH 접속 확인
- [ ] 시스템 업데이트 완료
- [ ] Swap 메모리 추가 (2GB)
- [ ] MySQL 설치 및 데이터베이스 생성
- [ ] Redis 설치 및 설정
- [ ] Node.js 18 + PM2 설치
- [ ] Nginx 설치 및 기본 설정
- [ ] 백엔드 코드 배포
- [ ] 환경변수 설정 (.env, NODE_ENV=development)
- [ ] PM2로 백엔드 시작
- [ ] Flutter Web 빌드 및 배포 (dart-define: API_BASE_URL=https://ezstay-api.duckdns.org)
- [ ] React Admin 환경변수 설정 (.env.test, build:test 스크립트)
- [ ] React Admin 빌드 및 배포 (npm run build:test, VITE_API_BASE_URL=https://ezstay-api.duckdns.org)
- [ ] DuckDNS 도메인 등록 (ezstay-api.duckdns.org → Elastic IP)
- [ ] Let's Encrypt SSL 인증서 발급 (단일 도메인)
- [ ] Nginx 경로 기반 라우팅 설정 (/api, /app, /admin)
- [ ] SSL 갱신 webroot 설정 확인
- [ ] 헬스체크 확인 (./healthcheck.sh)
- [ ] 자동 백업 Cron 등록 (선택사항)
- [ ] Fail2Ban 설치 (선택사항)
- [ ] 모니터링 스크립트 설정
- [ ] 카카오 개발자 콘솔에서 DuckDNS 콜백 URL 등록 (https://ezstay-api.duckdns.org/api/auth/oauth/kakao/callback)

---

## 다음 단계

### 테스트 서버 활용 방법

1. **개발 및 테스트**
   - [ ] 기능 개발 후 실시간 테스트
   - [ ] 프론트엔드 ↔ 백엔드 통합 테스트
   - [ ] 카카오 OAuth, Portone 결제 등 외부 API 테스트
   - [ ] 버그 재현 및 디버깅

2. **스테이징 서버 구축** (프로덕션 검증용)
   - [ ] 별도 스테이징 서버 구축 (이 가이드 재사용)
   - [ ] NODE_ENV=production으로 변경
   - [ ] npm ci --omit=dev로 프로덕션 의존성만 설치
   - [ ] 도메인: 독립된 DuckDNS 또는 유료 도메인 (예: staging.ezstay.com)
   - [ ] 프로덕션 배포 전 최종 검증

3. **프로덕션 배포 준비**
   - [ ] 프로덕션 서버 구축 (동일한 가이드 활용)
   - [ ] 도메인: 유료 도메인 (예: api.ezstay.com, app.ezstay.com, admin.ezstay.com)
   - [ ] 고가용성 설정 (RDS, ElastiCache)
   - [ ] 모니터링 설정 (CloudWatch, Sentry)
   - [ ] 백업 자동화 (RDS 스냅샷)

4. **CI/CD 구축**
   - GitHub Actions로 자동 배포
   - 테스트 서버: push to dev → 자동 배포
   - 스테이징: push to main → 자동 배포
   - 프로덕션: tag 생성 → 수동 승인 → 배포

---

## 📚 관련 문서

- **로컬 개발 환경**: 개발자 PC에서 개발 환경 설정
- **테스트 서버 (이 문서)**: 개발 및 기능 테스트용 서버
- **스테이징 서버**: 프로덕션 배포 전 최종 검증 서버 (향후 작성)
- **프로덕션 배포**: 실제 서비스용 고가용성 구성 (향후 작성)
- **CI/CD 파이프라인**: GitHub Actions 자동 배포 (향후 작성)

---

## ⚙️ 환경 요약

```yaml
환경: 테스트 서버 (Test)
목적: 개발 및 기능 테스트
인스턴스: AWS EC2 t2.small ($17/월)

백엔드:
  PORT: 8080
  NODE_ENV: development
  npm: npm install (모든 의존성)
  데이터베이스: ezstay_test_db
  특징: 상세한 에러 로그, 디버깅 도구 사용 가능

프론트엔드:
  React Admin:
    로컬: npm run dev (.env.development → localhost:8080)
    테스트: npm run build:test (.env.test → ezstay-api.duckdns.org)
    프로덕션: npm run build:prod (.env.production → api.ezstay.com)

  Flutter Web:
    로컬: flutter run --dart-define=API_BASE_URL=http://localhost:8080
    테스트: flutter build web --dart-define=API_BASE_URL=https://ezstay-api.duckdns.org
    프로덕션: flutter build web --dart-define=API_BASE_URL=https://api.ezstay.com

도메인 (경로 기반 라우팅):
  단일 도메인: ezstay-api.duckdns.org
  - https://ezstay-api.duckdns.org/api (백엔드 API)
  - https://ezstay-api.duckdns.org/app (Flutter Web)
  - https://ezstay-api.duckdns.org/admin (React Admin)
  - https://ezstay-api.duckdns.org/uploads (정적 파일)
```

---

**작성일**: 2025-10-30
**최종 수정**: 2025-10-31 (DuckDNS + 경로 기반 라우팅 반영)
**버전**: 4.0.0 (테스트 서버)
**환경**: AWS EC2 t2.small + Amazon Linux 2023 + DuckDNS
**아키텍처**: 단일 도메인 경로 기반 라우팅 (ezstay-api.duckdns.org)
**문의**: ezstay-dev@example.com
