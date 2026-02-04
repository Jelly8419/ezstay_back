-- =====================================================
-- 렌탈 결제 테이블 마이그레이션
-- 생성일: 2025-02-03
-- 설명: 렌탈 추가 주문 결제를 위한 테이블 생성
-- =====================================================

-- 렌탈 결제 테이블
CREATE TABLE IF NOT EXISTS `rental_payments` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `rentalOrderId` INT NOT NULL COMMENT '렌탈 주문 ID',
  `contractId` INT NOT NULL COMMENT '계약 ID (조회 편의용)',
  `paymentKey` VARCHAR(255) NOT NULL COMMENT '토스 결제 고유 키',
  `orderId` VARCHAR(100) NOT NULL COMMENT '주문번호',
  `method` ENUM('CARD', 'VIRTUAL_ACCOUNT', 'TRANSFER', 'MOBILE', 'EASY_PAY') NOT NULL COMMENT '결제 수단',
  `status` ENUM('READY', 'IN_PROGRESS', 'WAITING_FOR_DEPOSIT', 'DONE', 'CANCELED', 'PARTIAL_CANCELED', 'ABORTED', 'EXPIRED') NOT NULL DEFAULT 'READY' COMMENT '결제 상태',
  `requestedAt` DATETIME NOT NULL COMMENT '결제 요청 시각',
  `approvedAt` DATETIME NULL COMMENT '결제 승인 시각',
  `totalAmount` INT NOT NULL COMMENT '총 결제 금액',
  `balanceAmount` INT NULL COMMENT '취소 가능 금액',
  `suppliedAmount` INT NULL COMMENT '공급가액',
  `vat` INT NULL COMMENT '부가세',
  `taxFreeAmount` INT NULL DEFAULT 0 COMMENT '비과세 금액',
  `currency` VARCHAR(10) NOT NULL DEFAULT 'KRW' COMMENT '통화',
  `receiptUrl` VARCHAR(500) NULL COMMENT '영수증 URL',
  `checkoutUrl` VARCHAR(500) NULL COMMENT '결제 페이지 URL',
  `paymentResponse` JSON NULL COMMENT '토스 API 전체 응답',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_rental_payment_key` (`paymentKey`),
  KEY `idx_rental_payment_rental_order_id` (`rentalOrderId`),
  KEY `idx_rental_payment_contract_id` (`contractId`),
  KEY `idx_rental_payment_order_id` (`orderId`),
  KEY `idx_rental_payment_status` (`status`),
  CONSTRAINT `fk_rental_payment_rental_order` FOREIGN KEY (`rentalOrderId`) REFERENCES `rental_orders` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `fk_rental_payment_contract` FOREIGN KEY (`contractId`) REFERENCES `contracts` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 렌탈 결제 실패 로그 테이블
CREATE TABLE IF NOT EXISTS `rental_payment_failure_logs` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `rentalOrderId` INT NOT NULL COMMENT '렌탈 주문 ID',
  `contractId` INT NOT NULL COMMENT '계약 ID (조회 편의용)',
  `orderId` VARCHAR(100) NOT NULL COMMENT '주문번호',
  `failureCode` VARCHAR(50) NULL COMMENT '토스 에러 코드',
  `failureMessage` TEXT NULL COMMENT '실패 사유 메시지',
  `requestData` JSON NULL COMMENT '결제 요청 데이터',
  `responseData` JSON NULL COMMENT '토스 API 응답 데이터',
  `userAgent` VARCHAR(500) NULL COMMENT '사용자 브라우저 정보',
  `ipAddress` VARCHAR(50) NULL COMMENT '사용자 IP 주소',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rental_failure_log_rental_order_id` (`rentalOrderId`),
  KEY `idx_rental_failure_log_contract_id` (`contractId`),
  KEY `idx_rental_failure_log_order_id` (`orderId`),
  KEY `idx_rental_failure_log_created_at` (`createdAt`),
  CONSTRAINT `fk_rental_failure_log_rental_order` FOREIGN KEY (`rentalOrderId`) REFERENCES `rental_orders` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `fk_rental_failure_log_contract` FOREIGN KEY (`contractId`) REFERENCES `contracts` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 확인용 쿼리
-- =====================================================
-- SHOW TABLES LIKE 'rental_payment%';
-- DESCRIBE rental_payments;
-- DESCRIBE rental_payment_failure_logs;
