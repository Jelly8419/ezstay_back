-- ============================================================
-- payments 테이블 payment_type 컬럼 추가
-- 계약 결제(CONTRACT)와 호스트 부담금 결제(HOST_BURDEN) 구분
-- ============================================================

ALTER TABLE payments
  ADD COLUMN payment_type ENUM('CONTRACT', 'HOST_BURDEN')
    NOT NULL DEFAULT 'CONTRACT'
    COMMENT '결제 유형 (CONTRACT: 계약 결제, HOST_BURDEN: 호스트 부담금)'
    AFTER contract_id;

-- 인덱스 추가
ALTER TABLE payments
  ADD INDEX idx_payment_type (payment_type);
