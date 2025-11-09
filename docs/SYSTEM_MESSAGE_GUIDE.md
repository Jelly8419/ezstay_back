# 시스템 메시지 기능 가이드

## 개요
채팅방에서 호스트-게스트 대화 중간에 계약 상태 변경, 체크인/체크아웃 알림 등을 시스템 메시지로 자동 발송하는 기능입니다.

## 시스템 메시지 구조

### Firestore 메시지 형식
```javascript
{
  id: "msg_auto_generated",
  chatRoomId: "contract_123",
  senderId: null,              // 시스템 메시지는 발신자 없음
  senderName: "시스템",
  text: "계약이 승인되었습니다 🎉\n체크인: 2025-10-25",
  type: "system",              // 일반 메시지는 "user"
  systemMessageType: "contract_approved",
  metadata: {
    contractId: 123,
    checkInDate: "2025-10-25",
    checkOutDate: "2025-10-27"
  },
  createdAt: Timestamp,
  readBy: []
}
```

### 일반 사용자 메시지와의 차이
| 구분 | 일반 메시지 | 시스템 메시지 |
|------|-----------|------------|
| `type` | `"user"` | `"system"` |
| `senderId` | 호스트 또는 게스트 ID | `null` |
| `senderName` | 사용자 이름 | `"시스템"` |
| `systemMessageType` | 없음 | 메시지 타입 상수 |
| `metadata` | 없음 | 관련 데이터 |

## 시스템 메시지 타입

### 계약 관련
| 타입 | 상수 | 발송 시점 | 메시지 내용 |
|------|------|---------|-----------|
| **계약 승인** | `contract_approved` | 호스트가 계약 승인 시 | "계약이 승인되었습니다 🎉<br>체크인: {날짜}" |
| **계약 거절** | `contract_rejected` | 호스트가 계약 거절 시 | "계약이 거절되었습니다.<br>사유: {사유}" |
| **계약 취소** | `contract_canceled` | 게스트가 계약 취소 시 | "계약이 취소되었습니다 ❌" |
| **결제 완료** | `payment_completed` | 게스트 결제 완료 시 | "결제가 완료되었습니다 💳<br>금액: {금액}원" |
| **계약 완료** | `contract_completed` | 체크아웃 완료 시 | "계약이 완료되었습니다 ✅<br>이용해주셔서 감사합니다!" |

### 체크인/체크아웃
| 타입 | 상수 | 발송 시점 | 메시지 내용 |
|------|------|---------|-----------|
| **체크인 알림** | `check_in_reminder` | 체크인 D-1 (매일 오전 9시) | "내일 체크인 예정입니다 🏠<br>시간을 확인해주세요!" |
| **체크아웃 알림** | `check_out_reminder` | 체크아웃 D-1 (매일 오전 9시) | "내일 체크아웃 예정입니다 👋<br>짐을 준비해주세요!" |
| **체크인 완료** | `check_in_completed` | 체크인 완료 시 | "체크인이 완료되었습니다 ✅" |
| **체크아웃 완료** | `check_out_completed` | 체크아웃 완료 시 | "체크아웃이 완료되었습니다 👋<br>이용해주셔서 감사합니다!" |

### 기타 알림
| 타입 | 상수 | 발송 시점 | 메시지 내용 |
|------|------|---------|-----------|
| **중요 공지** | `important_notice` | 관리자/호스트가 직접 발송 | 사용자 정의 메시지 |
| **리뷰 요청** | `review_request` | 체크아웃 완료 후 | "숙소 이용은 어떠셨나요?<br>리뷰를 남겨주시면 큰 도움이 됩니다 ⭐" |
| **환불 완료** | `refund_completed` | 환불 처리 완료 시 | "환불이 완료되었습니다<br>금액: {금액}원" |

## 자동 발송 시나리오

### 1. 계약 승인 시 (approveContract)
```
호스트가 계약 승인
→ 채팅방 자동 생성
→ 시스템 메시지 발송: "계약이 승인되었습니다 🎉"
```

### 2. 계약 거절 시 (rejectContract)
```
호스트가 계약 거절
→ 채팅방 조회 (있으면)
→ 시스템 메시지 발송: "계약이 거절되었습니다"
```

### 3. 계약 취소 시 (cancelContractByGuest)
```
게스트가 계약 취소
→ 채팅방 조회 (있으면)
→ 시스템 메시지 발송: "계약이 취소되었습니다"
```

### 4. 체크인 D-1 알림 (스케줄러)
```
매일 오전 9시 실행
→ 내일 체크인 예정 계약 조회
→ 시스템 메시지 발송: "내일 체크인 예정입니다 🏠"
```

### 5. 체크아웃 D-1 알림 (스케줄러)
```
매일 오전 9시 실행
→ 내일 체크아웃 예정 계약 조회
→ 시스템 메시지 발송: "내일 체크아웃 예정입니다 👋"
```

### 6. 체크아웃 완료 후 (스케줄러)
```
매일 오전 9시 실행
→ 오늘 체크아웃 완료된 계약 조회
→ 시스템 메시지 1: "체크아웃이 완료되었습니다"
→ 3초 후 시스템 메시지 2: "리뷰를 남겨주시면 큰 도움이 됩니다 ⭐"
```

## 코드 사용법

### 1. 시스템 메시지 발송 (백엔드)
```javascript
const { sendSystemMessage } = require('../config/firebaseAdmin');
const { SystemMessageTypes, getSystemMessageTemplate } = require('../utils/systemMessageTypes');

// 기본 사용법
await sendSystemMessage(
  chatRoomId,
  '메시지 내용',
  SystemMessageTypes.CONTRACT_APPROVED,
  { contractId: 123 }
);

// 템플릿 사용
await sendSystemMessage(
  chatRoomId,
  getSystemMessageTemplate(SystemMessageTypes.CHECK_IN_REMINDER),
  SystemMessageTypes.CHECK_IN_REMINDER,
  { contractId: 123, checkInDate: '2025-10-25' }
);

// 커스텀 메시지
await sendSystemMessage(
  chatRoomId,
  '임시 공지: 내일 정기 점검이 있습니다.',
  SystemMessageTypes.IMPORTANT_NOTICE,
  { notice: '임시 공지' }
);
```

### 2. 시스템 메시지 렌더링 (Flutter 프론트엔드)
```dart
Widget buildMessage(Map<String, dynamic> message) {
  if (message['type'] == 'system') {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      margin: EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        color: Colors.grey[100],
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.info_outline, size: 16, color: Colors.grey[600]),
          SizedBox(width: 8),
          Flexible(
            child: Text(
              message['text'],
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Colors.grey[700],
                fontSize: 13,
                fontWeight: FontWeight.w500
              ),
            ),
          ),
        ],
      ),
    );
  }

  // 일반 사용자 메시지 렌더링
  return ChatBubble(message: message);
}
```

## 테스트 API

### 시스템 메시지 테스트 발송
**Endpoint**: `POST /api/chats/rooms/:chatRoomId/system-message`

**Request Body**:
```json
{
  "messageType": "contract_approved",  // 시스템 메시지 타입 (선택)
  "customText": "커스텀 메시지 내용",    // 직접 입력 (선택)
  "metadata": {                        // 추가 메타데이터 (선택)
    "contractId": 123,
    "checkInDate": "2025-10-25"
  }
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "message": {
      "id": "msg_auto_generated",
      "chatRoomId": "contract_123",
      "senderId": null,
      "senderName": "시스템",
      "text": "계약이 승인되었습니다 🎉\n체크인: 2025-10-25",
      "type": "system",
      "systemMessageType": "contract_approved",
      "metadata": { ... },
      "createdAt": { ... },
      "readBy": []
    },
    "chatRoomId": "contract_123"
  },
  "message": "시스템 메시지 발송 완료"
}
```

**예시 (cURL)**:
```bash
# 1. 계약 승인 메시지 테스트
curl -X POST http://localhost:8080/api/chats/rooms/contract_123/system-message \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "messageType": "contract_approved",
    "metadata": {
      "contractId": 123,
      "checkInDate": "2025-10-25"
    }
  }'

# 2. 커스텀 메시지 테스트
curl -X POST http://localhost:8080/api/chats/rooms/contract_123/system-message \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "customText": "테스트 시스템 메시지입니다."
  }'
```

## 스케줄러 설정

### 채팅 알림 스케줄러
**파일**: `schedulers/chatReminderScheduler.js`

**실행 주기**: 매일 오전 9시 (cron: `0 9 * * *`)

**동작**:
1. 체크인 D-1 알림 발송
2. 체크아웃 D-1 알림 발송
3. 체크아웃 완료 + 리뷰 요청 메시지 발송

**수동 실행** (서버 재시작 없이):
```javascript
const { runChatReminders } = require('./schedulers/chatReminderScheduler');
await runChatReminders();
```

**개발 모드**: `NODE_ENV=development` 시 서버 시작 즉시 1회 실행

## 주의사항

1. **채팅방 존재 확인**: 시스템 메시지는 채팅방이 생성된 후에만 발송됩니다.
   - 계약 승인 시: 채팅방 자동 생성 → 시스템 메시지 발송
   - 계약 거절/취소 시: 채팅방이 있을 때만 발송 (없으면 스킵)

2. **에러 처리**: 시스템 메시지 발송 실패해도 계약 처리는 정상 완료됩니다.
   ```javascript
   sendSystemMessage(...).catch(err => {
     console.error('시스템 메시지 발송 실패 (계약은 완료됨):', err);
   });
   ```

3. **Firestore 권한**: 백엔드는 Firebase Admin SDK로 메시지를 발송하므로 별도 권한 설정 불필요합니다.

4. **시간대**: 스케줄러는 서버 시간 기준으로 동작합니다. 한국 시간(KST)으로 설정되어 있는지 확인하세요.

## 트러블슈팅

### Q1. 시스템 메시지가 발송되지 않아요
**확인 사항**:
- Firebase Admin SDK 초기화 여부 확인
- 채팅방이 존재하는지 확인 (`ChatRoom` 테이블 조회)
- Firestore 규칙에서 메시지 쓰기 권한 확인

### Q2. 스케줄러가 실행되지 않아요
**확인 사항**:
- `server.js`에 `startChatReminderScheduler()` 호출 확인
- 서버 로그에서 `[스케줄러] 채팅 알림 스케줄러가 시작되었습니다` 메시지 확인
- cron 표현식 검증 (`0 9 * * *` = 매일 오전 9시)

### Q3. 메시지가 중복 발송돼요
**원인**: 스케줄러가 여러 번 등록되었거나 서버가 여러 인스턴스로 실행 중
**해결**: 서버 재시작 또는 스케줄러 중복 호출 확인

## 추가 개발 가이드

### 새로운 시스템 메시지 타입 추가
1. `utils/systemMessageTypes.js`에 상수 추가
2. `getSystemMessageTemplate()` 함수에 템플릿 추가
3. 필요한 컨트롤러에서 `sendSystemMessage()` 호출

**예시**:
```javascript
// utils/systemMessageTypes.js
const SystemMessageTypes = {
  // 기존 타입들...
  DEPOSIT_REFUNDED: 'deposit_refunded'  // 새 타입 추가
};

const getSystemMessageTemplate = (type, data = {}) => {
  const templates = {
    // 기존 템플릿들...
    [SystemMessageTypes.DEPOSIT_REFUNDED]: `보증금이 환불되었습니다\n금액: ${data.amount ? data.amount.toLocaleString() + '원' : '확인 필요'}`
  };
  return templates[type] || '시스템 메시지';
};
```

### 스케줄러 시간 변경
```javascript
// schedulers/chatReminderScheduler.js
cron.schedule('0 9 * * *', runChatReminders);  // 현재: 매일 오전 9시

// 예시: 매일 오전 8시로 변경
cron.schedule('0 8 * * *', runChatReminders);

// 예시: 매일 오전 9시, 오후 6시 (2회 실행)
cron.schedule('0 9,18 * * *', runChatReminders);
```

## 관련 파일
- **핵심 로직**: `config/firebaseAdmin.js` - `sendSystemMessage()`
- **타입 정의**: `utils/systemMessageTypes.js`
- **계약 통합**: `controllers/contractController.js`
- **스케줄러**: `schedulers/chatReminderScheduler.js`
- **테스트 API**: `controllers/chatController.js` - `sendTestSystemMessage()`
- **라우트**: `routes/chatRoutes.js`
