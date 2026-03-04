# 채팅 알림톡 연동 가이드 (프론트엔드)

## 개요
채팅 메시지 발송 시 상대방이 읽지 않았으면 카카오 알림톡을 보냅니다.
5분 내 중복 알림은 자동 차단됩니다.

## API 2개

### 1. 메시지 알림 요청 — `POST /api/chats/rooms/:chatRoomId/notify`

**호출 시점**: Firebase에 메시지를 write한 직후

```javascript
// 메시지 전송 후 호출
await firebase.database().ref(`chatRooms/${chatRoomId}/messages`).push(messageData);

// 백엔드에 알림 요청 (fire-and-forget)
fetch(`/api/chats/rooms/${chatRoomId}/notify`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  }
}).catch(() => {}); // 실패해도 무시
```

**파라미터**: 없음 (chatRoomId는 URL path, 발신자는 JWT에서 자동 추출)

**응답 예시**:
```json
// 알림톡 발송됨
{ "success": true, "data": { "sent": true, "skipped": false }, "message": "채팅 알림 처리 완료" }

// 상대방이 현재 채팅방 보고 있어서 skip
{ "success": true, "data": { "sent": false, "skipped": true, "reason": "currently_reading" }, "message": "채팅 알림 처리 완료" }

// 5분 이내 이미 알림 보내서 skip
{ "success": true, "data": { "sent": false, "skipped": true, "reason": "within_window" }, "message": "채팅 알림 처리 완료" }
```

---

### 2. 채팅방 읽음 처리 — `POST /api/chats/rooms/:chatRoomId/read`

**호출 시점**:
- 채팅방 화면 진입 시 (1회)
- 앱이 백그라운드 → 포그라운드 복귀 시 (채팅방 화면이면)
- (선택) 주기적 heartbeat (30초~1분 간격)

```javascript
// 채팅방 진입 시
useEffect(() => {
  // 읽음 처리
  fetch(`/api/chats/rooms/${chatRoomId}/read`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}` }
  }).catch(() => {});

  // (선택) 30초 heartbeat - 채팅방에 머무는 동안 상대방 알림 차단
  const interval = setInterval(() => {
    fetch(`/api/chats/rooms/${chatRoomId}/read`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}` }
    }).catch(() => {});
  }, 30000);

  return () => clearInterval(interval);
}, [chatRoomId]);
```

**파라미터**: 없음

**응답 예시**:
```json
{ "success": true, "data": { "read": true }, "message": "읽음 처리 완료" }
```

---

## 동작 흐름

```
[A가 메시지 전송]
    │
    ├─ Firebase에 메시지 write
    │
    └─ POST /api/chats/rooms/{id}/notify
         │
         ├─ B가 채팅방 열고 있음? (read 타임스탬프 10초 이내)
         │   └─ YES → skip (알림 안 보냄)
         │
         ├─ 5분 이내 이미 알림 보냄?
         │   └─ YES → skip
         │
         └─ 알림톡 발송 → B에게 카카오톡 알림
              └─ 5분 타이머 시작 (이후 메시지는 skip)


[B가 채팅방 진입]
    │
    └─ POST /api/chats/rooms/{id}/read
         └─ Redis에 읽음 시간 기록
              └─ 이후 A가 메시지 보내도 B가 보고 있으므로 알림 안 감
```

## 주의사항

1. **notify API는 실패해도 무시**: 알림톡은 부가 기능이므로 `.catch(() => {})` 처리
2. **read API도 실패해도 무시**: 최악의 경우 알림이 한 번 더 갈 뿐
3. **chatRoomId는 Firebase ID**: `chat_contract_123` 형식의 firebaseChatRoomId 사용
4. **인증 필수**: 두 API 모두 `Authorization: Bearer {accessToken}` 헤더 필요
5. **heartbeat는 선택**: 없어도 동작하지만, 있으면 "보고 있는데 알림 오는" 상황 방지
