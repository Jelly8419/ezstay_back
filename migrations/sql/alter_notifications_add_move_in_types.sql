-- ============================================================
-- notifications.type ENUM 확장
-- 입주 준비 서비스 임차인용 알림 타입 2종 추가
-- 작성일: 2026-05-08
-- 출처: 입주준비서비스_임차인_구현계획.md (Phase 12)
--
-- 추가 타입:
--   MOVE_IN_PAYMENT_REQUEST   — 임대인이 결제 요청 발송 (임차인 수신)
--   MOVE_IN_PAYMENT_COMPLETED — 임차인 옵션 결제 완료 (임차인 수신)
--
-- 적용 대상 DB: ezstay, ezstay_test
-- ============================================================

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

    -- 입주 준비 서비스 - 임차인 (Phase 12, 2026-05-08 추가)
    'MOVE_IN_PAYMENT_REQUEST',
    'MOVE_IN_PAYMENT_COMPLETED'
  ) NOT NULL COMMENT '알림 유형';


-- ============================================================
-- 검증
-- ============================================================
-- SHOW COLUMNS FROM notifications LIKE 'type';
