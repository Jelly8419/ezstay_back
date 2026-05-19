-- =====================================================================
-- 입주 준비 옵션 결제 — pg_tid NULL 인 PAID 건 일괄 환불 처리
-- 작성: 2026-05-19
-- 용도:
--   테스트 서버는 23:00 에 PG 측 자동 환불 처리됨.
--   DB 의 pg_tid=NULL 인 PAID 옵션 주문은 자동 취소 API 가 막히므로
--   (코드 가드 4903), DB 상태만 코드의 정상 환불 전이와 동일하게 일괄 정리.
--
-- ⚠️ 실행 전 반드시:
--   1. 대상 SELECT 로 건수/내역 먼저 확인
--   2. 트랜잭션으로 감싸 실행 (BEGIN ... COMMIT)
--   3. 운영 DB 가 아닌 "테스트 서버 DB" 에서만 실행
-- =====================================================================

-- ── STEP 0. 대상 확인 (먼저 실행해서 건수 검토) ──
SELECT p.id            AS payment_id,
       o.id             AS order_id,
       o.order_id        AS order_no,
       o.status          AS order_status,
       p.status          AS payment_status,
       p.amount,
       p.paid_at
FROM   move_in_guest_payments p
JOIN   move_in_guest_orders   o ON o.id = p.guest_order_id
WHERE  p.status = 'PAID'
  AND  (p.pg_tid IS NULL OR p.pg_tid = '')
ORDER  BY p.paid_at;

-- ── STEP 1. 일괄 환불 처리 (트랜잭션 권장) ──
BEGIN;

-- 1-1. 결제: PAID → CANCELLED
UPDATE move_in_guest_payments p
SET    p.status         = 'CANCELLED',
       p.failed_at       = NOW(),
       p.failure_reason  = '테스트 서버 일괄 환불 처리 (pg_tid 누락)',
       p.updated_at      = NOW()
WHERE  p.status = 'PAID'
  AND  (p.pg_tid IS NULL OR p.pg_tid = '');

-- 1-2. 주문 라인: ACTIVE → CANCELLED (대상 결제가 걸린 주문의 라인)
UPDATE move_in_guest_order_items it
JOIN   move_in_guest_orders o    ON o.id = it.guest_order_id
JOIN   move_in_guest_payments p  ON p.guest_order_id = o.id
SET    it.status        = 'CANCELLED',
       it.cancelled_at   = NOW(),
       it.cancel_reason  = '테스트 서버 일괄 환불 처리',
       it.refund_amount  = it.total_price,
       it.updated_at     = NOW()
WHERE  it.status = 'ACTIVE'
  AND  p.status = 'CANCELLED'
  AND  p.failure_reason = '테스트 서버 일괄 환불 처리 (pg_tid 누락)';

-- 1-3. 주문: PAID/PARTIAL_REFUND → FULLY_REFUNDED
UPDATE move_in_guest_orders o
JOIN   move_in_guest_payments p ON p.guest_order_id = o.id
SET    o.status          = 'FULLY_REFUNDED',
       o.refunded_amount  = o.paid_amount,
       o.updated_at       = NOW()
WHERE  o.status IN ('PAID', 'PARTIAL_REFUND')
  AND  p.status = 'CANCELLED'
  AND  p.failure_reason = '테스트 서버 일괄 환불 처리 (pg_tid 누락)';

-- 1-4. 결과 검증 (남은 PAID + pg_tid NULL 없어야 함)
SELECT COUNT(*) AS remaining
FROM   move_in_guest_payments
WHERE  status = 'PAID'
  AND  (pg_tid IS NULL OR pg_tid = '');

-- 검토 후 이상 없으면:
COMMIT;
-- 문제 있으면:
-- ROLLBACK;
