# LiveMoment API 문서

## 목차
- [게스트용 API](#게스트용-api)
  - [지도 영역 내 방 조회](#지도-영역-내-방-조회)
- [호스트 방 등록 API](#호스트-방-등록-api)

---

# 게스트용 API

## 지도 영역 내 방 조회
**GET** `/api/rooms/map`

카카오맵 클러스터링을 위한 지도 영역 내 방 목록 조회 API입니다.

### 인증
인증 불필요 (공개 API)

### Query Parameters
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| swLat | number | O | 남서쪽 위도 (Southwest Latitude) |
| swLng | number | O | 남서쪽 경도 (Southwest Longitude) |
| neLat | number | O | 북동쪽 위도 (Northeast Latitude) |
| neLng | number | O | 북동쪽 경도 (Northeast Longitude) |
| limit | number | X | 최대 조회 개수 (기본값: 500) |

### 좌표 범위
- 위도(latitude): -90 ~ 90
- 경도(longitude): -180 ~ 180

### Request Example
```
GET /api/rooms/map?swLat=37.4&swLng=126.9&neLat=37.6&neLng=127.1
```

### Response
```json
{
  "success": true,
  "message": "지도 영역 내 방 목록을 조회했습니다.",
  "data": {
    "count": 15,
    "rooms": [
      {
        "id": 1,
        "roomName": "홍대 넓은 원룸",
        "address": "서울특별시 마포구 서교동 123-45",
        "latitude": 37.5563,
        "longitude": 126.9236,
        "weeklyRent": 350000,
        "area": 33.5,
        "roomCount": 1,
        "bathroomCount": 1,
        "buildingType": "오피스텔",
        "thumbnail": "/uploads/rooms/room-1234567890-123456789.jpg"  // 또는 null (사진이 없는 경우)
      }
    ]
  }
}
```

### Error Responses

#### 필수 파라미터 누락 (400)
```json
{
  "success": false,
  "error": {
    "code": 4001,
    "message": "지도 영역 좌표가 필요합니다. (swLat, swLng, neLat, neLng)"
  }
}
```

#### 잘못된 좌표 형식 (400)
```json
{
  "success": false,
  "error": {
    "code": 4002,
    "message": "좌표는 숫자 형식이어야 합니다."
  }
}
```

#### 위도 범위 초과 (400)
```json
{
  "success": false,
  "error": {
    "code": 4003,
    "message": "위도는 -90 ~ 90 범위여야 합니다."
  }
}
```

#### 경도 범위 초과 (400)
```json
{
  "success": false,
  "error": {
    "code": 4004,
    "message": "경도는 -180 ~ 180 범위여야 합니다."
  }
}
```

### 사용 예시 (프론트엔드)
```javascript
// 카카오맵 지도 이동 이벤트
kakao.maps.event.addListener(map, 'bounds_changed', async function() {
  const bounds = map.getBounds();
  const swLatLng = bounds.getSouthWest();
  const neLatLng = bounds.getNorthEast();

  const response = await fetch(
    `/api/rooms/map?swLat=${swLatLng.getLat()}&swLng=${swLatLng.getLng()}&neLat=${neLatLng.getLat()}&neLng=${neLatLng.getLng()}`
  );

  const { data } = await response.json();

  // 마커 생성
  const markers = data.rooms.map(room =>
    new kakao.maps.Marker({
      position: new kakao.maps.LatLng(room.latitude, room.longitude),
      title: room.roomName
    })
  );

  // 클러스터러에 마커 추가
  clusterer.addMarkers(markers);
});
```

### 성능 최적화 권장사항
1. **Debounce 적용**: 지도 이동 시 0.3~0.5초 지연 후 API 호출
2. **캐싱**: 이미 조회한 영역은 로컬에 캐시
3. **줌 레벨 제한**: 너무 넓은 영역 조회 방지 (최소 줌 레벨 설정)

---

# 호스트 방 등록 API

## 인증
모든 API는 JWT 토큰 인증이 필요합니다.
```
Authorization: Bearer {access_token}
```

## 1. 기본 정보 등록
**POST** `/api/host/rooms`

### Request Body
```json
{
  "roomName": "string",
  "address": "string",
  "detailAddress": "string",
  "area": "number",
  "floor": "string",
  "buildingType": "string",
  "parkingAvailable": "boolean",
  "parkingInfo": "string",
  "elevatorAvailable": "boolean",
  "roomCount": "number",
  "bathroomCount": "number",
  "livingRoomCount": "number",
  "kitchenCount": "number",
  "isDuplex": "boolean",
  "entrancePassword": "string | null"
}
```

### Response
```json
{
  "success": true,
  "message": "방 기본 정보가 등록되었습니다.",
  "data": {
    "roomId": 1,
    "status": "draft"
  }
}
```

---

## 2. 요금 설정
**PATCH** `/api/host/rooms/:roomId/pricing`

### Request Body
```json
{
  "weeklyRent": "number",
  "longTermWeeks": "number",
  "longTermDiscount": "number",
  "quickMoveIn": "string",
  "quickMoveInDiscount": "number",
  "maintenanceFee": "number",
  "maintenanceDetail": "string",
  "includeElectricity": "boolean",
  "includeWater": "boolean",
  "includeGas": "boolean",
  "includeInternet": "boolean",
  "cleaningFee": "number",
  "minContractWeeks": "number",
  "refundPolicy": "string"
}
```

### Response
```json
{
  "success": true,
  "message": "요금 정보가 저장되었습니다.",
  "data": {
    "roomId": 1
  }
}
```

---

## 3. 사진 업로드
**POST** `/api/host/rooms/:roomId/photos`

### Request
- **Content-Type**: `multipart/form-data`
- **Field Name**: `photos[]`
- **최소**: 6장
- **최대**: 20장
- **허용 형식**: jpeg, jpg, png, gif, webp
- **파일 크기**: 최대 10MB

### Response
```json
{
  "success": true,
  "message": "사진이 업로드되었습니다.",
  "data": {
    "photoUrls": [
      {
        "id": 1,
        "url": "/uploads/rooms/room-1234567890-123456789.jpg",
        "order": 0
      }
    ]
  }
}
```

---

## 4. 편의시설 설정
**PATCH** `/api/host/rooms/:roomId/amenities`

### Request Body
```json
{
  "basicOptions": {
    "refrigerator": "boolean",
    "washingMachine": "boolean",
    "airConditioner": "boolean",
    "sink": "boolean",
    "bed": "boolean",
    "tv": "boolean",
    "internet": "boolean"
  },
  "additionalOptions": {
    "doorLock": "boolean",
    "cctv": "boolean",
    "managementOffice": "boolean",
    "gasRange": "boolean",
    "induction": "boolean",
    "microwave": "boolean",
    "diningTable": "boolean",
    "shoeRack": "boolean",
    "wardrobe": "boolean",
    "dressRoom": "boolean",
    "vanity": "boolean",
    "cableTv": "boolean",
    "sofa": "boolean",
    "desk": "boolean",
    "curtain": "boolean",
    "balcony": "boolean"
  },
  "convenienceOptions": {
    "heatingCooling": "boolean",
    "heater": "boolean",
    "airPurifier": "boolean",
    "dryer": "boolean",
    "iron": "boolean",
    "waterPurifier": "boolean",
    "riceCooker": "boolean",
    "electricKettle": "boolean",
    "dishes": "boolean",
    "cookware": "boolean",
    "bathtub": "boolean",
    "hairDryer": "boolean",
    "bidet": "boolean"
  },
  "petsAllowed": "boolean"
}
```

### Response
```json
{
  "success": true,
  "message": "편의시설 정보가 저장되었습니다.",
  "data": {
    "roomId": 1
  }
}
```

---

## 5. 무료 부가서비스 설정
**PATCH** `/api/host/rooms/:roomId/free-services`

### Request Body
```json
{
  "agreeTerms": "boolean",
  "cleaningService": "boolean",
  "cleaningToolImageUrl": "string | null",
  "hairDryerRental": "boolean",
  "beddingService": "boolean",
  "bedSizes": {
    "슈퍼싱글": "number",
    "퀸": "number",
    "킹": "number"
  },
  "autoPasswordChange": "boolean",
  "roomPassword": "string | null"
}
```

### Response
```json
{
  "success": true,
  "message": "무료 부가서비스 정보가 저장되었습니다.",
  "data": {
    "roomId": 1
  }
}
```

---

## 6. 청소도구 이미지 업로드
**POST** `/api/host/rooms/:roomId/cleaning-tool-image`

### Request
- **Content-Type**: `multipart/form-data`
- **Field Name**: `image`
- **허용 형식**: jpeg, jpg, png, gif, webp
- **파일 크기**: 최대 10MB

### Response
```json
{
  "success": true,
  "message": "청소도구 이미지가 업로드되었습니다.",
  "data": {
    "imageUrl": "/uploads/rooms/room-1234567890-123456789.jpg"
  }
}
```

---

## 7. 방 소개 및 설명
**PATCH** `/api/host/rooms/:roomId/description`

### Request Body
```json
{
  "description": "string",
  "transportation": "string",
  "houseRules": "string"
}
```

### Response
```json
{
  "success": true,
  "message": "방 소개가 저장되었습니다.",
  "data": {
    "roomId": 1
  }
}
```

---

## 8. 심사 요청
**POST** `/api/host/rooms/:roomId/submit-review`

### 필수 조건
- 최소 6장의 사진 업로드
- 요금 정보 입력 완료
- 방 소개 입력 완료

### Response
```json
{
  "success": true,
  "message": "심사 요청이 완료되었습니다.",
  "data": {
    "roomId": 1,
    "status": "pending_review",
    "submittedAt": "2025-10-03T12:00:00.000Z"
  }
}
```

---

## 9. 사진 순서 변경
**PATCH** `/api/host/rooms/:roomId/photos/reorder`

### Request Body
```json
{
  "photoIds": [3, 1, 2, 4, 5, 6]
}
```

### Response
```json
{
  "success": true,
  "message": "사진 순서가 변경되었습니다."
}
```

---

## 10. 사진 삭제
**DELETE** `/api/host/rooms/:roomId/photos/:photoId`

### Response
```json
{
  "success": true,
  "message": "사진이 삭제되었습니다."
}
```

---

## 11. 방 정보 조회
**GET** `/api/host/rooms/:roomId`

### Response
```json
{
  "success": true,
  "data": {
    "roomName": "string",
    "address": "string",
    "detailAddress": "string",
    "area": "number",
    "floor": "string",
    "buildingType": "string",
    "parkingAvailable": "boolean",
    "parkingInfo": "string",
    "elevatorAvailable": "boolean",
    "roomCount": "number",
    "bathroomCount": "number",
    "livingRoomCount": "number",
    "kitchenCount": "number",
    "isDuplex": "boolean",
    "entrancePassword": "string | null",
    "weeklyRent": "number",
    "longTermWeeks": "number",
    "longTermDiscount": "number",
    "quickMoveIn": "string",
    "quickMoveInDiscount": "number",
    "maintenanceFee": "number",
    "maintenanceDetail": "string",
    "includeElectricity": "boolean",
    "includeWater": "boolean",
    "includeGas": "boolean",
    "includeInternet": "boolean",
    "cleaningFee": "number",
    "minContractWeeks": "number",
    "refundPolicy": "string",
    "photos": [
      {
        "id": 1,
        "url": "/uploads/rooms/room-1234567890-123456789.jpg",
        "order": 0
      }
    ],
    "amenities": {
      "basicOptions": {},
      "additionalOptions": {},
      "convenienceOptions": {},
      "petsAllowed": false
    },
    "freeServices": {
      "agreeTerms": false,
      "cleaningService": false,
      "cleaningToolImageUrl": null,
      "hairDryerRental": false,
      "beddingService": false,
      "bedSizes": {
        "슈퍼싱글": 0,
        "퀸": 0,
        "킹": 0
      },
      "autoPasswordChange": false,
      "roomPassword": null
    },
    "description": "string",
    "transportation": "string",
    "houseRules": "string",
    "status": "draft",
    "submittedAt": null,
    "approvedAt": null,
    "publishedAt": null
  }
}
```

---

## 상태(Status) 설명
- `draft`: 작성 중
- `pending_review`: 심사 대기
- `approved`: 승인됨
- `rejected`: 반려됨
- `published`: 게시됨

---

## 에러 응답 형식
```json
{
  "success": false,
  "message": "에러 메시지",
  "error": "상세 에러 내용 (개발 환경)"
}
```

## HTTP 상태 코드
- `200`: 성공
- `201`: 생성 성공
- `400`: 잘못된 요청
- `401`: 인증 실패
- `403`: 권한 없음
- `404`: 리소스 없음
- `500`: 서버 에러
