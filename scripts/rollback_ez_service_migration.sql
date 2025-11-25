-- =====================================================
-- EzService 마이그레이션 롤백 스크립트
-- 작성일: 2025-01-XX
-- 목적: 문제 발생 시 원상 복구
-- ⚠️ 주의: 롤백 후 애플리케이션 코드도 원래대로 복원 필수!
-- =====================================================

-- Step 1: 기존 테이블 존재 여부 확인
SELECT
  '🔍 테이블 존재 여부 확인' AS description,
  TABLE_NAME,
  TABLE_ROWS,
  CASE
    WHEN TABLE_NAME = 'room_free_services' THEN '✅ 원본 테이블 존재 (롤백 가능)'
    WHEN TABLE_NAME = 'ez_services' THEN '⚠️ 새 테이블 존재 (삭제 예정)'
    ELSE '❓ 상태 불명'
  END AS status
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'ezstay'
  AND TABLE_NAME IN ('room_free_services', 'ez_services')
ORDER BY TABLE_NAME;

-- Step 2: 데이터 백업 확인 (롤백 전 필수!)
SELECT
  '⚠️ 백업 확인 경고' AS warning,
  '롤백 전에 ez_services 테이블 데이터를 백업했는지 확인하세요!' AS message,
  '백업 명령: mysqldump -u root -p ezstay ez_services > backup_ez_services_before_rollback.sql' AS backup_command;

-- Step 3: ez_services 테이블 삭제
-- ⚠️ 주의: 이 작업은 되돌릴 수 없습니다!
-- 계속 진행하려면 아래 주석을 제거하세요.
/*
DROP TABLE IF EXISTS ez_services;

SELECT '✅ ez_services 테이블 삭제 완료' AS result;
*/

-- Step 4: room_free_services 테이블 확인
-- ⚠️ 주석 해제하여 원본 테이블이 그대로 남아있는지 확인
/*
SELECT
  '🔍 원본 테이블 확인' AS description,
  COUNT(*) AS room_free_services_count,
  '✅ 롤백 완료! 원본 테이블 사용 가능' AS status
FROM room_free_services;
*/

-- Step 5: 애플리케이션 코드 복원 체크리스트
SELECT
  '📋 애플리케이션 코드 복원 체크리스트' AS checklist,
  '1. models/EzService.js 파일 삭제' AS step1,
  '2. models/index.js의 EzService 관계 설정 제거' AS step2,
  '3. 컨트롤러에서 ezService → freeService 복원' AS step3,
  '4. API 엔드포인트 /ez-service → /free-services 복원' AS step4,
  '5. 애플리케이션 재시작 및 테스트' AS step5;

-- =====================================================
-- 롤백 후 확인 사항
-- =====================================================
-- 1. room_free_services 테이블이 정상적으로 존재하는지 확인
-- 2. 애플리케이션 로그에서 "ez_services" 관련 에러가 없는지 확인
-- 3. API 테스트 (방 등록, 조회 등)
-- 4. 데이터베이스 백업 유지 (최소 1주일)
-- =====================================================

-- =====================================================
-- 롤백 실패 시 복구 방법:
-- 1. backup_ezstay_before_ezservice_migration_YYYYMMDD.sql 복원
-- 2. 데이터베이스 관리자에게 문의
-- =====================================================
