-- =====================================================
-- Migration: quick_move_in 컬럼 타입 변경 (VARCHAR → INT)
-- Date: 2025-01-17
-- Description: quick_move_in을 "빠른 입주 가능일(일)" 정수값으로 변경
-- =====================================================

-- Step 1: 백업 테이블 생성 (선택사항, 안전을 위해 권장)
CREATE TABLE IF NOT EXISTS rooms_backup_quick_move_in_20250117 AS
SELECT id, quick_move_in, quick_move_in_discount
FROM rooms;

-- Step 2: 기존 데이터 정리 (NULL이 아닌 값들을 임시 컬럼에 저장)
-- 기존에 문자열로 저장된 데이터가 있다면 NULL로 초기화
UPDATE rooms
SET quick_move_in = NULL
WHERE quick_move_in IS NOT NULL;

-- Step 3: 컬럼 타입 변경 (VARCHAR(100) → INT)
ALTER TABLE rooms
MODIFY COLUMN quick_move_in INT NULL
COMMENT '빠른 입주 가능일 (일 단위, 예: 7 = 7일 이내)';

-- Step 4: 더미 데이터 생성 (50% 확률로 null, 나머지는 1~14일 랜덤)
UPDATE rooms
SET
  quick_move_in = CASE
    WHEN RAND() < 0.5 THEN NULL
    ELSE FLOOR(RAND() * 14) + 1  -- 1~14일 랜덤
  END
WHERE status = 'published';

-- Step 5: quick_move_in_discount 업데이트 (quick_move_in이 null이 아니면 1~10% 랜덤)
UPDATE rooms
SET
  quick_move_in_discount = CASE
    WHEN quick_move_in IS NULL THEN NULL
    ELSE FLOOR(RAND() * 10) + 1  -- 1~10% 랜덤
  END
WHERE status = 'published';

-- 검증 쿼리
SELECT
  COUNT(*) as total_published,
  SUM(CASE WHEN quick_move_in IS NOT NULL THEN 1 ELSE 0 END) as has_quick_move_in,
  AVG(quick_move_in) as avg_quick_move_in_days,
  MIN(quick_move_in) as min_days,
  MAX(quick_move_in) as max_days
FROM rooms
WHERE status = 'published';

-- 샘플 데이터 확인
SELECT
  id,
  room_name,
  quick_move_in,
  quick_move_in_discount,
  long_term_weeks,
  long_term_discount
FROM rooms
WHERE status = 'published'
LIMIT 10;
