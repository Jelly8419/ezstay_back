-- 임대료 및 관리비 기준 변경: 1주일 → 1일
-- 작성일: 2025-01-XX

-- 1단계: 기존 데이터 백업 (선택사항, 안전을 위해 권장)
-- CREATE TABLE rooms_backup_20250117 AS SELECT * FROM rooms;

-- 2단계: 새로운 컬럼 추가 (1일 기준)
ALTER TABLE rooms
ADD COLUMN daily_rent INT NULL COMMENT '1일 임대료' AFTER weekly_rent,
ADD COLUMN daily_maintenance_fee INT NULL COMMENT '1일 관리비' AFTER maintenance_fee;

-- 3단계: 기존 데이터를 1일 기준으로 변환
-- (weeklyRent / 7)을 반올림하여 dailyRent에 저장
-- 1,000원 단위로 반올림 (예: 142,857원 → 143,000원)
UPDATE rooms
SET
  daily_rent = ROUND(weekly_rent / 7 / 1000) * 1000,
  daily_maintenance_fee = ROUND(maintenance_fee / 7 / 1000) * 1000
WHERE weekly_rent IS NOT NULL;

-- 4단계: 기존 주간 컬럼 삭제 (데이터 확인 후 실행)
-- 주의: 이 단계는 신중하게 실행하세요!
-- ALTER TABLE rooms
-- DROP COLUMN weekly_rent,
-- DROP COLUMN maintenance_fee;

-- 5단계: (선택) 기존 컬럼 이름 변경 (삭제 대신 이름만 변경)
-- 이 방법은 데이터 손실이 없어 더 안전합니다
-- long_term_weeks, min_contract_weeks는 그대로 유지 (주 단위 기준)
ALTER TABLE rooms
CHANGE COLUMN weekly_rent weekly_rent_deprecated INT NULL COMMENT '(사용중지) 1주일 임대료',
CHANGE COLUMN maintenance_fee maintenance_fee_deprecated INT NULL COMMENT '(사용중지) 1주일 관리비';

-- 6단계: daily 컬럼을 NOT NULL로 변경 (데이터 확인 후)
-- ALTER TABLE rooms
-- MODIFY COLUMN daily_rent INT NOT NULL COMMENT '1일 임대료',
-- MODIFY COLUMN daily_maintenance_fee INT NOT NULL COMMENT '1일 관리비';

-- 7단계: 검증 쿼리 (변환 확인)
-- SELECT
--   id,
--   room_name,
--   weekly_rent_deprecated AS '기존_주간임대료',
--   daily_rent AS '변환_일일임대료',
--   ROUND(weekly_rent_deprecated / 7 / 1000) * 1000 AS '계산값_확인',
--   maintenance_fee_deprecated AS '기존_주간관리비',
--   daily_maintenance_fee AS '변환_일일관리비'
-- FROM rooms
-- WHERE weekly_rent_deprecated IS NOT NULL
-- LIMIT 10;
