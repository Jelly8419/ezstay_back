-- ============================================================
-- 입주 준비 서비스 - 임차인(게스트) 도메인 인덱스 추가
-- 작성일: 2026-05-07
-- 출처: 입주준비서비스_임차인_구현계획.md (Phase 1)
--
-- 사유:
--   기존 테이블은 Sequelize sync 로 생성되어 PK/UNIQUE 외 인덱스가 없음.
--   FK 미적용은 CLAUDE.md 정책(외래키는 models/index.js belongsTo/hasMany 로 관리) 에 따라 그대로 둠.
--   조회 성능 확보를 위해 INDEX 만 추가.
--
-- 적용 대상 DB: ezstay, ezstay_test (둘 다 적용 필요)
--
-- ※ 멱등성: CREATE INDEX 는 같은 이름이 있으면 에러 발생.
--    재실행 시 사전 SHOW INDEX 로 존재 여부 확인 후 실행 권장.
-- ============================================================


-- ============================================================
-- 1) move_in_options
-- ============================================================
ALTER TABLE move_in_options
  ADD INDEX idx_move_in_options_active   (is_active),
  ADD INDEX idx_move_in_options_category (category),
  ADD INDEX idx_move_in_options_display  (display_order);


-- ============================================================
-- 2) move_in_guest_orders
--    PRIMARY 와 UNIQUE(order_id) 는 이미 있음.
-- ============================================================
ALTER TABLE move_in_guest_orders
  ADD INDEX idx_move_in_guest_orders_case     (case_id),
  ADD INDEX idx_move_in_guest_orders_guest    (guest_user_id, status),
  ADD INDEX idx_move_in_guest_orders_status   (status),
  ADD INDEX idx_move_in_guest_orders_delivery (delivery_status),
  ADD INDEX idx_move_in_guest_orders_modify   (modifiable_until),
  ADD INDEX idx_move_in_guest_orders_paid_at  (paid_at);


-- ============================================================
-- 3) move_in_guest_order_items
-- ============================================================
ALTER TABLE move_in_guest_order_items
  ADD INDEX idx_mig_order_items_order  (guest_order_id),
  ADD INDEX idx_mig_order_items_option (option_id),
  ADD INDEX idx_mig_order_items_status (status);


-- ============================================================
-- 4) move_in_guest_payments
-- ============================================================
ALTER TABLE move_in_guest_payments
  ADD INDEX idx_mig_payments_order  (guest_order_id),
  ADD INDEX idx_mig_payments_guest  (guest_user_id, status),
  ADD INDEX idx_mig_payments_case   (case_id),
  ADD INDEX idx_mig_payments_status (status);


-- ============================================================
-- 5) move_in_guest_order_logs
-- ============================================================
ALTER TABLE move_in_guest_order_logs
  ADD INDEX idx_mig_logs_order   (guest_order_id),
  ADD INDEX idx_mig_logs_item    (guest_order_item_id),
  ADD INDEX idx_mig_logs_case    (case_id),
  ADD INDEX idx_mig_logs_action  (action),
  ADD INDEX idx_mig_logs_actor   (actor, actor_id),
  ADD INDEX idx_mig_logs_created (created_at);


-- ============================================================
-- 검증 쿼리
-- ============================================================
-- SHOW INDEX FROM move_in_options;
-- SHOW INDEX FROM move_in_guest_orders;
-- SHOW INDEX FROM move_in_guest_order_items;
-- SHOW INDEX FROM move_in_guest_payments;
-- SHOW INDEX FROM move_in_guest_order_logs;
