-- =====================================================
-- EzService 마이그레이션 검증 스크립트
-- 작성일: 2025-01-XX
-- 목적: 데이터 무결성 및 마이그레이션 성공 여부 확인
-- =====================================================

-- 1. 레코드 개수 비교
SELECT
  '1️⃣ 레코드 개수 비교' AS test_name,
  (SELECT COUNT(*) FROM room_free_services) AS original_count,
  (SELECT COUNT(*) FROM ez_services) AS migrated_count,
  CASE
    WHEN (SELECT COUNT(*) FROM room_free_services) = (SELECT COUNT(*) FROM ez_services)
    THEN '✅ PASS'
    ELSE '❌ FAIL'
  END AS result;

-- 2. 데이터 일치성 검증 (샘플 10개)
SELECT
  '2️⃣ 데이터 일치성 검증 (샘플 10개)' AS test_name,
  o.room_id,
  o.cleaning_service = n.cleaning_service AS cleaning_match,
  o.auto_password_change = n.auto_password_change AS password_change_match,
  COALESCE(o.room_password, '') = COALESCE(n.room_password, '') AS password_match,
  CASE
    WHEN o.cleaning_service = n.cleaning_service
      AND o.auto_password_change = n.auto_password_change
      AND COALESCE(o.room_password, '') = COALESCE(n.room_password, '')
    THEN '✅ PASS'
    ELSE '❌ FAIL'
  END AS result
FROM room_free_services o
JOIN ez_services n ON o.room_id = n.room_id
LIMIT 10;

-- 3. 전체 데이터 일치성 검증 (불일치 항목만 출력)
SELECT
  '3️⃣ 전체 데이터 일치성 검증' AS test_name,
  COUNT(*) AS total_mismatches,
  CASE
    WHEN COUNT(*) = 0 THEN '✅ PASS (모든 데이터 일치)'
    ELSE '❌ FAIL (불일치 항목 존재)'
  END AS result
FROM room_free_services o
JOIN ez_services n ON o.room_id = n.room_id
WHERE o.cleaning_service != n.cleaning_service
   OR o.auto_password_change != n.auto_password_change
   OR COALESCE(o.room_password, '') != COALESCE(n.room_password, '');

-- 4. Null 값 검증
SELECT
  '4️⃣ Null 값 검증' AS test_name,
  COUNT(*) AS total_records,
  SUM(CASE WHEN cleaning_service IS NULL THEN 1 ELSE 0 END) AS null_cleaning,
  SUM(CASE WHEN auto_password_change IS NULL THEN 1 ELSE 0 END) AS null_auto_password,
  CASE
    WHEN SUM(CASE WHEN cleaning_service IS NULL THEN 1 ELSE 0 END) = 0
      AND SUM(CASE WHEN auto_password_change IS NULL THEN 1 ELSE 0 END) = 0
    THEN '✅ PASS (Null 값 없음)'
    ELSE '❌ FAIL (Null 값 존재)'
  END AS result
FROM ez_services;

-- 5. 외래키 제약조건 검증 (고아 레코드 확인)
SELECT
  '5️⃣ 외래키 제약조건 검증' AS test_name,
  COUNT(*) AS orphaned_records,
  CASE
    WHEN COUNT(*) = 0 THEN '✅ PASS (고아 레코드 없음)'
    ELSE '❌ FAIL (고아 레코드 존재)'
  END AS result
FROM ez_services e
LEFT JOIN rooms r ON e.room_id = r.id
WHERE r.id IS NULL;

-- 6. 타임스탬프 검증 (마이그레이션 시 기존 타임스탬프 유지되었는지 확인)
SELECT
  '6️⃣ 타임스탬프 검증 (샘플 5개)' AS test_name,
  o.room_id,
  o.created_at AS old_created_at,
  n.created_at AS new_created_at,
  o.updated_at AS old_updated_at,
  n.updated_at AS new_updated_at,
  CASE
    WHEN o.created_at = n.created_at AND o.updated_at = n.updated_at
    THEN '✅ PASS'
    ELSE '❌ FAIL'
  END AS result
FROM room_free_services o
JOIN ez_services n ON o.room_id = n.room_id
LIMIT 5;

-- 7. 인덱스 존재 확인
SELECT
  '7️⃣ 인덱스 존재 확인' AS test_name,
  INDEX_NAME,
  COLUMN_NAME,
  '✅ EXISTS' AS result
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = 'ezstay'
  AND TABLE_NAME = 'ez_services'
  AND INDEX_NAME IN ('idx_cleaning_service', 'idx_auto_password_change');

-- 8. 외래키 제약조건 존재 확인
SELECT
  '8️⃣ 외래키 제약조건 존재 확인' AS test_name,
  CONSTRAINT_NAME,
  REFERENCED_TABLE_NAME,
  '✅ EXISTS' AS result
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = 'ezstay'
  AND TABLE_NAME = 'ez_services'
  AND CONSTRAINT_NAME = 'fk_ez_services_room_id';

-- =====================================================
-- 종합 결과 요약
-- =====================================================
SELECT
  '📊 종합 결과 요약' AS summary,
  CASE
    WHEN (SELECT COUNT(*) FROM room_free_services) = (SELECT COUNT(*) FROM ez_services)
      AND NOT EXISTS (
        SELECT 1 FROM room_free_services o
        JOIN ez_services n ON o.room_id = n.room_id
        WHERE o.cleaning_service != n.cleaning_service
           OR o.auto_password_change != n.auto_password_change
           OR COALESCE(o.room_password, '') != COALESCE(n.room_password, '')
      )
      AND NOT EXISTS (
        SELECT 1 FROM ez_services e
        LEFT JOIN rooms r ON e.room_id = r.id
        WHERE r.id IS NULL
      )
    THEN '✅ 마이그레이션 성공! 모든 검증 통과'
    ELSE '❌ 마이그레이션 실패! 위 결과를 확인하고 롤백을 고려하세요'
  END AS result;

-- =====================================================
-- 다음 단계:
-- 1. 모든 검증이 PASS이면 → 애플리케이션 코드 업데이트 및 테스트
-- 2. 검증 실패 시 → rollback_ez_service_migration.sql 실행
-- =====================================================
