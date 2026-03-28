-- rental_order_refund_requests 테이블 생성
-- 입주중 옵션상품 환불 요청 관리 (관리자 수락/거절 + 수거 상태 추적)

CREATE TABLE rental_order_refund_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rental_order_id INT NOT NULL COMMENT '대상 렌탈 주문 ID',
  contract_id INT NOT NULL COMMENT '계약 ID (빠른 조회용)',
  requested_by INT NOT NULL COMMENT '요청한 게스트 user_id',

  -- 요청 상태
  status ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING' COMMENT '처리 상태',
  cancel_reason VARCHAR(255) NULL COMMENT '게스트 취소 사유',
  reject_reason VARCHAR(255) NULL COMMENT '관리자 거절 사유',

  -- 요청 시점 스냅샷
  delivery_status_snapshot ENUM('PENDING', 'IN_TRANSIT', 'DELIVERED') NOT NULL COMMENT '요청 시점의 배송 상태',
  item_total_amount INT NOT NULL DEFAULT 0 COMMENT '아이템 합계 금액 (배송비 차감 전)',

  -- 환불 확정 금액 (수락 시 확정)
  shipping_deduction INT NOT NULL DEFAULT 0 COMMENT '수거비 차감액 = 플랫폼 수거비 수입 (0 or 7000)',
  final_refund_amount INT NOT NULL DEFAULT 0 COMMENT '실제 환불 금액 (수락 시 확정)',

  -- 수거 상태 (배송이 나간 경우에만 사용)
  retrieval_status ENUM('RETRIEVAL_PENDING', 'IN_RETRIEVAL', 'RETRIEVED') NULL DEFAULT NULL COMMENT '수거 상태 (수락 후 배송된 상품에만 적용)',
  retrieval_started_at DATETIME NULL COMMENT '수거 시작 시점',
  retrieval_completed_at DATETIME NULL COMMENT '수거 완료 시점',

  -- 처리 정보
  admin_id INT NULL COMMENT '처리한 관리자 ID',
  processed_at DATETIME NULL COMMENT '수락/거절 처리 시점',

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_rorr_rental_order_id (rental_order_id),
  INDEX idx_rorr_contract_id (contract_id),
  INDEX idx_rorr_requested_by (requested_by),
  INDEX idx_rorr_status (status),
  INDEX idx_rorr_retrieval_status (retrieval_status),
  INDEX idx_rorr_created_at (created_at)
);
