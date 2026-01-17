# 방 관리 API 설계 문서 (Room Management API Design)

## 개요
호스트가 등록한 방 목록을 상태별로 관리하고, 각 방에 대해 **수정 / 게시·중단 / 복제 / 삭제 / 일정관리** 액션을 수행할 수 있도록 하는 백엔드 API 설계 문서입니다.

## 프론트엔드 요구사항 분석

### UI 컴포넌트 분석
- **PropertyManagement.tsx**: 방 목록 관리 화면
  - 상태별 필터링 (전체, 등록중, 심사중, 게시중, 등록 반려, 게시중단)
  - 검색 기능 (방 이름, 주소)
  - 방 카드별 관리 액션 (수정, 삭제, 게시/비공개 전환, 복제, 일정관리)

- **PropertySchedule.tsx**: 일정 관리 화면
  - 12개월 캘린더 뷰
  - 계약 불가 기간 설정/해제
  - 계약된 기간 및 차단 기간 목록 표시

### 방 상태(status) 정의
프론트엔드에서 사용하는 상태:
- `draft`: 등록중 (프론트엔드 로컬 상태, 서버 미저장)
- `pending`: 심사중 (서버의 `pending_review`)
- `approved`: 게시중 (서버의 `published`)
- `rejected`: 등록 반려 (서버의 `rejected`)
- `inactive`: 게시중단 (서버의 `approved`이지만 호스트가 비공개 처리)

### 상태 매핑 전략
백엔드 DB 상태 → 프론트엔드 표시 상태:
```
draft → draft (프론트엔드 로컬 관리)
pending_review → pending
approved (publishedAt null) → approved (심사 승인됨, 아직 게시 안함)
approved (publishedAt not null) → approved (게시중)
published → approved (레거시 호환)
rejected → rejected
```

**새로운 상태 필드 추가 필요**: `isActive` (Boolean)
- `true`: 호스트가 공개 상태로 설정
- `false`: 호스트가 비공개 상태로 설정 (게시중단)
- 이를 통해 `approved` 상태에서 게시/비공개 전환 가능

## API 설계

### 1. 방 상태 변경 API (게시/비공개)

#### Endpoint
```
PATCH /api/host/rooms/:roomId/status
```

#### 인증
- `authenticateToken` 미들웨어 필수
- 호스트 본인의 방만 수정 가능

#### Request Body
```json
{
  "isActive": true  // true: 게시, false: 비공개
}
```

#### 비즈니스 로직
1. **권한 검증**: `hostId === req.user.id`
2. **상태 검증**:
   - `status === 'approved'`인 경우에만 토글 가능
   - `status !== 'approved'`면 에러 반환
3. **상태 변경**:
   - `isActive = true`: 게시 (publishedAt 자동 설정)
   - `isActive = false`: 비공개 (publishedAt 유지)

#### Response (200 OK)
```json
{
  "success": true,
  "message": "방이 게시되었습니다.",
  "data": {
    "roomId": 1,
    "status": "approved",
    "isActive": true,
    "publishedAt": "2026-01-14T10:30:00Z"
  }
}
```

#### Error Cases
- `404`: 방을 찾을 수 없음
- `403`: 권한 없음 (다른 호스트의 방)
- `400`: 상태 변경 불가 (status가 approved가 아님)

---

### 2. 방 삭제 API

#### Endpoint
```
DELETE /api/host/rooms/:roomId
```

#### 인증
- `authenticateToken` 미들웨어 필수
- 호스트 본인의 방만 삭제 가능

#### 비즈니스 로직
1. **권한 검증**: `hostId === req.user.id`
2. **삭제 제약 조건**:
   - **계약이 존재하는 방은 삭제 불가** (Contract 테이블 확인)
   - 활성 계약(`status IN ['pending', 'approved', 'active']`) 존재 시 에러
3. **Soft Delete 권장** (미래 복구 가능성):
   - `status = 'deleted'` 상태로 변경
   - `deletedAt` 타임스탬프 기록
4. **Hard Delete** (선택사항):
   - 연관 데이터 cascade 삭제: RoomPhoto, RoomAmenity, EzService
   - 외래키 제약 조건 확인

#### Response (200 OK)
```json
{
  "success": true,
  "message": "방이 삭제되었습니다.",
  "data": null
}
```

#### Error Cases
- `404`: 방을 찾을 수 없음
- `403`: 권한 없음
- `400`: 계약이 존재하여 삭제 불가 (ErrorCode: `ROOM_HAS_CONTRACTS`)

---

### 3. 방 복제 API

#### Endpoint
```
POST /api/host/rooms/:roomId/duplicate
```

#### 인증
- `authenticateToken` 미들웨어 필수

#### Request Body
```json
{
  "includePhotos": true,    // 사진 복제 여부 (기본값: true)
  "includeAmenities": true,  // 편의시설 복제 여부 (기본값: true)
  "includeEzService": true   // 이지서비스 복제 여부 (기본값: true)
}
```

#### 비즈니스 로직
1. **권한 검증**: `hostId === req.user.id`
2. **원본 방 조회**:
   - Room + RoomPhoto + RoomAmenity + EzService
3. **새 방 생성**:
   - `status = 'draft'`
   - `roomName = "{원본 방 이름} (복제)"`
   - `submittedAt, approvedAt, publishedAt = null`
4. **연관 데이터 복제**:
   - **RoomPhoto**: `includePhotos === true`일 때 복제
   - **RoomAmenity**: `includeAmenities === true`일 때 복제
   - **EzService**: `includeEzService === true`일 때 복제
5. **트랜잭션 보장**: 모든 복제 작업을 단일 트랜잭션으로 처리

#### Response (201 Created)
```json
{
  "success": true,
  "message": "방이 복제되었습니다. 수정 후 등록해주세요.",
  "data": {
    "roomId": 123,
    "roomName": "강남역 도보 5분 원룸 (복제)",
    "status": "draft",
    "copiedFrom": 1
  }
}
```

#### Error Cases
- `404`: 원본 방을 찾을 수 없음
- `403`: 권한 없음

---

### 4. 방 목록 조회 API (기존 API 확장)

#### Endpoint
```
GET /api/host/rooms
```

#### Query Parameters (확장)
```
?status=approved          # 특정 상태 필터링
&isActive=true            # 게시 여부 필터링 (NEW)
&search=강남역            # 방 이름 또는 주소 검색 (NEW)
&page=1                   # 페이지 번호
&limit=10                 # 페이지당 개수
```

#### Response (200 OK)
```json
{
  "success": true,
  "data": {
    "rooms": [
      {
        "id": 1,
        "roomName": "강남역 도보 5분 원룸",
        "address": "서울시 강남구 역삼동 123-45",
        "detailAddress": "3층 301호",
        "area": 20.5,
        "buildingType": "원룸",
        "dailyRent": 50000,
        "status": "approved",
        "isActive": true,
        "photos": [
          {
            "url": "/uploads/rooms/photo1.jpg",
            "order": 0
          }
        ],
        "registrationProgress": {
          "currentStep": 7,
          "totalSteps": 7,
          "completedSteps": ["basic", "pricing", "photos", "amenities", "ezService", "description", "submit"]
        },
        "submittedAt": "2026-01-10T10:00:00Z",
        "approvedAt": "2026-01-11T14:00:00Z",
        "publishedAt": "2026-01-11T14:00:00Z",
        "createdAt": "2026-01-10T09:00:00Z",
        "updatedAt": "2026-01-11T14:00:00Z"
      }
    ],
    "pagination": {
      "total": 15,
      "page": 1,
      "limit": 10,
      "totalPages": 2
    }
  }
}
```

#### 변경사항
- **검색 기능 추가**: `search` 파라미터로 방 이름 또는 주소 부분 일치 검색
- **isActive 필터링**: 게시/비공개 상태 필터링
- **응답에 `isActive` 필드 추가**

---

## DB 스키마 변경

### Room 테이블 변경

#### 추가 컬럼
```sql
ALTER TABLE rooms
ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true COMMENT '호스트가 설정한 게시 여부 (true: 게시중, false: 비공개)',
ADD COLUMN deleted_at DATETIME NULL COMMENT 'Soft Delete 타임스탬프';
```

#### 인덱스 추가
```sql
CREATE INDEX idx_host_status_active ON rooms(host_id, status, is_active);
CREATE INDEX idx_search_name_address ON rooms(room_name, address);
```

---

## 에러 코드 추가

### utils/responseHelper.js 업데이트
```javascript
ErrorCodes: {
  // 기존 코드...

  // 4230-4239: 방 관리 관련
  ROOM_HAS_CONTRACTS: { code: 4230, message: '계약이 존재하여 삭제할 수 없습니다.' },
  ROOM_STATUS_NOT_APPROVED: { code: 4231, message: '게시 상태 변경은 승인된 방만 가능합니다.' },
  ROOM_ALREADY_DELETED: { code: 4232, message: '이미 삭제된 방입니다.' },
  DUPLICATE_ROOM_FAILED: { code: 4233, message: '방 복제에 실패했습니다.' }
}
```

---

## 라우팅 추가

### routes/hostRoutes.js
```javascript
// 방 관리 액션
router.patch('/rooms/:roomId/status', updateRoomStatus);    // 게시/비공개
router.delete('/rooms/:roomId', deleteRoom);                // 삭제
router.post('/rooms/:roomId/duplicate', duplicateRoom);     // 복제
```

---

## 컨트롤러 구현 가이드

### controllers/hostController.js

#### 1. updateRoomStatus
```javascript
const updateRoomStatus = async (req, res) => {
  try {
    const { roomId } = req.params;
    const hostId = req.user.id;
    const { isActive } = req.body;

    // 방 조회
    const room = await Room.findOne({ where: { id: roomId, hostId } });
    if (!room) return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);

    // 상태 검증
    if (room.status !== 'approved') {
      return error(res, ErrorCodes.ROOM_STATUS_NOT_APPROVED, 400);
    }

    // 상태 변경
    await room.update({
      isActive,
      publishedAt: isActive && !room.publishedAt ? new Date() : room.publishedAt
    });

    // 캐시 무효화
    await invalidateRoomCache();

    return updated(res, {
      roomId: room.id,
      status: room.status,
      isActive: room.isActive,
      publishedAt: room.publishedAt
    }, isActive ? '방이 게시되었습니다.' : '방이 비공개 처리되었습니다.');
  } catch (err) {
    console.error('Update room status error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};
```

#### 2. deleteRoom (Soft Delete)
```javascript
const deleteRoom = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { roomId } = req.params;
    const hostId = req.user.id;

    // 방 조회
    const room = await Room.findOne({ where: { id: roomId, hostId } });
    if (!room) return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);

    // 계약 존재 여부 확인
    const contractCount = await Contract.count({
      where: {
        roomId: room.id,
        status: ['pending', 'approved', 'active']
      }
    });

    if (contractCount > 0) {
      return error(res, ErrorCodes.ROOM_HAS_CONTRACTS, 400);
    }

    // Soft Delete
    await room.update({
      status: 'deleted',
      deletedAt: new Date()
    }, { transaction });

    await transaction.commit();

    // 캐시 무효화
    await invalidateRoomCache();

    return success(res, null, '방이 삭제되었습니다.');
  } catch (err) {
    await transaction.rollback();
    console.error('Delete room error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};
```

#### 3. duplicateRoom
```javascript
const duplicateRoom = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { roomId } = req.params;
    const hostId = req.user.id;
    const {
      includePhotos = true,
      includeAmenities = true,
      includeEzService = true
    } = req.body;

    // 원본 방 조회 (연관 데이터 포함)
    const originalRoom = await Room.findOne({
      where: { id: roomId, hostId },
      include: [
        { model: RoomPhoto, as: 'photos' },
        { model: RoomAmenity, as: 'amenity' },
        { model: EzService, as: 'ezService' }
      ]
    });

    if (!originalRoom) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    // 새 방 생성
    const newRoom = await Room.create({
      hostId,
      roomName: `${originalRoom.roomName} (복제)`,
      address: originalRoom.address,
      detailAddress: originalRoom.detailAddress,
      latitude: originalRoom.latitude,
      longitude: originalRoom.longitude,
      area: originalRoom.area,
      floor: originalRoom.floor,
      buildingType: originalRoom.buildingType,
      parkingAvailable: originalRoom.parkingAvailable,
      parkingInfo: originalRoom.parkingInfo,
      elevatorAvailable: originalRoom.elevatorAvailable,
      roomCount: originalRoom.roomCount,
      bathroomCount: originalRoom.bathroomCount,
      isDuplex: originalRoom.isDuplex,
      entrancePassword: originalRoom.entrancePassword,
      dailyRent: originalRoom.dailyRent,
      dailyMaintenanceFee: originalRoom.dailyMaintenanceFee,
      longTermWeeks: originalRoom.longTermWeeks,
      longTermDiscount: originalRoom.longTermDiscount,
      quickMoveIn: originalRoom.quickMoveIn,
      quickMoveInDiscount: originalRoom.quickMoveInDiscount,
      maintenanceDetail: originalRoom.maintenanceDetail,
      includeElectricity: originalRoom.includeElectricity,
      includeWater: originalRoom.includeWater,
      includeGas: originalRoom.includeGas,
      includeInternet: originalRoom.includeInternet,
      cleaningFee: originalRoom.cleaningFee,
      minContractWeeks: originalRoom.minContractWeeks,
      refundPolicy: originalRoom.refundPolicy,
      description: originalRoom.description,
      maxGuests: originalRoom.maxGuests,
      status: 'draft'
    }, { transaction });

    // 사진 복제
    if (includePhotos && originalRoom.photos && originalRoom.photos.length > 0) {
      const photoPromises = originalRoom.photos.map(photo =>
        RoomPhoto.create({
          roomId: newRoom.id,
          url: photo.url,
          order: photo.order
        }, { transaction })
      );
      await Promise.all(photoPromises);
    }

    // 편의시설 복제
    if (includeAmenities && originalRoom.amenity) {
      await RoomAmenity.create({
        roomId: newRoom.id,
        basicOptions: originalRoom.amenity.basicOptions,
        additionalOptions: originalRoom.amenity.additionalOptions,
        convenienceOptions: originalRoom.amenity.convenienceOptions,
        petsAllowed: originalRoom.amenity.petsAllowed,
        wifiPassword: originalRoom.amenity.wifiPassword
      }, { transaction });
    }

    // 이지서비스 복제
    if (includeEzService && originalRoom.ezService) {
      await EzService.create({
        roomId: newRoom.id,
        cleaningService: originalRoom.ezService.cleaningService,
        autoPasswordChange: originalRoom.ezService.autoPasswordChange,
        roomPassword: originalRoom.ezService.roomPassword
      }, { transaction });
    }

    await transaction.commit();

    return created(res, {
      roomId: newRoom.id,
      roomName: newRoom.roomName,
      status: newRoom.status,
      copiedFrom: originalRoom.id
    }, '방이 복제되었습니다. 수정 후 등록해주세요.');
  } catch (err) {
    await transaction.rollback();
    console.error('Duplicate room error:', err);
    return error(res, ErrorCodes.DUPLICATE_ROOM_FAILED, 500, err.message);
  }
};
```

---

## 구현 순서

### Phase 1: DB 스키마 변경
1. `rooms` 테이블에 `is_active`, `deleted_at` 컬럼 추가
2. 인덱스 추가 (`idx_host_status_active`, `idx_search_name_address`)
3. `status` ENUM에 `deleted` 추가 (선택사항)

### Phase 2: 에러 코드 추가
1. `utils/responseHelper.js`에 새 에러 코드 추가

### Phase 3: 컨트롤러 구현
1. `updateRoomStatus` 구현
2. `deleteRoom` 구현 (Soft Delete)
3. `duplicateRoom` 구현
4. `getMyRooms` 업데이트 (검색 기능 추가)

### Phase 4: 라우팅 추가
1. `routes/hostRoutes.js`에 새 엔드포인트 추가
2. 기존 `GET /api/host/rooms` 업데이트

### Phase 5: 테스트
1. 단위 테스트 작성
2. 통합 테스트 작성
3. 프론트엔드 연동 테스트

### Phase 6: 문서화
1. API 문서 업데이트 (`docs/API_DOCUMENTATION.md`)
2. Postman Collection 업데이트

---

## 보안 고려사항

### 1. 권한 검증
- 모든 엔드포인트에서 `hostId === req.user.id` 검증 필수
- 다른 호스트의 방에 대한 접근 차단

### 2. Rate Limiting
- 삭제 API: `deleteLimiter` (1시간/10회)
- 복제 API: `uploadLimiter` (1시간/20회) 재사용

### 3. SQL Injection 방지
- Sequelize ORM 사용으로 자동 방어
- 검색 쿼리는 파라미터 바인딩 사용

### 4. Soft Delete
- 방 삭제 시 실제 데이터는 유지 (복구 가능)
- 30일 후 자동 Hard Delete 스케줄러 고려 (선택사항)

---

## 프론트엔드 연동 가이드

### 방 상태 매핑
```typescript
// 백엔드 → 프론트엔드 상태 변환
const mapRoomStatus = (room: ServerRoom): FrontendStatus => {
  if (room.status === 'draft') return 'draft';
  if (room.status === 'pending_review') return 'pending';
  if (room.status === 'rejected') return 'rejected';
  if (room.status === 'approved' && room.isActive) return 'approved';
  if (room.status === 'approved' && !room.isActive) return 'inactive';
  return 'approved'; // 기본값
};
```

### API 호출 예시
```typescript
// 게시/비공개 전환
const toggleRoomStatus = async (roomId: string, isActive: boolean) => {
  const response = await fetch(`/api/host/rooms/${roomId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isActive })
  });
  return response.json();
};

// 방 삭제
const deleteRoom = async (roomId: string) => {
  const response = await fetch(`/api/host/rooms/${roomId}`, {
    method: 'DELETE'
  });
  return response.json();
};

// 방 복제
const duplicateRoom = async (roomId: string) => {
  const response = await fetch(`/api/host/rooms/${roomId}/duplicate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      includePhotos: true,
      includeAmenities: true,
      includeEzService: true
    })
  });
  return response.json();
};
```

---

## 향후 확장 고려사항

### 1. 일정 관리 API
- **BlockedPeriod** 테이블 생성 필요
- `POST /api/host/rooms/:roomId/blocked-periods`: 계약 불가 기간 추가
- `DELETE /api/host/rooms/:roomId/blocked-periods/:periodId`: 차단 기간 삭제
- `GET /api/host/rooms/:roomId/schedule`: 12개월 일정 조회 (계약 + 차단 기간)

### 2. 방 통계 API
- `GET /api/host/rooms/:roomId/statistics`: 조회수, 예약률, 수익 통계

### 3. 대량 작업 API
- `POST /api/host/rooms/bulk-status-update`: 여러 방 상태 일괄 변경
- `DELETE /api/host/rooms/bulk-delete`: 여러 방 일괄 삭제

### 4. 방 이력 관리
- **RoomHistory** 테이블: 방 정보 변경 이력 추적
- 관리자 감사 추적용

---

## 참고 자료
- PRD: 방 관리 기능 요구사항
- 기존 API: `GET /api/host/rooms`, `GET /api/host/rooms/:roomId`
- 프론트엔드 UI: `PropertyManagement.tsx`, `PropertySchedule.tsx`
- DB 모델: `models/Room.js`, `models/Contract.js`
