# 개발자 도구 (Dev Tools)

로컬 개발 및 테스트 환경에서 사용하는 유틸리티 도구 모음입니다.

> **프로덕션 보호**: 모든 도구는 `NODE_ENV=production`일 때 자동 차단됩니다.

## 도구 목록

| 도구 | 설명 | 주요 명령어 |
|------|------|-------------|
| [계약 관리 CLI](#-계약-관리-cli-도구) | 계약 승인/거절 처리 | `npm run dev:approve-all` |
| [계약 시드 데이터](#-계약-테스트-데이터-시더) | 다양한 상태의 테스트 계약 생성 | `npm run dev:seed-contracts` |

---

## 📋 계약 관리 CLI 도구

테스트 시 계약 승인/거절을 간편하게 처리할 수 있는 CLI 도구입니다.

### 주요 기능

1. **모든 대기중인 계약 일괄 승인** - 개발 시 가장 자주 사용
2. **특정 계약 승인** - 선택적 승인
3. **특정 계약 거절** - 거절 테스트
4. **계약 상태 조회** - 현황 파악

### 사용법

#### 1️⃣ 모든 대기중인 계약 일괄 승인 (가장 많이 사용)

```bash
npm run dev:approve-all
```

**출력 예시:**
```
📋 총 3건의 계약을 승인합니다...

✅ 계약 #1 (주문번호: 26012000001) 승인 완료
   호스트: 김철수 → 게스트: 이영희
   방: 강남역 도보 5분 원룸

✅ 계약 #2 (주문번호: 26012000002) 승인 완료
   호스트: 박민수 → 게스트: 최지훈
   방: 홍대입구 신축 오피스텔

🎉 3건의 계약이 모두 승인되었습니다.
```

#### 2️⃣ 특정 계약만 승인

```bash
npm run dev:approve <계약ID>

# 예시
npm run dev:approve 123
```

#### 3️⃣ 특정 계약 거절

```bash
npm run dev:reject <계약ID>

# 예시
npm run dev:reject 456
```

#### 4️⃣ 계약 상태 조회

```bash
npm run dev:contract-status
```

**출력 예시:**
```
📊 계약 상태 현황

상태                              건수
──────────────────────────────────────────────────
승인 대기                          5건
승인됨 (결제 대기)                  2건
결제 완료                          8건
진행중                            3건
완료                             12건
──────────────────────────────────────────────────
총계                              30건

📋 최근 승인 대기 계약 (최대 10건)

#15 | 26012000003
   방: 서울대입구역 신축 빌라
   호스트: 김철수 → 게스트: 이영희
   체크인: 2026-01-25
   생성: 2026-01-20 14:30:15
```

### 개발 워크플로우 예시

#### 시나리오 1: 빠른 테스트 (권장)

```bash
# 1. 게스트로 계약 요청 생성 (Postman/Thunder Client)
POST /api/contracts

# 2. CLI로 모든 계약 일괄 승인
npm run dev:approve-all

# 3. 게스트로 결제 진행
POST /api/contracts/{contractId}/payment
```

#### 시나리오 2: 특정 계약만 테스트

```bash
# 1. 먼저 상태 확인
npm run dev:contract-status

# 2. 특정 계약만 승인
npm run dev:approve 123

# 3. 다른 계약은 거절
npm run dev:reject 124
```

---

## 🌱 계약 테스트 데이터 시더

다양한 계약 상태별 테스트 데이터를 한 번에 생성하는 CLI 도구입니다.
각 상태에 필요한 관련 데이터(Payment, ContractStatusLog, RentalOrder 등)를 **정합성 있게** 함께 생성합니다.

### 시나리오 목록

| 시나리오 키 | 상태 | 생성되는 데이터 |
|------------|------|-----------------|
| `pending_approval` | 승인 대기 | Contract + StatusLog 1건 |
| `approved` | 승인됨 (결제 대기) | Contract + StatusLog 2건 |
| `payment_completed` | 결제 완료 | Contract + Payment + StatusLog 3건 |
| `in_progress` | 임대중 | Contract + Payment + StatusLog 4건 |
| `completed` | 계약 완료 | Contract + Payment + StatusLog 5건 |
| `rejected` | 거절됨 | Contract + StatusLog 2건 |
| `cancelled_with_refund` | 게스트 취소 + 환불 | Contract + Payment(취소) + Refund + StatusLog 5건 |
| `in_progress_with_rental` | 임대중 + 렌탈 | Contract + Payment + RentalOrder + Items + Reservation + RentalPayment + Logs |
| `completed_with_full_rental` | 완료 + 렌탈 2건 | Contract + Payment + RentalOrder x2 (INITIAL + ADDITIONAL) + 부분환불 이력 |

### 사용법

#### 기본 - 모든 시나리오 생성

```bash
npm run dev:seed-contracts
```

9개 시나리오를 각 1개씩 총 9개의 계약과 관련 데이터를 생성합니다.

#### 특정 시나리오만 생성

```bash
npm run dev:seed-contracts -- --scenario in_progress
npm run dev:seed-contracts -- --scenario cancelled_with_refund
npm run dev:seed-contracts -- --scenario in_progress_with_rental
```

#### 시나리오당 여러 개 생성

```bash
npm run dev:seed-contracts -- --count 3          # 9 시나리오 x 3 = 27개
npm run dev:seed-contracts -- --scenario in_progress --count 5  # 5개
```

#### 호스트/게스트 지정

```bash
# 호스트와 게스트 직접 지정
npm run dev:seed-contracts -- --host 1708 --guest 1805

# 호스트만 지정 (게스트는 랜덤)
npm run dev:seed-contracts -- --host 1708

# 호스트 + 특정 방 지정
npm run dev:seed-contracts -- --host 1708 --room 42

# 모든 옵션 조합
npm run dev:seed-contracts -- --host 1708 --guest 1805 --scenario in_progress_with_rental --count 2
```

**검증 로직:**
- 지정한 호스트/게스트 ID가 실제 DB에 존재하는지 확인
- 호스트에게 `published` 상태의 방이 있는지 확인
- `--room` 지정 시 해당 방이 호스트 소유인지 확인
- 호스트와 게스트가 동일인이 아닌지 확인
- 미지정 시 자동으로 적절한 유저/방을 랜덤 선택

#### 미리보기 (Dry Run)

```bash
npm run dev:seed-contracts -- --dry-run
npm run dev:seed-contracts -- --dry-run --scenario in_progress --count 3
```

DB 변경 없이 어떤 데이터가 생성될지 확인합니다.

#### 시나리오 목록 조회

```bash
npm run dev:seed-contracts -- --list
```

#### 시드 데이터 정리 (삭제)

```bash
npm run dev:seed-clean
```

시더로 생성한 데이터만 선택적으로 삭제합니다 (orderId가 `S2`로 시작하는 계약 기준).
외래키 순서를 고려하여 자식 → 부모 순으로 안전하게 삭제합니다.

### 출력 예시

#### 시드 생성

```
🌱 계약 테스트 데이터 시더
=============================

👤 호스트: #1708 (김철수, host@test.com)
👤 게스트: #1805 (이영희, guest@test.com)
🏠 방: #42 (강남역 도보 5분 원룸)

📋 마스터 데이터 확인...
  ✅ RentalItem 5건 (기존 존재)
  ✅ RefundPolicy 3종 (기존 존재)

📦 시나리오별 생성 시작...

  1/9 pending_approval
      ✅ Contract S2602050001 (PENDING_APPROVAL)
      ✅ ContractStatusLog 1건

  2/9 approved
      ✅ Contract S2602050002 (APPROVED)
      ✅ ContractStatusLog 2건

  ...

  8/9 in_progress_with_rental
      ✅ Contract S2602050008 (IN_PROGRESS)
      ✅ ContractStatusLog 4건
      ✅ Payment 1건
      ✅ RentalOrder 1건
      ✅ RentalOrderItem 2건
      ✅ RentalItemReservation 2건
      ✅ RentalPayment 1건
      ✅ RentalOrderLog 2건

  9/9 completed_with_full_rental
      ✅ Contract S2602050009 (COMPLETED)
      ✅ ContractStatusLog 5건
      ✅ Payment 1건
      ✅ RentalOrder 2건
      ✅ RentalOrderItem 4건
      ✅ RentalItemReservation 4건
      ✅ RentalPayment 2건
      ✅ RentalOrderLog 6건

=============================
✅ 완료! 총 9개 계약 + 관련 데이터 생성
```

#### 시드 정리

```
🧹 시드 데이터 정리
=============================

📋 9건의 시드 계약 발견

  🗑️ RentalPayment 3건 삭제
  🗑️ RentalOrderItem 6건 삭제
  🗑️ RentalOrderLog 8건 삭제
  🗑️ RentalItemReservation 6건 삭제
  🗑️ RentalOrder 3건 삭제
  🗑️ Refund 1건 삭제
  🗑️ Payment 7건 삭제
  🗑️ ContractStatusLog 31건 삭제
  🗑️ Contract 9건 삭제

=============================
✅ 시드 데이터 정리 완료!
```

### 데이터 정합성

시더가 보장하는 정합성 규칙:

1. **타임스탬프 체인**: `createdAt < approvedAt < paidAt < checkedInAt < checkedOutAt`
2. **금액 계산**: `subtotal = rentalFee + maintenanceFee + cleaningFee + rentalItemsFee`
3. **상태 로그 전이**: 모든 상태 변화에 대해 `fromStatus → toStatus`가 올바르게 기록됨
4. **환불 계산**: `finalRefundAmount = totalRefundAmount - platformFeeDeducted - penaltyAmount`
5. **렌탈 부분환불**: ADDITIONAL 주문에서 아이템 취소 시 `PARTIAL_REFUND` 상태 + 관련 로그 생성
6. **트랜잭션 안전**: 모든 생성/삭제는 단일 트랜잭션 내에서 실행 (에러 시 롤백)

### 시드 데이터 식별

- 계약 orderId: `S` + `YYMMDD` + `4자리 시퀀스` (예: `S2602050001`)
- 렌탈 주문 orderId: `S` + `YYMMDD` + `R` + `4자리 시퀀스` (예: `S260205R0001`)
- paymentKey: `seed_mock_` 접두사
- guestMessage: `[SEED] 테스트 계약 데이터`

이 식별자를 통해 `--clean` 명령으로 시드 데이터만 선택적으로 삭제할 수 있습니다.

### 마스터 데이터 자동 생성

렌탈 아이템 시나리오 실행 시, 다음 마스터 데이터가 없으면 자동으로 생성합니다:

| 데이터 | 자동 생성 내용 |
|--------|---------------|
| RentalItem | 헤어드라이어, 침구세트, 어메니티키트, 수건세트, 블루투스스피커 (5종) |
| RefundPolicyType | 유연(flexible), 보통(moderate), 엄격(strict) (3종) |
| RefundPolicyRule | 각 정책별 환불율 규칙 |

이미 데이터가 있으면 기존 데이터를 사용합니다.

---

## ⚠️ 주의사항

### 프로덕션 보호

모든 도구는 **개발/테스트 환경에서만** 동작합니다.

- ✅ `NODE_ENV=development` 또는 미설정 → 정상 동작
- ❌ `NODE_ENV=production` → 자동 차단

프로덕션 환경에서 실행 시:
```
❌ 에러: 개발 도구는 프로덕션 환경에서 사용할 수 없습니다.
```

### 데이터 무결성

- 이 도구들은 **DB를 직접 수정**합니다 (API 우회)
- 실제 비즈니스 로직(알림, 로그 등)은 실행되지 않습니다
- 개발/테스트용으로만 사용하세요

### Git 관리

`scripts/dev-tools/` 디렉토리는 Git에 포함되어 팀원들과 공유됩니다.

## 🚀 환경변수 기반 자동 승인 (고급)

CLI 도구보다 더 완전한 자동화가 필요한 경우, 환경변수로 자동 승인을 활성화할 수 있습니다.

### 설정 방법

`.env` 파일에 다음 환경변수 추가:

```bash
AUTO_APPROVE_CONTRACTS=true
```

### 동작 방식

- 계약 요청(POST /api/contracts) 생성 시
- 자동으로 `PENDING_APPROVAL` → `APPROVED` 상태로 변경
- 별도의 CLI 명령 없이 바로 결제 진행 가능

### 장점 vs 단점

#### ✅ 장점
- 완전 자동화 (CLI 명령 불필요)
- E2E 테스트 시나리오에 유용
- 빠른 반복 테스트 가능

#### ⚠️ 단점
- 실제 승인 플로우를 테스트할 수 없음
- 호스트 알림 등 승인 관련 로직 우회
- 디버깅 시 혼란 가능

### 권장 사용 시나리오

| 상황 | 권장 방법 |
|------|----------|
| 일반 개발 테스트 | CLI 도구 (`npm run dev:approve-all`) |
| 다양한 상태 데이터 필요 | 시드 도구 (`npm run dev:seed-contracts`) |
| E2E 자동화 테스트 | 환경변수 자동 승인 |
| 승인 플로우 개발/디버깅 | 환경변수 비활성화 (수동 승인) |

### 안전장치

프로덕션 환경에서는 **자동으로 비활성화**됩니다:

```javascript
if (process.env.NODE_ENV === 'production') {
  // AUTO_APPROVE_CONTRACTS 무시됨
}
```

## 🛠️ npm 스크립트 전체 목록

| 명령어 | 설명 |
|--------|------|
| `npm run dev:approve-all` | 모든 대기중인 계약 일괄 승인 |
| `npm run dev:approve <id>` | 특정 계약 승인 |
| `npm run dev:reject <id>` | 특정 계약 거절 |
| `npm run dev:contract-status` | 계약 상태 조회 |
| `npm run dev:seed-contracts` | 테스트 계약 데이터 생성 |
| `npm run dev:seed-clean` | 시드 데이터 정리 |

## 📝 트러블슈팅

### 에러: "Cannot find module '../models'"

```bash
# scripts/dev-tools/ 디렉토리에서 실행하지 마세요
# 프로젝트 루트에서 실행하세요

cd /path/to/ezstay_back
npm run dev:approve-all
```

### 에러: "계약 ID를 찾을 수 없습니다"

```bash
# 먼저 상태 확인으로 올바른 ID를 찾으세요
npm run dev:contract-status
```

### 에러: "계약 상태가 PENDING_APPROVAL이 아닙니다"

이미 승인/거절된 계약은 다시 처리할 수 없습니다.
새로운 계약을 생성하거나 DB를 직접 수정하세요.

### 에러: "published 상태의 방이 없습니다"

시드 도구는 `published` 상태의 방이 필요합니다.
호스트가 방을 등록하고 관리자가 승인한 후 사용하세요.

### 에러: "호스트와 게스트가 같을 수 없습니다"

`--host`와 `--guest`에 서로 다른 유저 ID를 지정하세요.

## 📚 관련 문서

- [빠른 시작 가이드](QUICK_START.md) - 빠르게 시작하기
- [API 문서](../../docs/API_DOCUMENTATION.md) - 계약 API 상세 스펙
- [계약 모델](../../models/Contract.js) - 계약 데이터 모델
- [계약 컨트롤러](../../controllers/contractController.js) - 계약 비즈니스 로직

## 🤝 기여

새로운 개발자 도구가 필요하면:

1. `scripts/dev-tools/` 에 새 스크립트 추가
2. `package.json`에 npm 스크립트 등록
3. 이 README에 사용법 문서화
4. 팀원들과 공유
