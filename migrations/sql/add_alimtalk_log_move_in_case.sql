-- ============================================================
-- 입주 준비 서비스 — 알림톡 일별 발송 횟수 제한 (케이스당 1일 10회)
-- 작성일: 2026-05-21
--
-- 배경:
--   임대인이 임차인에게 보내는 입주 준비 결제 요청 알림톡(UH_8852)은
--   재발송 횟수 상한이 없어 무제한 발송이 가능했음.
--   → 케이스 단위 1일(KST) 10회 제한 도입.
--
--   카운트 단위는 alimtalk_logs 의 당일 row 수.
--   기존 contract_id 는 입주 준비 케이스를 식별하지 못하고
--   receiver_id 는 미가입 임차인이면 NULL 이므로,
--   케이스 식별 전용 컬럼 move_in_case_id 를 신설한다.
--
-- 변경 사항:
--   alimtalk_logs 에 move_in_case_id INT NULL 추가
--   + 일별 카운트 쿼리용 인덱스 (move_in_case_id, created_at)
--
-- 적용 대상 DB: ezstay, ezstay_test
-- ============================================================

ALTER TABLE alimtalk_logs
  ADD COLUMN move_in_case_id INT NULL
    COMMENT '관련 입주 준비 케이스 ID (입주 준비 알림톡 일별 발송 제한 카운트용)'
    AFTER chat_room_id,
  ADD INDEX idx_move_in_case_created (move_in_case_id, created_at);

-- ============================================================
-- 검증 쿼리
-- ============================================================
-- SHOW COLUMNS FROM alimtalk_logs LIKE 'move_in_case_id';
-- SHOW INDEX FROM alimtalk_logs WHERE Key_name = 'idx_move_in_case_created';
