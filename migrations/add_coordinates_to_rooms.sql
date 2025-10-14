-- ============================================
-- Room 테이블에 위도/경도 컬럼 추가
-- ============================================
-- 작성일: 2025-10-11
-- 설명: 카카오 로컬 API를 통한 주소-좌표 변환 기능을 위해
--       WGS84 좌표계 기반 위도/경도 컬럼 추가

USE livemoment;

-- 1. latitude (위도) 컬럼 추가
ALTER TABLE rooms
ADD COLUMN latitude DECIMAL(10, 8) NULL
COMMENT '위도 (WGS84 좌표계, 예: 37.4979517)'
AFTER detail_address;

-- 2. longitude (경도) 컬럼 추가
ALTER TABLE rooms
ADD COLUMN longitude DECIMAL(11, 8) NULL
COMMENT '경도 (WGS84 좌표계, 예: 127.0276188)'
AFTER latitude;

-- 3. 인덱스 추가 (지도 기반 검색 성능 향상)
-- 위도/경도를 이용한 범위 검색 시 사용
ALTER TABLE rooms
ADD INDEX idx_coordinates (latitude, longitude);

-- 4. 변경 사항 확인
DESCRIBE rooms;

-- ============================================
-- 롤백 스크립트 (필요 시 실행)
-- ============================================
-- ALTER TABLE rooms DROP INDEX idx_coordinates;
-- ALTER TABLE rooms DROP COLUMN longitude;
-- ALTER TABLE rooms DROP COLUMN latitude;
