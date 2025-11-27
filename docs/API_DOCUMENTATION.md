# Ezstay API 문서

## 목차
- [인증 API](#인증-api)
  - [회원가입](#회원가입)
  - [로그인](#로그인)
  - [토큰 갱신](#토큰-갱신)
  - [로그아웃](#로그아웃)
  - [카카오 소셜 로그인](#카카오-소셜-로그인)
  - [프로필 조회](#프로필-조회)
- [사용자 관리 API](#사용자-관리-api)
  - [게스트 본인인증 정보 저장](#게스트-본인인증-정보-저장)
  - [호스트 본인인증 + 계좌정보 저장](#호스트-본인인증--계좌정보-저장)
  - [사용자 인증 상태 조회](#사용자-인증-상태-조회)
- [계좌 관리 API](#계좌-관리-api)
  - [계좌 실명 확인](#계좌-실명-확인)
  - [사용자 계좌 정보 조회](#사용자-계좌-정보-조회)
  - [계좌 정보 삭제](#계좌-정보-삭제)
- [게스트용 방 조회 API](#게스트용-방-조회-api)
  - [지도 영역 내 방 조회](#지도-영역-내-방-조회)
  - [방 목록 조회](#방-목록-조회)
  - [방 상세 정보 조회](#방-상세-정보-조회)
- [호스트 방 등록 API](#호스트-방-등록-api)
- [계약 관리 API](#계약-관리-api)
  - [계약 요청 생성](#계약-요청-생성)
  - [게스트 계약 목록 조회](#게스트-계약-목록-조회)
  - [호스트 계약 목록 조회](#호스트-계약-목록-조회)
  - [계약 상세 정보 조회](#계약-상세-정보-조회)
  - [계약 승인 (호스트)](#계약-승인-호스트)
  - [계약 거절 (호스트)](#계약-거절-호스트)
  - [계약 요청 취소 (게스트)](#계약-요청-취소-게스트)
- [채팅 API](#채팅-api)
  - [Firebase Custom Token 발급](#firebase-custom-token-발급)
  - [채팅방 생성](#채팅방-생성)
  - [내 채팅방 목록 조회](#내-채팅방-목록-조회)
  - [채팅방 상세 정보 조회](#채팅방-상세-정보-조회)
  - [계약 ID로 채팅방 조회](#계약-id로-채팅방-조회)
- [고객센터 API](#고객센터-api)
  - [공지사항 목록 조회](#공지사항-목록-조회)
  - [공지사항 상세 조회](#공지사항-상세-조회)
  - [FAQ 카테고리 목록 조회](#faq-카테고리-목록-조회)
  - [FAQ 목록 조회](#faq-목록-조회)
  - [FAQ 상세 조회](#faq-상세-조회)
  - [내 문의 목록 조회](#내-문의-목록-조회)
  - [내 문의 상세 조회](#내-문의-상세-조회)
  - [문의 등록](#문의-등록)
  - [문의 수정](#문의-수정)
  - [문의 삭제](#문의-삭제)
- [대여 물품 API](#대여-물품-api)
  - [대여 물품 목록 조회](#대여-물품-목록-조회)
  - [대여 물품 상세 조회](#대여-물품-상세-조회)
  - [대여 물품 통계 조회](#대여-물품-통계-조회)

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

## 프로필 조회
**GET** `/api/auth/profile`

현재 로그인한 사용자의 프로필 정보를 조회합니다.

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
  "data": {
    "id": 1,
    "email": "user@example.com",
    "name": "홍길동",
    "phoneNumber": "010-1234-5678",
    "profileImageUrl": "/uploads/profiles/user-1.jpg",
    "userType": "local",
    "userMode": "guest",
    "phoneVerified": true,
    "hasBank": false,
    "createdAt": "2025-01-01T00:00:00.000Z"
  }
}
```

### Response 필드 설명
| 필드 | 타입 | 설명 |
|------|------|------|
| id | number | 사용자 ID |
| email | string | 이메일 주소 |
| name | string \| null | 사용자 이름 (본인인증 후) |
| phoneNumber | string \| null | 전화번호 (본인인증 후) |
| profileImageUrl | string \| null | 프로필 이미지 URL |
| userType | string | 계정 타입 ("local" 또는 "social") |
| userMode | string | 사용자 모드 ("guest" 또는 "host") |
| phoneVerified | boolean | 본인인증 완료 여부 |
| hasBank | boolean | 계좌 등록 여부 |

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

# 사용자 관리 API

## 게스트 본인인증 정보 저장
**POST** `/api/user/guest/verification`

게스트 사용자의 본인인증 정보를 저장합니다.

### 인증
**필수** - Authorization 헤더에 Access Token 포함

### Request Body
| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| name | string | O | 본인인증된 이름 |
| birthDate | string | O | 생년월일 (YYYY-MM-DD) |
| phoneNumber | string | O | 전화번호 (010-1234-5678) |
| ci | string | O | 본인인증 CI 값 |
| di | string | O | 본인인증 DI 값 |

### Request Example
```json
{
  "name": "홍길동",
  "birthDate": "1990-01-01",
  "phoneNumber": "010-1234-5678",
  "ci": "본인인증CI값",
  "di": "본인인증DI값"
}
```

### Success Response (200)
```json
{
  "success": true,
  "message": "게스트 본인인증 정보가 저장되었습니다.",
  "data": {
    "phoneVerified": true
  }
}
```

### Error Responses

#### 필수 필드 누락 (400)
```json
{
  "success": false,
  "error": {
    "code": "MISSING_REQUIRED_FIELDS",
    "message": "필수 정보가 누락되었습니다."
  }
}
```

#### 이미 인증 완료 (400)
```json
{
  "success": false,
  "error": {
    "code": 4001,
    "message": "이미 본인인증이 완료되었습니다."
  }
}
```

---

## 호스트 본인인증 + 계좌정보 저장
**POST** `/api/user/host/verification`

호스트 사용자의 본인인증 정보와 계좌정보를 동시에 저장합니다.

### 인증
**필수** - Authorization 헤더에 Access Token 포함

### Request Body
| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| name | string | O | 본인인증된 이름 |
| birthDate | string | O | 생년월일 (YYYY-MM-DD) |
| phoneNumber | string | O | 전화번호 (010-1234-5678) |
| ci | string | O | 본인인증 CI 값 |
| di | string | O | 본인인증 DI 값 |
| bankAccount | object | O | 계좌 정보 객체 |
| bankAccount.bankName | string | O | 은행명 |
| bankAccount.accountNumber | string | O | 계좌번호 |
| bankAccount.accountHolder | string | O | 예금주명 |

### Request Example
```json
{
  "name": "김호스트",
  "birthDate": "1985-05-15",
  "phoneNumber": "010-9876-5432",
  "ci": "본인인증CI값",
  "di": "본인인증DI값",
  "bankAccount": {
    "bankName": "국민은행",
    "accountNumber": "123-456-789012",
    "accountHolder": "김호스트"
  }
}
```

### Success Response (200)
```json
{
  "success": true,
  "message": "호스트 본인인증 및 계좌 정보가 저장되었습니다.",
  "data": {
    "phoneVerified": true,
    "hasBank": true
  }
}
```

### Error Responses

#### 필수 필드 누락 (400)
```json
{
  "success": false,
  "error": {
    "code": "MISSING_REQUIRED_FIELDS",
    "message": "필수 정보가 누락되었습니다."
  }
}
```

#### 계좌 정보 누락 (400)
```json
{
  "success": false,
  "error": {
    "code": 4002,
    "message": "계좌 정보가 필요합니다."
  }
}
```

---

## 사용자 인증 상태 조회
**GET** `/api/user/verification`

현재 로그인한 사용자의 본인인증 및 계좌 등록 상태를 조회합니다.

### 인증
**필수** - Authorization 헤더에 Access Token 포함

### Success Response (200)
```json
{
  "success": true,
  "data": {
    "phoneVerified": true,
    "hasBank": true,
    "userMode": "host"
  }
}
```

### Response 필드 설명
| 필드 | 타입 | 설명 |
|------|------|------|
| phoneVerified | boolean | 본인인증 완료 여부 |
| hasBank | boolean | 계좌 등록 여부 |
| userMode | string | 현재 사용자 모드 ("guest" 또는 "host") |

---

# 계좌 관리 API

## 계좌 실명 확인
**POST** `/api/account/verify`

계좌 정보의 실명 일치 여부를 확인합니다. 회원가입 전후 모두 사용 가능합니다.

### 인증
**선택적** - 로그인 여부와 상관없이 사용 가능

### Request Body
| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| bankName | string | O | 은행명 |
| accountNumber | string | O | 계좌번호 |
| accountHolder | string | O | 예금주명 |
| birthDate | string | O | 생년월일 (YYYY-MM-DD) |

### Request Example
```json
{
  "bankName": "국민은행",
  "accountNumber": "123-456-789012",
  "accountHolder": "홍길동",
  "birthDate": "1990-01-01"
}
```

### Success Response (200)
```json
{
  "success": true,
  "message": "계좌 실명 확인이 완료되었습니다.",
  "data": {
    "verified": true,
    "accountHolder": "홍길동",
    "bankName": "국민은행"
  }
}
```

### Error Responses

#### 필수 필드 누락 (400)
```json
{
  "success": false,
  "error": {
    "code": "MISSING_REQUIRED_FIELDS",
    "message": "필수 정보가 누락되었습니다."
  }
}
```

#### 실명 불일치 (400)
```json
{
  "success": false,
  "error": {
    "code": 4010,
    "message": "계좌 실명 확인에 실패했습니다."
  }
}
```

---

## 사용자 계좌 정보 조회
**GET** `/api/account`

현재 로그인한 사용자의 등록된 계좌 정보를 조회합니다.

### 인증
**필수** - Authorization 헤더에 Access Token 포함

### Success Response (200)
```json
{
  "success": true,
  "data": {
    "id": 1,
    "bankName": "국민은행",
    "accountNumber": "123-456-789012",
    "accountHolder": "홍길동",
    "createdAt": "2025-01-01T00:00:00.000Z"
  }
}
```

### Error Responses

#### 계좌 정보 없음 (404)
```json
{
  "success": false,
  "error": {
    "code": 3001,
    "message": "등록된 계좌 정보가 없습니다."
  }
}
```

---

## 계좌 정보 삭제
**DELETE** `/api/account`

등록된 계좌 정보를 삭제합니다.

### 인증
**필수** - Authorization 헤더에 Access Token 포함

### Success Response (200)
```json
{
  "success": true,
  "message": "계좌 정보가 삭제되었습니다."
}
```

### Error Responses

#### 계좌 정보 없음 (404)
```json
{
  "success": false,
  "error": {
    "code": 3001,
    "message": "등록된 계좌 정보가 없습니다."
  }
}
```

---

# 게스트용 방 조회 API

## 방 목록 조회
**GET** `/api/rooms`

게스트가 조건에 맞는 방 목록을 조회합니다. `published` 상태인 방만 조회됩니다.

### 인증
인증 불필요 (공개 API)

### Query Parameters
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| checkInDate | string | X | 체크인 날짜 (YYYY-MM-DD) |
| checkOutDate | string | X | 체크아웃 날짜 (YYYY-MM-DD) |
| page | number | X | 페이지 번호 (기본값: 1) |
| limit | number | X | 페이지당 개수 (기본값: 20) |

### Request Example
```
GET /api/rooms?checkInDate=2025-02-01&checkOutDate=2025-02-10&page=1&limit=20
```

### Success Response (200)
```json
{
  "success": true,
  "message": "방 목록을 조회했습니다.",
  "data": {
    "total": 150,
    "page": 1,
    "limit": 20,
    "totalPages": 8,
    "rooms": [
      {
        "id": 1,
        "roomName": "홍대 넓은 원룸",
        "address": "서울특별시 마포구 서교동",
        "latitude": 37.5563,
        "longitude": 126.9236,
        "dailyRent": 50000,
        "area": 33.5,
        "roomCount": 1,
        "bathroomCount": 1,
        "buildingType": "오피스텔",
        "photos": [
          {
            "url": "/uploads/rooms/room-1-1.jpg",
            "order": 1
          },
          {
            "url": "/uploads/rooms/room-1-2.jpg",
            "order": 2
          }
        ],
        "discounts": {
          "quickMoveIn": 7,
          "quickMoveInDiscount": 5,
          "longTermWeeks": 4,
          "longTermDiscount": 10
        },
        "amenities": {
          "refrigerator": true,
          "washingMachine": true,
          "airConditioner": true
        }
      }
    ]
  }
}
```

---

## 방 상세 정보 조회
**GET** `/api/rooms/:id`

특정 방의 상세 정보를 조회합니다. `published` 상태인 방만 조회 가능하며, 보안상 민감정보는 제외됩니다.

### 인증
인증 불필요 (공개 API)

### URL Parameters
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| id | number | O | 방 ID |

### Success Response (200)
```json
{
  "success": true,
  "data": {
    "id": 1,
    "roomName": "홍대 넓은 원룸",
    "address": "서울특별시 마포구 서교동",
    "latitude": 37.5563,
    "longitude": 126.9236,
    "area": 33.5,
    "floor": "5층",
    "buildingType": "오피스텔",
    "parkingAvailable": true,
    "parkingInfo": "지하주차장 이용 가능",
    "elevatorAvailable": true,
    "roomCount": 1,
    "bathroomCount": 1,
    "isDuplex": false,
    "dailyRent": 50000,
    "longTermWeeks": 4,
    "longTermDiscount": 10,
    "dailyMaintenanceFee": 7000,
    "maintenanceDetail": "전기, 수도, 가스, 인터넷 포함",
    "cleaningFee": 30000,
    "minContractWeeks": 1,
    "refundPolicy": "입주 7일 전까지 100% 환불",
    "photos": [
      {
        "id": 1,
        "url": "/uploads/rooms/room-1.jpg",
        "order": 0
      }
    ],
    "amenity": {
      "basicOptions": {
        "refrigerator": true,
        "washingMachine": true,
        "airConditioner": true,
        "침대": {
          "킹": 2,
          "퀸": 0,
          "싱글": 1,
          "슈퍼싱글": 0
        }
      },
      "additionalOptions": {
        "doorLock": true,
        "cctv": true,
        "petsAllowed": false
      },
      "convenienceOptions": {
        "heatingCooling": true,
        "hairDryer": true
      }
    },
    "freeService": {
      "cleaningService": true,
      "hairDryerRental": true,
      "beddingService": true,
      "amenityKit": true,
      "towelSetRental": true
    },
    "description": "홍대입구역 도보 5분 거리의 깨끗한 원룸입니다.",
    "maxGuests": 4,
    "host": {
      "id": 123,
      "name": "김호스트",
      "profileImageUrl": "http://localhost:8080/uploads/profiles/host-profile.jpg"
    }
  }
}
```

### 보안 제외 필드
다음 필드는 게스트에게 노출되지 않습니다:
- `entrancePassword`: 출입 비밀번호
- `detailAddress`: 상세 주소
- `hostId`: 호스트 ID (대신 `host` 객체로 제공)
- `status`: 방 상태
- **`amenity.wifiPassword`**: 와이파이 비밀번호 (계약 전 제거됨)

### Error Responses

#### 방을 찾을 수 없음 (404)
```json
{
  "success": false,
  "error": {
    "code": "ROOM_NOT_FOUND",
    "message": "방을 찾을 수 없습니다."
  }
}
```

#### 게시되지 않은 방 (404)
```json
{
  "success": false,
  "error": {
    "code": 3002,
    "message": "게시되지 않은 방입니다."
  }
}
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
        "dailyRent": 350000,
        "area": 33.5,
        "roomCount": 1,
        "bathroomCount": 1,
        "buildingType": "오피스텔",
        "photos": [
          {
            "url": "/uploads/rooms/room-1234567890-1.jpg",
            "order": 1
          },
          {
            "url": "/uploads/rooms/room-1234567890-2.jpg",
            "order": 2
          }
          // ... 추가 사진들 (order 순서대로 정렬됨)
        ],  // 빈 배열 [] (사진이 없는 경우)
        "discounts": {
          "quickMoveIn": 7,  // 빠른 입주 가능일 (일 단위, 예: 7 = 7일 이내 입주 시 할인, null 가능)
          "quickMoveInDiscount": 5,  // 빠른 입주 할인율 (%) (숫자 또는 null)
          "longTermWeeks": 4,  // 장기 계약 기준 주수 (숫자 또는 null)
          "longTermDiscount": 10  // 장기 계약 할인율 (%) (숫자 또는 null)
        }
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
    "tv": "boolean",
    "internet": "boolean",
    "침대": {
      "킹": "number",
      "퀸": "number",
      "싱글": "number",
      "슈퍼싱글": "number"
    }
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
    "balcony": "boolean",
    "petsAllowed": "boolean"
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
  "wifiPassword": "string | null"
}
```

### 필드 설명
- `basicOptions`: 기본 편의시설 (JSON)
  - **침대**: 방에 실제로 있는 침대 사양 (중첩 객체)
    - 킹, 퀸, 싱글, 슈퍼싱글: 각 침대 타입별 개수
- `additionalOptions`: 추가 옵션 (JSON)
  - **petsAllowed**: 펫 가능 여부 (이전 버전의 최상위 필드에서 이동)
- `convenienceOptions`: 편의 옵션 (JSON)
- **wifiPassword**: 와이파이 비밀번호 (호스트가 게스트에게 제공)

### 예시 요청
```json
{
  "basicOptions": {
    "에어컨": true,
    "냉장고": true,
    "침대": {
      "킹": 2,
      "퀸": 0,
      "싱글": 1,
      "슈퍼싱글": 1
    }
  },
  "additionalOptions": {
    "petsAllowed": true,
    "doorLock": true
  },
  "convenienceOptions": {
    "heatingCooling": true,
    "hairDryer": true
  },
  "wifiPassword": "guest1234"
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

### 검증 규칙
- `침대` 객체의 키는 "킹", "퀸", "싱글", "슈퍼싱글"만 허용
- 침대 수량은 0 이상의 숫자여야 함
- 유효하지 않은 침대 사이즈 입력 시 400 에러 반환

---

## 5. 무료 부가서비스 설정
**PATCH** `/api/host/rooms/:roomId/free-services`

### Request Body
```json
{
  "cleaningService": "boolean",
  "hairDryerRental": "boolean",
  "beddingService": "boolean",
  "amenityKit": "boolean",
  "towelSetRental": "boolean",
  "autoPasswordChange": "boolean",
  "roomPassword": "string | null"
}
```

### 필드 설명
- `cleaningService`: 청소 서비스 제공 여부 (⚠️ `true`로 설정 시 `rooms.cleaning_fee`가 자동으로 0원으로 업데이트됨)
- `hairDryerRental`: 헤어드라이어 대여 여부
- `beddingService`: 침구류 제공 서비스 여부
- `amenityKit`: 어메니티 키트 제공 여부
- `towelSetRental`: 수건 세트 대여 여부
- `autoPasswordChange`: 자동 비밀번호 변경 여부
- `roomPassword`: 방 비밀번호

### 중요 사항
- **cleaningService 동작**: `cleaningService`를 `true`로 설정하면, 청소 서비스를 Ezstay에서 직접 제공하므로 호스트가 설정한 `cleaning_fee`는 자동으로 0원으로 업데이트됩니다.
- **캐시 무효화**: `cleaningService` 변경 시 지도 캐시가 자동으로 무효화됩니다.

### 예시 요청
```json
{
  "cleaningService": true,
  "hairDryerRental": false,
  "beddingService": true,
  "amenityKit": true,
  "towelSetRental": true,
  "autoPasswordChange": false,
  "roomPassword": "1234"
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

### ⚠️ 중요: 편의시설 vs 무료 부가서비스의 침대 구분
- **편의시설 (basicOptions.침대)**: 방에 **실제로 있는** 침대 사양
  - 예: "이 방에는 킹 침대 2개, 싱글 침대 1개가 있습니다"
- **무료 부가서비스 (bedSizes)**: **침구류 제공 서비스**를 위한 수량
  - 예: "킹 침대용 침구 2세트, 싱글 침대용 침구 1세트를 제공합니다"

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
  "maxGuests": "number (1~20, 필수)"
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
      "cleaningService": false,
      "hairDryerRental": false,
      "beddingService": false,
      "amenityKit": false,
      "towelSetRental": false,
      "autoPasswordChange": false,
      "roomPassword": null
    },
    "description": "string",
    "maxGuests": 2,
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
- `429`: Rate Limit 초과
- `500`: 서버 에러

---

# 계약 관리 API

모든 계약 관리 API는 JWT 인증이 필요합니다.

## 계약 상태값 (Contract Status)

| 상태값 | 설명 | 전이 가능 상태 |
|--------|------|---------------|
| `PENDING_APPROVAL` | 승인 대기 (게스트가 요청) | APPROVED, REJECTED, CANCELLED_BY_GUEST, APPROVAL_EXPIRED |
| `APPROVED` | 승인됨 (결제 대기) | PAYMENT_COMPLETED, CANCELLED_BY_GUEST, CANCELLED_BY_HOST, CANCELLED_BY_ADMIN_*, PAYMENT_EXPIRED |
| `REJECTED` | 거절됨 (호스트가 거절) | - (최종 상태) |
| `PAYMENT_COMPLETED` | 결제 완료 | IN_PROGRESS, CANCELLED_BY_GUEST, CANCELLED_BY_HOST, CANCELLED_BY_ADMIN_* |
| `IN_PROGRESS` | 계약 진행중 (체크인 완료) | COMPLETED, CANCELLED_BY_GUEST, CANCELLED_BY_HOST, CANCELLED_BY_ADMIN_* |
| `COMPLETED` | 계약 완료 (체크아웃 완료) | - (최종 상태) |
| `CANCELLED_BY_GUEST` | 게스트 취소 | REFUNDED |
| `CANCELLED_BY_HOST` | 호스트 취소 | REFUNDED |
| `CANCELLED_BY_ADMIN_WITH_REFUND` | 관리자 취소 (환불 O) | REFUNDED |
| `CANCELLED_BY_ADMIN_NO_REFUND` | 관리자 취소 (환불 X) | - (최종 상태) |
| `REFUNDED` | 환불 완료 | - (최종 상태) |
| `APPROVAL_EXPIRED` | 미승인 만료 | - (최종 상태) |
| `PAYMENT_EXPIRED` | 미결제 만료 | - (최종 상태) |

## 취소 유형 (Cancellation Type)

취소된 계약에 대해 추가 정보를 제공합니다.

| 취소 유형 | 설명 |
|-----------|------|
| `BEFORE_PAYMENT` | 결제 전 취소 (환불 대상 아님) |
| `AFTER_PAYMENT` | 결제 후 취소 (체크인 전, 환불 정책 적용) |
| `DURING_STAY` | 입실 중 취소 (조기 퇴실, 부분 환불 가능) |
| `AFTER_COMPLETION` | 완료 후 취소 (분쟁 등 특수 케이스) |

---

## 계약 요청 생성
**POST** `/api/contracts/request`

게스트가 호스트에게 계약 요청을 생성합니다.

### 비즈니스 컨텍스트
게스트가 마음에 드는 방을 찾고, 예약 가능 여부를 확인한 후, 호스트에게 계약 요청을 보냅니다.

### 전제 조건
- ✅ 로그인 완료 (JWT 토큰 필요)
- ✅ 게스트 본인인증 완료 (`/api/user/guest/verification`)
- ✅ 방이 `published` 상태
- ✅ 요청 기간에 다른 승인된 계약 없음

### 후속 작업
1. 호스트가 계약 요청 알림 수신
2. 호스트가 `/api/contracts/:contractId/approve` 또는 `reject` 호출
3. 승인 시 채팅방 자동 생성 (`/api/chats/rooms`)
4. 게스트가 결제 진행

### 인증
**필수** - Authorization 헤더에 Access Token 포함

### Request Body
| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| roomId | number | O | 방 ID |
| checkInDate | string | O | 체크인 날짜/시간 (YYYY-MM-DD HH:mm) |
| checkOutDate | string | O | 체크아웃 날짜/시간 (YYYY-MM-DD HH:mm) |
| totalDays | number | O | 총 숙박일수 |
| rentalFee | number | O | 임대료 |
| maintenanceFee | number | O | 관리비 |
| cleaningFee | number | O | 청소비 |
| rentalItemsFee | number | O | 대여 물품 비용 |
| platformFee | number | O | 플랫폼 수수료 |
| discountAmount | number | O | 할인 금액 |
| subtotal | number | O | 소계 |
| totalUsageFee | number | O | 총 이용료 |
| deposit | number | O | 보증금 |
| finalTotalAmount | number | O | 최종 결제 금액 |
| rentalItems | object | X | 대여 물품 정보 |
| guestMessage | string | X | 게스트 메시지 |
| discountCode | string | X | 할인 코드 |
| paymentMethod | string | O | 결제 수단 |
| installmentMonths | number | X | 할부 개월 수 |
| termsAgreed | object | O | 약관 동의 정보 |
| specialRequests | object | X | 특별 요청 사항 |
| pricingSnapshot | object | X | 가격 스냅샷 |

### Request Example
```json
{
  "roomId": 123,
  "checkInDate": "2025-12-18 15:00",
  "checkOutDate": "2026-01-18 11:00",
  "totalDays": 31,
  "rentalFee": 1000000,
  "maintenanceFee": 200000,
  "cleaningFee": 50000,
  "rentalItemsFee": 30000,
  "platformFee": 78000,
  "discountAmount": 50000,
  "subtotal": 1280000,
  "totalUsageFee": 1258000,
  "deposit": 300000,
  "finalTotalAmount": 1558000,
  "guestMessage": "오후 3시쯤 입주 예정입니다.",
  "paymentMethod": "CREDIT_CARD",
  "termsAgreed": {
    "serviceTerms": true,
    "cancellationPolicy": true,
    "refundPolicy": true
  }
}
```

### Success Response (201)
```json
{
  "success": true,
  "message": "계약 요청이 생성되었습니다.",
  "data": {
    "contractId": 1,
    "status": "PENDING_APPROVAL",
    "createdAt": "2025-01-11T10:00:00.000Z"
  }
}
```

### Error Responses

#### 방을 찾을 수 없음 (404)
```json
{
  "success": false,
  "error": {
    "code": "ROOM_NOT_FOUND",
    "message": "방을 찾을 수 없습니다."
  }
}
```

#### 이미 예약된 기간 (400)
```json
{
  "success": false,
  "error": {
    "code": 4201,
    "message": "해당 기간에 이미 예약이 있습니다."
  }
}
```

---

## 게스트 계약 목록 조회
**GET** `/api/contracts/guest?status=PENDING_APPROVAL`

게스트가 요청한 계약 목록을 조회합니다. **리스트에서는 최종 금액만 표시**되며, 상세 정보는 상세 페이지에서 확인할 수 있습니다.

### 인증
**필수** - Authorization 헤더에 Access Token 포함

### Query Parameters
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| status | string | X | 계약 상태 필터링 (PENDING_APPROVAL, APPROVED, REJECTED 등) |

### Success Response (200)
```json
{
  "success": true,
  "data": {
    "contracts": [
      {
        "id": 1,
        "orderId": "2501270001",
        "status": "PENDING_APPROVAL",
        "statusLabel": "승인 대기",
        "checkInDate": "2025-12-18T15:00:00+09:00",
        "checkOutDate": "2026-01-18T11:00:00+09:00",
        "totalDays": 31,
        "finalTotalAmount": 1558000,
        "room": {
          "id": 123,
          "roomName": "강남역 도보 3분 신축 원룸",
          "address": "서울 강남구 역삼동",
          "area": 33.0,
          "buildingType": "ONEROOM",
          "thumbnailUrl": "/uploads/rooms/room_123_1.jpg"
        },
        "host": {
          "id": 456,
          "name": "김호스트",
          "phoneNumber": "010-1234-5678"
        },
        "createdAt": "2025-01-27T10:00:00+09:00"
      }
    ]
  },
  "message": "계약 목록 조회 성공"
}
```

**💡 주요 변경사항** (v2.1.0):
- 리스트에서 금액 세부 내역 제거 (간소화)
- `finalTotalAmount`만 표시 (최종 결제 금액)
- 금액 상세 정보는 상세 페이지(`GET /api/contracts/:contractId`)에서 확인
- 응답 크기 약 40% 감소로 로딩 속도 향상

---

## 호스트 계약 목록 조회
**GET** `/api/contracts/host?status=PENDING_APPROVAL`

호스트가 받은 계약 요청 목록을 조회합니다. **수익 관리를 위해 금액 상세 정보를 모두 제공**합니다.

### 인증
**필수** - Authorization 헤더에 Access Token 포함

### Query Parameters
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| status | string | X | 계약 상태 필터링 |

### Success Response (200)
```json
{
  "success": true,
  "data": {
    "contracts": [
      {
        "id": 1,
        "orderId": "2501270001",
        "status": "PENDING_APPROVAL",
        "statusLabel": "승인 대기",
        "checkInDate": "2025-12-18T15:00:00+09:00",
        "checkOutDate": "2026-01-18T11:00:00+09:00",
        "totalDays": 31,
        "totalWeeks": 4,
        "rentalFee": 1000000,
        "maintenanceFee": 200000,
        "cleaningFee": 50000,
        "rentalItemsFee": 30000,
        "platformFee": 78000,
        "discountAmount": 50000,
        "discountType": "LONG_TERM_DISCOUNT",
        "discountCode": null,
        "subtotal": 1280000,
        "totalUsageFee": 1258000,
        "deposit": 300000,
        "finalTotalAmount": 1558000,
        "hostEarnings": 1180000,
        "rentalItems": {
          "airConditioner": { "quantity": 1, "dailyRate": 3000 }
        },
        "guestMessage": "오후 3시쯤 입주 예정입니다.",
        "room": {
          "id": 123,
          "roomName": "강남역 도보 3분 신축 원룸",
          "address": "서울 강남구 역삼동",
          "area": 33.0,
          "buildingType": "ONEROOM",
          "thumbnailUrl": "/uploads/rooms/room_123_1.jpg"
        },
        "guest": {
          "id": 789,
          "name": "이게스트",
          "phoneNumber": "010-9876-5432",
          "email": "guest@example.com"
        },
        "createdAt": "2025-01-27T10:00:00+09:00"
      }
    ]
  },
  "message": "계약 요청 목록 조회 성공"
}
```

**💡 주요 변경사항** (v2.1.0):
- `hostEarnings` 필드 추가: 호스트 실수령액 (totalUsageFee - platformFee)
- 모든 금액 정보 유지 (수익 관리용)
- 게스트 정보 상세 제공 (이메일 포함)

---

## 계약 상세 정보 조회
**GET** `/api/contracts/:contractId`

특정 계약의 상세 정보를 조회합니다. 호스트 또는 게스트만 조회 가능합니다.

### 인증
**필수** - Authorization 헤더에 Access Token 포함

### URL Parameters
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| contractId | number | O | 계약 ID |

### Success Response (200)
```json
{
  "success": true,
  "data": {
    "id": 1,
    "roomId": 123,
    "hostId": 5,
    "guestId": 10,
    "checkInDate": "2025-12-18T06:00:00.000Z",
    "checkOutDate": "2026-01-18T02:00:00.000Z",
    "totalDays": 31,
    "rentalFee": 1000000,
    "maintenanceFee": 200000,
    "cleaningFee": 50000,
    "rentalItemsFee": 30000,
    "platformFee": 78000,
    "discountAmount": 50000,
    "deposit": 300000,
    "finalTotalAmount": 1558000,
    "status": "APPROVED",
    "guestMessage": "오후 3시쯤 입주 예정입니다.",
    "hostMessage": null,
    "rentalItems": {
      "hair_dryer": { "itemId": 1, "quantity": 1, "price": 5000 }
    },
    "recommendedItems": {
      "items": [
        {
          "itemId": 1,
          "itemType": "hair_dryer",
          "name": "프리미엄 헤어드라이어",
          "quantity": 1,
          "price": 5000
        },
        {
          "itemId": 3,
          "itemType": "bedding_set",
          "name": "고급 침구 세트",
          "quantity": 2,
          "price": 15000
        }
      ],
      "recommendedBy": 5,
      "recommendedAt": "2025-01-27T10:30:00Z"
    },
    "refundPolicyType": "moderate",
    "refundPolicySnapshot": {
      "policyType": "moderate",
      "displayName": "보통",
      "description": "체크인 7일 전까지 전액 환불, 이후 50% 환불",
      "specialRules": {
        "alwaysRefund": {
          "cleaningFee": true,
          "maintenanceFee": false
        }
      },
      "rules": [
        { "daysBeforeMin": 7, "daysBeforeMax": null, "refundRate": 100, "isSameDayCancellation": false, "description": "7일 이상 전" },
        { "daysBeforeMin": 3, "daysBeforeMax": 6, "refundRate": 50, "isSameDayCancellation": false, "description": "3~6일 전" },
        { "daysBeforeMin": 0, "daysBeforeMax": 2, "refundRate": 0, "isSameDayCancellation": false, "description": "2일 이내" }
      ],
      "capturedAt": "2025-01-11T10:00:00.000Z"
    },
    "room": {
      "roomName": "홍대 넓은 원룸",
      "address": "서울특별시 마포구 서교동"
    },
    "createdAt": "2025-01-11T10:00:00.000Z"
  }
}
```

### 환불정책 스냅샷 필드 설명

계약 생성 시점의 환불정책을 보존하여, 추후 정책 변경과 관계없이 계약 당시의 정책을 적용합니다.

| 필드 | 타입 | 설명 |
|------|------|------|
| refundPolicyType | string | 환불정책 타입 (flexible, moderate, strict) |
| refundPolicySnapshot | object | 환불정책 상세 스냅샷 |
| refundPolicySnapshot.policyType | string | 정책 타입 |
| refundPolicySnapshot.displayName | string | 표시명 (약하게, 보통, 엄격하게) |
| refundPolicySnapshot.description | string | 정책 설명 |
| refundPolicySnapshot.specialRules | object | 특별 규칙 (청소비/관리비 환불 여부) |
| refundPolicySnapshot.rules | array | 환불율 규칙 배열 |
| refundPolicySnapshot.rules[].daysBeforeMin | number | 최소 일수 (N일 이전) |
| refundPolicySnapshot.rules[].daysBeforeMax | number\|null | 최대 일수 (null이면 상한 없음) |
| refundPolicySnapshot.rules[].refundRate | number | 환불율 (0-100%) |
| refundPolicySnapshot.rules[].isSameDayCancellation | boolean | 계약 당일 취소 규칙 여부 |
| refundPolicySnapshot.rules[].description | string | 규칙 설명 |
| refundPolicySnapshot.capturedAt | string | 스냅샷 캡처 시점 (ISO 8601) |

### Error Responses

#### 계약을 찾을 수 없음 (404)
```json
{
  "success": false,
  "error": {
    "code": 3003,
    "message": "계약을 찾을 수 없습니다."
  }
}
```

#### 권한 없음 (403)
```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "해당 계약에 접근할 권한이 없습니다."
  }
}
```

---

## 계약 승인 (호스트)
**PATCH** `/api/contracts/:contractId/approve`

호스트가 게스트의 계약 요청을 승인합니다. 승인 시 자동으로 채팅방이 생성되며, 선택적으로 권장 렌탈 아이템을 지정할 수 있습니다.

### 인증
**필수** - Authorization 헤더에 Access Token 포함 (호스트만)

### URL Parameters
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| contractId | number | O | 계약 ID |

### Request Body (선택사항)
| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| recommendedItems | object | X | 권장 렌탈 아이템 정보 |
| recommendedItems.items | array | X | 권장 아이템 목록 |
| recommendedItems.items[].itemId | number | O | 렌탈 아이템 ID |
| recommendedItems.items[].quantity | number | X | 수량 (기본값: 1) |

### Request Example (권장 아이템 포함)
```json
{
  "recommendedItems": {
    "items": [
      {
        "itemId": 1,
        "quantity": 1
      },
      {
        "itemId": 3,
        "quantity": 2
      }
    ]
  }
}
```

### Success Response (200)
```json
{
  "success": true,
  "message": "계약이 승인되었습니다.",
  "data": {
    "contractId": 1,
    "status": "APPROVED",
    "statusLabel": "승인됨",
    "approvedAt": "2025-01-27T10:30:00Z"
  }
}
```

### Error Responses

#### 이미 처리된 계약 (400)
```json
{
  "success": false,
  "error": {
    "code": 4202,
    "message": "이미 처리된 계약입니다."
  }
}
```

---

## 계약 거절 (호스트)
**PATCH** `/api/contracts/:contractId/reject`

호스트가 게스트의 계약 요청을 거절합니다.

### 인증
**필수** - Authorization 헤더에 Access Token 포함 (호스트만)

### URL Parameters
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| contractId | number | O | 계약 ID |

### Request Body
| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| hostMessage | string | O | 거절 사유 |

### Request Example
```json
{
  "hostMessage": "죄송합니다. 해당 기간에는 다른 예약이 있습니다."
}
```

### Success Response (200)
```json
{
  "success": true,
  "message": "계약이 거절되었습니다.",
  "data": {
    "contractId": 1,
    "status": "REJECTED"
  }
}
```

---

## 계약 요청 취소 (게스트)
**PATCH** `/api/contracts/:contractId/cancel`

게스트가 계약 요청을 취소합니다. 결제 전/후에 따라 취소 유형이 달라집니다.

### 인증
**필수** - Authorization 헤더에 Access Token 포함 (게스트만)

### URL Parameters
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| contractId | number | O | 계약 ID |

### Request Body
| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| cancellationReason | string | X | 취소 사유 (선택사항) |

### Request Example
```json
{
  "cancellationReason": "계획이 변경되어 취소합니다."
}
```

### Success Response (200)
```json
{
  "success": true,
  "message": "계약 요청이 취소되었습니다.",
  "data": {
    "contractId": 1,
    "status": "CANCELLED_BY_GUEST",
    "cancellationType": "BEFORE_PAYMENT",
    "cancelledAt": "2025-01-26T10:00:00.000Z"
  }
}
```

### 취소 시나리오별 응답

#### 결제 전 취소 (PENDING_APPROVAL 또는 APPROVED 상태)
```json
{
  "success": true,
  "message": "계약 요청이 취소되었습니다.",
  "data": {
    "contractId": 1,
    "status": "CANCELLED_BY_GUEST",
    "cancellationType": "BEFORE_PAYMENT",
    "cancelledAt": "2025-01-26T10:00:00.000Z"
  }
}
```

#### 결제 후 취소 (PAYMENT_COMPLETED 상태)
```json
{
  "success": true,
  "message": "계약이 취소되었습니다. 환불 절차가 진행됩니다.",
  "data": {
    "contractId": 1,
    "status": "CANCELLED_BY_GUEST",
    "cancellationType": "AFTER_PAYMENT",
    "cancelledAt": "2025-01-26T10:00:00.000Z",
    "refund": {
      "refundId": 123,
      "estimatedRefundAmount": 350000,
      "penaltyAmount": 150000,
      "refundStatus": "REQUESTED"
    }
  }
}
```

### Error Responses

#### 취소 불가능한 상태 (400)
```json
{
  "success": false,
  "error": {
    "code": 4203,
    "message": "해당 상태에서는 취소할 수 없습니다."
  }
}
```

#### 이미 취소된 계약 (400)
```json
{
  "success": false,
  "error": {
    "code": 4204,
    "message": "이미 취소된 계약입니다."
  }
}
```

---

# 채팅 API

Firebase 실시간 채팅 연동 API입니다. 백엔드는 채팅방 메타데이터를 관리하고, 실제 메시지는 Firebase Firestore에 저장됩니다.

## Firebase Custom Token 발급
**GET** `/api/chats/custom-token`

클라이언트에서 Firebase 로그인에 사용할 Custom Token을 발급합니다.

### 인증
**필수** - Authorization 헤더에 Access Token 포함

### Success Response (200)
```json
{
  "success": true,
  "data": {
    "customToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

### 사용 예시 (프론트엔드)
```javascript
// 1. 백엔드에서 Custom Token 발급
const { data } = await fetch('/api/chats/custom-token', {
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});

// 2. Firebase에 로그인
import { signInWithCustomToken } from 'firebase/auth';
await signInWithCustomToken(auth, data.customToken);

// 3. Firestore에서 메시지 조회/전송
import { collection, addDoc } from 'firebase/firestore';
const messagesRef = collection(db, 'chatRooms', chatRoomId, 'messages');
```

---

## 채팅방 생성
**POST** `/api/chats/rooms`

계약 승인 시 자동으로 호출되어 채팅방을 생성합니다.

### 인증
**필수** - Authorization 헤더에 Access Token 포함

### Request Body
| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| contractId | number | O | 계약 ID |

### Request Example
```json
{
  "contractId": 123
}
```

### Success Response (201)
```json
{
  "success": true,
  "message": "채팅방이 생성되었습니다.",
  "data": {
    "chatRoomId": 5,
    "firebaseChatRoomId": "chat_abc123",
    "contractId": 123
  }
}
```

---

## 내 채팅방 목록 조회
**GET** `/api/chats/rooms`

현재 로그인한 사용자의 모든 채팅방 목록을 조회합니다.

### 인증
**필수** - Authorization 헤더에 Access Token 포함

### Success Response (200)
```json
{
  "success": true,
  "data": {
    "chatRooms": [
      {
        "id": 1,
        "contractId": 123,
        "firebaseChatRoomId": "chat_abc123",
        "roomInfo": {
          "name": "강남역 원룸",
          "thumbnail": "https://..."
        },
        "otherUser": {
          "id": 5,
          "name": "김호스트",
          "profileImage": "https://..."
        },
        "lastMessage": {
          "text": "안녕하세요",
          "timestamp": "2025-01-11T10:30:00Z"
        },
        "unreadCount": 3,
        "createdAt": "2025-01-10T12:00:00.000Z"
      }
    ]
  }
}
```

---

## 채팅방 상세 정보 조회
**GET** `/api/chats/rooms/:chatRoomId`

특정 채팅방의 메타데이터를 조회합니다 (계약 정보, 참여자 정보 포함).

### 인증
**필수** - Authorization 헤더에 Access Token 포함

### URL Parameters
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| chatRoomId | number | O | 채팅방 ID |

### Success Response (200)
```json
{
  "success": true,
  "data": {
    "id": 1,
    "contractId": 123,
    "firebaseChatRoomId": "chat_abc123",
    "hostId": 5,
    "guestId": 10,
    "roomId": 50,
    "contract": {
      "checkInDate": "2025-12-18T06:00:00.000Z",
      "checkOutDate": "2026-01-18T02:00:00.000Z",
      "status": "APPROVED"
    },
    "room": {
      "roomName": "강남역 원룸",
      "address": "서울특별시 강남구"
    },
    "host": {
      "id": 5,
      "name": "김호스트",
      "profileImageUrl": "/uploads/profiles/host-1.jpg"
    },
    "guest": {
      "id": 10,
      "name": "홍길동",
      "profileImageUrl": "/uploads/profiles/guest-1.jpg"
    }
  }
}
```

---

## 계약 ID로 채팅방 조회
**GET** `/api/chats/contracts/:contractId/room`

계약 ID로 해당하는 채팅방을 조회합니다.

### 인증
**필수** - Authorization 헤더에 Access Token 포함

### URL Parameters
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| contractId | number | O | 계약 ID |

### Success Response (200)
```json
{
  "success": true,
  "data": {
    "chatRoomId": 1,
    "firebaseChatRoomId": "chat_abc123"
  }
}
```

### Error Responses

#### 채팅방을 찾을 수 없음 (404)
```json
{
  "success": false,
  "error": {
    "code": 3004,
    "message": "채팅방을 찾을 수 없습니다."
  }
}
```

---

# 고객센터 API

## 공지사항 목록 조회
**GET** `/api/support/notices`

게시된 공지사항 목록을 조회합니다.

### 인증
인증 불필요 (공개 API)

### Query Parameters
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| page | number | X | 페이지 번호 (기본값: 1) |
| limit | number | X | 페이지당 개수 (기본값: 10) |
| category | string | X | 카테고리 필터 |

### Success Response (200)
```json
{
  "success": true,
  "data": {
    "total": 50,
    "page": 1,
    "limit": 10,
    "totalPages": 5,
    "notices": [
      {
        "id": 1,
        "title": "서비스 이용 안내",
        "category": "NOTICE",
        "isPinned": true,
        "viewCount": 1500,
        "createdAt": "2025-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

---

## 공지사항 상세 조회
**GET** `/api/support/notices/:id`

특정 공지사항의 상세 내용을 조회합니다. `published` 상태인 공지사항만 조회 가능합니다.

### 인증
인증 불필요 (공개 API)

### URL Parameters
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| id | number | O | 공지사항 ID |

### Success Response (200)
```json
{
  "success": true,
  "data": {
    "id": 1,
    "title": "서비스 이용 안내",
    "content": "Ezstay 서비스를 이용해주셔서 감사합니다...",
    "category": "NOTICE",
    "isPinned": true,
    "viewCount": 1501,
    "createdAt": "2025-01-01T00:00:00.000Z",
    "updatedAt": "2025-01-05T00:00:00.000Z"
  }
}
```

---

## FAQ 카테고리 목록 조회
**GET** `/api/support/faq/categories`

FAQ 카테고리 목록을 조회합니다.

### 인증
인증 불필요 (공개 API)

### Success Response (200)
```json
{
  "success": true,
  "data": {
    "categories": [
      {
        "id": 1,
        "name": "계약/예약",
        "displayOrder": 1,
        "faqCount": 15
      },
      {
        "id": 2,
        "name": "결제",
        "displayOrder": 2,
        "faqCount": 10
      }
    ]
  }
}
```

---

## FAQ 목록 조회
**GET** `/api/support/faqs`

FAQ 목록을 조회합니다.

### 인증
인증 불필요 (공개 API)

### Query Parameters
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| categoryId | number | X | 카테고리 ID (선택) |
| search | string | X | 검색어 (제목/내용 검색, 선택) |
| page | number | X | 페이지 번호 (기본값: 1) |
| limit | number | X | 페이지당 개수 (기본값: 20) |

### Success Response (200)
```json
{
  "success": true,
  "data": {
    "total": 30,
    "page": 1,
    "limit": 20,
    "totalPages": 2,
    "faqs": [
      {
        "id": 1,
        "question": "계약을 취소하려면 어떻게 하나요?",
        "answer": "승인 대기 중인 계약은 앱에서 직접 취소하실 수 있습니다...",
        "categoryId": 1,
        "categoryName": "계약/예약",
        "viewCount": 500,
        "createdAt": "2025-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

---

## FAQ 상세 조회
**GET** `/api/support/faqs/:id`

특정 FAQ의 상세 내용을 조회합니다.

### 인증
인증 불필요 (공개 API)

### URL Parameters
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| id | number | O | FAQ ID |

### Success Response (200)
```json
{
  "success": true,
  "data": {
    "id": 1,
    "question": "계약을 취소하려면 어떻게 하나요?",
    "answer": "승인 대기 중인 계약은 앱에서 직접 취소하실 수 있습니다...",
    "categoryId": 1,
    "categoryName": "계약/예약",
    "viewCount": 501,
    "createdAt": "2025-01-01T00:00:00.000Z"
  }
}
```

---

## 내 문의 목록 조회
**GET** `/api/support/inquiries`

현재 로그인한 사용자의 문의 목록을 조회합니다.

### 인증
**필수** - Authorization 헤더에 Access Token 포함

### Query Parameters
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| status | string | X | 문의 상태 (PENDING, ANSWERED, CLOSED) |

### Success Response (200)
```json
{
  "success": true,
  "data": {
    "inquiries": [
      {
        "id": 1,
        "category": "BOOKING",
        "subject": "예약 취소 문의",
        "status": "ANSWERED",
        "createdAt": "2025-01-10T10:00:00.000Z",
        "answeredAt": "2025-01-10T15:00:00.000Z"
      }
    ]
  }
}
```

---

## 내 문의 상세 조회
**GET** `/api/support/inquiries/:id`

특정 문의의 상세 내용을 조회합니다. 본인의 문의만 조회 가능합니다.

### 인증
**필수** - Authorization 헤더에 Access Token 포함

### URL Parameters
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| id | number | O | 문의 ID |

### Success Response (200)
```json
{
  "success": true,
  "data": {
    "id": 1,
    "category": "BOOKING",
    "subject": "예약 취소 문의",
    "content": "예약을 취소하고 싶은데 어떻게 하나요?",
    "status": "ANSWERED",
    "answer": "승인 대기 중인 계약은 앱에서 직접 취소하실 수 있습니다.",
    "attachments": ["/uploads/inquiries/file1.jpg"],
    "createdAt": "2025-01-10T10:00:00.000Z",
    "answeredAt": "2025-01-10T15:00:00.000Z",
    "answeredBy": {
      "name": "관리자"
    }
  }
}
```

---

## 문의 등록
**POST** `/api/support/inquiries`

새로운 문의를 등록합니다.

### 인증
**필수** - Authorization 헤더에 Access Token 포함

### Request Body
| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| category | string | O | 문의 카테고리 (BOOKING, PAYMENT, ROOM, ETC) |
| subject | string | O | 제목 |
| content | string | O | 내용 |
| attachments | array | X | 첨부파일 URL 배열 |

### Request Example
```json
{
  "category": "BOOKING",
  "subject": "예약 취소 문의",
  "content": "예약을 취소하고 싶은데 어떻게 하나요?",
  "attachments": ["url1", "url2"]
}
```

### Success Response (201)
```json
{
  "success": true,
  "message": "문의가 등록되었습니다.",
  "data": {
    "inquiryId": 1,
    "status": "PENDING"
  }
}
```

---

## 문의 수정
**PATCH** `/api/support/inquiries/:id`

등록한 문의를 수정합니다. 답변 전에만 수정 가능합니다.

### 인증
**필수** - Authorization 헤더에 Access Token 포함 (본인만)

### URL Parameters
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| id | number | O | 문의 ID |

### Request Body
| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| subject | string | X | 제목 |
| content | string | X | 내용 |
| attachments | array | X | 첨부파일 URL 배열 |

### Success Response (200)
```json
{
  "success": true,
  "message": "문의가 수정되었습니다."
}
```

### Error Responses

#### 답변 후 수정 불가 (400)
```json
{
  "success": false,
  "error": {
    "code": 4301,
    "message": "답변이 완료된 문의는 수정할 수 없습니다."
  }
}
```

---

## 문의 삭제
**DELETE** `/api/support/inquiries/:id`

등록한 문의를 삭제합니다. 답변 전에만 삭제 가능합니다.

### 인증
**필수** - Authorization 헤더에 Access Token 포함 (본인만)

### URL Parameters
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| id | number | O | 문의 ID |

### Success Response (200)
```json
{
  "success": true,
  "message": "문의가 삭제되었습니다."
}
```

---

# 대여 물품 API

## 대여 물품 목록 조회
**GET** `/api/rental-items`

모든 대여 물품 목록을 조회합니다.

### 인증
**필수** - Authorization 헤더에 Access Token 포함

### Query Parameters
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| isActive | boolean | X | 활성 상태 필터 (true/false) |
| category | string | X | 카테고리 필터 (FURNITURE, ELECTRONICS 등) |

### Success Response (200)
```json
{
  "success": true,
  "data": {
    "rentalItems": [
      {
        "id": 1,
        "name": "접이식 테이블",
        "category": "FURNITURE",
        "description": "2인용 접이식 테이블",
        "dailyRate": 5000,
        "depositAmount": 20000,
        "totalStock": 10,
        "availableStock": 7,
        "isActive": true,
        "imageUrl": "https://..."
      }
    ]
  }
}
```

---

## 대여 물품 상세 조회
**GET** `/api/rental-items/:id`

특정 대여 물품의 상세 정보를 조회합니다.

### 인증
**필수** - Authorization 헤더에 Access Token 포함

### URL Parameters
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| id | number | O | 대여 물품 ID |

### Success Response (200)
```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "접이식 테이블",
    "category": "FURNITURE",
    "description": "2인용 접이식 테이블",
    "dailyRate": 5000,
    "depositAmount": 20000,
    "totalStock": 10,
    "availableStock": 7,
    "rentedStock": 3,
    "isActive": true,
    "imageUrl": "https://...",
    "createdAt": "2025-01-01T00:00:00.000Z"
  }
}
```

---

## 대여 물품 통계 조회
**GET** `/api/rental-items/stats`

대여 물품 전체 통계를 조회합니다.

### 인증
**필수** - Authorization 헤더에 Access Token 포함

### Success Response (200)
```json
{
  "success": true,
  "data": {
    "totalItems": 50,
    "activeItems": 45,
    "totalStock": 500,
    "availableStock": 320,
    "rentedStock": 180,
    "categoryStats": [
      {
        "category": "FURNITURE",
        "count": 20,
        "totalStock": 200,
        "availableStock": 150
      },
      {
        "category": "ELECTRONICS",
        "count": 15,
        "totalStock": 150,
        "availableStock": 100
      }
    ]
  }
}
```
