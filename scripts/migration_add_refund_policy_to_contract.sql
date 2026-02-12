-- ============================================================
-- Contract 테이블에 환불정책 스냅샷 컬럼 추가 마이그레이션
-- 작성일: 2025-01-26
-- 설명: 계약 시점의 환불정책을 보존하기 위한 컬럼 추가
-- ============================================================

-- 트랜잭션 시작
START TRANSACTION;

-- ============================================================
-- 1. contracts 테이블에 환불정책 관련 컬럼 추가
-- ============================================================

-- 환불정책 타입 컬럼 추가
ALTER TABLE contracts
ADD COLUMN refund_policy_type VARCHAR(50) NULL
COMMENT '계약 시점의 환불정책 타입 (약하게, 보통, 엄격하게)'
AFTER pricing_snapshot;

-- 환불정책 스냅샷 컬럼 추가 (JSON)
ALTER TABLE contracts
ADD COLUMN refund_policy_snapshot TEXT NULL
COMMENT '계약 시점의 환불정책 상세 규칙 (JSON)'
AFTER refund_policy_type;

-- ============================================================
-- 2. 인덱스 추가
-- ============================================================

ALTER TABLE contracts ADD INDEX idx_refund_policy_type (refund_policy_type);

-- ============================================================
-- 3. 완료
-- ============================================================

COMMIT;

-- 확인 쿼리
SELECT 'Migration completed successfully!' AS result;

-- 테이블 구조 확인
DESCRIBE contracts;

-- 인덱스 확인
SHOW INDEX FROM contracts WHERE Key_name LIKE 'idx_refund%';
