-- 보증금 상태에 REFUND_FAILED 추가
-- 실행 대상: contracts.deposit_status ENUM
-- 사유: PG 환불 실패 시 관리자 식별 및 재시도를 위한 상태 추가

ALTER TABLE `contracts`
  MODIFY COLUMN `deposit_status`
  ENUM('HOLDING', 'RETURN_PENDING', 'RETURN_HOLD', 'RETURN_CONFIRMED', 'DEDUCTION_CONFIRMED', 'RETURNED', 'REFUND_FAILED')
  NOT NULL DEFAULT 'HOLDING'
  COMMENT '보증금 상태 (HOLDING=보관중, RETURN_PENDING=반환대기, RETURN_HOLD=반환보류, RETURN_CONFIRMED=반환확정, DEDUCTION_CONFIRMED=차감확정, RETURNED=반환완료, REFUND_FAILED=환불실패)';
