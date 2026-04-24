-- ============================================================
-- 프로모션 이벤트 혜택 모드 확장 (benefit_mode)
-- ------------------------------------------------------------
-- 배경:
--   호스트 런칭 이벤트 정책 변경
--   - 기간: 무제한 → 오픈 후 ~ 2026-08-31 23:59:59 KST (고정 마감일)
--   - 선착순: 100명 → 무제한 (방 등록한 모든 인원)
--   - 혜택: 2만원 고정 → 정산 수수료 100% 면제
--
-- 설계 요지:
--   - start_at = 오픈 시각 (관리자가 PATCH 로 현재 시각 기록 → "오픈 버튼" 역할)
--   - end_at   = 2026-08-31 23:59:59 (고정 마감)
--   - benefit_mode = 할인 금액 해석 방식
--       FIXED_AMOUNT    : discount_amount 원 고정 차감 (기존 동작)
--       FEE_WAIVER_FULL : platform_fee 전액 면제 (discount_amount 무시)
--   - 유효기간 체크 기준:
--       호스트 혜택(apply_trigger=SETTLEMENT) → Contract.payment.approved_at 기준
--         → 결제가 end_at 이전이었으면 입주/정산이 end_at 이후여도 혜택 적용
--       게스트 혜택(apply_trigger=CONTRACT)   → 계약 생성 시점 (기존 now() 유지)
-- ============================================================

ALTER TABLE promotion_events
  ADD COLUMN benefit_mode ENUM('FIXED_AMOUNT', 'FEE_WAIVER_FULL') NOT NULL DEFAULT 'FIXED_AMOUNT'
    COMMENT '혜택 적용 방식. FIXED_AMOUNT=discount_amount 차감, FEE_WAIVER_FULL=수수료 전액 면제'
    AFTER discount_amount;

-- 롤백:
-- ALTER TABLE promotion_events DROP COLUMN benefit_mode;


-- ------------------------------------------------------------
-- 호스트 런칭 이벤트 정책 전환
-- ------------------------------------------------------------
-- 주의: 실행 전 아래 값이 운영 정책과 일치하는지 확인
--   - is_active:         false (오픈 전 비활성. 관리자 "오픈 버튼" 클릭 시
--                         isActive=true + startAt=NOW() 로 동시 PATCH)
--   - participant_limit: NULL (무제한 — 방 등록한 모든 호스트)
--   - benefit_mode:      FEE_WAIVER_FULL
--   - start_at:          NULL 유지 (오픈 시점에 PATCH 로 설정)
--   - end_at:            2026-08-31 23:59:59 (KST 자정 직전, 고정 마감)
-- ------------------------------------------------------------
UPDATE promotion_events
SET is_active         = false,
    benefit_mode      = 'FEE_WAIVER_FULL',
    participant_limit = NULL,
    start_at          = NULL,
    end_at            = '2026-08-31 23:59:59'
WHERE code = 'LAUNCH_HOST_2026';
