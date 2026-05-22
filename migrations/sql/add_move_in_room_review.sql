-- ============================================================
-- 입주 준비 서비스 — 방 심사 도입
-- 작성일: 2026-05-11
-- 출처: Notion "입주 준비 서비스 Admin" (35d7d336b0e580a4aca3fd0f9479b1a2)
--
-- 변경 사항:
--   1) move_in_rooms 에 심사 컬럼 5개 추가
--      - review_status   ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING'
--      - submitted_at    DATETIME NULL
--      - approved_at     DATETIME NULL
--      - rejected_at     DATETIME NULL
--      - rejection_reason VARCHAR(500) NULL
--   2) move_in_room_status_histories 이력 테이블 신규
--   3) 기존 row 백필: 전부 PENDING 으로 재진입 (정책: 엄격 적용)
--   4) notifications.type ENUM 에 MOVE_IN_ROOM_REVIEW_RESULT 추가
--
-- 적용 대상 DB: ezstay, ezstay_test
-- ============================================================

-- ------------------------------------------------------------
-- 1) move_in_rooms ALTER
-- ------------------------------------------------------------
ALTER TABLE move_in_rooms
  ADD COLUMN review_status ENUM('PENDING','APPROVED','REJECTED')
    NOT NULL DEFAULT 'PENDING' COMMENT '심사 상태' AFTER memo,
  ADD COLUMN submitted_at DATETIME NULL COMMENT '심사 요청 시각' AFTER review_status,
  ADD COLUMN approved_at  DATETIME NULL COMMENT '승인 시각' AFTER submitted_at,
  ADD COLUMN rejected_at  DATETIME NULL COMMENT '반려 시각' AFTER approved_at,
  ADD COLUMN rejection_reason VARCHAR(500) NULL COMMENT '반려 사유' AFTER rejected_at,
  ADD INDEX idx_move_in_rooms_review (review_status, submitted_at);

-- ------------------------------------------------------------
-- 2) 기존 row 백필 (전부 PENDING, submitted_at = created_at)
--    정책: 엄격 적용 — 운영팀이 관리자 화면에서 일괄 승인 처리 필요
-- ------------------------------------------------------------
UPDATE move_in_rooms
   SET review_status = 'PENDING',
       submitted_at  = COALESCE(submitted_at, created_at)
 WHERE submitted_at IS NULL;

-- ------------------------------------------------------------
-- 3) move_in_room_status_histories 이력 테이블
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS move_in_room_status_histories (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  move_in_room_id INT NOT NULL COMMENT '방 ID (FK는 모델에서 설정)',
  admin_id        INT NULL COMMENT '변경한 관리자 ID (SYSTEM 전이 시 NULL)',
  changed_by      ENUM('HOST','ADMIN','SYSTEM') NOT NULL DEFAULT 'ADMIN' COMMENT '변경 주체',
  previous_status ENUM('PENDING','APPROVED','REJECTED') NULL COMMENT '변경 전 상태 (최초 등록 시 NULL)',
  new_status      ENUM('PENDING','APPROVED','REJECTED') NOT NULL COMMENT '변경 후 상태',
  reason          VARCHAR(500) NULL COMMENT '반려 사유 또는 재심사 트리거 메모',
  triggered_fields TEXT NULL COMMENT '재심사 트리거 필드 목록 (JSON 문자열)',
  ip_address      VARCHAR(45) NULL,
  user_agent      VARCHAR(255) NULL,
  changed_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mir_history_room (move_in_room_id, changed_at),
  INDEX idx_mir_history_admin (admin_id)
) COMMENT='입주 준비 방 심사 상태 변경 이력';

-- ------------------------------------------------------------
-- 4) notifications.type ENUM 확장 (방 심사 결과 알림 추가)
-- ------------------------------------------------------------
ALTER TABLE notifications
  MODIFY COLUMN type ENUM(
    -- 공통
    'MESSAGE',
    'NOTICE',
    'INQUIRY_ANSWERED',
    'PAYMENT_COMPLETED',
    'CHECKIN_TODAY',
    'CHECKOUT_REMINDER',
    'CHECKOUT_CONFIRMED',
    'CONTRACT_CANCELED',
    'CONTRACT',

    -- 게스트 전용
    'CONTRACT_REQUEST_GUEST',
    'CONTRACT_APPROVED',
    'CONTRACT_REJECTED',
    'PAYMENT_PENDING',
    'OPTION_DEADLINE',

    -- 호스트 전용
    'CONTRACT_REQUEST_HOST',
    'PROPERTY_REVIEW_RESULT',
    'ADDITIONAL_OPTION_PAYMENT',
    'CHECKIN_CONFIRMED',
    'CHECKOUT_REQUEST',

    -- 입주 준비 서비스 - 임차인
    'MOVE_IN_PAYMENT_REQUEST',
    'MOVE_IN_PAYMENT_COMPLETED',

    -- 입주 준비 서비스 - 임대인 (2026-05-11 추가)
    'MOVE_IN_ROOM_REVIEW_RESULT'
  ) NOT NULL COMMENT '알림 유형';

-- ============================================================
-- 검증 쿼리
-- ============================================================
-- SHOW COLUMNS FROM move_in_rooms LIKE 'review_status';
-- SHOW CREATE TABLE move_in_room_status_histories;
-- SELECT review_status, COUNT(*) FROM move_in_rooms GROUP BY review_status;
-- SHOW COLUMNS FROM notifications LIKE 'type';
