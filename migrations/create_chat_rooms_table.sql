-- 채팅방 테이블 생성
-- Firebase Firestore와 연동되는 채팅방 메타데이터를 MySQL에 저장

CREATE TABLE IF NOT EXISTS chat_rooms (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  contract_id INT NOT NULL UNIQUE COMMENT '계약 ID (1:1 관계)',
  firebase_chat_room_id VARCHAR(100) NOT NULL UNIQUE COMMENT 'Firebase Firestore 채팅방 ID (예: contract_123)',
  host_id INT NOT NULL COMMENT '호스트 ID',
  guest_id INT NOT NULL COMMENT '게스트 ID',
  room_id INT NOT NULL COMMENT '방 ID (메타정보용)',
  is_active BOOLEAN NOT NULL DEFAULT TRUE COMMENT '채팅방 활성화 여부 (계약 완료/취소 시 false)',
  last_message_at DATETIME NULL COMMENT '마지막 메시지 시간 (Firestore 동기화용)',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- 외래키 제약조건
  CONSTRAINT fk_chat_rooms_contract FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_rooms_host FOREIGN KEY (host_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_rooms_guest FOREIGN KEY (guest_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_rooms_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,

  -- 인덱스
  INDEX idx_contract_id (contract_id),
  INDEX idx_firebase_chat_room_id (firebase_chat_room_id),
  INDEX idx_host_id (host_id),
  INDEX idx_guest_id (guest_id),
  INDEX idx_is_active (is_active),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='채팅방 정보 (Firebase 연동)';
