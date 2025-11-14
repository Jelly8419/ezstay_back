-- 방 비밀번호 변경 이력 테이블 생성
-- 보안 감사 및 추적용

CREATE TABLE IF NOT EXISTS `room_password_histories` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '이력 고유 ID',
  `room_id` INT NOT NULL COMMENT '방 ID',
  `admin_id` INT NOT NULL COMMENT '변경한 관리자 ID',
  `previous_password` VARCHAR(50) DEFAULT NULL COMMENT '변경 전 비밀번호 (최초 설정 시 null)',
  `new_password` VARCHAR(50) NOT NULL COMMENT '변경 후 비밀번호',
  `reason` VARCHAR(255) DEFAULT NULL COMMENT '변경 사유 (예: 호스트 분실 신고, 게스트 체크아웃 후 변경)',
  `ip_address` VARCHAR(45) DEFAULT NULL COMMENT '관리자 IP 주소 (IPv4/IPv6, 보안 감사용)',
  `user_agent` VARCHAR(255) DEFAULT NULL COMMENT '관리자 브라우저/디바이스 정보 (보안 감사용)',
  `changed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '비밀번호 변경 시각',
  PRIMARY KEY (`id`),
  INDEX `idx_room_password_history_room_time` (`room_id`, `changed_at`) COMMENT '방별 비밀번호 변경 이력 조회 최적화',
  INDEX `idx_room_password_history_admin` (`admin_id`) COMMENT '관리자별 비밀번호 변경 이력 조회',
  INDEX `idx_room_password_history_time` (`changed_at`) COMMENT '시간순 정렬 최적화',
  CONSTRAINT `fk_room_password_history_room`
    FOREIGN KEY (`room_id`)
    REFERENCES `rooms` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT `fk_room_password_history_admin`
    FOREIGN KEY (`admin_id`)
    REFERENCES `admins` (`id`)
    ON DELETE NO ACTION
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='방 비밀번호 변경 이력 테이블 (보안 감사용)';
