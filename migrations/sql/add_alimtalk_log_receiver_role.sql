-- ============================================================
-- alimtalk_logs — receiver_role 컬럼 보정
-- 작성일: 2026-05-21
--
-- 배경:
--   AlimtalkLog 모델은 receiver_role 컬럼을 정의하지만
--   일부 환경(특히 test DB)에 해당 컬럼이 누락되어 있어
--   AlimtalkLog.create / findAll 시 "Unknown column 'receiver_role'" 오류 발생.
--   → 모델 정의와 동기화하기 위해 컬럼 추가.
--
-- 운영(ezstay) DB에는 이미 존재 — IF NOT EXISTS 가 없는 MySQL 특성상
-- 적용 전 컬럼 존재 여부를 확인하고 실행할 것.
--
-- 적용 대상 DB: receiver_role 이 없는 모든 환경 (ezstay_test 등)
-- ============================================================

ALTER TABLE alimtalk_logs
  ADD COLUMN receiver_role ENUM('host','guest') NULL
    COMMENT '수신자 역할 (host/guest, 공통 발송 시 NULL)'
    AFTER receiver_phone;

-- ============================================================
-- 검증 쿼리
-- ============================================================
-- SHOW COLUMNS FROM alimtalk_logs LIKE 'receiver_role';
