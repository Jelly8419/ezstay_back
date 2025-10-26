-- Ezstay Admin 테이블 생성 쿼리
-- 실행: mysql -u root -p ezstay < scripts/createAdminTable.sql

-- 기존 테이블이 있으면 삭제 (주의!)
-- DROP TABLE IF EXISTS admins;

-- Admin 테이블 생성
CREATE TABLE IF NOT EXISTS admins (
  -- 기본 정보
  id INT AUTO_INCREMENT PRIMARY KEY COMMENT '관리자 ID',
  username VARCHAR(50) NOT NULL UNIQUE COMMENT '관리자 아이디 (로그인 ID)',
  password VARCHAR(255) NOT NULL COMMENT '비밀번호 (bcrypt 해싱)',
  name VARCHAR(100) NOT NULL COMMENT '관리자 이름',
  phone_number VARCHAR(20) DEFAULT NULL COMMENT '휴대폰 번호',

  -- 권한 및 상태
  role ENUM('super_admin', 'admin', 'cs_admin') NOT NULL DEFAULT 'admin'
    COMMENT 'super_admin: 최고관리자, admin: 일반관리자, cs_admin: 고객센터 관리자',
  is_active TINYINT(1) NOT NULL DEFAULT 1 COMMENT '계정 활성화 여부',

  -- 인증 관련
  refresh_token TEXT DEFAULT NULL COMMENT 'JWT Refresh Token',
  last_login_at DATETIME DEFAULT NULL COMMENT '마지막 로그인 시간',

  -- 타임스탬프
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시간',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시간',

  -- 인덱스
  INDEX idx_username (username),
  INDEX idx_role (role),
  INDEX idx_is_active (is_active),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='관리자 계정 테이블';

-- 초기 관리자 계정 생성 (선택사항)
-- 비밀번호: admin1234! (bcrypt 해싱 필요)
-- INSERT INTO admins (username, password, name, phone_number, role, is_active)
-- VALUES (
--   'admin',
--   '$2a$10$EXAMPLE_HASHED_PASSWORD', -- 실제 bcrypt 해싱된 비밀번호로 교체 필요
--   '최고관리자',
--   '010-1234-5678',
--   'super_admin',
--   1
-- );

-- 테이블 정보 확인
DESCRIBE admins;

-- 생성 완료 메시지
SELECT 'Admin 테이블 생성 완료!' AS message;
