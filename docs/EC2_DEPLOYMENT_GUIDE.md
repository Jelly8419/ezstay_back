# EC2 자동 배포 설정 가이드

## 📋 사전 준비

### 1. EC2 인스턴스 요구사항
- **OS**: Amazon Linux 2 또는 Ubuntu 20.04+
- **인스턴스 타입**: t2.micro 이상 (t2.small 권장)
- **스토리지**: 최소 8GB (20GB 권장)
- **보안 그룹**:
  - SSH (포트 22): GitHub Actions 접근 허용
  - HTTP (포트 80): 선택사항
  - Custom TCP (포트 3000): 애플리케이션 포트

### 2. 필수 소프트웨어
- Node.js v18 LTS
- MySQL 5.7+ 또는 8.0+
- Redis (선택사항, 캐싱용)
- PM2 (프로세스 관리자)
- Git

---

## 🚀 빠른 시작 (EC2 초기 설정)

### Step 1: EC2에 SSH 접속
```bash
# Windows (PowerShell 또는 WSL)
ssh -i "your-key.pem" ec2-user@your-ec2-public-ip

# 예시
ssh -i "C:\Users\user\Downloads\ezstay-key.pem" ec2-user@3.35.123.45
```

### Step 2: 설정 스크립트 실행
```bash
# 스크립트 다운로드 (GitHub에서)
cd ~
curl -o setup-test-server.sh https://raw.githubusercontent.com/Jelly8419/ezstay_back/develop/scripts/setup-test-server.sh

# 실행 권한 부여
chmod +x setup-test-server.sh

# 스크립트 실행
./setup-test-server.sh
```

**또는 직접 복사**:
```bash
# 로컬에서 EC2로 파일 전송
scp -i "your-key.pem" scripts/setup-test-server.sh ec2-user@your-ec2-ip:~/

# EC2에서 실행
ssh -i "your-key.pem" ec2-user@your-ec2-ip
chmod +x ~/setup-test-server.sh
./setup-test-server.sh
```

### Step 3: 환경변수 설정
```bash
cd /opt/ezstay/backend
nano .env
```

**최소 필수 설정**:
```env
NODE_ENV=development
PORT=3000

# Database
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_db_password
DB_NAME=ezstay_db

# JWT (최소 32자)
JWT_SECRET=your_super_secret_jwt_key_min_32_chars_long_12345678
JWT_REFRESH_SECRET=your_super_secret_refresh_key_min_32_chars_long_12345678

# Kakao OAuth
KAKAO_CLIENT_ID=your_kakao_rest_api_key
KAKAO_CLIENT_SECRET=your_kakao_client_secret
KAKAO_CALLBACK_URL=http://your-ec2-ip:3000/api/auth/oauth/kakao/callback
```

저장: `Ctrl+O` → `Enter` → `Ctrl+X`

---

## 🗄️ 데이터베이스 설정

### MySQL 설치 (Amazon Linux 2)
```bash
# MySQL 8.0 설치
sudo yum install -y mysql-community-server

# MySQL 시작
sudo systemctl start mysqld
sudo systemctl enable mysqld

# 초기 비밀번호 확인
sudo grep 'temporary password' /var/log/mysqld.log

# MySQL 보안 설정
sudo mysql_secure_installation
```

### 데이터베이스 생성
```bash
mysql -u root -p
```

```sql
-- 데이터베이스 생성
CREATE DATABASE ezstay_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 사용자 생성 및 권한 부여
CREATE USER 'ezstay_user'@'localhost' IDENTIFIED BY 'strong_password_here';
GRANT ALL PRIVILEGES ON ezstay_db.* TO 'ezstay_user'@'localhost';
FLUSH PRIVILEGES;

EXIT;
```

### Redis 설치 (선택사항)
```bash
sudo yum install -y redis
sudo systemctl start redis
sudo systemctl enable redis
```

---

## 🔐 GitHub Actions 설정

### Step 1: GitHub Secrets 등록

**GitHub 저장소** → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

| Secret 이름 | 값 | 설명 |
|-------------|-----|------|
| `TEST_SERVER_HOST` | `3.35.123.45` | EC2 퍼블릭 IP |
| `TEST_SERVER_USER` | `ec2-user` | SSH 사용자명 |
| `TEST_SERVER_SSH_KEY` | `-----BEGIN RSA...` | EC2 .pem 키 전체 내용 |
| `TEST_SERVER_PORT` | `22` | SSH 포트 (생략 가능) |

### Step 2: SSH 키 등록 방법

**Windows에서 .pem 키 복사**:
```powershell
# PowerShell
Get-Content C:\Users\user\Downloads\your-key.pem | Set-Clipboard

# 또는 메모장으로 열기
notepad C:\Users\user\Downloads\your-key.pem
```

전체 내용(시작부터 끝까지)을 복사해서 `TEST_SERVER_SSH_KEY`에 붙여넣기:
```
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA...
(전체 키 내용)
...
-----END RSA PRIVATE KEY-----
```

### Step 3: EC2 보안 그룹 설정

**AWS Console** → **EC2** → **인스턴스 선택** → **보안** → **보안 그룹 클릭**

**인바운드 규칙 추가**:
| 유형 | 프로토콜 | 포트 | 소스 | 설명 |
|------|----------|------|------|------|
| SSH | TCP | 22 | 0.0.0.0/0 | GitHub Actions 접근 |
| Custom TCP | TCP | 3000 | 0.0.0.0/0 | Node.js 애플리케이션 |

---

## ✅ 배포 테스트

### 1. 수동 배포 테스트 (EC2에서)
```bash
cd /opt/ezstay/backend
git fetch origin
git checkout develop
git pull origin develop
npm ci  # 테스트 환경: 모든 의존성 설치
pm2 restart ezstay-api || pm2 start server.js --name ezstay-api
pm2 logs ezstay-api
```

**정상 동작 확인**:
```bash
# 애플리케이션 상태 확인
pm2 status

# 로그 확인
pm2 logs ezstay-backend

# API 테스트
curl http://localhost:3000/api/health
```

### 2. GitHub Actions 자동 배포 테스트
```bash
# 로컬에서
git add .
git commit -m "test: GitHub Actions 자동 배포 테스트"
git push origin develop
```

**GitHub에서 확인**:
- 저장소 → **Actions** 탭 → 워크플로우 실행 확인
- 녹색 체크 표시: 성공 ✅
- 빨간 X 표시: 실패 ❌ (로그 확인 필요)

---

## 🔧 PM2 명령어 모음

```bash
# 애플리케이션 시작
pm2 start server.js --name ezstay-backend

# 재시작
pm2 restart ezstay-backend

# 중지
pm2 stop ezstay-backend

# 삭제
pm2 delete ezstay-backend

# 상태 확인
pm2 status

# 로그 확인 (실시간)
pm2 logs ezstay-backend

# 로그 확인 (최근 100줄)
pm2 logs ezstay-backend --lines 100

# 모니터링
pm2 monit

# 부팅 시 자동 시작 설정
pm2 startup
pm2 save
```

---

## 🐛 트러블슈팅

### 문제 1: GitHub Actions에서 SSH 접속 실패
```
ERROR: Permission denied (publickey)
```

**해결 방법**:
1. `TEST_SERVER_SSH_KEY`가 정확히 복사되었는지 확인 (시작/끝 포함)
2. EC2 보안 그룹에서 SSH 포트(22) 열렸는지 확인
3. EC2 인스턴스가 실행 중인지 확인

### 문제 2: npm ci 실패
```
ERROR: ENOENT: no such file or directory
```

**해결 방법**:
```bash
cd ~/ezstay_back
rm -rf node_modules package-lock.json
npm install
```

### 문제 3: PM2가 서버 재부팅 후 자동 시작 안 됨
**해결 방법**:
```bash
pm2 startup
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ec2-user --hp /home/ec2-user
pm2 save
```

### 문제 4: 포트 3000이 이미 사용 중
**해결 방법**:
```bash
# 프로세스 확인
sudo lsof -i :3000

# 프로세스 종료
sudo kill -9 <PID>

# 또는 PM2로 관리
pm2 restart ezstay-backend
```

---

## 📊 배포 프로세스

```
개발자 로컬
    ↓
git push origin develop
    ↓
GitHub Actions 트리거
    ↓
1. 코드 체크아웃
2. Node.js 설정
3. 의존성 설치
4. 테스트 실행 (선택)
    ↓
5. EC2 SSH 접속
6. Git Pull
7. npm ci --production
8. PM2 재시작
    ↓
EC2 배포 완료 ✅
    ↓
브라우저: http://your-ec2-ip:3000
```

---

## 🎯 체크리스트

배포 전 확인사항:

- [ ] EC2 인스턴스 실행 중
- [ ] 보안 그룹에서 SSH(22), HTTP(3000) 포트 오픈
- [ ] MySQL 설치 및 데이터베이스 생성
- [ ] Redis 설치 (선택사항)
- [ ] `.env` 파일 설정 완료
- [ ] GitHub Secrets 4개 모두 등록
- [ ] PM2로 애플리케이션 정상 실행
- [ ] `curl http://localhost:3000` 응답 확인

---

## 📞 추가 지원

문제 발생 시:
1. EC2 로그 확인: `pm2 logs ezstay-backend`
2. GitHub Actions 로그 확인: Actions 탭
3. 시스템 로그: `sudo journalctl -u pm2-ec2-user -f`
