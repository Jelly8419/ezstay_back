# 배포 스크립트 헬스체크 문제 해결

## 🔍 문제 분석

### 발견된 문제점

1. **❌ `/health` 엔드포인트 부재 (치명적)**
   - 배포 스크립트는 `http://localhost:8080/health`를 체크
   - 하지만 `server.js`에 해당 라우트가 존재하지 않음
   - 결과: 항상 **404 Not Found** 에러 발생

2. **⚠️ 타이밍 문제**
   - `sleep 5` 후 즉시 헬스체크 시도
   - MySQL/Redis 연결, Sequelize 동기화 시간 미고려
   - PM2 reload 완료 후 앱 초기화 시간 필요

3. **⚠️ curl 옵션 부족**
   - 타임아웃 미설정 → 무한 대기 가능
   - 재시도 로직 없음 → 일시적 장애에도 즉시 실패

4. **⚠️ 보안 문제**
   - DB 비밀번호 스크립트에 하드코딩
   - Git에 노출 위험

---

## ✅ 해결 방법

### 1. 헬스체크 엔드포인트 추가 (server.js)

**위치**: `server.js` 162번째 줄 이후

```javascript
// 헬스체크 엔드포인트 (배포 스크립트용)
app.get('/health', async (req, res) => {
  try {
    // MySQL 연결 확인
    await sequelize.authenticate();

    // Redis 연결 확인 (선택적)
    const { redisClient } = require('./config/redis');
    const redisStatus = redisClient?.isReady ? 'connected' : 'disconnected';

    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      mysql: 'connected',
      redis: redisStatus,
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB'
      }
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      message: 'Service unavailable',
      error: error.message
    });
  }
});
```

**응답 예시**:
```json
{
  "status": "ok",
  "timestamp": "2025-10-31T12:34:56.789Z",
  "uptime": 3600.5,
  "mysql": "connected",
  "redis": "connected",
  "memory": {
    "used": "120MB",
    "total": "200MB"
  }
}
```

---

### 2. 배포 스크립트 개선 (deploy.sh)

**개선된 헬스체크 로직**:

```bash
# 헬스체크 (개선된 버전: 재시도 로직 + 타임아웃)
print_info "서비스 헬스체크 중..."
HEALTH_CHECK_URL="http://localhost:${PORT:-8080}/health"
MAX_RETRIES=12  # 최대 12번 시도 (60초)
RETRY_INTERVAL=5  # 5초 간격

success=false
for i in $(seq 1 $MAX_RETRIES); do
    print_info "헬스체크 시도 $i/$MAX_RETRIES..."

    # curl 옵션:
    # -f: HTTP 에러 시 실패 반환
    # -s: 진행 상황 출력 안 함
    # --connect-timeout 3: 연결 타임아웃 3초
    # --max-time 5: 전체 요청 타임아웃 5초
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
```

**개선 사항 요약**:
- ✅ **재시도 로직**: 최대 12번 시도 (총 60초)
- ✅ **타임아웃 설정**: 연결 3초, 전체 5초
- ✅ **에러 로그 출력**: 실패 시 PM2 로그 자동 표시
- ✅ **환경변수 활용**: DB 비밀번호 하드코딩 제거
- ✅ **상세한 진행 상황**: 각 시도마다 상태 출력

---

## 🚀 적용 방법

### 로컬에서 먼저 테스트

1. **헬스체크 엔드포인트 테스트**:
```bash
# 서버 실행
npm run dev

# 헬스체크 테스트 (새 터미널)
curl http://localhost:8080/health

# 기대 응답: {"status":"ok",...}
```

2. **Git 커밋 및 푸시**:
```bash
git add server.js scripts/deploy.sh
git commit -m "fix: 헬스체크 엔드포인트 추가 및 배포 스크립트 개선"
git push origin main
```

### EC2 서버에서 적용

1. **서버 접속**:
```bash
ssh -i ezstay-key.pem ec2-user@54.180.123.45
```

2. **최신 코드 가져오기**:
```bash
cd /opt/ezstay/backend
git pull origin main
```

3. **서비스 재시작**:
```bash
pm2 reload ezstay-api
```

4. **헬스체크 확인**:
```bash
# 로컬 확인
curl http://localhost:8080/health

# HTTPS 확인
curl https://ezstay-api.duckdns.org/api/health
```

5. **배포 스크립트 업데이트**:
```bash
# 배포 문서의 개선된 스크립트 복사
cat > /opt/ezstay/deploy.sh << 'EOF'
[개선된 스크립트 내용]
EOF

chmod +x /opt/ezstay/deploy.sh
```

6. **배포 스크립트 테스트**:
```bash
/opt/ezstay/deploy.sh
```

---

## 📊 헬스체크 동작 원리

### 정상 시나리오
```
1. PM2 reload ezstay-api
2. 5초 대기 (첫 시도)
3. curl /health → 200 OK
4. ✅ 배포 성공
```

### 앱 초기화 지연 시나리오
```
1. PM2 reload ezstay-api
2. 5초 대기 (첫 시도)
3. curl /health → 연결 거부 (앱 아직 시작 안 됨)
4. 5초 대기 (두 번째 시도)
5. curl /health → 200 OK
6. ✅ 배포 성공 (시도 2/12)
```

### MySQL 연결 실패 시나리오
```
1. PM2 reload ezstay-api
2. 5초 대기
3. curl /health → 503 Service Unavailable
   (sequelize.authenticate() 실패)
4. 60초 후에도 계속 503
5. ❌ 배포 실패 → 자동 롤백
```

---

## 🔧 트러블슈팅

### 헬스체크가 계속 실패하는 경우

1. **PM2 상태 확인**:
```bash
pm2 status
pm2 logs ezstay-api --lines 50
```

2. **포트 확인**:
```bash
netstat -tulpn | grep 8080
```

3. **MySQL/Redis 연결 확인**:
```bash
# MySQL
mysql -u ezstay_user -p -e "SELECT 1;"

# Redis
redis-cli ping
```

4. **수동으로 헬스체크**:
```bash
curl -v http://localhost:8080/health
```

### 응답이 없는 경우

1. **방화벽 확인**:
```bash
sudo firewall-cmd --list-all
```

2. **Nginx 프록시 확인**:
```bash
sudo nginx -t
sudo tail -f /var/log/nginx/error.log
```

3. **환경변수 확인**:
```bash
cd /opt/ezstay/backend
cat .env | grep PORT
```

---

## 📝 체크리스트

배포 전 확인 사항:

- [ ] `server.js`에 `/health` 엔드포인트 추가
- [ ] 로컬에서 `curl http://localhost:8080/health` 테스트 완료
- [ ] Git에 커밋 및 푸시 완료
- [ ] EC2에서 `git pull` 완료
- [ ] PM2 재시작 (`pm2 reload ezstay-api`)
- [ ] 헬스체크 엔드포인트 접근 가능 확인
- [ ] 배포 스크립트 업데이트 완료
- [ ] 배포 스크립트 테스트 실행 성공

---

**작성일**: 2025-10-31
**버전**: 1.0.0
**관련 파일**:
- `server.js` (헬스체크 엔드포인트)
- `scripts/deploy.sh` (개선된 배포 스크립트)
- `claudedocs/AWS_DIRECT_INSTALL_DEPLOYMENT.md` (배포 가이드)
