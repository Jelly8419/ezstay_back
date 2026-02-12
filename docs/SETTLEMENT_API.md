# 정산 API 문서 (호스트용)

> **Base URL**: `/api/host/settlements`
> **인증**: 모든 API는 JWT 토큰 필요 (`Authorization: Bearer {token}`)

---

## 목차
1. [정산 목록 조회](#1-정산-목록-조회)
2. [정산 상세 조회](#2-정산-상세-조회)
3. [정산 내역 엑셀 다운로드](#3-정산-내역-엑셀-다운로드)
4. [정산 정책](#4-정산-정책)
5. [상태 코드](#5-상태-코드)

---

## 1. 정산 목록 조회

호스트의 정산 목록을 조회합니다.

### Request
```
GET /api/host/settlements
```

### Query Parameters
| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|---------|------|:----:|-------|------|
| tab | string | N | `pending` | `pending` (정산 예정) / `completed` (정산 완료) |
| roomId | number | N | - | 방 ID 필터 (completed 탭에서만 동작) |
| startDate | string | N | - | 정산일 시작 (YYYY-MM-DD, completed 탭에서만) |
| endDate | string | N | - | 정산일 종료 (YYYY-MM-DD, completed 탭에서만) |
| page | number | N | 1 | 페이지 번호 |
| limit | number | N | 20 | 페이지당 항목 수 |

### Response (200 OK)
```json
{
  "success": true,
  "data": {
    "settlements": [
      {
        "contractId": 123,
        "contractNumber": "C2501150001",
        "roomId": 45,
        "roomTitle": "강남역 원룸 A",
        "roomThumbnail": "/uploads/rooms/45/main.jpg",
        "guestName": "홍길동",
        "checkInDate": "2025-01-01T15:00:00.000Z",
        "checkOutDate": "2025-01-15T11:00:00.000Z",
        "rentalDays": 14,
        "settlementAmount": 1112050,
        "settlementDate": "2025-01-22",
        "status": "pending",
        "statusLabel": "정산 예정",
        "hasRefund": false,
        "refundAmount": 0,
        "hasEzCleaningService": false
      }
    ],
    "summary": {
      "totalCount": 15,
      "totalSettlementAmount": 12500000,
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
        { "roomId": 46, "roomTitle": "강남역 원룸 B" }
      ]
    }
  }
}
```

### 필드 설명

#### settlements[]
| 필드 | 타입 | 설명 |
|-----|------|------|
| contractId | number | 계약 ID |
| contractNumber | string | 계약 번호 |
| roomId | number | 방 ID |
| roomTitle | string | 방 이름 |
| roomThumbnail | string | 방 대표 이미지 URL (nullable) |
| guestName | string | 게스트 이름 |
| checkInDate | string | 체크인 일시 (ISO 8601) |
| checkOutDate | string | 체크아웃 일시 (ISO 8601) |
| rentalDays | number | 이용 일수 |
| settlementAmount | number | 정산 금액 (원) |
| settlementDate | string | 정산 예정일 (YYYY-MM-DD) |
| status | string | 상태 코드 (`pending` / `completed`) |
| statusLabel | string | 상태 라벨 (한글) |
| hasRefund | boolean | 환불 여부 |
| refundAmount | number | 환불 금액 (원) |
| hasEzCleaningService | boolean | EZ청소서비스 사용 여부 |

#### summary
| 필드 | 타입 | 설명 |
|-----|------|------|
| totalCount | number | 현재 탭 총 건수 |
| totalSettlementAmount | number | 현재 탭 총 정산 금액 |
| pendingCount | number | 정산 예정 건수 |
| completedCount | number | 정산 완료 건수 |

---

## 2. 정산 상세 조회

특정 계약의 정산 상세 정보를 조회합니다.

### Request
```
GET /api/host/settlements/:contractId
```

### Path Parameters
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|:----:|------|
| contractId | number | Y | 계약 ID |

### Response (200 OK)
```json
{
  "success": true,
  "data": {
    "contract": {
      "contractId": 123,
      "contractNumber": "C2501150001",
      "status": "COMPLETED",
      "checkInDate": "2025-01-01T15:00:00.000Z",
      "checkOutDate": "2025-01-15T11:00:00.000Z",
      "rentalDays": 14,
      "paidAt": "2025-01-01T10:30:00.000Z"
    },
    "room": {
      "roomId": 45,
      "title": "강남역 원룸 A",
      "address": "서울시 강남구 테헤란로 123",
      "thumbnail": "/uploads/rooms/45/main.jpg"
    },
    "guest": {
      "name": "홍길동",
      "phone": "010-****-5678"
    },
    "breakdown": {
      "rentalFee": 1000000,
      "maintenanceFee": 100000,
      "cleaningFee": 50000,
      "originalCleaningFee": 50000,
      "hasEzCleaningService": false,
      "subtotal": 1150000,
      "platformFee": 37950,
      "platformFeeRate": 3.3,
      "grossSettlement": 1112050
    },
    "refund": {
      "hasRefund": false,
      "refundDate": null,
      "refundReason": null,
      "refundType": null,
      "refundDetails": null
    },
    "settlement": {
      "finalAmount": 1112050,
      "settlementDate": "2025-01-22",
      "status": "pending",
      "statusLabel": "정산 예정",
      "bankInfo": {
        "bankName": "신한은행",
        "accountNumber": "110-***-***-789",
        "accountHolder": "김호스트"
      }
    }
  }
}
```

### 필드 설명

#### breakdown (금액 상세)
| 필드 | 타입 | 설명 |
|-----|------|------|
| rentalFee | number | 임대료 |
| maintenanceFee | number | 관리비 |
| cleaningFee | number | 정산되는 청소비 (EZ청소서비스 사용 시 0) |
| originalCleaningFee | number | 원래 청소비 |
| hasEzCleaningService | boolean | EZ청소서비스 사용 여부 |
| subtotal | number | 소계 (임대료 + 관리비 + 청소비) |
| platformFee | number | 플랫폼 수수료 (3.3%) |
| platformFeeRate | number | 수수료율 (3.3) |
| grossSettlement | number | 수수료 차감 후 금액 |

#### refund (환불 정보) - 환불이 있는 경우
```json
{
  "hasRefund": true,
  "refundDate": "2025-01-10T14:20:00.000Z",
  "refundReason": "게스트 사유로 인한 조기 퇴실",
  "refundType": "PARTIAL",
  "refundDetails": {
    "rentalFeeRefund": 200000,
    "maintenanceFeeRefund": 20000,
    "cleaningFeeRefund": 0,
    "totalRefund": 220000
  }
}
```

#### settlement (정산 정보)
| 필드 | 타입 | 설명 |
|-----|------|------|
| finalAmount | number | 최종 정산 금액 |
| settlementDate | string | 정산 예정일 (YYYY-MM-DD) |
| status | string | 상태 코드 |
| statusLabel | string | 상태 라벨 (한글) |
| bankInfo | object | 정산 계좌 정보 (nullable) |

---

## 3. 정산 내역 엑셀 다운로드

정산 내역을 엑셀 파일로 다운로드합니다.

### Request
```
GET /api/host/settlements/export
```

### Query Parameters
| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|---------|------|:----:|-------|------|
| tab | string | N | `all` | `all` / `pending` / `completed` |
| roomId | number | N | - | 방 ID 필터 |
| startDate | string | N | - | 정산일 시작 (YYYY-MM-DD) |
| endDate | string | N | - | 정산일 종료 (YYYY-MM-DD) |

### Response
- **Content-Type**: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- **Content-Disposition**: `attachment; filename="settlement_2025-01-15.xlsx"`

### 엑셀 컬럼
| 컬럼명 | 설명 |
|-------|------|
| 계약번호 | 계약 번호 |
| 방 이름 | 방 이름 |
| 게스트명 | 게스트 이름 |
| 입실일 | 체크인 날짜 |
| 퇴실일 | 체크아웃 날짜 |
| 이용일수 | 숙박 일수 |
| 임대료 | 임대료 |
| 관리비 | 관리비 |
| 청소비 | 청소비 (EZ서비스 사용 시 0) |
| EZ청소 | EZ청소서비스 사용 여부 (O/-) |
| 소계 | 소계 |
| 플랫폼 수수료(3.3%) | 호스트 수수료 |
| 환불금액 | 환불 금액 |
| 정산금액 | 최종 정산 금액 |
| 정산예정일 | 정산 예정일 |
| 상태 | 정산 상태 |

---

## 4. 정산 정책

### 수수료 정책
| 구분 | 수수료율 | 설명 |
|-----|---------|------|
| 게스트 플랫폼 수수료 | 9.9% | 게스트가 결제 시 추가 부담 |
| **호스트 플랫폼 수수료** | **3.3%** | **정산 시 차감** |

### 정산 금액 계산
```
소계 = 임대료 + 관리비 + 청소비*
호스트 수수료 = 소계 × 3.3%
정산 금액 = 소계 - 호스트 수수료 - 환불금액

* EZ청소서비스 사용 시 청소비는 소계에서 제외
```

### 정산 예정일
- **체크아웃 + 7일** 후 정산
- 예: 1월 15일 체크아웃 → 1월 22일 정산

### 정산 상태
| 상태 | 코드 | 설명 |
|-----|------|------|
| 정산 예정 | `pending` | 체크아웃 후 7일 이내 |
| 정산 완료 | `completed` | 체크아웃 후 7일 경과 |

### EZ청소서비스
- EZ청소서비스 사용 시 **청소비는 플랫폼이 수령**
- 호스트 정산 시 청소비가 **0원**으로 계산됨
- `hasEzCleaningService: true`로 표시

---

## 5. 상태 코드

### 성공 응답
| 상태 코드 | 설명 |
|----------|------|
| 200 | 조회 성공 |

### 에러 응답
| 상태 코드 | 에러 코드 | 설명 |
|----------|----------|------|
| 401 | 1001 | 인증 필요 |
| 404 | 3003 | 계약을 찾을 수 없음 |
| 500 | 5001 | 서버 내부 오류 |

### 에러 응답 형식
```json
{
  "success": false,
  "error": {
    "code": 3003,
    "message": "계약을 찾을 수 없습니다"
  }
}
```

---

## 프론트엔드 구현 가이드

### 1. 정산 목록 페이지
```typescript
// 탭 전환
const [tab, setTab] = useState<'pending' | 'completed'>('pending');

// API 호출
const { data } = await api.get('/host/settlements', {
  params: { tab, page, limit: 20 }
});

// 탭별 건수 표시
<Tab label={`정산 예정 (${data.summary.pendingCount})`} />
<Tab label={`정산 완료 (${data.summary.completedCount})`} />
```

### 2. 필터 (정산 완료 탭에서만)
```typescript
// 방 필터 드롭다운
<Select value={roomId} onChange={setRoomId}>
  {data.filters.rooms.map(room => (
    <Option value={room.roomId}>{room.roomTitle}</Option>
  ))}
</Select>

// 날짜 필터
<DateRangePicker
  startDate={startDate}
  endDate={endDate}
  onChange={({ start, end }) => {
    setStartDate(start);
    setEndDate(end);
  }}
/>
```

### 3. 엑셀 다운로드
```typescript
const downloadExcel = async () => {
  const response = await api.get('/host/settlements/export', {
    params: { tab, roomId, startDate, endDate },
    responseType: 'blob'
  });

  const url = URL.createObjectURL(response.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `정산내역_${new Date().toISOString().split('T')[0]}.xlsx`;
  a.click();
};
```

### 4. 금액 포맷팅
```typescript
const formatCurrency = (amount: number) => {
  return amount.toLocaleString('ko-KR') + '원';
};

// 사용 예
<span>{formatCurrency(settlement.settlementAmount)}</span>
// 출력: "1,112,050원"
```

### 5. EZ청소서비스 표시
```typescript
{item.hasEzCleaningService ? (
  <Badge color="blue">EZ청소</Badge>
) : null}

// 청소비 표시
<span>
  청소비: {formatCurrency(item.cleaningFee)}
  {item.hasEzCleaningService && (
    <Tooltip title="EZ청소서비스 사용으로 플랫폼이 수령">
      <InfoIcon />
    </Tooltip>
  )}
</span>
```
