-- =====================================================
-- 게스트 환급 계좌 테이블 생성
-- 무통장/가상계좌로 결제한 게스트의 환급 계좌 관리
-- 호스트 정산계좌(user_bank_accounts)와 별도 테이블
-- =====================================================

CREATE TABLE IF NOT EXISTS guest_refund_accounts (
  id INT AUTO_INCREMENT PRIMARY KEY COMMENT '환급 계좌 고유 ID',
  user_id INT NOT NULL COMMENT '사용자 ID (users 테이블 참조)',
  bank_code VARCHAR(3) NOT NULL COMMENT '은행 코드 (예: 004, 088)',
  bank_name VARCHAR(50) NOT NULL COMMENT '은행명 (예: KB국민은행, 신한은행)',
  account_number VARCHAR(30) NOT NULL COMMENT '계좌번호 (하이픈 제거)',
  account_holder VARCHAR(50) NOT NULL COMMENT '예금주명',
  is_verified TINYINT(1) NOT NULL DEFAULT 0 COMMENT '예금주 확인 완료 여부 (아임포트)',
  verified_at DATETIME NULL COMMENT '예금주 확인 완료 시간',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY guest_refund_accounts_user_id_unique (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='게스트 환급 계좌 정보 (무통장/가상계좌 환불용)';
