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

# 환경변수 로드 (.env 파일에서 DB 비밀번호 가져오기)
if [ -f "$BACKEND_DIR/.env" ]; then
    export $(grep -v '^#' "$BACKEND_DIR/.env" | xargs)
fi

# 데이터베이스 백업
print_info "데이터베이스 백업 중..."
if mysqldump -u "$DB_USER" -p"$DB_PASSWORD" ezstay_db | gzip > "$BACKUP_DIR/db_backup_$(date +%Y%m%d_%H%M%S).sql.gz"; then
    print_info "✅ DB 백업 완료"
else
    print_warn "DB 백업 실패 (계속 진행)"
fi

# Git Pull
print_info "최신 코드 가져오기..."
cd "$BACKEND_DIR"
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

# 헬스체크 (개선된 버전)
print_info "서비스 헬스체크 중..."
HEALTH_CHECK_URL="http://localhost:${PORT:-8080}/health"
MAX_RETRIES=12  # 최대 12번 시도 (60초)
RETRY_INTERVAL=5  # 5초 간격

success=false
for i in $(seq 1 $MAX_RETRIES); do
    print_info "헬스체크 시도 $i/$MAX_RETRIES..."

    if curl -f -s --connect-timeout 3 --max-time 5 "$HEALTH_CHECK_URL" > /dev/null 2>&1; then
        print_info "✅ 백엔드 서비스 정상 (시도 $i/$MAX_RETRIES)"
        success=true
        break
    else
        if [ $i -lt $MAX_RETRIES ]; then
            print_warn "서비스 응답 없음, ${RETRY_INTERVAL}초 후 재시도..."
            sleep $RETRY_INTERVAL
        fi
    fi
done

if [ "$success" = false ]; then
    print_error "백엔드 서비스 헬스체크 실패"
    print_warn "PM2 로그 확인:"
    pm2 logs ezstay-api --nostream --lines 20

    print_warn "이전 버전으로 롤백 중..."
    cd "$BACKEND_DIR"
    git reset --hard HEAD@{1}
    pm2 reload ezstay-api

    print_error "롤백 완료 - 배포 실패"
    exit 1
fi

# Nginx 설정 테스트
if sudo nginx -t > /dev/null 2>&1; then
    print_info "✅ Nginx 설정 정상"
    sudo systemctl reload nginx
else
    print_error "Nginx 설정 오류"
    sudo nginx -t  # 에러 메시지 출력
    exit 1
fi

# PM2 상태 확인
print_info "PM2 프로세스 상태:"
pm2 status

# 7일 이상 된 백업 삭제
find "$BACKUP_DIR" -type f -name "*.sql.gz" -mtime +7 -delete

print_info "🎉 배포 완료!"
print_info "접속 주소:"
print_info "  - API: https://ezstay-api.duckdns.org/api"
print_info "  - App: https://ezstay-api.duckdns.org/app"
print_info "  - Admin: https://ezstay-api.duckdns.org/admin"
print_info ""
print_info "헬스체크 응답:"
curl -s "$HEALTH_CHECK_URL" | jq '.' 2>/dev/null || curl -s "$HEALTH_CHECK_URL"
