-- 계약 취소/거절 사유 필드 추가
-- 작성일: 2025-10-24
-- 목적: 계약 요청 메시지와 취소/거절 사유를 분리하여 저장

-- cancellation_reason 컬럼 추가
ALTER TABLE contracts
ADD COLUMN cancellation_reason TEXT NULL
COMMENT '취소/거절 사유 (게스트 취소, 호스트 거절 시 사용)'
AFTER host_message;

-- 기존 데이터 마이그레이션 (선택사항)
-- 거절된 계약의 경우 hostMessage를 cancellationReason으로 복사
UPDATE contracts
SET cancellation_reason = host_message
WHERE status = 'REJECTED' AND host_message IS NOT NULL;

-- 게스트가 취소한 계약의 경우 guestMessage를 cancellationReason으로 복사 (취소 사유가 있었다면)
-- 주의: guestMessage는 원래 요청 메시지이므로 신중하게 처리
-- UPDATE contracts
-- SET cancellation_reason = guest_message
-- WHERE status = 'CANCELLED_BY_GUEST' AND guest_message IS NOT NULL;
