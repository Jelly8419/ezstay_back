-- ============================================================
-- VAT 분리 컬럼 추가 (회계 시스템 30일 런칭 버전 - Week 1)
-- ------------------------------------------------------------
-- 목적: 플랫폼 수수료(게스트 9.9% / 호스트 3.3%)를 VAT 포함 총액과
--       공급가액/부가세로 분리 저장. 분기별 부가세 신고 시 SUM 한 번으로
--       공급가액·매출세액을 뽑을 수 있게 함.
--
-- 원칙:
--   - 기존 platform_fee / host_platform_fee 컬럼은 VAT 포함 총액으로 유지 (하위 호환)
--   - *_supply = 공급가액 (round(total × 10/11))
--   - *_vat    = 부가세 (total - supply)
--   - 불변식: supply + vat === total
--   - 모든 신규 컬럼 DEFAULT 0 → 기존 행은 0 으로 시작 (런칭 전이라 무관,
--     런칭 후 추가될 경우 백필 스크립트 필요)
--
-- 롤백: 각 ALTER 문 하단 주석의 DROP COLUMN 사용
-- ============================================================


-- 1) contracts : 계약 생성 시점의 게스트·호스트 수수료 스냅샷
ALTER TABLE contracts
  ADD COLUMN platform_fee_supply      BIGINT NOT NULL DEFAULT 0
    COMMENT '게스트 수수료 공급가액 (round(platform_fee × 10/11))'
    AFTER platform_fee,
  ADD COLUMN platform_fee_vat         BIGINT NOT NULL DEFAULT 0
    COMMENT '게스트 수수료 부가세 (platform_fee - platform_fee_supply)'
    AFTER platform_fee_supply,
  ADD COLUMN host_platform_fee_supply BIGINT NOT NULL DEFAULT 0
    COMMENT '호스트 수수료 공급가액 (round(host_platform_fee × 10/11))'
    AFTER host_platform_fee,
  ADD COLUMN host_platform_fee_vat    BIGINT NOT NULL DEFAULT 0
    COMMENT '호스트 수수료 부가세 (host_platform_fee - host_platform_fee_supply)'
    AFTER host_platform_fee_supply;

-- 롤백:
-- ALTER TABLE contracts
--   DROP COLUMN platform_fee_supply,
--   DROP COLUMN platform_fee_vat,
--   DROP COLUMN host_platform_fee_supply,
--   DROP COLUMN host_platform_fee_vat;


-- 2) settlements : 정산 시점의 호스트 수수료 스냅샷 (호스트 귀속 정산 전용)
ALTER TABLE settlements
  ADD COLUMN host_platform_fee_supply BIGINT NOT NULL DEFAULT 0
    COMMENT '호스트 수수료 공급가액 (round(host_platform_fee × 10/11))'
    AFTER host_platform_fee,
  ADD COLUMN host_platform_fee_vat    BIGINT NOT NULL DEFAULT 0
    COMMENT '호스트 수수료 부가세 (host_platform_fee - host_platform_fee_supply)'
    AFTER host_platform_fee_supply;

-- 롤백:
-- ALTER TABLE settlements
--   DROP COLUMN host_platform_fee_supply,
--   DROP COLUMN host_platform_fee_vat;


-- 3) refunds : 환불 시점의 원본 게스트 수수료 VAT 분리 보존
--    - platform_fee_deducted (비환불 수수료)는 이미 존재 → 거기서 VAT 분리 필요 시
--      환불 실행 컨트롤러에서 splitVatFromTotal 로 분리 계산 (별도 컬럼 불요)
--    - 분기별 신고 시 "환불로 역전된 공급가액/VAT" 가 필요하므로 원본에 분리 저장
ALTER TABLE refunds
  ADD COLUMN original_platform_fee_supply BIGINT NOT NULL DEFAULT 0
    COMMENT '원본 게스트 수수료 공급가액 (환불 시점의 round(originalPlatformFee × 10/11))'
    AFTER original_platform_fee,
  ADD COLUMN original_platform_fee_vat    BIGINT NOT NULL DEFAULT 0
    COMMENT '원본 게스트 수수료 부가세 (originalPlatformFee - originalPlatformFeeSupply)'
    AFTER original_platform_fee_supply;

-- 롤백:
-- ALTER TABLE refunds
--   DROP COLUMN original_platform_fee_supply,
--   DROP COLUMN original_platform_fee_vat;
