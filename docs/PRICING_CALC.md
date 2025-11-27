# EZStay 금액 계산 시스템 문서

> 방 상세페이지에서 사용되는 금액 계산 로직에 대한 기술 문서입니다.

## 목차

1. [개요](#개요)
2. [금액 구성 요소](#금액-구성-요소)
3. [할인 정책](#할인-정책)
4. [EZ서비스 청소비 계산](#ez서비스-청소비-계산)
5. [계약 수수료 정책](#계약-수수료-정책)
6. [최종 금액 계산 공식](#최종-금액-계산-공식)
7. [환불 정책](#환불-정책)
8. [코드 참조](#코드-참조)

---

## 개요

EZStay의 금액 계산 시스템은 `PriceCalculator` 클래스를 통해 처리됩니다. 게스트가 방 상세페이지에서 날짜를 선택하면 실시간으로 예상 금액이 계산되어 표시됩니다.

### 핵심 파일

| 파일 | 역할 |
|------|------|
| `lib/utils/price_calculator.dart` | 핵심 가격 계산 로직 |
| `lib/widgets/room_detail/booking_bottom_sheet.dart` | UI에서 계산기 호출 |
| `lib/models/calculated_pricing.dart` | 계산된 가격 데이터 모델 |
| `lib/widgets/modals/refund_calculation_modal.dart` | 환불 계산 로직 |

---

## 금액 구성 요소

### 기본 요금 항목

| 항목 | 필드명 | 계산 방식 | 설명 |
|------|--------|----------|------|
| 기본 임대료 | `baseRent` | `dailyRent × 선택일수` | 일 임대료 기준 |
| 관리비 | `maintenanceFee` | `dailyMaintenanceFee × 선택일수` | 일 관리비 기준 |
| 청소비 | `cleaningFee` | `room.cleaningFee` 또는 EZ청소비 | 조건에 따라 다름 |
| 보증금 | `deposit` | `room.deposit` | 고정 금액 |
| 렌탈 아이템 | `rentalItemsFee` | `Σ(아이템가격 × 수량)` | 옵션 상품 합계 |

### Room 모델 필드 참조

```dart
// lib/models/room.dart
class Room {
  final int dailyRent;           // 일 임대료
  final int dailyMaintenanceFee; // 일 관리비
  final int cleaningFee;         // 호스트 설정 청소비
  final int deposit;             // 보증금

  // 할인 정보 (discounts 객체에서 파싱)
  final int? longTermWeeks;        // 장기계약 기준 주수
  final int? longTermDiscount;     // 장기계약 할인율 (%)
  final int? quickMoveIn;          // 빠른 입주 기준 일수
  final int? quickMoveInDiscount;  // 빠른 입주 할인 금액 (원)

  // EZ서비스
  final RoomEzService? ezService;  // EZ서비스 설정
}
```

---

## 할인 정책

EZStay는 2가지 할인 정책을 제공합니다. **할인 적용 순서가 중요합니다.**

### 1. 빠른 입주 할인 (Quick Move-In Discount)

**먼저 적용됩니다.**

| 항목 | 설명 |
|------|------|
| 조건 | 체크인 날짜가 오늘로부터 `quickMoveIn`일 이내 |
| 할인 방식 | **고정 금액** 할인 (원) |
| 예시 | 13일 이내 입주 시 50,000원 할인 |

```dart
// lib/utils/price_calculator.dart (라인 100-113)
if (daysUntilCheckIn <= room.quickMoveIn!) {
  quickMoveInDiscount = room.quickMoveInDiscount!;  // 고정 금액
}
```

### 2. 장기계약 할인 (Long-Term Discount)

**빠른 입주 할인 적용 후 계산됩니다.**

| 항목 | 설명 |
|------|------|
| 조건 | 선택한 기간이 `longTermWeeks`주 이상 |
| 할인 방식 | **비율(%) 할인** |
| 계산 기준 | 빠른 입주 할인 적용 후 남은 임대료 |
| 예시 | 4주 이상 계약 시 10% 할인 |

```dart
// lib/utils/price_calculator.dart (라인 115-126)
if (weeks >= room.longTermWeeks!) {
  // 빠른 입주 할인 적용 후 임대료에 장기계약 할인율 적용
  final adjustedRent = baseRent - quickMoveInDiscount;
  longTermDiscount = (adjustedRent * room.longTermDiscount! / 100).floor();
}
```

### 할인 적용 순서 다이어그램

```
┌─────────────────────────────────────────────────────────────┐
│  1️⃣ 기본 임대료 계산                                         │
│     baseRent = dailyRent × days                             │
│                                                              │
│  2️⃣ 빠른 입주 할인 적용 (고정 금액)                           │
│     quickMoveInDiscount = room.quickMoveInDiscount          │
│                                                              │
│  3️⃣ 장기계약 할인 적용 (% 할인)                               │
│     adjustedRent = baseRent - quickMoveInDiscount           │
│     longTermDiscount = adjustedRent × (할인율% / 100)        │
│                                                              │
│  4️⃣ 총 할인액                                                │
│     totalDiscount = quickMoveInDiscount + longTermDiscount  │
└─────────────────────────────────────────────────────────────┘
```

---

## EZ서비스 청소비 계산

EZ서비스 청소 옵션을 선택한 경우, 호스트가 설정한 청소비 대신 **평수 기반 EZ청소비**가 적용됩니다.

### 청소비 결정 로직

```dart
// lib/utils/price_calculator.dart (라인 74-76)
final cleaningFee = (room.ezService?.cleaningService == true)
    ? calculateEzCleaningFee(room.area)  // EZ서비스 청소비 (평수 기반)
    : room.cleaningFee;                   // 호스트 설정 청소비
```

### EZ서비스 청소비 계산 공식

```dart
// lib/utils/price_calculator.dart (라인 214-242)
static int calculateEzCleaningFee(String areaString) {
  const baseFee = 50000;              // 기본 5만원
  const additionalFeePerUnit = 20000; // 10평당 2만원 추가
  const pyeongPerUnit = 10;           // 10평 단위

  final pyeong = double.tryParse(areaString) ?? 0;

  // 10평 이하: 기본 5만원
  if (pyeong <= 10) {
    return baseFee;
  }

  // 10평 초과: 기본 5만원 + 10평당 2만원 추가 (올림)
  final excessPyeong = pyeong - 10;
  final additionalUnits = (excessPyeong / pyeongPerUnit).ceil();
  return baseFee + (additionalUnits * additionalFeePerUnit);
}
```

### EZ청소비 요금표

| 평수 범위 | 계산 | EZ청소비 |
|----------|------|----------|
| 10평 이하 | 기본금 | **50,000원** |
| 11 ~ 20평 | 50,000 + 20,000 × 1 | **70,000원** |
| 21 ~ 30평 | 50,000 + 20,000 × 2 | **90,000원** |
| 31 ~ 40평 | 50,000 + 20,000 × 3 | **110,000원** |
| 41 ~ 50평 | 50,000 + 20,000 × 4 | **130,000원** |

### 계산 예시

```
예시 1: 12평
  - 초과 평수: 12 - 10 = 2평
  - 추가 단위: ceil(2 / 10) = 1단위
  - 청소비: 50,000 + (1 × 20,000) = 70,000원

예시 2: 25평
  - 초과 평수: 25 - 10 = 15평
  - 추가 단위: ceil(15 / 10) = 2단위
  - 청소비: 50,000 + (2 × 20,000) = 90,000원

예시 3: 40평
  - 초과 평수: 40 - 10 = 30평
  - 추가 단위: ceil(30 / 10) = 3단위
  - 청소비: 50,000 + (3 × 20,000) = 110,000원
```

### 중요 사항

- **올림(ceil) 처리**: 10평 단위로 올림하여 계산
- **수수료 계산 시 제외**: EZ청소 서비스 사용 시, 청소비는 계약 수수료 계산에서 **제외**됨

---

## 계약 수수료 정책

### 수수료율: **9.9%**

### 수수료 계산 기준

| EZ청소 서비스 | 수수료 계산 기준 |
|--------------|-----------------|
| **미사용** | `(임대료 + 관리비 + 청소비 - 총할인) × 9.9%` |
| **사용** | `(임대료 + 관리비 - 총할인) × 9.9%` ← 청소비 제외 |

```dart
// lib/utils/price_calculator.dart (라인 128-136)
final isEzCleaningService = room.ezService?.cleaningService == true;
final totalDiscount = longTermDiscount + quickMoveInDiscount;

final feeBase = isEzCleaningService
    ? baseRent + maintenanceFee - totalDiscount  // EZ청소 사용시 청소비 제외
    : baseRent + maintenanceFee + cleaningFee - totalDiscount;

final contractFee = (feeBase * 0.099).floor();
```

### 수수료 계산에서 제외되는 항목

| 항목 | 수수료 포함 여부 |
|------|-----------------|
| 기본 임대료 | ✅ 포함 |
| 관리비 | ✅ 포함 |
| 청소비 (호스트) | ✅ 포함 |
| 청소비 (EZ서비스) | ❌ 제외 |
| 보증금 | ❌ 제외 |
| 렌탈 아이템 | ❌ 제외 |

---

## 최종 금액 계산 공식

### 소계 (Subtotal)

```
소계 = 임대료 + 관리비 + 청소비 + 렌탈아이템 - 총할인
```

### 최종 총액 (Total)

```
최종 총액 = 소계 + 보증금 + 계약수수료
```

### PriceBreakdown 클래스

```dart
// lib/utils/price_calculator.dart (라인 6-35)
class PriceBreakdown {
  final int baseRent;           // 기본 임대료 (일 임대료 × 일수)
  final int maintenanceFee;     // 관리비 (일 관리비 × 일수)
  final int cleaningFee;        // 청소비
  final int deposit;            // 보증금
  final int rentalItemsFee;     // 렌탈 아이템 총 비용
  final int longTermDiscount;   // 장기 계약 할인
  final int quickMoveInDiscount; // 빠른 입주 할인
  final int contractFee;        // 계약 수수료 (9.9%)

  // 총 할인 금액
  int get totalDiscount => longTermDiscount + quickMoveInDiscount;

  // 소계 (임대료 + 관리비 + 청소비 + 렌탈 아이템 - 할인)
  int get subtotal => baseRent + maintenanceFee + cleaningFee + rentalItemsFee - totalDiscount;

  // 최종 총액 (소계 + 보증금 + 계약 수수료)
  int get total => subtotal + deposit + contractFee;
}
```

### 계산 예시

**조건:**
- 계약 기간: 30일
- 일 임대료: 50,000원
- 일 관리비: 5,000원
- 청소비: 50,000원 (호스트 설정)
- 보증금: 300,000원
- 빠른 입주 할인: 50,000원 적용
- 장기계약 할인: 10% 적용 (4주 이상)

**계산:**

```
1. 기본 금액
   임대료: 50,000 × 30 = 1,500,000원
   관리비: 5,000 × 30 = 150,000원
   청소비: 50,000원

2. 할인 적용
   빠른입주 할인: -50,000원
   장기계약 할인: (1,500,000 - 50,000) × 10% = -145,000원
   총 할인: -195,000원

3. 수수료 계산
   수수료 기준: 1,500,000 + 150,000 + 50,000 - 195,000 = 1,505,000원
   계약수수료: 1,505,000 × 9.9% = 148,995원

4. 최종 금액
   소계: 1,500,000 + 150,000 + 50,000 - 195,000 = 1,505,000원
   최종: 1,505,000 + 300,000 + 148,995 = 1,953,995원
```

---

## 환불 정책

### 환불율 기준 (방의 refundPolicy 설정에 따름)

| 정책 | 100% 환불 | 50% 환불 | 환불 불가 |
|------|-----------|----------|-----------|
| **유연 (flexible)** | 입주 7일 전 | 입주 3일 전 | 3일 미만 |
| **보통 (moderate)** | 입주 14일 전 | 입주 7일 전 | 7일 미만 |
| **엄격 (strict)** | 입주 30일 전 | 입주 14일 전 | 14일 미만 |

### 특수 환불 규칙

| 조건 | 환불 규칙 |
|------|----------|
| **결제 당일 취소** | 임대료+수수료 합계의 **10%만 위약금** (90% 환불) |
| **결제 당일 이후** | 계약수수료 **환불 불가** |
| **관리비/청소비/보증금** | **항상 전액 환불** |

### 옵션 상품(렌탈 아이템) 환불

| 배송 상태 | 환불 규칙 |
|----------|----------|
| 배송 전 | 전액 환불 |
| 배송 중 | 왕복 배송비 **7,000원 차감** 후 환불 |
| 배송 완료 | 환불 불가 |

---

## 코드 참조

### 주요 메서드

| 메서드 | 위치 | 설명 |
|--------|------|------|
| `PriceCalculator.calculate()` | price_calculator.dart:40 | 가격 분석 계산 |
| `PriceCalculator.calculateEzCleaningFee()` | price_calculator.dart:220 | EZ청소비 계산 |
| `PriceCalculator.formatKRW()` | price_calculator.dart:151 | 통화 포맷팅 |
| `PriceCalculator.validateDateSelection()` | price_calculator.dart:197 | 날짜 유효성 검증 |

### 관련 모델

| 모델 | 위치 | 설명 |
|------|------|------|
| `PriceBreakdown` | price_calculator.dart:6 | 가격 분석 결과 |
| `CalculatedPricing` | calculated_pricing.dart:3 | 계약 요청용 가격 정보 |
| `Room` | room.dart:7 | 방 정보 (가격/할인 포함) |
| `BookingState` | booking_state.dart | 예약 상태 (날짜/렌탈아이템) |

---

## 변경 이력

| 날짜 | 버전 | 변경 내용 |
|------|------|----------|
| 2025-11-27 | 1.0.0 | 최초 문서 작성 |

---

*이 문서는 EZStay 프론트엔드 개발팀에서 관리합니다.*
