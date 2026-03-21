-- =====================================================
-- 영수증 테이블 마이그레이션
-- 1. receipt_settings 테이블 생성 (기존 host_receipt_settings 대체)
-- 2. receipts 테이블 생성 (거래건별 발급 이력)
-- 3. 기존 host_receipt_settings 데이터 마이그레이션
-- 4. 기존 host_receipt_settings 테이블 삭제
-- =====================================================

-- 1. receipt_settings 테이블 생성
CREATE TABLE IF NOT EXISTS receipt_settings (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL COMMENT '사용자 ID (호스트/게스트)',
  receipt_type ENUM('personal', 'business', 'tax_invoice') NOT NULL COMMENT '영수증 종류',
  receipt_number VARCHAR(30) NOT NULL COMMENT '폰번호/카드번호/사업자번호',
  business_name VARCHAR(100) DEFAULT NULL COMMENT '사업자명',
  rep_name VARCHAR(50) DEFAULT NULL COMMENT '대표자명',
  email VARCHAR(100) DEFAULT NULL COMMENT '이메일 (tax_invoice 전용)',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_receipt_settings_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='사용자 영수증 발급 정보 설정 테이블';

-- 2. receipts 테이블 생성
CREATE TABLE IF NOT EXISTS receipts (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL COMMENT '대상 사용자 ID',
  user_type ENUM('HOST', 'GUEST') NOT NULL COMMENT '사용자 유형',
  contract_id INT UNSIGNED DEFAULT NULL COMMENT '관련 계약 ID',
  settlement_id INT UNSIGNED DEFAULT NULL COMMENT '관련 정산 ID',
  receipt_type ENUM('personal', 'business', 'tax_invoice') NOT NULL COMMENT '영수증 종류 (스냅샷)',
  target_type ENUM('CONTRACT_FEE', 'HOST_CANCEL_FEE', 'GUEST_CANCEL_FEE', 'OPTION_SALE') NOT NULL COMMENT '발급 유형',
  amount INT NOT NULL COMMENT '발급 대상 금액',
  date DATE NOT NULL COMMENT '결제일 또는 정산 지급일',
  status ENUM('PENDING', 'ISSUED') NOT NULL DEFAULT 'PENDING' COMMENT '발급 상태',
  issued_at DATETIME DEFAULT NULL COMMENT '발급 완료 시각',
  issued_by INT UNSIGNED DEFAULT NULL COMMENT '발급 처리 관리자 ID',
  issue_note VARCHAR(500) DEFAULT NULL COMMENT '관리자 메모',
  receipt_number VARCHAR(30) NOT NULL COMMENT '폰번호/카드번호/사업자번호 (스냅샷)',
  business_name VARCHAR(100) DEFAULT NULL COMMENT '사업자명 (스냅샷)',
  rep_name VARCHAR(50) DEFAULT NULL COMMENT '대표자명 (스냅샷)',
  email VARCHAR(100) DEFAULT NULL COMMENT '이메일 (스냅샷)',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_receipts_user (user_id, user_type),
  KEY idx_receipts_status (status),
  KEY idx_receipts_contract (contract_id),
  KEY idx_receipts_date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='영수증 발급 건 관리 테이블';

-- 3. 기존 데이터 마이그레이션 (host_receipt_settings → receipt_settings)
-- receipt_required='yes'이고 발급 정보가 있는 건만 이관
INSERT INTO receipt_settings (user_id, receipt_type, receipt_number, business_name, rep_name, email, created_at, updated_at)
SELECT host_id, receipt_type, receipt_number, business_name, rep_name, email, created_at, updated_at
FROM host_receipt_settings
WHERE receipt_required = 'yes'
  AND receipt_type IS NOT NULL
  AND receipt_number IS NOT NULL;

-- 4. 기존 테이블 삭제 (마이그레이션 확인 후 실행)
DROP TABLE IF EXISTS host_receipt_settings;
