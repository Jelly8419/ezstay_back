# 채팅 API 문서 (Firebase 연동)

> 계약 승인된 호스트와 게스트 간의 실시간 채팅 기능
>
> **구현 완료일**: 2025-10-25
> **Firebase Firestore 연동**

---

## 📌 개요

### 아키텍처
- **백엔드 (MySQL)**: 채팅방 메타데이터 관리
- **Firebase Firestore**: 실시간 메시지 저장 및 전송
- **Firebase Authentication**: Custom Token 기반 인증

### 채팅방 생성 시점
- 호스트가 계약을 **승인(APPROVED)**할 때 자동 생성
- 계약 ID 1개당 채팅방 1개 (1:1 관계)

---

## 🔐 인증 플로우

### 1. Firebase Custom Token 발급 (백엔드)

**Endpoint**: `GET /api/chats/custom-token`

**Request Headers**:
```http
Authorization: Bearer {accessToken}
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "customToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
    "uid": "123"
  },
  "message": "Firebase Custom Token 발급 성공"
}
```

### 2. Firebase 로그인 (프론트엔드)

```javascript
import { getAuth, signInWithCustomToken } from 'firebase/auth';

const auth = getAuth();
await signInWithCustomToken(auth, customToken);
```

---

## 📡 API 엔드포인트

### 1. 채팅방 생성 (수동)

**Endpoint**: `POST /api/chats/rooms`

**설명**: 계약 승인 시 자동 생성되지만, 수동으로도 생성 가능

**Request Headers**:
```http
Authorization: Bearer {accessToken}
Content-Type: application/json
```

**Request Body**:
```json
{
  "contractId": 123
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "chatRoom": {
      "id": 1,
      "contractId": 123,
      "firebaseChatRoomId": "contract_123",
      "hostId": 10,
      "guestId": 20,
      "roomId": 5,
      "isActive": true,
      "lastMessageAt": null,
      "createdAt": "2025-10-25T10:00:00Z",
      "updatedAt": "2025-10-25T10:00:00Z"
    },
    "firebaseChatRoomId": "contract_123"
  },
  "message": "채팅방 생성 성공"
}
```

**Error Responses**:
- `400`: 계약이 승인 상태가 아님
- `404`: 계약을 찾을 수 없음

---

### 2. 내 채팅방 목록 조회

**Endpoint**: `GET /api/chats/rooms`

**Request Headers**:
```http
Authorization: Bearer {accessToken}
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "chatRooms": [
      {
        "id": 1,
        "contractId": 123,
        "firebaseChatRoomId": "contract_123",
        "hostId": 10,
        "guestId": 20,
        "roomId": 5,
        "isActive": true,
        "lastMessageAt": "2025-10-25T12:30:00Z",
        "createdAt": "2025-10-25T10:00:00Z",
        "updatedAt": "2025-10-25T12:30:00Z",
        "contract": {
          "id": 123,
          "status": "APPROVED",
          "checkInDate": "2025-11-01T15:00:00Z",
          "checkOutDate": "2025-11-10T11:00:00Z"
        },
        "room": {
          "id": 5,
          "name": "강남역 원룸",
          "roadAddress": "서울시 강남구 강남대로 123"
        },
        "host": {
          "id": 10,
          "name": "김호스트",
          "email": "host@example.com",
          "profileImageUrl": "https://..."
        },
        "guest": {
          "id": 20,
          "name": "이게스트",
          "email": "guest@example.com",
          "profileImageUrl": "https://..."
        },
        "lastMessage": "안녕하세요!",
        "unreadCount": 2
      }
    ],
    "total": 1
  },
  "message": "채팅방 목록 조회 성공"
}
```

---

### 3. 채팅방 상세 정보 조회

**Endpoint**: `GET /api/chats/rooms/:chatRoomId`

**URL Parameters**:
- `chatRoomId`: Firebase 채팅방 ID (예: `contract_123`)

**Request Headers**:
```http
Authorization: Bearer {accessToken}
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "chatRoom": {
      "id": 1,
      "contractId": 123,
      "firebaseChatRoomId": "contract_123",
      "hostId": 10,
      "guestId": 20,
      "roomId": 5,
      "isActive": true,
      "contract": {
        "id": 123,
        "status": "APPROVED",
        "checkInDate": "2025-11-01T15:00:00Z",
        "checkOutDate": "2025-11-10T11:00:00Z",
        "totalUsageFee": 500000
      },
      "room": {
        "id": 5,
        "name": "강남역 원룸",
        "roadAddress": "서울시 강남구 강남대로 123",
        "detailAddress": "101호"
      },
      "host": {
        "id": 10,
        "name": "김호스트",
        "email": "host@example.com",
        "profileImageUrl": "https://...",
        "phoneNumber": "010-1234-5678"
      },
      "guest": {
        "id": 20,
        "name": "이게스트",
        "email": "guest@example.com",
        "profileImageUrl": "https://...",
        "phoneNumber": "010-9876-5432"
      }
    },
    "metadata": {
      "contractId": 123,
      "hostId": 10,
      "guestId": 20,
      "isActive": true,
      "lastMessageText": "안녕하세요!",
      "lastMessageSenderId": 20,
      "lastMessageAt": {
        "_seconds": 1729851000,
        "_nanoseconds": 0
      },
      "unreadCount": {
        "10": 2,
        "20": 0
      }
    }
  },
  "message": "채팅방 상세 정보 조회 성공"
}
```

**Error Responses**:
- `403`: 권한 없음 (호스트 또는 게스트가 아님)
- `404`: 채팅방을 찾을 수 없음

---

### 4. 계약별 채팅방 조회

**Endpoint**: `GET /api/chats/contracts/:contractId/room`

**URL Parameters**:
- `contractId`: 계약 ID

**Request Headers**:
```http
Authorization: Bearer {accessToken}
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "chatRoom": {
      "id": 1,
      "contractId": 123,
      "firebaseChatRoomId": "contract_123",
      "hostId": 10,
      "guestId": 20,
      "roomId": 5,
      "isActive": true,
      "contract": { ... },
      "room": { ... },
      "host": { ... },
      "guest": { ... }
    }
  },
  "message": "채팅방 조회 성공"
}
```

**Error Responses**:
- `403`: 권한 없음
- `404`: 채팅방이 없음

---

## 🔥 Firestore 데이터 구조

### Collection: `chatRooms`

**Document ID**: `contract_123` (계약 ID 기반)

```javascript
{
  contractId: 123,
  hostId: 10,
  guestId: 20,
  roomId: 5,
  roomInfo: {
    name: "강남역 원룸",
    address: "서울시 강남구 강남대로 123"
  },
  hostInfo: {
    id: 10,
    name: "김호스트",
    profileImageUrl: "https://..."
  },
  guestInfo: {
    id: 20,
    name: "이게스트",
    profileImageUrl: "https://..."
  },
  checkInDate: Timestamp,
  checkOutDate: Timestamp,
  isActive: true,
  lastMessageText: "안녕하세요!",
  lastMessageSenderId: 20,
  lastMessageAt: Timestamp,
  unreadCount: {
    10: 2,  // 호스트 읽지 않은 메시지
    20: 0   // 게스트 읽지 않은 메시지
  },
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

### SubCollection: `messages`

**Path**: `chatRooms/{chatRoomId}/messages`

**Document 예시**:
```javascript
{
  senderId: 20,
  senderName: "이게스트",
  senderProfileImageUrl: "https://...",
  text: "안녕하세요! 입주 날짜 확인 부탁드립니다.",
  imageUrl: null,  // 이미지 메시지인 경우
  read: false,
  timestamp: Timestamp,
  type: "text"  // "text" | "image" | "system"
}
```

---

## 🎯 프론트엔드 통합 가이드

### 1. Firebase 초기화

```javascript
// src/firebase/config.js
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "ezstay-864bc.firebaseapp.com",
  projectId: "ezstay-864bc",
  storageBucket: "ezstay-864bc.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
```

### 2. Firebase 로그인

```javascript
// src/services/chatService.js
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '../firebase/config';
import axios from 'axios';

export const loginToFirebase = async () => {
  try {
    // 1. 백엔드에서 Custom Token 발급
    const response = await axios.get('/api/chats/custom-token', {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('accessToken')}`
      }
    });

    const { customToken } = response.data.data;

    // 2. Firebase 로그인
    await signInWithCustomToken(auth, customToken);
    console.log('Firebase 로그인 성공');
  } catch (error) {
    console.error('Firebase 로그인 실패:', error);
    throw error;
  }
};
```

### 3. 실시간 메시지 수신

```javascript
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';

export const listenToMessages = (chatRoomId, callback) => {
  const messagesRef = collection(db, `chatRooms/${chatRoomId}/messages`);
  const q = query(messagesRef, orderBy('timestamp', 'asc'));

  // 실시간 리스너 등록
  const unsubscribe = onSnapshot(q, (snapshot) => {
    const messages = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toDate()
    }));

    callback(messages);
  });

  // 컴포넌트 언마운트 시 리스너 해제
  return unsubscribe;
};
```

### 4. 메시지 전송

```javascript
import { collection, addDoc, serverTimestamp, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

export const sendMessage = async (chatRoomId, senderId, senderName, text) => {
  try {
    // 메시지 추가
    await addDoc(collection(db, `chatRooms/${chatRoomId}/messages`), {
      senderId,
      senderName,
      senderProfileImageUrl: null,
      text,
      imageUrl: null,
      read: false,
      timestamp: serverTimestamp(),
      type: 'text'
    });

    // 채팅방 메타데이터 업데이트
    const chatRoomRef = doc(db, 'chatRooms', chatRoomId);
    await updateDoc(chatRoomRef, {
      lastMessageText: text,
      lastMessageSenderId: senderId,
      lastMessageAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    console.log('메시지 전송 성공');
  } catch (error) {
    console.error('메시지 전송 실패:', error);
    throw error;
  }
};
```

### 5. React 컴포넌트 예시

```jsx
import React, { useState, useEffect } from 'react';
import { listenToMessages, sendMessage } from '../services/chatService';

const ChatRoom = ({ chatRoomId, currentUserId, currentUserName }) => {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');

  useEffect(() => {
    // 실시간 메시지 리스너 등록
    const unsubscribe = listenToMessages(chatRoomId, (newMessages) => {
      setMessages(newMessages);
    });

    // 컴포넌트 언마운트 시 리스너 해제
    return () => unsubscribe();
  }, [chatRoomId]);

  const handleSend = async () => {
    if (!inputText.trim()) return;

    await sendMessage(chatRoomId, currentUserId, currentUserName, inputText);
    setInputText('');
  };

  return (
    <div className="chat-room">
      <div className="messages">
        {messages.map(msg => (
          <div
            key={msg.id}
            className={msg.senderId === currentUserId ? 'my-message' : 'other-message'}
          >
            <p>{msg.text}</p>
            <span>{msg.timestamp?.toLocaleString()}</span>
          </div>
        ))}
      </div>

      <div className="input-area">
        <input
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSend()}
          placeholder="메시지를 입력하세요..."
        />
        <button onClick={handleSend}>전송</button>
      </div>
    </div>
  );
};

export default ChatRoom;
```

---

## 🔒 보안 설정

### Firestore Security Rules

Firebase Console → Firestore Database → 규칙

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // 채팅방 접근 권한: 호스트 또는 게스트만
    match /chatRooms/{chatRoomId} {
      allow read, write: if request.auth != null &&
        (resource.data.hostId == int(request.auth.uid) ||
         resource.data.guestId == int(request.auth.uid));
    }

    // 메시지 접근 권한
    match /chatRooms/{chatRoomId}/messages/{messageId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }
  }
}
```

### Firestore 인덱스

Firebase Console → Firestore Database → 색인

**필수 복합 인덱스**:
1. Collection: `chatRooms`
   - `hostId` (오름차순) + `updatedAt` (내림차순)
   - `guestId` (오름차순) + `updatedAt` (내림차순)

---

## 🗄️ MySQL 데이터베이스

### `chat_rooms` 테이블

```sql
CREATE TABLE chat_rooms (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  contract_id INT NOT NULL UNIQUE,
  firebase_chat_room_id VARCHAR(100) NOT NULL UNIQUE,
  host_id INT NOT NULL,
  guest_id INT NOT NULL,
  room_id INT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_message_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE,
  FOREIGN KEY (host_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (guest_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);
```

---

## 📊 채팅방 생성 플로우

```
[게스트] 계약 요청
    ↓
[호스트] 계약 승인 (PATCH /api/contracts/:contractId/approve)
    ↓
[백엔드] 자동 채팅방 생성
    ├─ MySQL: chat_rooms 레코드 생성
    └─ Firestore: chatRooms/{contract_id} 문서 생성
    ↓
[게스트/호스트] 채팅방 접근 가능
    ├─ GET /api/chats/custom-token (Custom Token 발급)
    ├─ Firebase signInWithCustomToken()
    └─ Firestore 실시간 메시지 송수신
```

---

## ⚠️ 주의사항

### 1. Firebase Custom Token
- **유효기간**: 1시간
- 만료 시 재발급 필요: `GET /api/chats/custom-token`

### 2. 채팅방 활성화 상태
- 계약 완료/취소 시 `isActive: false`로 변경
- 비활성 채팅방도 조회는 가능 (읽기 전용)

### 3. 메시지 저장
- Firestore에만 저장 (MySQL에는 저장 안 함)
- 마지막 메시지 정보만 MySQL `last_message_at`에 동기화

### 4. 권한 검증
- 모든 채팅 API는 JWT 인증 필수
- 채팅방 접근은 호스트 또는 게스트만 가능

---

## 🚀 배포 체크리스트

- [ ] Firebase 프로젝트 생성
- [ ] Firestore Database 활성화 (서울 리전)
- [ ] Firebase Authentication 활성화
- [ ] Firestore Security Rules 설정
- [ ] Firestore 복합 인덱스 생성
- [ ] 환경변수 설정 (FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL)
- [ ] MySQL 마이그레이션 실행
- [ ] 백엔드 서버 재시작
- [ ] 프론트엔드 Firebase SDK 설치 및 설정

---

## 📚 참고 자료

- [Firebase 공식 문서](https://firebase.google.com/docs)
- [Firestore 시작하기](https://firebase.google.com/docs/firestore)
- [Firebase Authentication](https://firebase.google.com/docs/auth)
- [Custom Token 생성](https://firebase.google.com/docs/auth/admin/create-custom-tokens)

---

**문서 버전**: 1.0.0
**최종 수정일**: 2025-10-25
**작성자**: Claude Code Assistant
