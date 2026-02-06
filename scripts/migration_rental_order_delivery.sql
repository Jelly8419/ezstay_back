-- =====================================================
-- 렌탈 주문 배송 상태 추가 마이그레이션
-- 실행일: 2025-02-07
-- 설명: rental_orders 테이블에 배송 상태 필드 추가
--       rental_order_logs 테이블에 배송 관련 액션 추가
-- =====================================================

-- 1. rental_orders 테이블에 배송 상태 컬럼 추가
ALTER TABLE rental_orders
ADD COLUMN delivery_status ENUM('PENDING', 'IN_TRANSIT', 'DELIVERED')
  NOT NULL DEFAULT 'PENDING'
  COMMENT '배송 상태 (PENDING: 배송전, IN_TRANSIT: 배송중, DELIVERED: 배송완료)'
  AFTER status,
ADD COLUMN delivered_at DATETIME NULL
  COMMENT '배송 완료 시점'
  AFTER delivery_status;

-- 2. 배송 상태 인덱스 추가
ALTER TABLE rental_orders
ADD INDEX idx_rental_orders_delivery_status (delivery_status);

-- 3. rental_order_logs 테이블의 action ENUM에 배송 관련 액션 추가
-- 주의: MySQL에서 ENUM 타입 수정 시 기존 값들을 모두 포함해야 함
ALTER TABLE rental_order_logs
MODIFY COLUMN action ENUM(
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
  'ORDER_EXPIRED',
  'DELIVERY_STARTED',
  'DELIVERY_COMPLETED'
) NOT NULL COMMENT '액션 유형';

-- =====================================================
-- 롤백 스크립트 (필요시 사용)
-- =====================================================
-- ALTER TABLE rental_orders
-- DROP INDEX idx_rental_orders_delivery_status,
-- DROP COLUMN delivered_at,
-- DROP COLUMN delivery_status;

-- ALTER TABLE rental_order_logs
-- MODIFY COLUMN action ENUM(
--   'ORDER_CREATED',
--   'ITEM_ADDED',
--   'ITEM_CANCELLED',
--   'PAYMENT_PENDING',
--   'PAYMENT_COMPLETED',
--   'PAYMENT_FAILED',
--   'REFUND_REQUESTED',
--   'REFUND_COMPLETED',
--   'REFUND_FAILED',
--   'ORDER_CANCELLED',
--   'ORDER_EXPIRED'
-- ) NOT NULL COMMENT '액션 유형';
