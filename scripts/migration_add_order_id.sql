-- =====================================================
-- 계약 주문번호(orderId) 시스템 마이그레이션
-- 작성일: 2025-01-11
-- =====================================================

USE ezstay;

-- 1. contract_sequences 테이블 생성
CREATE TABLE IF NOT EXISTS contract_sequences (
  id INT AUTO_INCREMENT PRIMARY KEY,
  date_key DATE NOT NULL COMMENT '날짜 (YYYY-MM-DD)',
  last_number INT NOT NULL DEFAULT 0 COMMENT '마지막 순번',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_date (date_key)
) ENGINE=InnoDB COMMENT='계약 주문번호 시퀀스 관리';

-- 2. contracts 테이블에 order_id 컬럼 추가
ALTER TABLE contracts
ADD COLUMN order_id VARCHAR(11) NULL COMMENT '계약 주문번호 (yymmdd + 5자리 숫자)' AFTER id;

-- 3. order_id 유니크 인덱스 추가
ALTER TABLE contracts
ADD UNIQUE KEY uk_order_id (order_id);

-- 4. 기존 데이터 마이그레이션 (선택사항)
-- 기존 계약 데이터에 소급 적용이 필요한 경우 실행
-- 주의: 기존 데이터가 많으면 시간이 걸릴 수 있음

-- 날짜별로 순번을 리셋하여 주문번호 생성
UPDATE contracts c
INNER JOIN (
  SELECT
    id,
    CONCAT(
      DATE_FORMAT(created_at, '%y%m%d'),
      LPAD(
        @row_num := IF(@prev_date = DATE(created_at), @row_num + 1, 1),
        5, '0'
      )
    ) AS new_order_id,
    @prev_date := DATE(created_at) AS prev_date
  FROM contracts,
    (SELECT @row_num := 0, @prev_date := NULL) AS vars
  WHERE order_id IS NULL
  ORDER BY created_at, id
) AS numbered
ON c.id = numbered.id
SET c.order_id = numbered.new_order_id;

-- 5. order_id NOT NULL 제약조건 추가 (기존 데이터 마이그레이션 후)
-- ALTER TABLE contracts
-- MODIFY COLUMN order_id VARCHAR(11) NOT NULL COMMENT '계약 주문번호 (yymmdd + 5자리 숫자)';

-- =====================================================
-- 마이그레이션 완료
-- =====================================================
