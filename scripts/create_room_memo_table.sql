-- 방 관리 메모 테이블 생성
-- 관리자 전용 메모 기능

CREATE TABLE IF NOT EXISTS `room_memos` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '메모 고유 ID',
  `room_id` INT NOT NULL COMMENT '방 ID',
  `admin_id` INT NOT NULL COMMENT '작성한 관리자 ID',
  `content` TEXT NOT NULL COMMENT '메모 내용',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '메모 작성 시각',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '메모 수정 시각',
  PRIMARY KEY (`id`),
  INDEX `idx_room_memos_room_id` (`room_id`) COMMENT '방별 메모 조회 최적화',
  INDEX `idx_room_memos_admin_id` (`admin_id`) COMMENT '관리자별 메모 조회 최적화',
  INDEX `idx_room_memos_created_at` (`created_at`) COMMENT '최신순 정렬 최적화',
  CONSTRAINT `fk_room_memos_room`
    FOREIGN KEY (`room_id`)
    REFERENCES `rooms` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT `fk_room_memos_admin`
    FOREIGN KEY (`admin_id`)
    REFERENCES `admins` (`id`)
    ON DELETE NO ACTION
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='방 관리 메모 테이블 (관리자 전용)';
