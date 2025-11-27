-- ============================================================
-- Contract 상태값 및 로그 테이블 마이그레이션
-- 작성일: 2025-01-26
-- 설명: 관리자 취소 상태 추가, 취소 유형 컬럼 추가, 상태 변경 로그 테이블 생성
-- ============================================================

-- 트랜잭션 시작
START TRANSACTION;

-- ============================================================
-- 1. contracts 테이블 ENUM 값 수정
-- ============================================================

-- 기존 ENUM에 관리자 취소 상태 2개 추가
ALTER TABLE contracts
MODIFY COLUMN status ENUM(
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'PAYMENT_COMPLETED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED_BY_GUEST',
  'CANCELLED_BY_HOST',
  'CANCELLED_BY_ADMIN_WITH_REFUND',
  'CANCELLED_BY_ADMIN_NO_REFUND',
  'REFUNDED',
  'APPROVAL_EXPIRED',
  'PAYMENT_EXPIRED'
) NOT NULL DEFAULT 'PENDING_APPROVAL'
COMMENT '계약 상태';

-- ============================================================
-- 2. contracts 테이블에 취소 관련 컬럼 추가
-- ============================================================

-- 취소 유형 컬럼 추가
ALTER TABLE contracts
ADD COLUMN cancellation_type ENUM(
  'BEFORE_PAYMENT',
  'AFTER_PAYMENT',
  'DURING_STAY',
  'AFTER_COMPLETION'
) NULL
COMMENT '취소 유형 (취소된 경우에만 값 존재)'
AFTER cancellation_reason;

-- 취소한 관리자 ID 컬럼 추가
ALTER TABLE contracts
ADD COLUMN cancelled_by_admin_id INT NULL
COMMENT '취소한 관리자 ID (관리자 취소인 경우)'
AFTER cancellation_type;

-- 인덱스 추가
ALTER TABLE contracts ADD INDEX idx_cancellation_type (cancellation_type);
ALTER TABLE contracts ADD INDEX idx_cancelled_by_admin (cancelled_by_admin_id);

-- ============================================================
-- 3. contract_status_logs 테이블 생성
-- ============================================================

CREATE TABLE IF NOT EXISTS contract_status_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  contract_id INT NOT NULL COMMENT '계약 ID',
  from_status VARCHAR(50) NULL COMMENT '변경 전 상태',
  to_status VARCHAR(50) NOT NULL COMMENT '변경 후 상태',
  changed_by ENUM('GUEST', 'HOST', 'ADMIN', 'SYSTEM') NOT NULL COMMENT '변경 주체',
  changed_by_user_id INT NULL COMMENT '변경한 사용자 ID (User 또는 Admin)',
  reason TEXT NULL COMMENT '변경 사유',
  metadata JSON NULL COMMENT '추가 메타데이터 (환불 금액, 위약금 등)',
  ip_address VARCHAR(45) NULL COMMENT '요청 IP 주소',
  user_agent VARCHAR(500) NULL COMMENT '사용자 에이전트',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시점',

  -- 인덱스
  INDEX idx_contract (contract_id),
  INDEX idx_to_status (to_status),
  INDEX idx_changed_by (changed_by),
  INDEX idx_created_at (created_at),
  INDEX idx_contract_created (contract_id, created_at),

  -- 외래키
  CONSTRAINT fk_contract_status_logs_contract
    FOREIGN KEY (contract_id) REFERENCES contracts(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='계약 상태 변경 이력 (영구 보존)';

-- ============================================================
-- 4. 완료
-- ============================================================

COMMIT;

-- 확인 쿼리
SELECT 'Migration completed successfully!' AS result;

-- 테이블 구조 확인
DESCRIBE contracts;
DESCRIBE contract_status_logs;

-- 인덱스 확인
SHOW INDEX FROM contracts WHERE Key_name LIKE 'idx_cancel%';
SHOW INDEX FROM contract_status_logs;
