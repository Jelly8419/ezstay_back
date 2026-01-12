# 🖥️ 백엔드 - 로컬/테스트 환경 결제 시스템 구현 가이드

## 📋 목차
1. [환경변수 설정](#환경변수-설정)
2. [ngrok 설정 (Webhook 테스트)](#ngrok-설정-webhook-테스트)
3. [Mock 결제 시스템 구현](#mock-결제-시스템-구현)
4. [테스트 서버 배포](#테스트-서버-배포)
5. [디버깅 팁](#디버깅-팁)

---

## 환경변수 설정

### 🔧 로컬 개발 환경

```env
# .env.local (로컬 전용)
NODE_ENV=development

# 토스페이먼츠 테스트 API 키 (결제 위젯 연동 키)
TOSS_CLIENT_KEY=test_ck_OEP59LybZ8BN3Y1Y7kVrwYxAdXy1
TOSS_SECRET_KEY=test_sk_zXLkKEypNArWmo50nX3lmeaxYG5R
TOSS_WEBHOOK_SECRET=test_webhook_secret_12345

# 로컬 결제 리다이렉트 URL
PAYMENT_SUCCESS_URL=http://localhost:3000/payment/success
PAYMENT_FAIL_URL=http://localhost:3000/payment/fail

# 데이터베이스 (로컬)
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=ezstay_dev
DB_LOGGING=true  # SQL 쿼리 로그 출력
```

### 🖥️ 테스트 서버 환경

```env
# .env.test (테스트 서버 전용)
NODE_ENV=test

# 토스페이먼츠 테스트 API 키
TOSS_CLIENT_KEY=test_ck_OEP59LybZ8BN3Y1Y7kVrwYxAdXy1
TOSS_SECRET_KEY=test_sk_zXLkKEypNArWmo50nX3lmeaxYG5R
TOSS_WEBHOOK_SECRET=test_webhook_secret_12345

# 테스트 서버 도메인 (HTTPS 필수)
PAYMENT_SUCCESS_URL=https://test.ezstay.com/payment/success
PAYMENT_FAIL_URL=https://test.ezstay.com/payment/fail

# 데이터베이스 (테스트 서버)
DB_HOST=test-db.example.com
DB_PORT=3306
DB_USER=ezstay_test
DB_PASSWORD=secure_test_password
DB_NAME=ezstay_test
DB_LOGGING=false  # 프로덕션은 false 권장
```

### 🛡️ 환경변수 검증

```javascript
// server.js 시작 부분에 추가

// 필수 환경변수 검증
const requiredEnvVars = ['TOSS_CLIENT_KEY', 'TOSS_SECRET_KEY'];
requiredEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    console.error(`❌ 환경변수 ${varName}가 설정되지 않았습니다.`);
    process.exit(1);
  }
});

// 시크릿 키 길이 검증 (최소 32자)
if (process.env.TOSS_SECRET_KEY.length < 32) {
  console.error(`❌ TOSS_SECRET_KEY는 최소 32자 이상이어야 합니다.`);
  process.exit(1);
}

console.log('✅ 토스페이먼츠 환경변수 검증 완료');
```

---

## ngrok 설정 (Webhook 테스트)

### 🌐 1. ngrok 설치

```bash
# Windows
choco install ngrok

# 또는 https://ngrok.com/download 에서 다운로드
```

### 🚀 2. ngrok 실행

```bash
# 백엔드 서버 포트로 터널 생성
ngrok http 8080
```

**실행 결과**:
```
Forwarding  https://abc123.ngrok.io -> http://localhost:8080
```

### 🔗 3. 환경변수 업데이트

```env
# .env.local 수정
PAYMENT_SUCCESS_URL=https://abc123.ngrok.io/payment/success
PAYMENT_FAIL_URL=https://abc123.ngrok.io/payment/fail
```

### 📡 4. Webhook URL 등록

**토스페이먼츠 개발자센터**:
1. https://developers.tosspayments.com 접속
2. 내 정보 → 연동 정보 → Webhook URL 설정
3. URL 입력: `https://abc123.ngrok.io/api/webhooks/toss-payment`

### 🔍 5. ngrok 웹 인터페이스

```
http://127.0.0.1:4040
```
- 모든 HTTP 요청/응답 실시간 확인 가능
- 디버깅에 유용

---

## Mock 결제 시스템 구현

네트워크 없이 빠른 로컬 테스트가 필요한 경우 사용.

### 📦 1. Mock 모드 환경변수

```env
# .env.local
PAYMENT_MOCK_MODE=true  # Mock 모드 활성화
```

### 🎭 2. Mock Controller 생성

```javascript
// controllers/mockPaymentController.js

const { sequelize, Contract, Payment, ContractStatusLog } = require('../models');
const { success, error, ErrorCodes } = require('../utils/responseHelper');

/**
 * Mock 결제 승인 (실제 토스 API 호출 없음)
 * POST /api/contracts/:contractId/confirm-payment-mock
 */
const confirmPaymentMock = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { contractId } = req.params;
    const { orderId, amount, simulateFailure } = req.body;
    const guestId = req.user.id;

    // 결제 실패 시뮬레이션
    if (simulateFailure) {
      await transaction.rollback();
      return error(
        res,
        { code: 4605, message: '[MOCK] 결제 승인 실패 (시뮬레이션)' },
        400
      );
    }

    // 계약 조회
    const contract = await Contract.findOne({
      where: { id: contractId, guestId },
      transaction
    });

    if (!contract) {
      await transaction.rollback();
      return error(res, { code: 3005, message: '계약을 찾을 수 없습니다' }, 404);
    }

    if (contract.status !== 'APPROVED') {
      await transaction.rollback();
      return error(
        res,
        { code: 4602, message: '결제 가능한 상태가 아닙니다' },
        400
      );
    }

    // orderId 및 금액 검증
    if (contract.orderId !== orderId || contract.finalTotalAmount !== parseInt(amount, 10)) {
      await transaction.rollback();
      return error(
        res,
        { code: 4604, message: '주문번호 또는 금액이 일치하지 않습니다' },
        400
      );
    }

    // Mock Payment 데이터 생성
    const mockPaymentKey = `mock_payment_${Date.now()}`;
    const now = new Date();

    const payment = await Payment.create({
      contractId: contract.id,
      paymentKey: mockPaymentKey,
      orderId: contract.orderId,
      method: 'CARD',
      status: 'DONE',
      requestedAt: now,
      approvedAt: now,
      totalAmount: contract.finalTotalAmount,
      balanceAmount: contract.finalTotalAmount,
      suppliedAmount: Math.floor(contract.finalTotalAmount / 1.1),
      vat: Math.floor(contract.finalTotalAmount - (contract.finalTotalAmount / 1.1)),
      taxFreeAmount: 0,
      currency: 'KRW',
      receiptUrl: 'https://mock.receipt.url',
      paymentResponse: {
        mock: true,
        message: 'Mock payment for testing'
      }
    }, { transaction });

    // Contract 업데이트
    await contract.update({
      status: 'PAYMENT_COMPLETED',
      paymentMethod: 'CARD',
      paidAt: now
    }, { transaction });

    // 상태 변경 로그 기록
    await ContractStatusLog.createLog({
      contractId: contract.id,
      fromStatus: 'APPROVED',
      toStatus: 'PAYMENT_COMPLETED',
      changedBy: 'GUEST',
      changedByUserId: guestId,
      reason: '[MOCK] 게스트가 결제를 완료했습니다',
      metadata: {
        paymentKey: mockPaymentKey,
        paymentMethod: 'CARD',
        totalAmount: contract.finalTotalAmount,
        mock: true
      },
      req,
      transaction
    });

    await transaction.commit();

    console.log(`✅ [MOCK] 결제 승인 완료: ${mockPaymentKey}`);

    return success(
      res,
      {
        contractId: contract.id,
        orderId: contract.orderId,
        status: contract.status,
        payment: {
          paymentKey: payment.paymentKey,
          method: payment.method,
          status: payment.status,
          totalAmount: payment.totalAmount,
          approvedAt: payment.approvedAt,
          receiptUrl: payment.receiptUrl
        },
        mock: true
      },
      '[MOCK] 결제가 완료되었습니다'
    );

  } catch (err) {
    await transaction.rollback();
    console.error('[MOCK] 결제 승인 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

module.exports = {
  confirmPaymentMock
};
```

### 🔀 3. Mock 라우트 설정

```javascript
// routes/contractRoutes.js에 추가

const { confirmPaymentMock } = require('../controllers/mockPaymentController');

// Mock 결제 승인 (개발/테스트 환경 전용)
if (process.env.PAYMENT_MOCK_MODE === 'true') {
  router.post('/:contractId/confirm-payment-mock', authenticateToken, confirmPaymentMock);
  console.log('⚠️ Mock 결제 모드 활성화');
}
```

---

## 테스트 서버 배포

### 🔐 1. HTTPS 설정 (필수)

토스페이먼츠는 **HTTPS URL만 허용**합니다.

#### Let's Encrypt 무료 SSL 인증서

```bash
# Certbot 설치 (Ubuntu)
sudo apt-get update
sudo apt-get install certbot python3-certbot-nginx

# SSL 인증서 발급
sudo certbot --nginx -d test.ezstay.com

# 자동 갱신 설정
sudo certbot renew --dry-run
```

#### Nginx 설정

```nginx
# /etc/nginx/sites-available/ezstay-test
server {
    listen 443 ssl http2;
    server_name test.ezstay.com;

    ssl_certificate /etc/letsencrypt/live/test.ezstay.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/test.ezstay.com/privkey.pem;

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/webhooks/ {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

# HTTP to HTTPS redirect
server {
    listen 80;
    server_name test.ezstay.com;
    return 301 https://$server_name$request_uri;
}
```

### 🚀 2. 서버 배포

```bash
# Git Pull
cd /var/www/ezstay_back
git pull origin develop

# 환경변수 설정
cp .env.test .env

# 의존성 설치
npm install

# 데이터베이스 마이그레이션
npm run migrate

# PM2로 서버 재시작
pm2 restart ezstay-test
pm2 logs ezstay-test

# PM2 프로세스 확인
pm2 list
```

### 📊 3. 서버 모니터링

```bash
# 로그 실시간 확인
pm2 logs ezstay-test --lines 100

# 서버 상태 확인
pm2 status

# 서버 재시작
pm2 restart ezstay-test

# 메모리 사용량 확인
pm2 monit
```

---

## 디버깅 팁

### 1. 로그 확인

```javascript
// controllers/contractController.js
console.log('📝 결제 승인 요청:', { contractId, paymentKey, orderId, amount });
console.log('✅ 토스 응답:', tossResponse.data);
console.log('💾 Payment 저장:', payment.id);
```

### 2. 토스 API 응답 저장

```javascript
// 전체 응답을 paymentResponse 필드에 저장하여 추후 확인
paymentResponse: paymentData // 전체 JSON 저장
```

### 3. MySQL 쿼리 로깅

```javascript
// models/index.js 또는 Sequelize 설정
logging: console.log // 모든 SQL 쿼리 출력
```

### 4. Webhook 이벤트 테스트

```bash
# ngrok 터널로 Webhook 수신 확인
curl -X POST https://abc123.ngrok.io/api/webhooks/toss-payment \
  -H "Content-Type: application/json" \
  -H "toss-webhook-signature: mock_signature" \
  -d '{
    "eventType": "PAYMENT_STATUS_CHANGED",
    "data": {
      "paymentKey": "test_payment_key",
      "orderId": "250111-00001",
      "status": "DONE"
    }
  }'
```

---

## 🚨 주의사항

### ⚠️ 테스트 환경 제한사항

1. **테스트 API는 실제 금액 차감 없음**
   - 결제 승인되어도 카드사에 청구되지 않음
   - 프로덕션 전환 시 API 키만 변경

2. **Webhook 이벤트는 테스트에서도 실제 전송됨**
   - ngrok이 꺼지면 Webhook 수신 불가
   - 테스트 서버는 항상 접근 가능해야 함

3. **로컬 환경에서 HTTPS 불가**
   - ngrok 터널 사용 필수
   - 무료 ngrok은 세션 타임아웃 있음 (8시간)

### 🔐 보안 주의사항

1. **테스트 API 키도 노출 금지**
   - `.env` 파일은 절대 Git에 커밋하지 않기
   - 공개 저장소에 테스트 키도 올리지 않기

2. **ngrok URL 공유 금지**
   - 임시 터널 URL은 외부에 공유하지 않기
   - 테스트 완료 후 ngrok 종료

3. **테스트 DB는 별도 관리**
   - 프로덕션 DB와 완전히 분리
   - 정기적으로 초기화

---

## 🎯 체크리스트

### 로컬 개발 시작 전
- [ ] 토스페이먼츠 개발자센터 가입
- [ ] 테스트 API 키 발급 (결제 위젯 연동 키)
- [ ] `.env.local` 환경변수 설정
- [ ] ngrok 설치 및 실행 (Webhook 테스트 시)
- [ ] MySQL 로컬 DB 생성
- [ ] 백엔드 서버 실행 확인 (`npm run dev`)

### Mock 모드 사용 시
- [ ] `PAYMENT_MOCK_MODE=true` 설정
- [ ] `mockPaymentController.js` 생성
- [ ] Mock 라우트 추가

### 테스트 서버 배포 전
- [ ] 테스트 도메인 HTTPS 설정 (Let's Encrypt)
- [ ] `.env.test` 환경변수 설정
- [ ] 테스트 DB 마이그레이션 완료
- [ ] 토스 개발자센터에 Webhook URL 등록
- [ ] 방화벽 포트 개방 (443, 80)
- [ ] SSL 인증서 유효기간 확인

---

**문서 버전**: 1.0
**최종 수정일**: 2025-01-11
**작성자**: Claude Code
**대상**: 백엔드 개발자
