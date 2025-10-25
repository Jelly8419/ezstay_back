# 보안 업데이트 안내

## 🔴 즉시 조치 필요

보안 강화 업데이트가 적용되었습니다. 다음 작업을 **반드시** 수행해주세요.

---

## 1. 환경변수 재설정

### `.env` 파일 재생성
`.env` 파일이 Git에서 제거되었습니다. 다음 명령으로 새로운 시크릿 키를 생성하세요:

```bash
# JWT Secret 생성 (32자 이상)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### `.env` 파일 작성
프로젝트 루트에 `.env` 파일을 생성하고 아래 내용을 입력하세요:

```bash
# Database
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=livemoment

# JWT (위에서 생성한 랜덤 문자열 사용)
JWT_SECRET=생성한_랜덤_문자열_1
JWT_REFRESH_SECRET=생성한_랜덤_문자열_2
JWT_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d

# Kakao OAuth (새로 발급받으세요)
KAKAO_CLIENT_ID=your_new_kakao_client_id
KAKAO_CLIENT_SECRET=your_new_kakao_client_secret
KAKAO_REDIRECT_URI=http://localhost:3000/api/auth/oauth/kakao/callback

# Portone (새로 발급받으세요)
PORTONE_API_KEY=your_new_portone_api_key
PORTONE_API_SECRET=your_new_portone_api_secret

# Upload Path
UPLOAD_PATH=./uploads/rooms
UPLOADS_PUBLIC_PATH=./uploads

# Server
PORT=3000
NODE_ENV=development
```

---

## 2. 외부 API 키 재발급

기존 API 키가 노출되었으므로 **반드시 재발급** 받으세요:

### Kakao Developers
1. https://developers.kakao.com 접속
2. 기존 앱에서 Client Secret 재발급
3. `.env` 파일에 새 값 입력

### Portone (아임포트)
1. Portone 관리자 콘솔 접속
2. API Secret 재발급
3. `.env` 파일에 새 값 입력

---

## 3. 변경 사항 확인

### ✅ 적용된 보안 개선 사항

1. **환경변수 보호**
   - `.gitignore` 파일 생성
   - `.env` 파일 Git 추적 제거

2. **JWT 보안 강화**
   - JWT Secret 필수 검증 추가 (서버 시작 시)
   - Access Token과 Refresh Token에 별도 시크릿 사용
   - 최소 32자 길이 검증

3. **Refresh Token 검증**
   - 토큰 서명 및 만료 시간 검증 추가
   - DB 조회 전 토큰 유효성 확인

4. **파일 업로드 보안**
   - MIME 타입과 확장자 둘 다 검증
   - 악성 파일 업로드 차단

5. **경로 하드코딩 제거**
   - 업로드 경로를 환경변수로 관리
   - 다른 환경에서도 동작 가능

---

## 4. 서버 재시작

```bash
# 개발 모드
npm run dev

# 프로덕션 모드
npm start
```

⚠️ **주의**: JWT_SECRET이나 JWT_REFRESH_SECRET이 없거나 32자 미만이면 서버가 시작되지 않습니다.

---

## 5. 추가 권장 사항

### Git 이력에서 민감정보 완전 제거 (선택)

Git 이력에 `.env` 파일이 남아있으므로, 완전히 제거하려면:

```bash
# BFG Repo-Cleaner 사용 (권장)
# 또는 git filter-branch 사용

# 주의: 이 작업은 Git 이력을 재작성하므로 팀원과 협의 필요
```

### 프로덕션 배포 전 체크리스트

- [ ] 모든 API 키 재발급 완료
- [ ] `.env` 파일이 Git에 포함되지 않는지 확인
- [ ] JWT Secret이 강력한 랜덤 문자열인지 확인
- [ ] CORS 설정을 프로덕션 도메인으로 제한
- [ ] HTTPS 적용
- [ ] Rate Limiting 구현 (추후 업데이트 예정)

---

## 문제 발생 시

서버 시작 오류가 발생하면 다음을 확인하세요:

1. `.env` 파일이 프로젝트 루트에 있는지
2. `JWT_SECRET`과 `JWT_REFRESH_SECRET`이 32자 이상인지
3. DB 접속 정보가 올바른지

궁금한 점이 있으면 팀에 문의하세요.
