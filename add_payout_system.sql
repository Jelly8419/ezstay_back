-- ============================================================
-- Payout System Migration
-- 지급 관리 시스템 마이그레이션
-- 실행 전 반드시 백업 필요
-- ============================================================

-- 1. settlements 테이블 컬럼 추가
--    PG 정산 확인 정보 + 지급 가능 날짜

ALTER TABLE settlements
  ADD COLUMN pg_settled_at DATETIME NULL COMMENT 'PG 정산 입금 확인 시각 (관리자 확인 시점)' AFTER note,
  ADD COLUMN pg_settled_confirmed_by INT NULL COMMENT 'PG 정산 확인한 관리자 ID' AFTER pg_settled_at,
  ADD COLUMN payout_available_date DATE NULL COMMENT '지급 가능 최소 날짜 (결제 승인일 + 3영업일)' AFTER pg_settled_confirmed_by;

-- 2. payouts 테이블 신규 생성

CREATE TABLE payouts (
  id                INT          NOT NULL AUTO_INCREMENT,
  contract_id       INT          NOT NULL COMMENT '계약 ID',
  settlement_id     INT          NULL     COMMENT '연관 Settlement ID (CONTRACT_SETTLEMENT 타입)',
  refund_id         INT          NULL     COMMENT '연관 Refund ID (GUEST_PENALTY, DEPOSIT_DEDUCTION 타입)',

  payout_type       ENUM(
    'CONTRACT_SETTLEMENT',            -- 계약 정산 (호스트)
    'GUEST_PENALTY',                  -- 게스트 취소 위약금 (호스트)
    'DEPOSIT_DEDUCTION',              -- 보증금 차감 합의분 (호스트)
    'HOST_CANCELLATION_COMPENSATION'  -- 호스트 귀책 취소 보상 (게스트)
  ) NOT NULL COMMENT '지급 유형',

  recipient_type    ENUM('HOST', 'GUEST') NOT NULL COMMENT '수령인 유형',
  recipient_id      INT          NOT NULL COMMENT '수령인 User ID',

  amount            INT          NOT NULL COMMENT '지급 금액',

  status            ENUM(
    'PENDING',      -- 대기 (PG 정산 미완료 또는 payable_after 미도래)
    'PAYABLE',      -- 지급 가능 (조건 충족, 관리자 실행 대기)
    'PROCESSING',   -- 지급 처리 중
    'COMPLETED',    -- 지급 완료
    'FAILED',       -- 지급 실패 (재시도 필요)
    'CANCELLED'     -- 취소 (환불 충돌 등)
  ) NOT NULL DEFAULT 'PENDING' COMMENT '지급 상태',

  payable_after     DATE         NOT NULL COMMENT '지급 가능 최소 날짜 (결제 승인일 + 3영업일)',

  -- 수령 계좌 정보 스냅샷 (지급 시점 기준)
  bank_name         VARCHAR(50)  NULL COMMENT '수령 은행명',
  account_number    VARCHAR(50)  NULL COMMENT '수령 계좌번호',
  account_holder    VARCHAR(100) NULL COMMENT '수령 예금주명',

  -- 처리 정보
  admin_id          INT          NULL COMMENT '처리한 관리자 ID',
  processed_at      DATETIME     NULL COMMENT '지급 완료 시각',
  failure_reason    TEXT         NULL COMMENT '지급 실패 사유',
  note              TEXT         NULL COMMENT '관리자 메모',

  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_payout_contract_id (contract_id),
  INDEX idx_payout_status_date (status, payable_after),
  INDEX idx_payout_recipient (recipient_type, recipient_id),
  INDEX idx_payout_type (payout_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='지급 관리';
