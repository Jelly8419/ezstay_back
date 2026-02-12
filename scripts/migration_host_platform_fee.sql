-- =====================================================
-- 호스트 플랫폼 수수료 컬럼 추가 마이그레이션
-- 실행일: 2025-02-07
-- 설명: contracts 테이블에 호스트 플랫폼 수수료 필드 추가
--       기존 platform_fee는 게스트 수수료(9.9%)
--       새로운 host_platform_fee는 호스트 수수료(3.3%)
-- =====================================================

-- 1. contracts 테이블에 호스트 플랫폼 수수료 컬럼 추가
ALTER TABLE contracts
ADD COLUMN host_platform_fee INT NOT NULL DEFAULT 0
  COMMENT '호스트 플랫폼 수수료 (3.3%, 정산 시 차감)'
  AFTER platform_fee;

-- 2. 기존 platform_fee 컬럼 코멘트 명확화
ALTER TABLE contracts
MODIFY COLUMN platform_fee INT NOT NULL DEFAULT 0
  COMMENT '게스트 플랫폼 수수료 (9.9%, 게스트가 추가 결제)';

-- 3. 기존 계약 데이터에 호스트 수수료 일괄 계산 (3.3%)
-- 주의: EZ청소서비스 사용 여부는 ez_services 테이블에서 확인 필요
-- 간단한 계산: (rental_fee + maintenance_fee + cleaning_fee) * 0.033
-- 실제로는 EZ청소서비스 사용 시 cleaning_fee 제외해야 함
UPDATE contracts c
LEFT JOIN rooms r ON c.room_id = r.id
LEFT JOIN ez_services ez ON r.id = ez.room_id
SET c.host_platform_fee = FLOOR(
  (c.rental_fee + c.maintenance_fee +
   CASE WHEN ez.cleaning_service = 1 THEN 0 ELSE c.cleaning_fee END
  ) * 0.033
)
WHERE c.host_platform_fee = 0;

-- =====================================================
-- 롤백 스크립트 (필요시 사용)
-- =====================================================
-- ALTER TABLE contracts
-- DROP COLUMN host_platform_fee;
--
-- ALTER TABLE contracts
-- MODIFY COLUMN platform_fee INT NOT NULL DEFAULT 0
--   COMMENT '플랫폼 수수료';
