-- =====================================================
-- RentalOrderLog action ENUM에 ORDER_EXPIRED 추가
-- 생성일: 2025-02-04
-- 설명: 자동 만료 스케줄러를 위한 액션 타입 추가
-- =====================================================

-- 기존 ENUM에 ORDER_EXPIRED 추가
ALTER TABLE `rental_order_logs`
MODIFY COLUMN `action` ENUM(
  'ORDER_CREATED',
  'ITEM_ADDED',
  'ITEM_CANCELLED',
  'PAYMENT_PENDING',
  'PAYMENT_COMPLETED',
  'PAYMENT_FAILED',
  'REFUND_REQUESTED',
  'REFUND_COMPLETED',
  'REFUND_FAILED',
  'ORDER_CANCELLED',
  'ORDER_EXPIRED'
) NOT NULL COMMENT '액션 유형';

-- 확인용 쿼리
-- SHOW COLUMNS FROM rental_order_logs LIKE 'action';
