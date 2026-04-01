-- ============================================
-- service_tasks 테이블 생성
-- 청소 / 침구류 대여 / 침구류 회수 예약 관리
-- ============================================

CREATE TABLE service_tasks (
  id              INT AUTO_INCREMENT PRIMARY KEY,

  -- 계약 연결
  contract_id     INT NOT NULL,

  -- 작업 유형: CLEANING(청소) / BEDDING_DELIVERY(침구 대여) / BEDDING_RETRIEVAL(침구 회수)
  task_type       ENUM('CLEANING', 'BEDDING_DELIVERY', 'BEDDING_RETRIEVAL') NOT NULL,

  -- 기준일: 청소/침구회수 → 퇴실일, 침구대여 → 입주일
  reference_date  DATE NOT NULL,

  -- 수량: BEDDING_DELIVERY/BEDDING_RETRIEVAL 시 침구 세트 수량, CLEANING은 NULL
  quantity        INT NULL DEFAULT NULL,

  -- 상태
  status          ENUM('PENDING', 'RESERVED', 'COMPLETED', 'ISSUE') NOT NULL DEFAULT 'PENDING',

  -- 업체 정보 (예약 완료 시 선택 입력)
  vendor_name     VARCHAR(100) NULL DEFAULT NULL,
  vendor_contact  VARCHAR(100) NULL DEFAULT NULL,   -- 담당자
  vendor_ref_no   VARCHAR(100) NULL DEFAULT NULL,   -- 예약번호

  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- 계약당 작업 유형 중복 방지
  UNIQUE KEY uq_contract_task (contract_id, task_type),

  INDEX idx_status        (status),
  INDEX idx_reference_date (reference_date),
  INDEX idx_contract_id   (contract_id),
  INDEX idx_task_type     (task_type),

  CONSTRAINT fk_service_tasks_contract
    FOREIGN KEY (contract_id) REFERENCES contracts (id)
    ON DELETE CASCADE ON UPDATE CASCADE
);
