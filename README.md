# 부동산 단기 임대 백엔드 API

Node.js와 Express.js를 사용한 부동산 단기 임대 백엔드 API 서버입니다.

## 설치 및 실행

```bash
# 의존성 설치
npm install

# 개발 서버 실행
npm run dev

# 프로덕션 서버 실행
npm start
```

## 환경 설정

`.env` 파일에 다음 환경변수들을 설정하세요:

```
PORT=3000
MONGODB_URI=mongodb://localhost:27017/rental-api
NODE_ENV=development
```

## API 엔드포인트

### 방 등록
- **POST** `/api/rooms/register`
- 새로운 방을 등록합니다.

**요청 예시:**
```json
{
  "roomName": "깨끗한 원룸",
  "address": "서울시 강남구 역삼동",
  "detailAddress": "123-45 ABC빌딩 301호",
  "area": 25.5,
  "buildingType": "원룸",
  "parkingAvailable": true,
  "elevatorAvailable": true,
  "roomCount": 1,
  "bathroomCount": 1,
  "livingRoomCount": 0,
  "kitchenCount": 1,
  "isDuplex": false
}
```

### 방 목록 조회
- **GET** `/api/rooms`
- 등록된 모든 방의 목록을 조회합니다.

### 방 상세 조회
- **GET** `/api/rooms/:id`
- 특정 방의 상세 정보를 조회합니다.

## 데이터 구조

### Room 스키마
- `roomName`: 방 이름 (필수)
- `address`: 주소 (필수)
- `detailAddress`: 상세 주소 (필수)
- `area`: 면적(㎡) (필수)
- `buildingType`: 건물 유형 (아파트, 오피스텔, 빌라, 주택, 원룸, 기타)
- `parkingAvailable`: 주차 가능 여부 (boolean)
- `elevatorAvailable`: 엘리베이터 가능 여부 (boolean)
- `roomCount`: 방 개수
- `bathroomCount`: 화장실 개수
- `livingRoomCount`: 거실 개수
- `kitchenCount`: 주방 개수
- `isDuplex`: 복층 여부 (boolean)
- `hostId`: 호스트 ID (선택사항)
- `createdAt`: 생성일
- `updatedAt`: 수정일