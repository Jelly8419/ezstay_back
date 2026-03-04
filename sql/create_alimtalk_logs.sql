-- ============================================
-- alimtalk_logs 테이블 생성
-- 카카오 알림톡 발송 이력 관리
-- ============================================

CREATE TABLE IF NOT EXISTS `alimtalk_logs` (
  `id` INT NOT NULL AUTO_INCREMENT,

  -- 이벤트 식별
  `event_name` VARCHAR(50) NOT NULL COMMENT '이벤트명 (payment_completed_guest, contract_canceled_host 등)',

  -- 관련 리소스 (중복 발송 체크에 사용)
  `contract_id` INT NULL COMMENT '관련 계약 ID',
  `chat_room_id` INT NULL COMMENT '관련 채팅방 ID (채팅 알림용)',

  -- 수신자 정보
  `receiver_id` INT NOT NULL COMMENT '수신자 사용자 ID',
  `receiver_phone` VARCHAR(20) NOT NULL COMMENT '수신자 전화번호',

  -- 템플릿 정보
  `tpl_code` VARCHAR(50) NOT NULL COMMENT 'Aligo 알림톡 템플릿 코드',

  -- 발송 상태
  `status` ENUM('PENDING', 'SENT', 'FAILED', 'RETRIED', 'FALLBACK_SENT', 'FALLBACK_FAILED') NOT NULL DEFAULT 'PENDING' COMMENT '발송 상태',

  -- 요청/응답 데이터
  `request_payload` TEXT NULL COMMENT 'Aligo API 요청 payload (JSON)',
  `response_payload` TEXT NULL COMMENT 'Aligo API 응답 payload (JSON)',

  -- 재시도
  `retry_count` TINYINT NOT NULL DEFAULT 0 COMMENT '재시도 횟수 (최대 1)',

  -- 에러 정보
  `error_message` TEXT NULL COMMENT '에러 메시지',

  -- 타임스탬프
  `sent_at` DATETIME NULL COMMENT '발송 성공 시각',
  `failed_at` DATETIME NULL COMMENT '최종 실패 시각',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),

  -- 중복 발송 체크 인덱스
  INDEX `idx_dedup` (`event_name`, `contract_id`, `receiver_id`),

  -- 재시도 대상 조회 인덱스
  INDEX `idx_status_retry` (`status`, `retry_count`),

  -- 생성일 기반 조회 인덱스
  INDEX `idx_created_at` (`created_at`),

  -- 외래키
  CONSTRAINT `fk_alimtalk_logs_receiver`
    FOREIGN KEY (`receiver_id`) REFERENCES `users` (`id`)
    ON DELETE NO ACTION ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='카카오 알림톡 발송 이력';
