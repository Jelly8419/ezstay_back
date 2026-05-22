-- ============================================================
-- move_in_options 시드 데이터
-- 작성일: 2026-05-08
-- 출처: 입주준비서비스_임차인_구현계획.md (B안 — RentalItem과 분리)
--
-- 정책:
--   - 데이터는 운영 중인 rental_items (내부 계약 옵션) 와 동일하게 시작
--   - 추후 외부 임대인 정책상 가격/구성이 달라질 수 있어 분리 운영 (PRD 14 정신)
--   - 가격은 INT (원). rental_items 의 DECIMAL(10,2) 와 별개로 정수로 관리
--
-- 적용 대상 DB: ezstay, ezstay_test
-- ============================================================

-- ── 어메니티 키트 (구매) ─────────────────────────────────────
INSERT INTO move_in_options
  (name, description, option_type, category, price, total_stock, display_order, is_active, created_at, updated_at)
SELECT '어메니티 키트', '치약/칫솔/샴푸/린스 등 1회용 어메니티 세트', 'PURCHASE', 'AMENITY_KIT', 3000, 100, 1, 1, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM move_in_options WHERE name = '어메니티 키트');

-- ── 헤어드라이기 (대여) ─────────────────────────────────────
INSERT INTO move_in_options
  (name, description, option_type, category, price, total_stock, display_order, is_active, created_at, updated_at)
SELECT '헤어드라이기 대여', '헤어드라이기 1대 대여 (퇴실 시 회수)', 'RENTAL', 'HAIR_DRYER', 10000, 70, 2, 1, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM move_in_options WHERE name = '헤어드라이기 대여');

-- ── 침구류 대여 (대여) ─────────────────────────────────────
INSERT INTO move_in_options
  (name, description, option_type, category, price, total_stock, display_order, is_active, created_at, updated_at)
SELECT '침구류 대여', '이불/베개/시트 1세트 대여', 'RENTAL', 'BEDDING_SET', 25000, 150, 3, 1, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM move_in_options WHERE name = '침구류 대여');

-- ── 타올 세트 (구매) ───────────────────────────────────────
INSERT INTO move_in_options
  (name, description, option_type, category, price, total_stock, display_order, is_active, created_at, updated_at)
SELECT '타올', '수건 세트', 'PURCHASE', 'TOWEL_SET', 2000, 200, 4, 1, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM move_in_options WHERE name = '타올');


-- ============================================================
-- 검증 쿼리
-- ============================================================
-- SELECT id, name, option_type, category, price, total_stock, is_active, display_order
--   FROM move_in_options
--   ORDER BY display_order, id;
