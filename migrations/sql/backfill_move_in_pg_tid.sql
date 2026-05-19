-- =====================================================================
-- 입주 준비 결제 pgTid(PG 거래번호) 백필 + 수동 취소 가이드
-- 작성: 2026-05-19
-- 배경:
--   PAYSTDMPI 카드결제 응답의 PG 거래번호는 `orderno` 필드로 오는데,
--   기존 코드가 tran_key || recv_orderno 만 보고 추출 → pg_tid 가 NULL 로 저장됨.
--   PayTag 취소(CARDCANCEL)는 orderno 로 "PG 거래번호"를 요구하므로
--   pg_tid 가 NULL 인 기존 결제 완료 건은 자동 취소 불가.
--
--   코드 수정 이후 신규 결제는 pg_tid 에 PG 거래번호가 정상 저장됨.
--   기존 건은 PG 거래번호를 우리가 알 수 없어 SQL 만으론 복구 불가 →
--   PayTag 관리자 콘솔(거래내역)과 대조해 수동 백필해야 함.
-- =====================================================================

-- ── STEP 1. 백필 대상 식별 (PAID 인데 pg_tid 없는 건) ──

-- 옵션 결제
SELECT p.id            AS payment_id,
       p.guest_order_id,
       o.order_id       AS shop_orderno,   -- PayTag 콘솔의 "가맹점주문번호"
       p.amount,
       p.paid_at,
       p.pg_tid
FROM   move_in_guest_payments p
JOIN   move_in_guest_orders   o ON o.id = p.guest_order_id
WHERE  p.status = 'PAID'
  AND  (p.pg_tid IS NULL OR p.pg_tid = '')
ORDER  BY p.paid_at;

-- 청소 결제
SELECT p.id        AS payment_id,
       p.case_id,
       p.order_id   AS shop_orderno,       -- PayTag 콘솔의 "가맹점주문번호"
       p.amount,
       p.paid_at,
       p.pg_tid
FROM   move_in_payments p
WHERE  p.status = 'PAID'
  AND  (p.pg_tid IS NULL OR p.pg_tid = '')
ORDER  BY p.paid_at;

-- ── STEP 2. 수동 백필 (PayTag 콘솔에서 PG 거래번호 확보 후) ──
--
-- PayTag 관리자 콘솔 > 거래내역에서 위 shop_orderno 로 검색하여
-- 각 건의 "PG거래번호(orderno)" 를 확인한 뒤, 건별로 UPDATE.
--
-- ⚠️ 절대 일괄 UPDATE 금지. 건별로 PG 콘솔 대조 후 1건씩.
--
-- 예) shop_orderno '260518-G0004' 의 PG 거래번호가 '20260518016933' 인 경우:
--
--   UPDATE move_in_guest_payments
--   SET    pg_tid = '20260518016933'
--   WHERE  id = <payment_id>          -- STEP1 에서 확인한 payment_id
--     AND  pg_tid IS NULL;            -- 안전장치 (이미 채워졌으면 skip)
--
--   UPDATE move_in_payments
--   SET    pg_tid = '<PG거래번호>'
--   WHERE  id = <payment_id>
--     AND  pg_tid IS NULL;
--
-- 백필 후에는 해당 건도 정상 자동 취소/환불 가능.

-- ── STEP 3. 백필 불가 건 처리 ──
--
-- PayTag 콘솔에서도 거래를 못 찾는 경우(이미 정산 완료/거래 만료 등):
--   - 자동 취소 API 는 4903(MISSING_PG_TID) 으로 거절됨 (코드에서 가드).
--   - 해당 건 환불은 PayTag 콘솔에서 직접 수동 취소 처리 후,
--     DB 상태를 운영자가 수기 정리 (order=FULLY_REFUNDED, payment=CANCELLED 등).
--   - 수기 정리 시 MoveInGuestOrderLog 에 actor='ADMIN', action='MANUAL_REFUND' 로그 권장.
