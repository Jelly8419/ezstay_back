# 빠른 시작 가이드 - 개발자 도구

로컬 개발 환경에서 계약 기능을 빠르게 테스트하는 방법입니다.

## 🚀 방법 1: 시드 데이터로 한 번에 생성 (가장 빠름)

다양한 상태의 계약을 한 번에 만들고 싶을 때 사용합니다.

### 1단계: 테스트 데이터 생성

```bash
npm run dev:seed-contracts
```

이 명령 하나로 9가지 상태의 계약이 관련 데이터(결제, 로그, 렌탈 등)와 함께 생성됩니다:
- 승인 대기, 승인됨, 결제 완료, 임대중, 완료, 거절, 취소+환불, 임대중+렌탈, 완료+렌탈

### 2단계: 확인

```bash
npm run dev:contract-status
```

### 3단계: 테스트 끝나면 정리

```bash
npm run dev:seed-clean
```

끝! 10초면 충분합니다.

---

### 고급: 특정 호스트/게스트로 생성

```bash
# 호스트 #1708, 게스트 #1805로 모든 시나리오 생성
npm run dev:seed-contracts -- --host 1708 --guest 1805

# 특정 시나리오만
npm run dev:seed-contracts -- --host 1708 --guest 1805 --scenario in_progress_with_rental

# 시나리오당 3개씩
npm run dev:seed-contracts -- --host 1708 --count 3

# 미리보기 (DB 변경 없음)
npm run dev:seed-contracts -- --dry-run
```

### 고급: 시나리오 목록 확인

```bash
npm run dev:seed-contracts -- --list
```

출력:
```
📋 사용 가능한 시나리오

  📦 pending_approval
     승인 대기 (PENDING_APPROVAL)
     Contract만 생성, 로그 1건

  📦 approved
     승인됨 (APPROVED)
     Contract + StatusLog 2건

  📦 payment_completed
     결제 완료 (PAYMENT_COMPLETED)
     Contract + Payment(DONE) + StatusLog 3건

  📦 in_progress
     임대중 (IN_PROGRESS)
     Contract + Payment(DONE) + StatusLog 4건

  📦 completed
     계약 완료 (COMPLETED)
     Contract + Payment(DONE) + StatusLog 5건

  📦 rejected
     거절됨 (REJECTED)
     Contract + StatusLog 2건

  📦 cancelled_with_refund
     게스트 취소 + 환불 (CANCELLED_BY_GUEST)
     Contract + Payment(CANCELED) + Refund(COMPLETED) + StatusLog 5건

  📦 in_progress_with_rental
     임대중 + 렌탈 주문 (IN_PROGRESS + RentalOrder)
     🏷️  렌탈 아이템 데이터 포함

  📦 completed_with_full_rental
     완료 + 렌탈 2건 (COMPLETED + INITIAL + ADDITIONAL)
     🏷️  렌탈 아이템 데이터 포함
```

---

## 🚀 방법 2: API로 직접 테스트

실제 API 흐름을 따라가며 테스트할 때 사용합니다.

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

---

## 🔄 방법 비교

| 상황 | 권장 방법 |
|------|----------|
| 다양한 상태의 데이터가 필요 | `npm run dev:seed-contracts` |
| 특정 API 흐름을 직접 테스트 | API + `npm run dev:approve-all` |
| 완전 자동화 (CLI도 불필요) | `.env`에 `AUTO_APPROVE_CONTRACTS=true` |

### ❌ 기존: 번거로운 방식
1. 게스트로 계약 요청 생성
2. **로그아웃** → 호스트 계정으로 **재로그인**
3. 호스트 API로 계약 승인
4. **로그아웃** → 게스트 계정으로 **다시 로그인**
5. 결제 진행

**문제**: 계정 전환 2회 필요, 시간 낭비

### ✅ 개선: 시드 도구 사용
```bash
npm run dev:seed-contracts
# → 계정 전환 불필요, 모든 상태 한 번에 생성
```

---

## 💡 실전 팁

### Tip 1: 프론트엔드 개발 시
```bash
# 모든 상태의 계약 데이터를 한 번에 생성해서
# 목록 UI, 상세 UI, 상태별 표시를 한 번에 테스트
npm run dev:seed-contracts
```

### Tip 2: 렌탈 기능 테스트 시
```bash
# 렌탈 주문이 포함된 시나리오만 생성
npm run dev:seed-contracts -- --scenario in_progress_with_rental
npm run dev:seed-contracts -- --scenario completed_with_full_rental
```

### Tip 3: 환불 플로우 테스트 시
```bash
# 취소+환불 시나리오
npm run dev:seed-contracts -- --scenario cancelled_with_refund
```

### Tip 4: 테스트 반복 시
```bash
# 정리 후 다시 생성 (반복 가능)
npm run dev:seed-clean && npm run dev:seed-contracts
```

### Tip 5: 대량 데이터 테스트
```bash
# 시나리오당 10개씩 = 총 90개 계약
npm run dev:seed-contracts -- --count 10
```

---

## 📊 상태 확인

언제든지 현재 계약 상황을 확인:

```bash
npm run dev:contract-status
```

---

## ⚠️ 주의사항

### 프로덕션에서는 사용 불가
이 도구는 개발/테스트 환경에서만 동작:
- ✅ `NODE_ENV=development` → 정상 동작
- ❌ `NODE_ENV=production` → 자동 차단

### DB 직접 수정
- 이 도구들은 API를 우회하고 DB를 직접 수정합니다
- 알림, 로그 등 비즈니스 로직이 실행되지 않습니다
- **테스트 목적으로만 사용하세요**

---

## 🛠️ 명령어 한눈에 보기

```bash
# 계약 관리
npm run dev:approve-all              # 모든 대기중인 계약 승인
npm run dev:approve <id>             # 특정 계약 승인
npm run dev:reject <id>              # 특정 계약 거절
npm run dev:contract-status          # 계약 상태 조회

# 시드 데이터
npm run dev:seed-contracts           # 모든 시나리오 생성
npm run dev:seed-contracts -- --scenario <name>  # 특정 시나리오
npm run dev:seed-contracts -- --host <id> --guest <id>  # 유저 지정
npm run dev:seed-contracts -- --count <n>  # 개수 지정
npm run dev:seed-contracts -- --dry-run  # 미리보기
npm run dev:seed-contracts -- --list  # 시나리오 목록
npm run dev:seed-clean               # 시드 데이터 정리
```

---

## 🆘 문제 해결

### "published 상태의 방이 없습니다"
→ 호스트가 방을 등록하고 관리자가 승인해야 합니다

### "호스트와 게스트가 같을 수 없습니다"
→ `--host`와 `--guest`에 다른 유저 ID를 지정하세요

### "계약 ID를 찾을 수 없습니다"
→ `npm run dev:contract-status`로 올바른 ID 확인

### 명령어가 실행되지 않음
→ 프로젝트 루트 디렉토리에서 실행하는지 확인
```bash
cd /path/to/ezstay_back
npm run dev:seed-contracts
```

---

## 📚 더 알아보기

- [상세 문서](README.md) - 전체 기능 및 사용법
- [CLAUDE.md](../../CLAUDE.md) - 프로젝트 전체 가이드
- [API 문서](../../docs/API_DOCUMENTATION.md) - 계약 API 상세 스펙

---

**Happy Testing!**
