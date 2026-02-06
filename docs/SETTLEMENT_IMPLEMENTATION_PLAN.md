# 정산 기능 구현 계획서

## 1. 설계 결정사항

### 1.1 Settlement 테이블 생성 여부
**결론: 별도 Settlement 테이블 생성 필요 없음**

**이유:**
- Contract 테이블에 이미 모든 금액 정보 존재 (rentalFee, maintenanceFee, cleaningFee, platformFee)
- Refund 테이블에 환불 관련 상세 정보 존재
- 정산은 Contract의 상태(COMPLETED) + 체크아웃 날짜 기반으로 계산 가능
- 별도 테이블 생성 시 데이터 동기화 문제 발생 가능

### 1.2 정산 대상 조건
```
정산 대기 (예정):
- Contract.hostId = 현재 호스트
- Contract.status = 'COMPLETED'
- Contract.checkOutDate >= today (아직 체크아웃 안됨) OR 체크아웃 후 7일 이내

정산 완료:
- Contract.hostId = 현재 호스트
- Contract.status = 'COMPLETED'
- Contract.checkOutDate < today - 7일 (체크아웃 후 7일 경과)
```

### 1.3 정산 금액 계산 공식
```javascript
// 기본 정산 금액 (호스트 수령액)
hostSettlement = rentalFee + maintenanceFee + cleaningFee - platformFee

// 환불이 있는 경우
// Refund 테이블에서 해당 계약의 환불 정보 조회
// hostSettlement -= (rentalFeeRefundAmount + maintenanceFeeRefundAmount + cleaningFeeRefundAmount)
// 단, 플랫폼 수수료 환불분은 호스트 정산에서 제외되지 않음
```

---

## 2. API 설계

### 2.1 정산 목록 조회 API
```
GET /api/host/settlements
```

**Query Parameters:**
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| tab | string | N | 'pending' (기본값) / 'completed' |
| roomId | number | N | 방 필터링 (completed 탭에서만) |
| startDate | string | N | 시작일 (completed 탭에서만, YYYY-MM-DD) |
| endDate | string | N | 종료일 (completed 탭에서만, YYYY-MM-DD) |
| page | number | N | 페이지 번호 (기본값: 1) |
| limit | number | N | 페이지당 항목 수 (기본값: 20) |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "settlements": [
      {
        "contractId": 123,
        "roomId": 45,
        "roomTitle": "강남역 원룸 A",
        "roomThumbnail": "/uploads/rooms/123/thumb.jpg",
        "guestName": "홍길동",
        "checkInDate": "2025-01-01",
        "checkOutDate": "2025-01-15",
        "rentalDays": 14,
        "settlementAmount": 1260000,
        "settlementDate": "2025-01-22",
        "status": "pending",
        "hasRefund": false,
        "refundAmount": 0
      }
    ],
    "summary": {
      "totalCount": 15,
      "totalSettlementAmount": 18900000,
      "pendingCount": 5,
      "completedCount": 10
    },
    "pagination": {
      "page": 1,
      "limit": 20,
      "totalPages": 1,
      "totalCount": 15
    },
    "filters": {
      "rooms": [
        { "roomId": 45, "roomTitle": "강남역 원룸 A" },
        { "roomId": 46, "roomTitle": "역삼역 투룸 B" }
      ]
    }
  }
}
```

### 2.2 정산 상세 조회 API
```
GET /api/host/settlements/:contractId
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "contract": {
      "contractId": 123,
      "contractNumber": "C2501-00123",
      "status": "COMPLETED",
      "checkInDate": "2025-01-01",
      "checkOutDate": "2025-01-15",
      "rentalDays": 14,
      "paidAt": "2024-12-25T10:30:00Z"
    },
    "room": {
      "roomId": 45,
      "title": "강남역 원룸 A",
      "address": "서울시 강남구 역삼동 123-45",
      "thumbnail": "/uploads/rooms/45/thumb.jpg"
    },
    "guest": {
      "name": "홍길동",
      "phone": "010-****-5678"
    },
    "breakdown": {
      "rentalFee": 1400000,
      "maintenanceFee": 140000,
      "cleaningFee": 50000,
      "subtotal": 1590000,
      "platformFee": 159000,
      "platformFeeRate": 10,
      "grossSettlement": 1431000
    },
    "refund": {
      "hasRefund": true,
      "refundDate": "2025-01-10T14:20:00Z",
      "refundReason": "조기 퇴실",
      "refundDetails": {
        "rentalFeeRefund": 200000,
        "maintenanceFeeRefund": 20000,
        "cleaningFeeRefund": 0,
        "totalRefund": 220000
      }
    },
    "settlement": {
      "finalAmount": 1211000,
      "settlementDate": "2025-01-22",
      "status": "pending",
      "bankInfo": {
        "bankName": "신한은행",
        "accountNumber": "110-***-***890",
        "accountHolder": "김호스트"
      }
    }
  }
}
```

### 2.3 정산 내역 엑셀 다운로드 API
```
GET /api/host/settlements/export
```

**Query Parameters:**
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| tab | string | N | 'pending' / 'completed' / 'all' (기본값) |
| roomId | number | N | 방 필터링 |
| startDate | string | N | 시작일 (YYYY-MM-DD) |
| endDate | string | N | 종료일 (YYYY-MM-DD) |

**Response:** Excel 파일 다운로드 (Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet)

---

## 3. 파일 구조 및 구현 계획

### 3.1 새로 생성할 파일
```
controllers/
  settlementController.js    # 정산 관련 비즈니스 로직

routes/
  settlementRoutes.js        # /api/host/settlements 라우트

services/
  settlementService.js       # 정산 금액 계산 로직 분리

utils/
  excelHelper.js             # 엑셀 생성 유틸리티 (exceljs 사용)
```

### 3.2 수정할 파일
```
routes/index.js 또는 server.js
  - settlementRoutes 추가

package.json
  - exceljs 패키지 추가
```

---

## 4. 상세 구현 계획

### Phase 1: 기본 인프라 (1단계)
1. **settlementService.js** 생성
   - `calculateSettlementAmount(contract, refunds)` - 정산 금액 계산
   - `getSettlementStatus(contract)` - 정산 상태 판단 (pending/completed)
   - `getSettlementDate(checkOutDate)` - 정산 예정일 계산 (체크아웃 + 7일)

2. **exceljs 패키지 설치**
   ```bash
   npm install exceljs
   ```

### Phase 2: 목록 API (2단계)
3. **settlementController.js** - `getSettlements()`
   - 호스트 인증 확인
   - tab에 따른 조건 분기
   - Contract + Room + User(guest) + Refund JOIN 쿼리
   - 정산 금액 계산 적용
   - 페이지네이션 처리
   - 필터용 방 목록 조회

4. **settlementRoutes.js** 생성 및 라우트 등록

### Phase 3: 상세 API (3단계)
5. **settlementController.js** - `getSettlementDetail()`
   - 계약 상세 조회 (권한 확인: 본인 방만)
   - 금액 breakdown 계산
   - 환불 정보 조회 및 반영
   - 호스트 계좌 정보 조회 (마스킹 처리)

### Phase 4: 엑셀 다운로드 (4단계)
6. **excelHelper.js** 생성
   - `createSettlementExcel(data)` - 정산 내역 엑셀 생성

7. **settlementController.js** - `exportSettlements()`
   - 필터 조건에 따른 데이터 조회
   - 엑셀 파일 생성 및 다운로드 응답

---

## 5. 데이터베이스 쿼리 예시

### 5.1 정산 대기 목록 쿼리
```sql
SELECT
  c.id as contractId,
  c.contract_number,
  c.check_in_date,
  c.check_out_date,
  c.rental_fee,
  c.maintenance_fee,
  c.cleaning_fee,
  c.platform_fee,
  c.status,
  r.id as roomId,
  r.title as roomTitle,
  (SELECT photo_url FROM room_photos WHERE room_id = r.id ORDER BY display_order LIMIT 1) as thumbnail,
  u.name as guestName,
  COALESCE(SUM(ref.rental_fee_refund_amount + ref.maintenance_fee_refund_amount + ref.cleaning_fee_refund_amount), 0) as totalRefund
FROM contracts c
JOIN rooms r ON c.room_id = r.id
JOIN users u ON c.guest_id = u.id
LEFT JOIN refunds ref ON c.id = ref.contract_id AND ref.status = 'COMPLETED'
WHERE c.host_id = :hostId
  AND c.status = 'COMPLETED'
  AND c.check_out_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
GROUP BY c.id
ORDER BY c.check_out_date ASC;
```

### 5.2 정산 완료 목록 쿼리 (날짜 필터 포함)
```sql
SELECT
  c.id as contractId,
  -- ... (동일 필드)
FROM contracts c
-- ... (동일 JOIN)
WHERE c.host_id = :hostId
  AND c.status = 'COMPLETED'
  AND c.check_out_date < DATE_SUB(CURDATE(), INTERVAL 7 DAY)
  AND (:roomId IS NULL OR c.room_id = :roomId)
  AND (:startDate IS NULL OR DATE_ADD(c.check_out_date, INTERVAL 7 DAY) >= :startDate)
  AND (:endDate IS NULL OR DATE_ADD(c.check_out_date, INTERVAL 7 DAY) <= :endDate)
GROUP BY c.id
ORDER BY c.check_out_date DESC;
```

---

## 6. 보안 고려사항

1. **인증**: `authenticateToken` 미들웨어 필수 적용
2. **권한**: 호스트 본인의 방/계약만 조회 가능 (hostId 검증)
3. **데이터 마스킹**:
   - 게스트 전화번호: `010-****-5678`
   - 계좌번호: `110-***-***890`
4. **Rate Limiting**: 엑셀 다운로드에 별도 제한 적용 고려

---

## 7. 향후 확장 고려

1. **정산 확정 기능**: 호스트가 정산 내역 확인 후 확정 버튼
2. **정산 이의제기**: 호스트가 정산 금액에 이의 제기
3. **자동 송금 연동**: 실제 은행 API 연동 (현재는 수동 처리 가정)
4. **정산 알림**: 정산 완료 시 알림 발송

---

## 8. 구현 우선순위

| 순서 | 기능 | 예상 시간 |
|-----|------|----------|
| 1 | settlementService.js (계산 로직) | 1시간 |
| 2 | 정산 목록 API | 2시간 |
| 3 | 정산 상세 API | 1.5시간 |
| 4 | 엑셀 다운로드 API | 1.5시간 |
| 5 | 테스트 및 문서화 | 1시간 |

**총 예상 시간: 약 7시간**

---

## 9. 엑셀 출력 컬럼

| 컬럼명 | 필드 |
|-------|------|
| 계약번호 | contractNumber |
| 방 이름 | roomTitle |
| 게스트명 | guestName |
| 입실일 | checkInDate |
| 퇴실일 | checkOutDate |
| 이용일수 | rentalDays |
| 임대료 | rentalFee |
| 관리비 | maintenanceFee |
| 청소비 | cleaningFee |
| 소계 | subtotal |
| 플랫폼 수수료 | platformFee |
| 환불금액 | refundAmount |
| 정산금액 | settlementAmount |
| 정산예정일 | settlementDate |
| 정산상태 | status |
