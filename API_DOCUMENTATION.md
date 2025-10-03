# 호스트 방 등록 API 문서

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
