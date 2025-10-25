# 채팅 기능 설정 가이드

## ❓ 질문: 프로젝트 종료 후 재시작하면 기존 승인된 계약의 채팅방이 열려있나요?

### 답변: 두 가지 방법으로 해결했습니다!

---

## ✅ 해결 방법 1: 자동 생성 (권장)

### 동작 방식
프론트엔드에서 채팅방에 접근할 때 **채팅방이 없으면 자동으로 생성**됩니다.

### API 사용법
```javascript
// 계약 ID로 채팅방 조회 (없으면 자동 생성)
GET /api/chats/contracts/:contractId/room
```

### 예시
```javascript
// 프론트엔드에서 채팅방 열기
const response = await fetch(`/api/chats/contracts/123/room`, {
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});

const { chatRoom } = await response.json();
// 채팅방이 없었다면 자동으로 생성됨!
```

### 동작 플로우
```
1. 사용자가 채팅방 접근
   ↓
2. GET /api/chats/contracts/123/room 호출
   ↓
3. 백엔드에서 채팅방 확인
   ├─ 있으면 → 바로 반환
   └─ 없으면 → 자동 생성 후 반환
   ↓
4. 프론트엔드에서 채팅 UI 표시
```

### 장점
- ✅ 사용자가 채팅을 열 때 자동으로 생성
- ✅ 별도의 관리 작업 불필요
- ✅ 실시간으로 대응

---

## ✅ 해결 방법 2: 일괄 생성 스크립트

### 사용 시점
- 채팅 기능을 **처음 배포**할 때
- 기존 승인된 계약들의 채팅방을 **한 번에 생성**하고 싶을 때

### 실행 방법

#### 1. 스크립트 실행
```bash
node scripts/createChatRoomsForExistingContracts.js
```

#### 2. 실행 결과 예시
```
🚀 Firebase 초기화 중...
✅ Firebase Admin SDK 초기화 성공
📋 승인된 계약 조회 중...
✅ 총 15개의 승인된 계약 발견
📌 채팅방이 없는 계약: 10개

📍 계약 ID 1 처리 중...
  ✓ MySQL 채팅방 생성: contract_1
  ✓ Firestore 메타데이터 생성 완료

📍 계약 ID 5 처리 중...
  ✓ MySQL 채팅방 생성: contract_5
  ✓ Firestore 메타데이터 생성 완료

...

==================================================
🎉 채팅방 생성 완료!
  ✅ 성공: 10개
  ❌ 실패: 0개
==================================================
```

### 스크립트가 하는 일
1. 모든 승인된 계약 조회 (APPROVED, PAYMENT_COMPLETED, IN_PROGRESS, COMPLETED)
2. 채팅방이 없는 계약만 필터링
3. 각 계약에 대해:
   - MySQL에 채팅방 레코드 생성
   - Firestore에 메타데이터 생성
4. 결과 리포트 출력

### 대상 계약 상태
- `APPROVED` - 승인됨
- `PAYMENT_COMPLETED` - 결제 완료
- `IN_PROGRESS` - 진행 중
- `COMPLETED` - 완료됨 (읽기 전용으로 생성)

---

## 📊 비교: 자동 생성 vs 일괄 생성

| 항목 | 자동 생성 (방법 1) | 일괄 생성 (방법 2) |
|------|------------------|-------------------|
| **실행 시점** | 사용자가 채팅 접근 시 | 관리자가 스크립트 실행 시 |
| **대상** | 접근한 채팅방만 | 모든 승인된 계약 |
| **수동 작업** | 불필요 | 스크립트 실행 1회 |
| **권장 시나리오** | 일반 운영 | 초기 배포 |

---

## 🎯 권장 사용법

### 1. 채팅 기능 **처음 배포** 시
```bash
# 1단계: DB 마이그레이션
mysql -u root -p ezstay < migrations/create_chat_rooms_table.sql

# 2단계: 기존 계약 채팅방 일괄 생성
node scripts/createChatRoomsForExistingContracts.js

# 3단계: 서버 시작
npm run dev
```

### 2. 이후 **일반 운영**
- 새로운 계약 승인 시 → 자동 생성됨 (approveContract 함수)
- 사용자가 채팅 접근 시 → 없으면 자동 생성됨 (getChatRoomByContractId 함수)

---

## 🔍 동작 확인 방법

### 1. 채팅방 목록 확인
```bash
# MySQL에서 확인
mysql -u root -p ezstay
SELECT * FROM chat_rooms;
```

### 2. Firestore 확인
Firebase Console → Firestore Database → `chatRooms` 컬렉션

### 3. API로 확인
```bash
# 내 채팅방 목록 조회
curl -X GET http://localhost:8080/api/chats/rooms \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

---

## ⚠️ 주의사항

### 1. 스크립트 실행 전 확인
- ✅ Firebase 환경변수가 설정되어 있는지 확인
- ✅ DB 마이그레이션이 완료되었는지 확인
- ✅ 서버가 실행 중이면 잠시 중단

### 2. 중복 실행 방지
스크립트는 **이미 채팅방이 있는 계약은 건너뜁니다**.
안전하게 여러 번 실행해도 괜찮습니다.

### 3. 완료된 계약
- `COMPLETED` 상태의 계약도 채팅방이 생성됩니다
- 단, `isActive: false`로 설정되어 읽기 전용입니다

---

## 🐛 문제 해결

### Q1. 스크립트 실행 시 Firebase 에러
```
❌ Firebase Admin SDK 초기화 실패
```

**해결책**:
- `.env` 파일에 Firebase 환경변수가 있는지 확인
- `FIREBASE_PROJECT_ID`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL`

### Q2. 일부 계약만 실패
```
✗ 계약 ID 5 처리 실패: Cannot read property 'name' of null
```

**원인**: 계약과 연결된 Room, Host, Guest 정보가 없음

**해결책**: DB에서 해당 계약의 외래키 확인

### Q3. 자동 생성이 안 됨
```
GET /api/chats/contracts/123/room
→ 404 Not Found
```

**원인**: 계약이 승인 상태가 아님

**확인**:
```sql
SELECT id, status FROM contracts WHERE id = 123;
```

---

## 📝 요약

### 결론: 두 가지 방법 모두 구현됨!

1. **자동 생성** (권장): 사용자가 채팅 접근 시 자동으로 생성
   - API: `GET /api/chats/contracts/:contractId/room`

2. **일괄 생성**: 관리자가 스크립트 실행
   - 명령어: `node scripts/createChatRoomsForExistingContracts.js`

### 추천 방법
- 초기 배포: **일괄 생성 스크립트** 1회 실행
- 이후 운영: **자동 생성** 활용 (사용자 접근 시)

이제 기존 승인된 계약들도 채팅방을 사용할 수 있습니다! 🎉
