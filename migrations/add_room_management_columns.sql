-- 방 관리 기능을 위한 컬럼 추가
-- 실행일: 2026-01-14

-- 1. isActive 컬럼 추가 (게시 여부)
ALTER TABLE rooms
ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1
COMMENT '게시 여부 (1: 게시중, 0: 비공개)'
AFTER rejection_reason;

-- 2. deletedAt 컬럼 추가 (Soft Delete)
ALTER TABLE rooms
ADD COLUMN deleted_at DATETIME NULL
COMMENT 'Soft Delete 타임스탬프'
AFTER is_active;

-- 3. deleted_at 인덱스 추가 (Soft Delete 조회 최적화)
CREATE INDEX idx_deleted_at ON rooms(deleted_at);

-- 4. 기존 데이터 업데이트 (모든 기존 방을 게시 상태로 설정)
UPDATE rooms
SET is_active = 1
WHERE is_active IS NULL;
