-- room_free_services 테이블에 amenityKit 컬럼 추가
-- 어메니티 키트 제공 여부 (샴푸, 린스 등)

ALTER TABLE room_free_services
ADD COLUMN amenity_kit BOOLEAN NOT NULL DEFAULT false
AFTER bed_size_king;

-- 컬럼 추가 확인
-- SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
-- FROM INFORMATION_SCHEMA.COLUMNS
-- WHERE TABLE_NAME = 'room_free_services' AND TABLE_SCHEMA = 'livemoment';
