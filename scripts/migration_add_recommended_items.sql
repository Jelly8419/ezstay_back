-- 호스트 권장 렌탈 아이템 기능 추가
-- 2025-01-27
-- Contract 테이블에 recommended_items 컬럼 추가

ALTER TABLE contracts
ADD COLUMN recommended_items TEXT NULL
COMMENT '호스트가 권장하는 렌탈 아이템 목록 (JSON)'
AFTER rental_items;

-- 컬럼 추가 확인
DESCRIBE contracts;
