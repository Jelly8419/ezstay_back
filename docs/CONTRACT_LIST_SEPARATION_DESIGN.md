# 계약 리스트 조회 API 게스트/호스트 분리 설계

## 📋 현재 상황 분석

### 기존 API 구조
| API | 엔드포인트 | 컨트롤러 함수 | 위치 |
|-----|-----------|--------------|------|
| 게스트 계약 목록 | `GET /api/contracts/guest` | `getGuestContracts` | [contractController.js:389-483](c:\study\ezstay_back\controllers\contractController.js#L389-L483) |
| 호스트 계약 목록 | `GET /api/contracts/host` | `getHostContracts` | [contractController.js:489-587](c:\study\ezstay_back\controllers\contractController.js#L489-L587) |

### 기존 반환 데이터 (공통)
```javascript
{
  contracts: [
    {
      // 기본 정보
      id, orderId, status, statusLabel,
      checkInDate, checkOutDate, totalDays, totalWeeks,

      // 💰 금액 상세 정보 (모두 노출)
      rentalFee,           // 임대료
      maintenanceFee,      // 관리비
      cleaningFee,         // 청소비
      rentalItemsFee,      // 렌탈 아이템 비용
      platformFee,         // 플랫폼 수수료
      discountAmount,      // 할인 금액
      discountType,        // 할인 유형
      discountCode,        // 쿠폰 코드
      subtotal,            // 소계 (할인 전)
      totalUsageFee,       // 실이용 금액
      deposit,             // 보증금
      finalTotalAmount,    // 최종 결제 금액

      // 기타
      rentalItems,         // 렌탈 아이템 정보
      room: { ... },       // 방 정보
      host/guest: { ... }  // 상대방 정보
    }
  ]
}
```

## ⚠️ 문제점

### 게스트 입장
- **리스트에서 금액 상세 정보 과다 노출**
  - 게스트는 최종 금액만 필요 (`finalTotalAmount`)
  - 플랫폼 수수료, 할인 내역 등은 상세 페이지에서 확인
  - 리스트는 간결하게 "어떤 방, 언제, 얼마" 정도만 필요

### 호스트 입장
- **수익 관리를 위해 금액 상세 필수**
  - 임대료, 관리비, 청소비 등 수익 구성 요소 확인 필요
  - 플랫폼 수수료 차감 후 실수령액 계산
  - 할인 적용 내역 파악
  - 렌탈 아이템 추가 수익 확인

## 🎯 분리 목표

### 게스트 계약 리스트
> "간결한 요약 정보 제공 - 어떤 방을, 언제, 얼마에 예약했는지"

**유지 필드**:
- ✅ 기본 정보: id, orderId, status, statusLabel
- ✅ 날짜 정보: checkInDate, checkOutDate, totalDays
- ✅ **최종 금액만**: `finalTotalAmount`
- ✅ 방 정보: room (기본 정보 + 썸네일)
- ✅ 호스트 정보: host (이름, 연락처)

**제거 필드**:
- ❌ rentalFee, maintenanceFee, cleaningFee, rentalItemsFee
- ❌ platformFee, discountAmount, discountType, discountCode
- ❌ subtotal, totalUsageFee, deposit
- ❌ totalWeeks
- ❌ rentalItems

### 호스트 계약 리스트
> "수익 관리를 위한 상세 금액 정보 제공"

**유지 필드**:
- ✅ **모든 금액 정보 유지**
  - rentalFee, maintenanceFee, cleaningFee, rentalItemsFee
  - platformFee, discountAmount, discountType, discountCode
  - subtotal, totalUsageFee, deposit, finalTotalAmount
- ✅ rentalItems (렌탈 수익 파악용)
- ✅ guestMessage (게스트 요청사항)
- ✅ 방 정보: room
- ✅ 게스트 정보: guest (이름, 연락처, 이메일)

**추가 필드 (선택)**:
- 📊 `hostEarnings` (호스트 실수령액) = `totalUsageFee - platformFee`
  - 플랫폼 수수료 차감 후 호스트가 받을 금액

## 📐 설계 사양

### 1. API 엔드포인트 (변경 없음)
```
GET /api/contracts/guest?status=PENDING_APPROVAL
GET /api/contracts/host?status=PENDING_APPROVAL
```

### 2. 응답 스키마

#### 게스트 계약 리스트 (간소화)
```javascript
// GET /api/contracts/guest
{
  "success": true,
  "data": {
    "contracts": [
      {
        "id": 1,
        "orderId": "2501270001",
        "status": "PENDING_APPROVAL",
        "statusLabel": "승인 대기",

        // 날짜 정보
        "checkInDate": "2025-12-18T15:00:00+09:00",
        "checkOutDate": "2026-01-18T11:00:00+09:00",
        "totalDays": 31,

        // 💰 최종 금액만 표시
        "finalTotalAmount": 1558000,

        // 방 정보
        "room": {
          "id": 123,
          "roomName": "강남역 도보 3분 신축 원룸",
          "address": "서울 강남구 역삼동",
          "area": 33.0,
          "buildingType": "ONEROOM",
          "thumbnailUrl": "/uploads/rooms/room_123_1.jpg"
        },

        // 호스트 정보
        "host": {
          "id": 456,
          "name": "김호스트",
          "phoneNumber": "010-1234-5678"
        },

        "createdAt": "2025-01-27T10:00:00+09:00"
      }
    ]
  },
  "message": "계약 목록 조회 성공"
}
```

#### 호스트 계약 리스트 (상세 유지)
```javascript
// GET /api/contracts/host
{
  "success": true,
  "data": {
    "contracts": [
      {
        "id": 1,
        "orderId": "2501270001",
        "status": "PENDING_APPROVAL",
        "statusLabel": "승인 대기",

        // 날짜 정보
        "checkInDate": "2025-12-18T15:00:00+09:00",
        "checkOutDate": "2026-01-18T11:00:00+09:00",
        "totalDays": 31,
        "totalWeeks": 4,

        // 💰 금액 상세 정보 (모두 포함)
        "rentalFee": 1000000,        // 임대료
        "maintenanceFee": 200000,    // 관리비
        "cleaningFee": 50000,        // 청소비
        "rentalItemsFee": 30000,     // 렌탈 아이템
        "platformFee": 78000,        // 플랫폼 수수료 (9.9%)
        "discountAmount": 50000,     // 할인
        "discountType": "LONG_TERM_DISCOUNT",
        "discountCode": null,
        "subtotal": 1280000,         // 소계 (할인 전)
        "totalUsageFee": 1258000,    // 실이용 금액
        "deposit": 300000,           // 보증금
        "finalTotalAmount": 1558000, // 최종 금액

        // 📊 호스트 수익 (새로 추가)
        "hostEarnings": 1180000,     // 호스트 실수령액 (totalUsageFee - platformFee)

        // 렌탈 아이템
        "rentalItems": {
          "airConditioner": { "quantity": 1, "dailyRate": 3000 }
        },

        // 게스트 메시지
        "guestMessage": "오후 3시쯤 입주 예정입니다.",

        // 방 정보
        "room": {
          "id": 123,
          "roomName": "강남역 도보 3분 신축 원룸",
          "address": "서울 강남구 역삼동",
          "area": 33.0,
          "buildingType": "ONEROOM",
          "thumbnailUrl": "/uploads/rooms/room_123_1.jpg"
        },

        // 게스트 정보
        "guest": {
          "id": 789,
          "name": "이게스트",
          "phoneNumber": "010-9876-5432",
          "email": "guest@example.com"
        },

        "createdAt": "2025-01-27T10:00:00+09:00"
      }
    ]
  },
  "message": "계약 요청 목록 조회 성공"
}
```

### 3. 구현 계획

#### Step 1: 컨트롤러 수정
**파일**: `controllers/contractController.js`

```javascript
/**
 * 게스트의 계약 요청 목록 조회 (간소화 버전)
 * GET /api/contracts/guest
 */
const getGuestContracts = async (req, res) => {
  try {
    const guestId = req.user.id;
    const { status } = req.query;

    const whereClause = { guestId };
    if (status) {
      whereClause.status = status;
    }

    const contracts = await Contract.findAll({
      where: whereClause,
      include: [
        {
          model: Room,
          as: 'room',
          attributes: ['id', 'roomName', 'address', 'area', 'buildingType'],
          include: [
            {
              model: RoomPhoto,
              as: 'photos',
              attributes: ['id', 'url'],
              limit: 1,
              order: [['order', 'ASC']]
            }
          ]
        },
        {
          model: User,
          as: 'host',
          attributes: ['id', 'name', 'phoneNumber']
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    return success(
      res,
      {
        contracts: contracts.map(contract => ({
          id: contract.id,
          orderId: contract.orderId,
          status: contract.status,
          statusLabel: Contract.STATUS_LABELS[contract.status],

          // 날짜 정보
          checkInDate: contract.checkInDate,
          checkOutDate: contract.checkOutDate,
          totalDays: contract.totalDays,

          // 💰 최종 금액만 표시 (간소화)
          finalTotalAmount: contract.finalTotalAmount,

          // 방 정보
          room: {
            id: contract.room.id,
            roomName: contract.room.roomName,
            address: contract.room.address,
            area: contract.room.area,
            buildingType: contract.room.buildingType,
            thumbnailUrl: contract.room.photos[0]?.url || null
          },

          // 호스트 정보
          host: {
            id: contract.host.id,
            name: contract.host.name,
            phoneNumber: contract.host.phoneNumber
          },

          createdAt: contract.createdAt
        }))
      },
      '계약 목록 조회 성공'
    );
  } catch (err) {
    console.error('게스트 계약 목록 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 호스트가 받은 계약 요청 목록 조회 (상세 버전)
 * GET /api/contracts/host
 */
const getHostContracts = async (req, res) => {
  try {
    const hostId = req.user.id;
    const { status } = req.query;

    const whereClause = { hostId };
    if (status) {
      whereClause.status = status;
    }

    const contracts = await Contract.findAll({
      where: whereClause,
      include: [
        {
          model: Room,
          as: 'room',
          attributes: ['id', 'roomName', 'address', 'area', 'buildingType'],
          include: [
            {
              model: RoomPhoto,
              as: 'photos',
              attributes: ['id', 'url'],
              limit: 1,
              order: [['order', 'ASC']]
            }
          ]
        },
        {
          model: User,
          as: 'guest',
          attributes: ['id', 'name', 'phoneNumber', 'email']
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    return success(
      res,
      {
        contracts: contracts.map(contract => ({
          id: contract.id,
          orderId: contract.orderId,
          status: contract.status,
          statusLabel: Contract.STATUS_LABELS[contract.status],

          // 날짜 정보
          checkInDate: contract.checkInDate,
          checkOutDate: contract.checkOutDate,
          totalDays: contract.totalDays,
          totalWeeks: contract.totalWeeks,

          // 💰 금액 상세 정보 (모두 유지)
          rentalFee: contract.rentalFee,
          maintenanceFee: contract.maintenanceFee,
          cleaningFee: contract.cleaningFee,
          rentalItemsFee: contract.rentalItemsFee,
          platformFee: contract.platformFee,
          discountAmount: contract.discountAmount,
          discountType: contract.discountType,
          discountCode: contract.discountCode,
          subtotal: contract.subtotal,
          totalUsageFee: contract.totalUsageFee,
          deposit: contract.deposit,
          finalTotalAmount: contract.finalTotalAmount,

          // 📊 호스트 실수령액 (새로 추가)
          hostEarnings: contract.totalUsageFee - contract.platformFee,

          // 렌탈 아이템
          rentalItems: contract.rentalItems,

          // 메시지
          guestMessage: contract.guestMessage,

          // 방 정보
          room: {
            id: contract.room.id,
            roomName: contract.room.roomName,
            address: contract.room.address,
            area: contract.room.area,
            buildingType: contract.room.buildingType,
            thumbnailUrl: contract.room.photos[0]?.url || null
          },

          // 게스트 정보
          guest: {
            id: contract.guest.id,
            name: contract.guest.name,
            phoneNumber: contract.guest.phoneNumber,
            email: contract.guest.email
          },

          createdAt: contract.createdAt
        }))
      },
      '계약 요청 목록 조회 성공'
    );
  } catch (err) {
    console.error('호스트 계약 목록 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};
```

#### Step 2: API 문서 업데이트
**파일**: `docs/API_DOCUMENTATION.md`

- 게스트 계약 리스트 응답 예시 간소화
- 호스트 계약 리스트에 `hostEarnings` 필드 추가
- 각 API의 사용 목적 명확화

#### Step 3: 프론트엔드 영향도 분석
**게스트 앱** (Flutter):
- ⚠️ 기존에 상세 금액 정보를 사용하고 있다면 수정 필요
- ✅ 리스트에서 최종 금액만 표시하도록 변경
- ✅ 상세 페이지는 기존 API (`GET /api/contracts/:contractId`) 사용

**호스트 앱** (Flutter):
- ✅ 기존 필드 모두 유지되므로 영향 없음
- 📊 `hostEarnings` 필드 활용 (호스트 실수령액 표시)

**관리자 대시보드** (React):
- ✅ 영향 없음 (별도 관리자 API 사용)

## 🔄 마이그레이션 전략

### Breaking Changes 최소화
1. **엔드포인트 변경 없음**: 기존 URL 유지
2. **호스트 API 하위 호환**: 모든 기존 필드 유지
3. **게스트 API는 필드 제거**:
   - ⚠️ Breaking Change 발생
   - 프론트엔드 수정 필요

### 배포 순서
```
1. 백엔드 API 배포 (게스트 응답 간소화)
   ↓
2. Flutter 앱 업데이트 (게스트 리스트 UI 간소화)
   ↓
3. 앱 스토어 배포
   ↓
4. 구버전 앱 지원 중단 일정 공지
```

### 롤백 계획
- 문제 발생 시 컨트롤러 코드만 되돌리기
- DB 스키마 변경 없음 (안전)

## ✅ 검증 체크리스트

### 기능 검증
- [ ] 게스트 계약 리스트 조회 시 최종 금액만 표시되는지 확인
- [ ] 호스트 계약 리스트 조회 시 모든 금액 정보가 표시되는지 확인
- [ ] `hostEarnings` 계산이 정확한지 검증
- [ ] 기존 필터링 기능 (status) 정상 작동 확인

### 성능 검증
- [ ] 쿼리 성능 저하 없음 (동일한 include 구조)
- [ ] 응답 크기 감소 확인 (게스트 API)

### 보안 검증
- [ ] 게스트가 호스트 계약 목록에 접근 불가 확인
- [ ] 호스트가 게스트 계약 목록에 접근 불가 확인
- [ ] JWT 인증 정상 작동 확인

## 📊 예상 효과

### 게스트 경험 개선
- ✅ **리스트 간결화**: 필요한 정보만 표시 (최종 금액)
- ✅ **로딩 속도 향상**: 응답 크기 약 40% 감소
- ✅ **UI 단순화**: 금액 표시 로직 간소화

### 호스트 경험 개선
- ✅ **수익 관리 용이**: 금액 구성 요소 한눈에 파악
- ✅ **실수령액 즉시 확인**: `hostEarnings` 필드 활용
- ✅ **의사결정 지원**: 할인, 렌탈 아이템 수익 분석

### 시스템 효율
- ✅ **네트워크 트래픽 감소**: 게스트 API 응답 크기 40% 감소
- ✅ **API 명확성**: 게스트/호스트 역할에 맞는 데이터 제공
- ✅ **유지보수성**: 각 API의 목적과 책임 명확화

## 🚀 구현 우선순위

1. **High Priority** (필수):
   - [contractController.js:389-483](c:\study\ezstay_back\controllers\contractController.js#L389-L483) `getGuestContracts` 수정 (필드 제거)
   - [contractController.js:489-587](c:\study\ezstay_back\controllers\contractController.js#L489-L587) `getHostContracts` 수정 (`hostEarnings` 추가)
   - API 문서 업데이트

2. **Medium Priority** (권장):
   - Flutter 앱 UI 업데이트 (게스트 리스트 간소화)
   - 프론트엔드 테스트

3. **Low Priority** (선택):
   - 응답 캐싱 전략 개선
   - 페이지네이션 추가 (계약 수가 많아질 경우)

## 📝 관련 파일

### 백엔드
- [controllers/contractController.js](c:\study\ezstay_back\controllers\contractController.js) - 컨트롤러 로직
- [routes/contractRoutes.js](c:\study\ezstay_back\routes\contractRoutes.js) - 라우팅 (변경 없음)
- [models/Contract.js](c:\study\ezstay_back\models\Contract.js) - 모델 (변경 없음)
- [docs/API_DOCUMENTATION.md](c:\study\ezstay_back\docs\API_DOCUMENTATION.md) - API 문서 업데이트 필요

### 프론트엔드 (영향 파일 확인 필요)
- Flutter 게스트 앱: 계약 리스트 화면
- Flutter 호스트 앱: 계약 리스트 화면 (hostEarnings 표시)

---

**작성일**: 2025-01-27
**작성자**: Claude Code (설계 문서 자동 생성)
**버전**: 1.0.0
**상태**: 설계 완료 - 구현 대기
