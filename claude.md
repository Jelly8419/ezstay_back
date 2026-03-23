# EZStay Backend - CLAUDE.md

## 프로젝트
단기 임대 플랫폼 백엔드 API. Node.js / Express v5 / MySQL(Sequelize) / JWT / Kakao OAuth.

## ⚡ 항상 적용되는 규칙
- 응답은 반드시 `utils/responseHelper.js` 사용 (`res.json()` 직접 사용 금지)
- `User.destroy()` 절대 금지 → Soft Delete만 허용
- 모델에 `references` 옵션 사용 금지 → `models/index.js`에서만 관계 설정
- `sync({ alter: false })` 유지

---

## 📂 스킬 자동 매칭 규칙

### conventions-skill.md 로드 조건
**항상 로드**: 새 컨트롤러/서비스/모델/라우트 작성 시
**키워드**: API 응답, 에러 코드, 인증, 미들웨어, 검증, 트랜잭션, Sequelize

### architecture-skill.md 로드 조건
**키워드**: 구조, 모델 관계, 방 등록, 관리자, 권한, 흐름
**파일 경로**: `models/`, `routes/`, `controllers/`, `services/`
**의도**: 새 기능 추가, 모델 수정, 관리자 API 작업

---

## API 기본 URL
`http://localhost:8080`

## 주요 라우트
```
/api/auth      # 인증 (이메일/카카오)
/api/user      # 사용자 관리
/api/host      # 호스트 방 등록/관리
/api/rooms     # 방 조회 (게스트용)
/api/contracts # 계약/예약
/api/chats     # 채팅
/api/admin     # 관리자 전용
```
