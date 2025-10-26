-- Ezstay Admin 테이블 생성 및 초기 데이터 삽입
--
-- 사용법:
-- 1. MySQL 접속: mysql -u root -p
-- 2. 데이터베이스 선택: USE ezstay;
-- 3. 파일 실행: SOURCE scripts/initAdmin.sql;
--
-- 또는 한 번에:
-- mysql -u root -p ezstay < scripts/initAdmin.sql

-- ============================================
-- 1. Admin 테이블 생성
-- ============================================

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

-- ============================================
-- 2. 초기 관리자 계정 생성
-- ============================================

-- 비밀번호: admin1234!
-- bcrypt 해싱 결과: $2a$10$YourHashedPasswordHere

-- 주의: 실제 사용 시 아래 비밀번호를 bcrypt로 해싱한 값으로 교체해야 합니다!
-- Node.js에서 해싱: await bcrypt.hash('admin1234!', 10)

INSERT INTO admins (username, password, name, phone_number, role, is_active, created_at, updated_at)
VALUES
-- 최고 관리자 (개발용 - 실제 배포 시 비밀번호 변경 필수!)
(
  'admin',
  '$2a$10$wXqZ7b8f8X8X8X8X8X8X8OQ7Jx.xXxXxXxXxXxXxXxXxXxXxXxXxX', -- 실제 bcrypt 해시로 교체 필요
  '최고관리자',
  '010-1234-5678',
  'super_admin',
  1,
  NOW(),
  NOW()
),

-- 일반 관리자 (예시)
(
  'manager',
  '$2a$10$wXqZ7b8f8X8X8X8X8X8X8OQ7Jx.xXxXxXxXxXxXxXxXxXxXxXxXxX', -- 실제 bcrypt 해시로 교체 필요
  '일반관리자',
  '010-2345-6789',
  'admin',
  1,
  NOW(),
  NOW()
),

-- 고객센터 관리자 (예시)
(
  'cs',
  '$2a$10$wXqZ7b8f8X8X8X8X8X8X8OQ7Jx.xXxXxXxXxXxXxXxXxXxXxXxXxX', -- 실제 bcrypt 해시로 교체 필요
  '고객센터',
  '010-3456-7890',
  'cs_admin',
  1,
  NOW(),
  NOW()
)
ON DUPLICATE KEY UPDATE
  updated_at = NOW();

-- ============================================
-- 3. 생성 결과 확인
-- ============================================

SELECT
  '✅ Admin 테이블 생성 완료!' AS status;

SELECT
  '📋 생성된 관리자 계정:' AS info;

SELECT
  id,
  username,
  name,
  role,
  is_active,
  created_at
FROM admins
ORDER BY role DESC, id ASC;

SELECT
  CONCAT(
    '⚠️  주의: 비밀번호를 실제 bcrypt 해시값으로 변경해야 합니다!',
    '\n',
    '방법: node scripts/createAdmin.js'
  ) AS warning;
