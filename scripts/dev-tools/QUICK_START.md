# 빠른 시작 가이드 - 계약 테스트

로컬 개발 환경에서 계약 기능을 빠르게 테스트하는 방법입니다.

## 🚀 가장 빠른 방법 (권장)

### 1단계: 계약 요청 생성
Postman 또는 Thunder Client에서:

```http
POST http://localhost:3000/api/contracts
Authorization: Bearer <게스트_토큰>
Content-Type: application/json

{
  "roomId": 1,
  "checkInDate": "2026-01-25T15:00:00.000Z",
  "checkOutDate": "2026-02-01T11:00:00.000Z",
  "guestMessage": "테스트 계약입니다",
  "termsAgreed": {
    "service": true,
    "privacy": true,
    "refund": true
  }
}
```

### 2단계: 자동 승인 (하나의 명령으로!)
```bash
npm run dev:approve-all
```

출력:
```
✅ 계약 #1 (주문번호: 26012000001) 승인 완료
   호스트: 김철수 → 게스트: 이영희
   방: 강남역 도보 5분 원룸

🎉 1건의 계약이 모두 승인되었습니다.
```

### 3단계: 결제 진행
```http
POST http://localhost:3000/api/contracts/1/payment
Authorization: Bearer <게스트_토큰>
```

끝! 🎉

---

## 🔄 기존 방식과 비교

### ❌ 기존: 번거로운 방식
1. 게스트로 계약 요청 생성
2. **로그아웃** → 호스트 계정으로 **재로그인** 😫
3. 호스트 API로 계약 승인
4. **로그아웃** → 게스트 계정으로 **다시 로그인** 😫
5. 결제 진행

**문제**: 계정 전환 2회 필요, 시간 낭비

### ✅ 개선: CLI 도구 사용
1. 게스트로 계약 요청 생성
2. **터미널에서 `npm run dev:approve-all`** ⚡
3. 결제 진행

**효과**: 계정 전환 불필요, **10초 안에 승인 완료**

---

## 💡 실전 팁

### Tip 1: 여러 계약 동시 테스트
```bash
# 계약 3개 생성 후
npm run dev:approve-all
# → 한 번에 모두 승인
```

### Tip 2: 선택적 승인/거절
```bash
# 먼저 상태 확인
npm run dev:contract-status

# 특정 계약만 승인
npm run dev:approve 1
npm run dev:approve 3

# 나머지는 거절
npm run dev:reject 2
```

### Tip 3: 완전 자동화 (고급)
E2E 테스트 시나리오에 유용:

```bash
# .env 파일
AUTO_APPROVE_CONTRACTS=true
```

이제 계약 생성 시 **자동으로 승인됨** (CLI 명령 불필요)

---

## 📊 상태 확인

언제든지 현재 계약 상황을 확인:

```bash
npm run dev:contract-status
```

출력:
```
📊 계약 상태 현황

상태                              건수
──────────────────────────────────────────────────
승인 대기                          3건
승인됨 (결제 대기)                  2건
결제 완료                          5건
진행중                            1건
──────────────────────────────────────────────────
총계                              11건

📋 최근 승인 대기 계약 (최대 10건)

#15 | 26012000003
   방: 서울대입구역 신축 빌라
   호스트: 김철수 → 게스트: 이영희
   체크인: 2026-01-25
   생성: 2026-01-20 14:30:15
```

---

## ⚠️ 주의사항

### 프로덕션에서는 사용 불가
이 도구는 개발/테스트 환경에서만 동작:
- ✅ `NODE_ENV=development` → 정상 동작
- ❌ `NODE_ENV=production` → 자동 차단

### DB 직접 수정
- 이 도구는 API를 우회하고 DB를 직접 수정합니다
- 알림, 로그 등 비즈니스 로직이 실행되지 않습니다
- **테스트 목적으로만 사용하세요**

---

## 🆘 문제 해결

### "계약 ID를 찾을 수 없습니다"
→ `npm run dev:contract-status`로 올바른 ID 확인

### "계약 상태가 PENDING_APPROVAL이 아닙니다"
→ 이미 승인/거절된 계약입니다. 새 계약을 생성하세요

### 명령어가 실행되지 않음
→ 프로젝트 루트 디렉토리에서 실행하는지 확인
```bash
cd /path/to/ezstay_back
npm run dev:approve-all
```

---

## 📚 더 알아보기

- [상세 문서](README.md) - 전체 기능 및 사용법
- [CLAUDE.md](../../CLAUDE.md) - 프로젝트 전체 가이드
- [API 문서](../../docs/API_DOCUMENTATION.md) - 계약 API 상세 스펙

---

**Happy Testing! 🎉**
