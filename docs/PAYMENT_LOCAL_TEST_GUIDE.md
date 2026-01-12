# 🧪 로컬/테스트 환경 결제 시스템 구현 가이드

## 📋 목차
1. [개요](#개요)
2. [토스페이먼츠 테스트 환경](#토스페이먼츠-테스트-환경)
3. [로컬 개발 환경 설정](#로컬-개발-환경-설정)
4. [테스트 서버 환경 설정](#테스트-서버-환경-설정)
5. [Mock 결제 시스템 (선택)](#mock-결제-시스템-선택)
6. [테스트 시나리오](#테스트-시나리오)

---

## 개요

로컬/테스트 환경에서는 **실제 결제 없이** 결제 플로우를 테스트할 수 있습니다.

### 테스트 환경 전략

```
┌─────────────────────────────────────────────────┐
│ 1️⃣ 토스 테스트 API (권장)                       │
│    - 실제 토스 API 사용                          │
│    - 테스트 카드로 결제                          │
│    - 실제 환경과 동일한 플로우                    │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│ 2️⃣ Mock 시스템 (선택)                           │
│    - 토스 API 호출 없이 로컬 처리                │
│    - 빠른 개발 및 테스트                         │
│    - 네트워크 의존성 없음                        │
└─────────────────────────────────────────────────┘
```

---

## 토스페이먼츠 테스트 환경

### 1️⃣ 테스트 API 키 발급

1. **토스페이먼츠 개발자센터** 접속
   - https://developers.tosspayments.com

2. **회원가입 및 로그인**
   - 이메일 인증 완료

3. **API 키 발급**
   ```
   내 정보 → API 키 관리 → 테스트 API 키 복사
   ```

4. **발급되는 키**
   - `test_ck_xxxxx`: 클라이언트 키 (프론트엔드용)
   - `test_sk_xxxxx`: 시크릿 키 (백엔드용)

### 2️⃣ 테스트 카드 번호

토스페이먼츠에서 제공하는 **실제 결제되지 않는** 테스트 카드:

| 카드사 | 카드번호 | 비밀번호 | CVC | 유효기간 |
|--------|---------|---------|-----|---------|
| 신한카드 | `5449-0300-0000-0009` | 아무거나 | 123 | 12/25 |
| 현대카드 | `5334-9900-0000-0008` | 아무거나 | 123 | 12/25 |
| 국민카드 | `4570-2800-0000-0007` | 아무거나 | 123 | 12/25 |
| 삼성카드 | `4530-4100-0000-0006` | 아무거나 | 123 | 12/25 |
| 롯데카드 | `5472-9500-0000-0004` | 아무거나 | 123 | 12/25 |

**특징**:
- ✅ 실제 카드사 연결 없이 승인 완료
- ✅ 실제 금액 차감 없음
- ✅ 취소/환불 테스트 가능
- ✅ Webhook 이벤트 정상 발생

### 3️⃣ 테스트 환경 API 엔드포인트

```javascript
// 테스트 환경 (동일한 엔드포인트 사용)
const TOSS_API_URL = 'https://api.tosspayments.com/v1/payments/confirm';

// 프로덕션 환경 (동일한 엔드포인트 사용)
// API 키만 다르게 사용
```

---

## 로컬 개발 환경 설정

### 🔧 1. 환경변수 설정

```env
# .env.local (로컬 전용)
NODE_ENV=development

# 토스페이먼츠 테스트 API 키
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
```

### 🌐 2. ngrok으로 로컬 서버 외부 노출 (Webhook 테스트용)

토스페이먼츠 Webhook은 **외부에서 접근 가능한 URL**이 필요합니다.

#### ngrok 설치 및 실행

```bash
# ngrok 설치 (Windows)
choco install ngrok

# 또는 https://ngrok.com/download 에서 다운로드

# ngrok 실행 (백엔드 서버 포트)
ngrok http 8080
```

#### ngrok 실행 결과
```
Forwarding  https://abc123.ngrok.io -> http://localhost:8080
```

#### 환경변수 업데이트
```env
# ngrok URL로 변경
PAYMENT_SUCCESS_URL=https://abc123.ngrok.io/payment/success
PAYMENT_FAIL_URL=https://abc123.ngrok.io/payment/fail
```

#### 토스 개발자센터에서 Webhook URL 등록
```
https://abc123.ngrok.io/api/webhooks/toss-payment
```

### 📱 3. Flutter 앱에서 로컬 서버 연결

#### Android Emulator
```dart
// Android 에뮬레이터는 10.0.2.2로 localhost 접근
final baseUrl = 'http://10.0.2.2:8080';
```

#### iOS Simulator
```dart
// iOS 시뮬레이터는 localhost 직접 사용
final baseUrl = 'http://localhost:8080';
```

#### 실제 디바이스
```dart
// ngrok URL 사용
final baseUrl = 'https://abc123.ngrok.io';
```

### 🎯 4. 로컬 개발 워크플로우

```
1. 백엔드 서버 시작: npm run dev (localhost:8080)
2. ngrok 실행: ngrok http 8080
3. Flutter 앱 실행: flutter run
4. 결제 테스트: 테스트 카드 번호 사용
5. Webhook 확인: ngrok 터널을 통해 수신
```

---

## 테스트 서버 환경 설정

### 🖥️ 1. 테스트 서버 환경변수

```env
# .env.test (테스트 서버 전용)
NODE_ENV=test

# 토스페이먼츠 테스트 API 키
TOSS_CLIENT_KEY=test_ck_OEP59LybZ8BN3Y1Y7kVrwYxAdXy1
TOSS_SECRET_KEY=test_sk_zXLkKEypNArWmo50nX3lmeaxYG5R
TOSS_WEBHOOK_SECRET=test_webhook_secret_12345

# 테스트 서버 도메인
PAYMENT_SUCCESS_URL=https://test.ezstay.com/payment/success
PAYMENT_FAIL_URL=https://test.ezstay.com/payment/fail

# 데이터베이스 (테스트 서버)
DB_HOST=test-db.example.com
DB_PORT=3306
DB_USER=ezstay_test
DB_PASSWORD=secure_test_password
DB_NAME=ezstay_test
```

### 🔐 2. HTTPS 설정 (필수)

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

#### Nginx 설정 예시

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
    }

    location /api/webhooks/ {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 🚀 3. 테스트 서버 배포

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
```

---

## Mock 결제 시스템 (선택)

네트워크 없이 **빠른 로컬 테스트**가 필요한 경우 Mock 시스템 사용.

### 📦 1. Mock 모드 환경변수

```env
# .env.local
PAYMENT_MOCK_MODE=true  # Mock 모드 활성화
```

### 🎭 2. Mock Controller 구현

```javascript
// controllers/mockPaymentController.js

const { sequelize, Contract, Payment } = require('../models');
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

### 📱 4. Flutter에서 Mock 모드 사용

```dart
// config/api_config.dart
class ApiConfig {
  static const bool useMockPayment = true; // 개발 시 true
  static const String baseUrl = 'http://10.0.2.2:8080';
}

// services/payment_service.dart
Future<void> confirmPayment(int contractId, String paymentKey, String orderId, int amount) async {
  final endpoint = ApiConfig.useMockPayment
      ? '/api/contracts/$contractId/confirm-payment-mock'
      : '/api/contracts/$contractId/confirm-payment';

  final response = await http.post(
    Uri.parse('${ApiConfig.baseUrl}$endpoint'),
    headers: {
      'Authorization': 'Bearer $accessToken',
      'Content-Type': 'application/json'
    },
    body: jsonEncode({
      if (ApiConfig.useMockPayment) ...{
        'orderId': orderId,
        'amount': amount,
        'simulateFailure': false, // true로 설정하면 실패 테스트
      } else ...{
        'paymentKey': paymentKey,
        'orderId': orderId,
        'amount': amount,
      }
    })
  );

  // ...
}
```

---

## 테스트 시나리오

### ✅ 1. 정상 결제 플로우

```
1. 계약 승인 상태 확인 (status: APPROVED)
2. 결제 정보 조회 API 호출
3. 토스 결제창 호출 (테스트 카드 입력)
4. successUrl 리다이렉트 확인
5. 결제 승인 API 호출
6. Contract 상태 변경 확인 (status: PAYMENT_COMPLETED)
7. Payment 레코드 생성 확인
8. 채팅방 시스템 메시지 확인
```

### ❌ 2. 금액 변조 시나리오

```javascript
// 클라이언트에서 금액 변조 시도
const response = await http.post(
  Uri.parse('$baseUrl/api/contracts/$contractId/confirm-payment'),
  body: jsonEncode({
    'paymentKey': paymentKey,
    'orderId': orderId,
    'amount': 100000, // ❌ 실제 금액보다 적게 전송
  })
);

// 예상 결과: 400 Bad Request
// { code: 4604, message: '결제 금액이 일치하지 않습니다' }
```

### 🔁 3. 중복 결제 방지

```javascript
// 같은 계약에 대해 두 번 결제 시도
await confirmPayment(contractId, paymentKey1, orderId, amount);
await confirmPayment(contractId, paymentKey2, orderId, amount);

// 예상 결과: 두 번째 요청은 실패
// { code: 4602, message: '이미 결제된 계약입니다' }
```

### ⏰ 4. 결제 시간 제한 테스트

```javascript
// 승인 후 24시간 경과 시 자동 만료 확인
// Cron Job 실행 또는 수동 상태 변경
await Contract.update(
  { status: 'PAYMENT_EXPIRED' },
  { where: { status: 'APPROVED', approvedAt: { [Op.lt]: twentyFourHoursAgo } } }
);
```

### 🔙 5. 환불 테스트 (추후 구현)

```javascript
// 결제 완료 후 환불 요청
const refundResponse = await axios.post(
  'https://api.tosspayments.com/v1/payments/{paymentKey}/cancel',
  {
    cancelReason: '테스트 환불',
    cancelAmount: contract.finalTotalAmount
  },
  {
    headers: {
      Authorization: `Basic ${encodedKey}`,
      'Content-Type': 'application/json'
    }
  }
);
```

### 📞 6. Webhook 이벤트 테스트

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

## 🔍 디버깅 팁

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

### 3. 네트워크 요청 확인

```bash
# ngrok 웹 인터페이스
http://127.0.0.1:4040

# 모든 HTTP 요청/응답 확인 가능
```

### 4. MySQL 쿼리 로깅

```javascript
// models/index.js
logging: console.log // 모든 SQL 쿼리 출력
```

---

## 📊 환경별 설정 요약

| 항목 | 로컬 개발 | 테스트 서버 | 프로덕션 |
|-----|---------|-----------|---------|
| API 키 | test_ck/sk | test_ck/sk | live_ck/sk |
| HTTPS | ❌ (ngrok 사용) | ✅ 필수 | ✅ 필수 |
| Webhook | ngrok URL | 고정 도메인 | 고정 도메인 |
| 카드번호 | 테스트 카드 | 테스트 카드 | 실제 카드 |
| DB | 로컬 MySQL | 테스트 DB | 프로덕션 DB |
| Mock 모드 | ✅ 선택 가능 | ❌ 비활성화 | ❌ 비활성화 |

---

## 🚨 주의사항

### ⚠️ 테스트 환경 제한사항

1. **테스트 API는 실제 금액 차감 없음**
   - 결제 승인되어도 카드사에 청구되지 않음
   - 프로덕션 전환 시 API 키만 변경

2. **Webhook 이벤트는 테스트에서도 실제 전송됨**
   - ngrok이 꺼지면 Webhook 수신 불가
   - 테스트 서버는 항상 접근 가능해야 함

3. **테스트 카드는 특정 시나리오만 지원**
   - 모든 카드사 테스트는 불가
   - 할부/포인트 사용 제한적

4. **로컬 환경에서 HTTPS 불가**
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
- [ ] 테스트 API 키 발급
- [ ] `.env.local` 환경변수 설정
- [ ] ngrok 설치 및 실행 (Webhook 테스트 시)
- [ ] MySQL 로컬 DB 생성
- [ ] 백엔드 서버 실행 확인
- [ ] Flutter 앱 빌드 확인

### 첫 결제 테스트 전
- [ ] 계약 승인 상태 확인 (APPROVED)
- [ ] 결제 정보 조회 API 동작 확인
- [ ] 테스트 카드 번호 준비
- [ ] successUrl/failUrl 설정 확인
- [ ] 네트워크 연결 확인

### 테스트 서버 배포 전
- [ ] 테스트 도메인 HTTPS 설정
- [ ] `.env.test` 환경변수 설정
- [ ] 테스트 DB 마이그레이션 완료
- [ ] 토스 개발자센터에 Webhook URL 등록
- [ ] 방화벽 포트 개방 (443, 80)
- [ ] SSL 인증서 유효기간 확인

---

**문서 버전**: 1.0
**최종 수정일**: 2025-01-11
**작성자**: Claude Code
