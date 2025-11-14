-- Room 테이블 status 컬럼에 'hidden_by_admin' 상태 추가
-- 관리자가 방을 임시로 숨길 수 있는 기능

ALTER TABLE `rooms`
MODIFY COLUMN `status` ENUM(
  'draft',
  'pending_review',
  'approved',
  'rejected',
  'published',
  'hidden_by_admin'
) NOT NULL DEFAULT 'draft' COMMENT '방 상태 (hidden_by_admin: 관리자가 임시로 숨긴 상태)';
