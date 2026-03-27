# 인증 API 변경 스펙 (프론트엔드 전달용)

> 작성일: 2026-03-27
> 변경 사유: 세션 테이블 도입 — 기기별 다중 세션 관리 방식으로 전환

---

## 변경 요약

| API | 변경 여부 | 변경 내용 |
|-----|----------|----------|
| `POST /api/auth/login` | ✅ 응답 동일 | 내부 구조 변경 (프론트 영향 없음) |
| `POST /api/auth/register` | ✅ 응답 동일 | 내부 구조 변경 (프론트 영향 없음) |
| `POST /api/auth/refresh` | ✅ 응답 동일 | 내부 구조 변경 (프론트 영향 없음) |
| `POST /api/auth/logout` | ⚠️ **요청 변경** | body에 `refreshToken` 추가 권장 |
| `POST /api/auth/kakao` | ✅ 응답 동일 | 내부 구조 변경 (프론트 영향 없음) |

---

## 변경된 API 상세

### `POST /api/auth/logout` — 요청 방식 변경

#### 기존 방식
```http
POST /api/auth/logout
Authorization: Bearer {accessToken}
```
- body 없음
- 동작: DB의 refreshToken 컬럼을 null로 초기화

#### 변경 방식
```http
POST /api/auth/logout
Authorization: Bearer {accessToken}
Content-Type: application/json

{
  "refreshToken": "현재 기기의 refreshToken"
}
```
- `refreshToken`을 함께 보내면 → **현재 기기 세션만** 삭제 (다른 기기 유지)
- `refreshToken`을 생략하면 → **해당 계정의 모든 세션** 삭제 (전체 로그아웃)

#### 응답 (변경 없음)
```json
{
  "success": true,
  "message": "로그아웃이 완료되었습니다.",
  "data": null
}
```

#### 프론트 권장 구현
```js
// 현재 기기만 로그아웃 (일반 로그아웃)
await axios.post('/api/auth/logout', {
  refreshToken: localStorage.getItem('refreshToken')
}, {
  headers: { Authorization: `Bearer ${accessToken}` }
});

// 전체 기기 로그아웃 (보안상 필요 시)
await axios.post('/api/auth/logout', {}, {
  headers: { Authorization: `Bearer ${accessToken}` }
});
```

---

## 변경 없는 API (참고용)

### `POST /api/auth/login`

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123",
  "user_mode": "guest"  // optional: "guest" | "host"
}
```

```json
{
  "success": true,
  "data": {
    "user": {
      "id": 1,
      "email": "user@example.com",
      "name": "홍길동",
      "nickname": "길동",
      "profileImageUrl": null,
      "userType": "local",
      "userMode": "guest",
      "phoneVerified": true,
      "hasBank": false
    },
    "accessToken": "eyJ...",
    "refreshToken": "eyJ..."
  },
  "message": "로그인이 완료되었습니다."
}
```

> `accessToken`: 유효기간 1시간 (기본값)
> `refreshToken`: 유효기간 14일 (기본값)

---

### `POST /api/auth/refresh`

```http
POST /api/auth/refresh
Content-Type: application/json

{
  "refreshToken": "eyJ..."
}
```

```json
{
  "success": true,
  "data": {
    "accessToken": "eyJ...(새 토큰)",
    "refreshToken": "eyJ...(새 토큰)"
  }
}
```

> **중요**: refreshToken도 매번 새로 발급됩니다. 응답의 새 refreshToken으로 저장값을 갱신하세요.

---

### `POST /api/auth/kakao`

```http
POST /api/auth/kakao
Content-Type: application/json

{
  "code": "카카오_인증코드",
  "user_mode": "guest"  // optional
}
```

응답 구조는 `/api/auth/login`과 동일합니다.

---

## 다중 기기 동작 방식 (참고)

| 상황 | 기존 동작 | 변경 후 동작 |
|------|----------|-------------|
| 기기A 로그인 상태에서 기기B 로그인 | 기기A refreshToken 무효화 | 기기A, B 모두 유효 |
| 기기B에서 로그아웃 | 모든 세션 만료 | 기기B 세션만 삭제, 기기A 유지 |
| 보안 위협 감지 시 전체 로그아웃 | 재로그인으로 덮어씌움 | body 없이 logout 호출 |

---

## 프론트 토큰 관리 권장 패턴

```js
// 로그인 시
const { accessToken, refreshToken } = response.data;
localStorage.setItem('accessToken', accessToken);
localStorage.setItem('refreshToken', refreshToken);

// accessToken 만료 시 갱신
const { accessToken: newAccess, refreshToken: newRefresh } = await refreshTokenAPI();
localStorage.setItem('accessToken', newAccess);
localStorage.setItem('refreshToken', newRefresh); // ← 반드시 갱신

// 로그아웃 시
await logoutAPI({ refreshToken: localStorage.getItem('refreshToken') });
localStorage.removeItem('accessToken');
localStorage.removeItem('refreshToken');
```
