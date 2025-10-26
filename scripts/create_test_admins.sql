-- 테스트용 관리자 계정 생성 SQL
-- 사용법: MySQL 또는 MariaDB에 직접 실행

-- 비밀번호: admin1234! (bcrypt 해시)
-- bcrypt.hash('admin1234!', 10) = $2b$10$Os8ODpH71wUPy9HITk.qMOint2zMtmHQJnOlmMtHG7dQT5AxvNd6u

-- 1. 슈퍼 관리자
INSERT INTO admins (
  username,
  password,
  name,
  phone_number,
  role,
  is_active,
  created_at,
  updated_at
) VALUES (
  'admin',
  '$2b$10$Os8ODpH71wUPy9HITk.qMOint2zMtmHQJnOlmMtHG7dQT5AxvNd6u',
  '슈퍼관리자',
  '010-1234-5678',
  'super_admin',
  true,
  NOW(),
  NOW()
) ON DUPLICATE KEY UPDATE
  updated_at = NOW();

-- 2. 일반 관리자
INSERT INTO admins (
  username,
  password,
  name,
  phone_number,
  role,
  is_active,
  created_at,
  updated_at
) VALUES (
  'manager',
  '$2b$10$Os8ODpH71wUPy9HITk.qMOint2zMtmHQJnOlmMtHG7dQT5AxvNd6u',
  '일반관리자',
  '010-2234-5678',
  'admin',
  true,
  NOW(),
  NOW()
) ON DUPLICATE KEY UPDATE
  updated_at = NOW();

-- 3. CS 관리자
INSERT INTO admins (
  username,
  password,
  name,
  phone_number,
  role,
  is_active,
  created_at,
  updated_at
) VALUES (
  'csadmin',
  '$2b$10$Os8ODpH71wUPy9HITk.qMOint2zMtmHQJnOlmMtHG7dQT5AxvNd6u',
  'CS관리자',
  '010-3234-5678',
  'cs_admin',
  true,
  NOW(),
  NOW()
) ON DUPLICATE KEY UPDATE
  updated_at = NOW();

-- 생성된 계정 확인
SELECT id, username, name, role, is_active, created_at
FROM admins
WHERE username IN ('admin', 'manager', 'csadmin');
