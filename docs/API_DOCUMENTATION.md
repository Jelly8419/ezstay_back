# Ezstay API 문서

## 목차
- [인증 API](#인증-api)
  - [회원가입](#회원가입)
  - [로그인](#로그인)
  - [토큰 갱신](#토큰-갱신)
  - [로그아웃](#로그아웃)
  - [카카오 소셜 로그인](#카카오-소셜-로그인)
- [게스트용 API](#게스트용-api)
  - [지도 영역 내 방 조회](#지도-영역-내-방-조회)
- [호스트 방 등록 API](#호스트-방-등록-api)

---

# 인증 API

## 회원가입
**POST** `/api/auth/register`

이메일 기반 회원가입 API입니다.

### 인증
인증 불필요 (공개 API)

### Rate Limiting
- **제한**: 15분 내 5회
- **목적**: Brute Force 공격 방어

### Request Body
| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| email | string | O | 이메일 주소 (유효한 이메일 형식) |
| password | string | O | 비밀번호 (최소 8자, 대문자+소문자+숫자 포함) |
| user_mode | string | X | 사용자 모드 ("guest" 또는 "host", 기본값: "guest") |

### 비밀번호 요구사항
- 최소 8자 이상
- 대문자 최소 1개
- 소문자 최소 1개
- 숫자 최소 1개

### Request Example
```json
{
  "email": "user@example.com",
  "password": "SecurePass123",
  "user_mode": "guest"
}
```

### Success Response (201)
```json
{
  "success": true,
  "message": "회원가입이 완료되었습니다.",
  "data": {
    "user": {
      "id": 1,
      "email": "user@example.com",
      "name": null,
      "profileImageUrl": null,
      "userType": "local",
      "userMode": "guest",
      "phoneVerified": false,
      "hasBank": false
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

### Error Responses

#### 이메일 형식 오류 (400)
```json
{
  "success": false,
  "error": {
    "code": "INVALID_EMAIL",
    "message": "유효하지 않은 이메일 형식입니다."
  }
}
```

#### 비밀번호 강도 부족 (400)
```json
{
  "success": false,
  "error": {
    "code": 4004,
    "message": "비밀번호는 최소 8자 이상이어야 하며, 대문자, 소문자, 숫자를 포함해야 합니다."
  }
}
```

#### 중복 이메일 (400)
```json
{
  "success": false,
  "error": {
    "code": "DUPLICATE_EMAIL",
    "message": "이미 사용 중인 이메일입니다."
  }
}
```

#### Rate Limit 초과 (429)
```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "너무 많은 요청이 발생했습니다. 잠시 후 다시 시도해주세요."
  }
}
```

---

## 로그인
**POST** `/api/auth/login`

이메일 기반 로그인 API입니다.

### 인증
인증 불필요 (공개 API)

### Rate Limiting
- **제한**: 15분 내 5회
- **목적**: Brute Force 공격 방어

### 계정 잠금 정책
- 5회 연속 로그인 실패 시 **30분 동안 계정 잠금**
- 로그인 성공 시 실패 횟수 자동 초기화

### Request Body
| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| email | string | O | 이메일 주소 |
| password | string | O | 비밀번호 |
| user_mode | string | X | 사용자 모드 ("guest" 또는 "host") |

### user_mode 동작
- 계좌 정보 없음: 자동으로 "guest" 모드
- 계좌 정보 있음: 요청한 `user_mode` 값 적용 (기본값: "guest")

### Request Example
```json
{
  "email": "user@example.com",
  "password": "SecurePass123",
  "user_mode": "host"
}
```

### Success Response (200)
```json
{
  "success": true,
  "message": "로그인이 완료되었습니다.",
  "data": {
    "user": {
      "id": 1,
      "email": "user@example.com",
      "name": "홍길동",
      "profileImageUrl": "/uploads/profiles/user-1.jpg",
      "userType": "local",
      "userMode": "host",
      "phoneVerified": true,
      "hasBank": true
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

### Error Responses

#### 이메일 형식 오류 (400)
```json
{
  "success": false,
  "error": {
    "code": "INVALID_EMAIL",
    "message": "유효하지 않은 이메일 형식입니다."
  }
}
```

#### 사용자 없음 또는 비밀번호 불일치 (401)
```json
{
  "success": false,
  "error": {
    "code": "USER_NOT_FOUND",
    "message": "이메일 또는 비밀번호가 올바르지 않습니다."
  }
}
```

또는

```json
{
  "success": false,
  "error": {
    "code": "PASSWORD_MISMATCH",
    "message": "이메일 또는 비밀번호가 올바르지 않습니다."
  }
}
```

#### 계정 잠금 (401)
```json
{
  "success": false,
  "error": {
    "code": 1004,
    "message": "계정이 일시적으로 잠겨있습니다. 나중에 다시 시도해주세요."
  }
}
```

#### 비활성화된 계정 (401)
```json
{
  "success": false,
  "error": {
    "code": 1005,
    "message": "비활성화된 계정입니다."
  }
}
```

---

## 토큰 갱신
**POST** `/api/auth/refresh`

만료된 Access Token을 갱신하는 API입니다.

### 인증
Refresh Token 필요

### Request Body
| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| refreshToken | string | O | 로그인 시 발급받은 Refresh Token |

### Request Example
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### Success Response (200)
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

### Error Responses

#### Refresh Token 없음 (401)
```json
{
  "success": false,
  "error": {
    "code": "INVALID_TOKEN",
    "message": "유효하지 않은 토큰입니다."
  }
}
```

#### Refresh Token 만료 (401)
```json
{
  "success": false,
  "error": {
    "code": "TOKEN_EXPIRED",
    "message": "토큰이 만료되었습니다."
  }
}
```

#### 유효하지 않은 토큰 (403)
```json
{
  "success": false,
  "error": {
    "code": "INVALID_TOKEN",
    "message": "유효하지 않은 토큰입니다."
  }
}
```

---

## 로그아웃
**POST** `/api/auth/logout`

현재 로그인된 사용자를 로그아웃 처리합니다. 서버에 저장된 Refresh Token을 삭제합니다.

### 인증
**필수** - Authorization 헤더에 Access Token 포함
```
Authorization: Bearer {access_token}
```

### Request Body
없음

### Success Response (200)
```json
{
  "success": true,
  "message": "로그아웃이 완료되었습니다."
}
```

### Error Responses

#### 인증 실패 (401)
```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "인증이 필요합니다."
  }
}
```

---

## 카카오 소셜 로그인
**POST** `/api/auth/kakao`

카카오 OAuth 로그인 API입니다. 기존 계정이 있으면 자동 연동됩니다.

### 인증
인증 불필요 (공개 API)

### 카카오 로그인 플로우
1. 프론트엔드에서 카카오 인가 코드 획득
2. 인가 코드를 백엔드로 전송
3. 백엔드에서 카카오 API로 토큰 교환 및 사용자 정보 조회
4. 신규 사용자: User + SocialUser 생성
5. 기존 사용자: 기존 계정에 소셜 로그인 연동
6. JWT 토큰 발급

### Request Body
| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| code | string | O | 카카오 OAuth 인가 코드 |
| user_mode | string | X | 사용자 모드 ("guest" 또는 "host", 기본값: "guest") |

### Request Example
```json
{
  "code": "kakao_authorization_code_here",
  "user_mode": "guest"
}
```

### Success Response (200)
```json
{
  "success": true,
  "message": "카카오 로그인이 완료되었습니다.",
  "data": {
    "user": {
      "id": 1,
      "email": "user@kakao.com",
      "name": "홍길동",
      "profileImageUrl": "https://k.kakaocdn.net/...",
      "userType": "social",
      "userMode": "guest",
      "phoneVerified": false,
      "hasBank": false
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "isNewUser": false
  }
}
```

### Response 필드 설명
| 필드 | 설명 |
|------|------|
| isNewUser | 신규 가입 여부 (true: 신규, false: 기존 사용자) |

### Error Responses

#### 인가 코드 없음 (400)
```json
{
  "success": false,
  "error": {
    "code": "MISSING_REQUIRED_FIELDS",
    "message": "카카오 인가 코드가 필요합니다."
  }
}
```

#### 카카오 API 오류 (500)
```json
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "카카오 로그인 처리 중 오류가 발생했습니다."
  }
}
```

### 프론트엔드 구현 예시
```javascript
// 1. 카카오 로그인 버튼 클릭
const handleKakaoLogin = () => {
  const KAKAO_AUTH_URL = `https://kauth.kakao.com/oauth/authorize?client_id=${KAKAO_CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=code`;
  window.location.href = KAKAO_AUTH_URL;
};

// 2. 콜백 페이지에서 인가 코드 처리
const handleCallback = async () => {
  const code = new URLSearchParams(window.location.search).get('code');

  const response = await fetch('/api/auth/kakao', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, user_mode: 'guest' })
  });

  const { data } = await response.json();

  // 토큰 저장
  localStorage.setItem('accessToken', data.accessToken);
  localStorage.setItem('refreshToken', data.refreshToken);
};
```

---

# 게스트용 API

## 지도 영역 내 방 조회
**GET** `/api/rooms/map`

카카오맵 클러스터링을 위한 지도 영역 내 방 목록 조회 API입니다. 선택적으로 날짜 필터를 적용하여 예약 가능한 방만 조회할 수 있습니다.

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
| checkIn | string | X | 입실일 (YYYY-MM-DD 형식) |
| checkOut | string | X | 퇴실일 (YYYY-MM-DD 형식) |

### 좌표 범위
- 위도(latitude): -90 ~ 90
- 경도(longitude): -180 ~ 180

### 날짜 필터 사용
- `checkIn`과 `checkOut`은 **둘 다 제공하거나 둘 다 생략**해야 합니다
- 날짜를 제공하면 해당 기간에 **예약 가능한 방만** 반환됩니다
- 날짜를 생략하면 **모든 게시된 방**을 반환합니다
- 과거 날짜로는 검색할 수 없습니다

### Request Examples

#### 1. 날짜 필터 없이 조회 (기본)
```
GET /api/rooms/map?swLat=37.4&swLng=126.9&neLat=37.6&neLng=127.1
```

#### 2. 날짜 필터 적용 (예약 가능한 방만)
```
GET /api/rooms/map?swLat=37.4&swLng=126.9&neLat=37.6&neLng=127.1&checkIn=2025-11-10&checkOut=2025-11-15
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

#### 날짜 파라미터 불완전 (400)
```json
{
  "success": false,
  "error": {
    "code": 4005,
    "message": "입실일과 퇴실일을 모두 입력해주세요."
  }
}
```

#### 유효하지 않은 날짜 형식 (400)
```json
{
  "success": false,
  "error": {
    "code": 4006,
    "message": "유효하지 않은 날짜 형식입니다. (YYYY-MM-DD)"
  }
}
```

#### 퇴실일이 입실일보다 이전 (400)
```json
{
  "success": false,
  "error": {
    "code": 4007,
    "message": "퇴실일은 입실일보다 이후여야 합니다."
  }
}
```

#### 과거 날짜 검색 (400)
```json
{
  "success": false,
  "error": {
    "code": 4008,
    "message": "과거 날짜로 검색할 수 없습니다."
  }
}
```

### 사용 예시 (프론트엔드)

#### 1. 날짜 필터 없이 조회
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

#### 2. 날짜 필터 적용 (예약 가능한 방만)
```javascript
// 날짜 선택 상태 관리
const [checkIn, setCheckIn] = useState(null);
const [checkOut, setCheckOut] = useState(null);

// 지도 이동 또는 날짜 변경 시 호출
const fetchRooms = async () => {
  const bounds = map.getBounds();
  const swLatLng = bounds.getSouthWest();
  const neLatLng = bounds.getNorthEast();

  // 날짜 파라미터 추가 (선택적)
  const params = new URLSearchParams({
    swLat: swLatLng.getLat(),
    swLng: swLatLng.getLng(),
    neLat: neLatLng.getLat(),
    neLng: neLatLng.getLng()
  });

  if (checkIn && checkOut) {
    params.append('checkIn', checkIn);  // 형식: '2025-11-10'
    params.append('checkOut', checkOut);
  }

  const response = await fetch(`/api/rooms/map?${params}`);
  const { data } = await response.json();

  // 마커 생성 및 표시
  updateMarkers(data.rooms);
};

// 날짜 변경 시 재조회
useEffect(() => {
  fetchRooms();
}, [checkIn, checkOut]);
```

#### 3. 프론트엔드 가격 필터링 (백엔드 호출 없음)
```javascript
const [apiRooms, setApiRooms] = useState([]);      // 백엔드에서 받은 데이터
const [displayRooms, setDisplayRooms] = useState([]); // 화면에 표시할 데이터
const [minPrice, setMinPrice] = useState(0);
const [maxPrice, setMaxPrice] = useState(1000000);

// 백엔드 호출 (날짜 변경 시만)
useEffect(() => {
  fetchRooms().then(data => setApiRooms(data.rooms));
}, [mapBounds, checkIn, checkOut]);

// 프론트엔드 가격 필터링 (실시간, API 호출 없음)
useEffect(() => {
  const filtered = apiRooms.filter(room =>
    room.dailyRent >= minPrice && room.dailyRent <= maxPrice
  );
  setDisplayRooms(filtered);
}, [apiRooms, minPrice, maxPrice]);

// 지도에 표시
<Map markers={displayRooms} />
<PriceRangeSlider
  min={minPrice}
  max={maxPrice}
  onChange={(min, max) => {
    setMinPrice(min);
    setMaxPrice(max);
  }}
/>
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
