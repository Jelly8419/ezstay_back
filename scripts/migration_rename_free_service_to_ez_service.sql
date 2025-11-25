-- =====================================================
-- EzService 리팩토링 마이그레이션
-- 작성일: 2025-01-XX
-- 목적: room_free_services → ez_services 변경
-- 설명: 렌탈 아이템 관련 컬럼 제거 및 테이블명 변경
-- =====================================================

-- Step 1: 새로운 테이블 생성
CREATE TABLE ez_services (
  room_id INT NOT NULL PRIMARY KEY COMMENT '방 ID (외래키)',
  cleaning_service TINYINT(1) NOT NULL DEFAULT 0 COMMENT '무료 청소 서비스 제공 여부',
  auto_password_change TINYINT(1) NOT NULL DEFAULT 0 COMMENT '자동 비밀번호 변경 여부',
  room_password VARCHAR(100) DEFAULT NULL COMMENT '방 출입 비밀번호',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_ez_services_room_id FOREIGN KEY (room_id)
    REFERENCES rooms(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='이지서비스 (호스트 제공 무료 부가 서비스)';

-- Step 2: 인덱스 생성
CREATE INDEX idx_cleaning_service ON ez_services(cleaning_service);
CREATE INDEX idx_auto_password_change ON ez_services(auto_password_change);

-- Step 3: 기존 데이터 마이그레이션 (렌탈 관련 컬럼 제외)
INSERT INTO ez_services (room_id, cleaning_service, auto_password_change, room_password, created_at, updated_at)
SELECT
  room_id,
  cleaning_service,
  auto_password_change,
  room_password,
  created_at,
  updated_at
FROM room_free_services;

-- Step 4: 데이터 검증
SELECT
  '🔍 데이터 마이그레이션 결과' AS description,
  (SELECT COUNT(*) FROM room_free_services) AS original_count,
  (SELECT COUNT(*) FROM ez_services) AS migrated_count,
  CASE
    WHEN (SELECT COUNT(*) FROM room_free_services) = (SELECT COUNT(*) FROM ez_services)
    THEN '✅ SUCCESS'
    ELSE '❌ FAILED'
  END AS status;

-- Step 5: 샘플 데이터 비교 (처음 5개)
SELECT
  '🔍 샘플 데이터 비교 (처음 5개)' AS description,
  o.room_id,
  o.cleaning_service AS old_cleaning,
  n.cleaning_service AS new_cleaning,
  o.auto_password_change AS old_auto_password,
  n.auto_password_change AS new_auto_password,
  CASE
    WHEN o.cleaning_service = n.cleaning_service
      AND o.auto_password_change = n.auto_password_change
    THEN '✅ MATCH'
    ELSE '❌ MISMATCH'
  END AS status
FROM room_free_services o
JOIN ez_services n ON o.room_id = n.room_id
LIMIT 5;

-- =====================================================
-- 다음 단계 (수동 실행):
-- 1. 검증 스크립트 실행: verify_ez_service_migration.sql
-- 2. 애플리케이션 코드 업데이트 및 테스트
-- 3. 모든 검증 완료 후 아래 주석 해제하여 실행
-- =====================================================

-- Step 6: 기존 테이블 삭제 (모든 검증 완료 후 수동 실행)
-- ⚠️ 주의: 롤백 불가능! 백업 필수!
/*
DROP TABLE IF EXISTS room_free_services;

SELECT '✅ room_free_services 테이블 삭제 완료' AS result;
*/

-- =====================================================
-- 롤백 방법 (문제 발생 시):
-- rollback_ez_service_migration.sql 실행
-- =====================================================
