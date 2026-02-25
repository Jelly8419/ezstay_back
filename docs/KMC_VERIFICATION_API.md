# KMC 본인인증 API 연동 가이드

## 목차
- [개요](#개요)
- [인증 플로우](#인증-플로우)
- [API 1: 인증 요청 데이터 생성](#api-1-인증-요청-데이터-생성)
- [API 2: 인증 결과 검증](#api-2-인증-결과-검증)
- [프론트엔드 구현 가이드](#프론트엔드-구현-가이드)
- [기존 본인인증 API와의 관계](#기존-본인인증-api와의-관계)
- [에러 코드](#에러-코드)
- [주의사항](#주의사항)

---

## 개요

KMC(한국모바일인증) 휴대폰 본인인증을 통해 사용자의 실명, 전화번호, 생년월일 등을 검증합니다.

**기존 방식**: 프론트에서 이름/전화번호를 직접 입력 → 서버에 저장 (검증 없음)
**변경 방식**: KMC 인증창에서 실제 본인인증 → 서버가 검증된 결과를 수신 → 저장

---

## 인증 플로우

```
[프론트엔드]                    [백엔드]                     [KMC 서버]
     │                           │                            │
     │ 1. POST /kmc/request      │                            │
     │──────────────────────────>│                            │
     │                           │                            │
     │ 2. { trCert, trUrl, ... } │                            │
     │<──────────────────────────│                            │
     │                           │                            │
     │ 3. KMC 인증창 팝업 ──────────────────────────────────>│
     │                           │                            │
     │ 4. 사용자가 인증 수행      │                            │
     │                           │                            │
     │ 5. KMC가 tr_url로 결과 전송 (apiToken, certNum)        │
     │<───────────────────────────────────────────────────────│
     │                           │                            │
     │ 6. POST /kmc/verify       │                            │
     │  { apiToken, certNum }    │                            │
     │──────────────────────────>│                            │
     │                           │ 7. KMC API로 결과 검증     │
     │                           │───────────────────────────>│
     │                           │<───────────────────────────│
     │                           │ 8. 복호화 + 위변조 검증    │
     │                           │    + User DB 업데이트      │
     │                           │                            │
     │ 9. { name, phoneNumber,   │                            │
     │      birth, gender }      │                            │
     │<──────────────────────────│                            │
     │                           │                            │
     │ 10. 기존 본인인증 저장 API 호출                        │
     │   (saveGuestVerification / saveHostVerification)       │
     │──────────────────────────>│                            │
```

---

## API 1: 인증 요청 데이터 생성

**POST** `/api/auth/kmc/request`

KMC 인증창을 열기 위한 암호화된 데이터를 생성합니다.

### 인증
`Authorization: Bearer {accessToken}` (필수)

### Request Body
없음 (빈 POST 요청)

### Success Response (200)
```json
{
  "success": true,
  "message": "본인인증 요청 데이터가 생성되었습니다.",
  "data": {
    "trCert": "암호화된_인증_요청_데이터_문자열...",
    "cpId": "고객사ID",
    "trUrl": "https://yourdomain.com/api/auth/kmc/callback",
    "certNum": "20260226143025123456",
    "reqDate": "20260226143025",
    "certMet": "T",
    "plusInfo": "42"
  }
}
```

### Response 필드 설명
| 필드 | 타입 | 설명 |
|------|------|------|
| trCert | string | KMC 인증창에 전달할 암호화된 요청 데이터 |
| cpId | string | KMC 고객사 ID |
| trUrl | string | KMC 인증 완료 후 결과를 수신할 URL |
| certNum | string | 요청번호 (고유값) |
| reqDate | string | 요청일시 (YYYYMMDDHHMMSS) |
| certMet | string | 인증방법 ("T": 휴대폰) |
| plusInfo | string | 추가 데이터 (사용자 ID) |

### Error Responses

#### 인증 토큰 없음 (401)
```json
{
  "success": false,
  "message": "액세스 토큰이 필요합니다."
}
```

#### 암호화 모듈 오류 (500)
```json
{
  "success": false,
  "code": 4401,
  "message": "인증 요청 생성에 실패했습니다."
}
```

---

## API 2: 인증 결과 검증

**POST** `/api/auth/kmc/verify`

KMC 인증 완료 후 받은 apiToken과 certNum으로 결과를 검증합니다.

### 인증
`Authorization: Bearer {accessToken}` (필수)

### Request Body
| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| apiToken | string | O | KMC 인증 완료 후 수신한 API 토큰 |
| certNum | string | O | KMC 인증 완료 후 수신한 인증 번호 |

### Request Example
```json
{
  "apiToken": "KMC에서_받은_암호화된_토큰...",
  "certNum": "KMC에서_받은_암호화된_인증번호..."
}
```

### Success Response (200)
```json
{
  "success": true,
  "message": "본인인증이 완료되었습니다.",
  "data": {
    "verified": true,
    "name": "홍길동",
    "phoneNumber": "01012345678",
    "birth": "19900101",
    "gender": "M"
  }
}
```

### Response 필드 설명
| 필드 | 타입 | 설명 |
|------|------|------|
| verified | boolean | 인증 성공 여부 (항상 true, 실패 시 에러 응답) |
| name | string | 실명 |
| phoneNumber | string | 휴대폰 번호 (하이픈 없음) |
| birth | string | 생년월일 (YYYYMMDD) |
| gender | string | 성별 ("M" 또는 "F") |

### Error Responses

#### 필수 파라미터 누락 (400)
```json
{
  "success": false,
  "code": 4002,
  "message": "필수 정보를 모두 입력해주세요."
}
```

#### 인증 토큰 만료 (400)
```json
{
  "success": false,
  "code": 4403,
  "message": "인증 토큰이 만료되었습니다."
}
```

#### 위변조 감지 (400)
```json
{
  "success": false,
  "code": 4406,
  "message": "인증 데이터 위변조가 감지되었습니다."
}
```

#### 중복 인증 (409)
```json
{
  "success": false,
  "code": 4410,
  "message": "이미 다른 계정에서 본인인증이 완료된 정보입니다."
}
```

#### KMC 서버 오류 (500)
```json
{
  "success": false,
  "code": 4407,
  "message": "KMC 서버 연동 중 오류가 발생했습니다."
}
```

---

## 프론트엔드 구현 가이드

### 1단계: 인증 요청 데이터 받기

```javascript
const requestKmcVerification = async () => {
  const response = await fetch('/api/auth/kmc/request', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });
  return await response.json();
};
```

### 2단계: KMC 인증창 팝업 열기

```javascript
const openKmcPopup = (data) => {
  // 팝업용 form 생성
  const form = document.createElement('form');
  form.name = 'reqKMCISForm';
  form.method = 'post';
  form.action = 'https://www.kmcert.com/kmcis/web/kmcisReq.jsp';

  // hidden 필드 추가
  const fields = {
    'tr_cert': data.trCert,
    'tr_url': data.trUrl,
    'tr_ver': 'V2'
  };

  Object.entries(fields).forEach(([name, value]) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  });

  document.body.appendChild(form);

  // 모바일/PC 분기
  const isMobile = /iPhone|iPad|Android|Windows CE|BlackBerry|Symbian|Windows Phone|webOS|Opera Mini|Opera Mobi/i.test(navigator.userAgent);

  if (isMobile) {
    // 모바일: 현재 창에서 이동
    form.target = '';
    form.submit();
  } else {
    // PC: 팝업 창 열기
    const popup = window.open('', 'KMCISWindow', 'width=425,height=550,resizable=0,scrollbars=no,status=0,titlebar=0,toolbar=0,left=435,top=250');

    if (!popup) {
      alert('팝업이 차단되었습니다. 팝업 차단을 해제해주세요.');
      return;
    }

    form.target = 'KMCISWindow';
    form.submit();
  }

  document.body.removeChild(form);
};
```

### 3단계: KMC 인증 결과 수신 페이지

KMC 인증이 완료되면 `tr_url`로 `apiToken`과 `certNum`이 POST됩니다.
이 값을 받아서 부모 창(또는 앱)으로 전달해야 합니다.

**결과 수신 페이지** (tr_url에 해당하는 프론트 페이지):

```html
<!-- /kmc/callback 페이지 -->
<script>
  // URL 파라미터 또는 POST body에서 apiToken, certNum 추출
  // KMC는 이 페이지에 form POST로 데이터를 전송합니다

  window.onload = function() {
    const apiToken = document.getElementById('apiToken')?.value || '';
    const certNum = document.getElementById('certNum')?.value || '';

    if (window.opener) {
      // PC 팝업인 경우: 부모 창으로 데이터 전달
      window.opener.postMessage({
        type: 'KMC_RESULT',
        apiToken: apiToken,
        certNum: certNum
      }, '*');
      window.close();
    } else {
      // 모바일인 경우: 직접 verify API 호출 또는 리다이렉트
      window.location.href = `/verification/complete?apiToken=${encodeURIComponent(apiToken)}&certNum=${encodeURIComponent(certNum)}`;
    }
  };
</script>

<!-- KMC가 이 hidden form에 값을 채워서 POST합니다 -->
<form>
  <input type="hidden" id="apiToken" name="apiToken" value="<%= apiToken %>" />
  <input type="hidden" id="certNum" name="certNum" value="<%= certNum %>" />
</form>
```

### 4단계: 부모 창에서 결과 수신 및 verify 호출

```javascript
// PC: 팝업으로부터 메시지 수신
window.addEventListener('message', async (event) => {
  if (event.data?.type === 'KMC_RESULT') {
    const { apiToken, certNum } = event.data;
    await verifyKmcResult(apiToken, certNum);
  }
});

// verify API 호출
const verifyKmcResult = async (apiToken, certNum) => {
  const response = await fetch('/api/auth/kmc/verify', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ apiToken, certNum })
  });

  const result = await response.json();

  if (result.success) {
    // 인증 성공 - 결과 데이터로 기존 본인인증 저장 API 호출
    const { name, phoneNumber, birth, gender } = result.data;

    // 게스트: saveGuestVerification 호출
    // 호스트: saveHostVerification 호출
    await saveVerification(name, phoneNumber);
  } else {
    // 인증 실패 처리
    alert(result.message);
  }
};
```

### 5단계: 기존 본인인증 저장 API 호출

KMC verify 성공 후, 기존 `saveGuestVerification` 또는 `saveHostVerification` API를 호출합니다.
이때 `name`과 `phone_number`는 KMC verify 응답에서 받은 값을 사용합니다.

```javascript
// 게스트 본인인증 저장
const saveGuestVerification = async (name, phoneNumber) => {
  const response = await fetch('/api/user/guest/verification', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: name,                    // KMC에서 받은 실명
      phone_number: phoneNumber,     // KMC에서 받은 전화번호
      terms: {
        service_terms: true,
        privacy_policy: true,
        age_confirmed: true,
        marketing_consent: false     // 선택
      }
    })
  });
  return await response.json();
};

// 호스트 본인인증 + 계좌 저장
const saveHostVerification = async (name, phoneNumber, bankInfo) => {
  const response = await fetch('/api/user/host/verification', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: name,                         // KMC에서 받은 실명
      phone_number: phoneNumber,          // KMC에서 받은 전화번호
      bank_code: bankInfo.bankCode,       // 사용자가 입력
      account_num: bankInfo.accountNum,   // 사용자가 입력
      account_holder_name: bankInfo.holderName, // 사용자가 입력
      terms: {
        service_terms: true,
        privacy_policy: true,
        age_confirmed: true,
        marketing_consent: false
      }
    })
  });
  return await response.json();
};
```

---

## 전체 흐름 요약 (프론트 기준)

```
1. 사용자가 "본인인증" 버튼 클릭
2. POST /api/auth/kmc/request → trCert 등 수신
3. trCert로 KMC 인증창 팝업 열기
4. 사용자가 KMC에서 휴대폰 인증 수행
5. KMC가 tr_url로 apiToken + certNum POST
6. 결과 수신 페이지에서 부모 창으로 데이터 전달
7. POST /api/auth/kmc/verify → 이름, 전화번호, 생년월일 수신
8. 수신된 정보로 기존 본인인증 저장 API 호출
   - 게스트: POST /api/user/guest/verification
   - 호스트: POST /api/user/host/verification
9. 완료 → 다음 단계로 이동
```

---

## 기존 본인인증 API와의 관계

| 항목 | 변경 전 | 변경 후 |
|------|---------|---------|
| 이름/전화번호 입력 | 사용자가 직접 입력 | KMC 인증 결과에서 자동 채움 |
| 본인인증 여부 | 검증 없이 저장 | KMC 실제 인증 후 저장 |
| 기존 저장 API | 그대로 사용 | 그대로 사용 (이름/전화번호만 KMC 결과 사용) |
| DB 추가 저장 | 없음 | CI, DI, 생년월일, 성별 자동 저장 |

**기존 API는 변경 없음.** KMC 인증이 앞단에 추가되는 구조입니다.

---

## 에러 코드

| 코드 | HTTP | 설명 |
|------|------|------|
| 4401 | 500 | 인증 요청 생성 실패 (암호화 모듈 오류) |
| 4402 | 500 | 인증 결과 복호화 실패 |
| 4403 | 400 | 인증 토큰 만료 (KMC APR02) |
| 4404 | 400 | 인증 토큰 없음 (KMC APR03) |
| 4405 | 400 | 본인인증 실패 (일반) |
| 4406 | 400 | 인증 데이터 위변조 감지 |
| 4407 | 500 | KMC 서버 연동 오류 |
| 4408 | 500 | 인증 모듈 미준비 (서버 시작 직후 등) |
| 4410 | 409 | 다른 계정에서 이미 인증된 정보 (DI 중복) |

---

## 주의사항

1. **KMC 인증창 URL은 프론트에서 직접 호출합니다**
   - `https://www.kmcert.com/kmcis/web/kmcisReq.jsp`
   - 백엔드에서 생성한 `trCert`, `trUrl`을 form hidden으로 전달

2. **tr_url(결과 수신 URL)은 프론트엔드 페이지여야 합니다**
   - KMC가 인증 결과를 이 URL로 POST합니다
   - 이 페이지에서 `apiToken`, `certNum`을 추출하여 백엔드 verify API를 호출합니다

3. **팝업 차단 처리가 필요합니다**
   - PC에서는 팝업으로 KMC 인증창을 열기 때문에 팝업 차단 시 안내 필요

4. **모바일/PC 분기 처리가 필요합니다**
   - 모바일: 현재 창에서 KMC 페이지로 이동 → 결과 수신 후 앱으로 복귀
   - PC: 팝업 창에서 인증 → 부모 창으로 postMessage로 결과 전달

5. **로컬 환경에서는 테스트 불가합니다**
   - KMC 바이너리가 Linux 전용
   - KMC에 등록된 도메인에서만 동작
   - 테스트 서버/운영 서버에서만 실제 테스트 가능

6. **인증 결과의 name, phoneNumber는 수정 불가하게 처리해주세요**
   - KMC에서 검증된 값이므로 사용자가 임의로 변경하면 안 됩니다
   - 프론트 UI에서 읽기 전용으로 표시 권장
