/*M!999999\- enable the sandbox mode */ 
-- MariaDB dump 10.19-11.5.2-MariaDB, for Win64 (AMD64)
--
-- Host: localhost    Database: ezstay
-- ------------------------------------------------------
-- Server version	11.5.2-MariaDB

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*M!100616 SET @OLD_NOTE_VERBOSITY=@@NOTE_VERBOSITY, NOTE_VERBOSITY=0 */;

--
-- Table structure for table `admin_action_logs`
--

DROP TABLE IF EXISTS `admin_action_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `admin_action_logs` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `admin_id` int(11) NOT NULL,
  `admin_email` varchar(255) NOT NULL COMMENT 'Admin username (로그인 ID)',
  `admin_name` varchar(100) DEFAULT NULL,
  `action_type` varchar(50) NOT NULL COMMENT 'CREATE, UPDATE, DELETE, APPROVE, REJECT, ACTIVATE, DEACTIVATE, SUSPEND, EXPORT',
  `resource_type` varchar(50) NOT NULL COMMENT 'USER, PROPERTY, RESERVATION, PAYMENT, ADMIN, SYSTEM',
  `resource_id` varchar(100) DEFAULT NULL,
  `method` varchar(10) NOT NULL COMMENT 'POST, PATCH, PUT, DELETE',
  `endpoint` varchar(255) NOT NULL,
  `request_body` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT '요청 본문 (민감 정보 제외)' CHECK (json_valid(`request_body`)),
  `response_status` int(11) DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL COMMENT 'IPv4/IPv6',
  `user_agent` text DEFAULT NULL,
  `description` text DEFAULT NULL COMMENT '액션 설명',
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `admin_action_logs_admin_id` (`admin_id`),
  KEY `admin_action_logs_created_at` (`created_at`),
  KEY `admin_action_logs_resource_type_resource_id` (`resource_type`,`resource_id`),
  KEY `admin_action_logs_action_type` (`action_type`),
  CONSTRAINT `admin_action_logs_ibfk_1` FOREIGN KEY (`admin_id`) REFERENCES `admins` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=68 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `admin_refunds`
--

DROP TABLE IF EXISTS `admin_refunds`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `admin_refunds` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `contract_id` int(11) NOT NULL COMMENT '계약 ID',
  `admin_id` int(11) NOT NULL COMMENT '처리한 관리자 ID',
  `refund_type` enum('FULL','PARTIAL_ITEMS') NOT NULL,
  `refund_amount` int(11) NOT NULL DEFAULT 0 COMMENT 'PARTIAL_AMOUNT 시 입력 금액',
  `rental_fee_refund_amount` int(11) NOT NULL DEFAULT 0 COMMENT '임대료 환불액',
  `maintenance_fee_refund_amount` int(11) NOT NULL DEFAULT 0 COMMENT '관리비 환불액',
  `cleaning_fee_refund_amount` int(11) NOT NULL DEFAULT 0 COMMENT '청소비 환불액',
  `platform_fee_refund_amount` int(11) NOT NULL DEFAULT 0 COMMENT '서비스 수수료 환불액',
  `deposit_refund_amount` int(11) NOT NULL DEFAULT 0 COMMENT '보증금 환불액',
  `rental_items_refund_amount` int(11) NOT NULL DEFAULT 0 COMMENT '렌탈 상품 환불액',
  `total_refund_amount` int(11) NOT NULL DEFAULT 0 COMMENT '총 환불액',
  `final_refund_amount` int(11) NOT NULL DEFAULT 0 COMMENT '최종 확정 환불액',
  `original_rental_fee` int(11) NOT NULL DEFAULT 0,
  `original_maintenance_fee` int(11) NOT NULL DEFAULT 0,
  `original_cleaning_fee` int(11) NOT NULL DEFAULT 0,
  `original_platform_fee` int(11) NOT NULL DEFAULT 0,
  `original_deposit` int(11) NOT NULL DEFAULT 0,
  `original_total_amount` int(11) NOT NULL DEFAULT 0,
  `refund_status` enum('COMPLETED','FAILED') NOT NULL DEFAULT 'COMPLETED',
  `refund_method` enum('ORIGINAL_PAYMENT','BANK_TRANSFER') NOT NULL DEFAULT 'ORIGINAL_PAYMENT',
  `refund_reason` text DEFAULT NULL,
  `admin_notes` text DEFAULT NULL,
  `pg_response` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'PG 취소 응답 원문' CHECK (json_valid(`pg_response`)),
  `completed_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_admin_refunds_contract` (`contract_id`),
  KEY `idx_admin_refunds_admin` (`admin_id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `admins`
--

DROP TABLE IF EXISTS `admins`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `admins` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(50) NOT NULL COMMENT '관리자 아이디 (로그인 ID)',
  `password` varchar(255) NOT NULL COMMENT '비밀번호 (bcrypt 해싱)',
  `name` varchar(100) NOT NULL COMMENT '관리자 이름',
  `phone_number` varchar(20) DEFAULT NULL COMMENT '휴대폰 번호',
  `role` enum('super_admin','admin','cs_admin') NOT NULL DEFAULT 'admin' COMMENT 'super_admin: 최고관리자, admin: 일반관리자, cs_admin: 고객센터 관리자',
  `is_active` tinyint(1) NOT NULL DEFAULT 1 COMMENT '계정 활성화 여부',
  `last_login_at` datetime DEFAULT NULL COMMENT '마지막 로그인 시간',
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `admins_username` (`username`),
  UNIQUE KEY `admins_username_unique` (`username`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `alimtalk_logs`
--

DROP TABLE IF EXISTS `alimtalk_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `alimtalk_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `event_name` varchar(50) NOT NULL COMMENT '이벤트명 (payment_completed_guest, contract_canceled_host 등)',
  `contract_id` int(11) DEFAULT NULL COMMENT '관련 계약 ID',
  `chat_room_id` int(11) DEFAULT NULL COMMENT '관련 채팅방 ID (채팅 알림용)',
  `receiver_id` int(11) NOT NULL COMMENT '수신자 사용자 ID',
  `receiver_phone` varchar(20) NOT NULL COMMENT '수신자 전화번호',
  `tpl_code` varchar(50) NOT NULL COMMENT 'Aligo 알림톡 템플릿 코드',
  `status` enum('PENDING','SENT','FAILED','RETRIED','FALLBACK_SENT','FALLBACK_FAILED') NOT NULL DEFAULT 'PENDING' COMMENT '발송 상태',
  `request_payload` text DEFAULT NULL COMMENT 'Aligo API 요청 payload (JSON)',
  `response_payload` text DEFAULT NULL COMMENT 'Aligo API 응답 payload (JSON)',
  `retry_count` tinyint(4) NOT NULL DEFAULT 0 COMMENT '재시도 횟수 (최대 1)',
  `error_message` text DEFAULT NULL COMMENT '에러 메시지',
  `sent_at` datetime DEFAULT NULL COMMENT '발송 성공 시각',
  `failed_at` datetime DEFAULT NULL COMMENT '최종 실패 시각',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_dedup` (`event_name`,`contract_id`,`receiver_id`),
  KEY `idx_status_retry` (`status`,`retry_count`),
  KEY `idx_created_at` (`created_at`),
  KEY `fk_alimtalk_logs_receiver` (`receiver_id`),
  CONSTRAINT `fk_alimtalk_logs_receiver` FOREIGN KEY (`receiver_id`) REFERENCES `users` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=146 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='카카오 알림톡 발송 이력';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `auto_message_templates`
--

DROP TABLE IF EXISTS `auto_message_templates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `auto_message_templates` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `host_id` int(11) NOT NULL COMMENT '호스트 ID',
  `room_id` int(11) NOT NULL COMMENT '방 ID (방별로 다른 자동메시지 설정 가능)',
  `trigger_type` enum('CONTRACT_CONFIRMED','BEFORE_CHECK_IN','BEFORE_CHECK_OUT') NOT NULL COMMENT '발송 트리거 타입',
  `trigger_days` int(11) NOT NULL DEFAULT 0 COMMENT 'N일 전 (0이면 즉시, CONTRACT_CONFIRMED일 때는 무시됨)',
  `trigger_time` varchar(5) NOT NULL DEFAULT '09:00' COMMENT '발송 시각 (HH:mm 형식, 예: 09:00)',
  `title` varchar(100) NOT NULL COMMENT '템플릿 제목 (관리용)',
  `message_content` text NOT NULL COMMENT '메시지 내용',
  `is_active` tinyint(1) NOT NULL DEFAULT 1 COMMENT '활성화 여부 (ON/OFF)',
  `sent_count` int(11) NOT NULL DEFAULT 0 COMMENT '총 발송 횟수',
  `last_sent_at` datetime DEFAULT NULL COMMENT '마지막 발송 시각',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_host_id` (`host_id`),
  KEY `idx_room_id` (`room_id`),
  KEY `idx_trigger_type` (`trigger_type`),
  KEY `idx_is_active` (`is_active`),
  KEY `idx_host_room_trigger` (`host_id`,`room_id`,`trigger_type`),
  CONSTRAINT `fk_auto_message_host` FOREIGN KEY (`host_id`) REFERENCES `users` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `fk_auto_message_room` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `blocked_periods`
--

DROP TABLE IF EXISTS `blocked_periods`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `blocked_periods` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `room_id` int(11) NOT NULL,
  `start_date` date NOT NULL COMMENT '불가 시작 날짜 (YYYY-MM-DD)',
  `end_date` date NOT NULL COMMENT '불가 종료 날짜 (YYYY-MM-DD)',
  `reason` varchar(200) DEFAULT NULL COMMENT '불가 사유 (최대 200자)',
  `created_by` int(11) NOT NULL COMMENT '생성한 호스트 ID',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `fk_blocked_period_host` (`created_by`),
  KEY `idx_room_id` (`room_id`),
  KEY `idx_start_date` (`start_date`),
  KEY `idx_end_date` (`end_date`),
  KEY `idx_date_range` (`room_id`,`start_date`,`end_date`) COMMENT '날짜 범위 조회 최적화',
  CONSTRAINT `fk_blocked_period_host` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `fk_blocked_period_room` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_date_order` CHECK (`end_date` >= `start_date`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='계약 불가 기간 관리';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `chat_rooms`
--

DROP TABLE IF EXISTS `chat_rooms`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `chat_rooms` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `contract_id` int(11) NOT NULL COMMENT '계약 ID (1:1 관계)',
  `firebase_chat_room_id` varchar(100) NOT NULL COMMENT 'Firebase Firestore 채팅방 ID (예: contract_123)',
  `host_id` int(11) NOT NULL COMMENT '호스트 ID',
  `guest_id` int(11) NOT NULL COMMENT '게스트 ID',
  `room_id` int(11) NOT NULL COMMENT '방 ID (메타정보용)',
  `is_active` tinyint(1) NOT NULL DEFAULT 1 COMMENT '채팅방 활성화 여부 (계약 완료/취소 시 false)',
  `last_message_at` datetime DEFAULT NULL COMMENT '마지막 메시지 시간 (Firestore 동기화용)',
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_contract_id` (`contract_id`),
  UNIQUE KEY `idx_firebase_chat_room_id` (`firebase_chat_room_id`),
  KEY `room_id` (`room_id`),
  KEY `idx_host_id` (`host_id`),
  KEY `idx_guest_id` (`guest_id`),
  KEY `idx_is_active` (`is_active`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `chat_rooms_ibfk_1` FOREIGN KEY (`contract_id`) REFERENCES `contracts` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `chat_rooms_ibfk_2` FOREIGN KEY (`host_id`) REFERENCES `users` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `chat_rooms_ibfk_3` FOREIGN KEY (`guest_id`) REFERENCES `users` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `chat_rooms_ibfk_4` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=174 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `contract_sequences`
--

DROP TABLE IF EXISTS `contract_sequences`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `contract_sequences` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `date_key` date NOT NULL COMMENT '날짜 (YYYY-MM-DD)',
  `last_number` int(11) NOT NULL DEFAULT 0 COMMENT '마지막 순번',
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `date_key` (`date_key`),
  UNIQUE KEY `uk_date` (`date_key`)
) ENGINE=InnoDB AUTO_INCREMENT=17 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='계약 주문번호 시퀀스 관리';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `contract_status_logs`
--

DROP TABLE IF EXISTS `contract_status_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `contract_status_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `contract_id` int(11) NOT NULL COMMENT '계약 ID',
  `from_status` varchar(50) DEFAULT NULL COMMENT '변경 전 상태',
  `to_status` varchar(50) NOT NULL COMMENT '변경 후 상태',
  `changed_by` enum('GUEST','HOST','ADMIN','SYSTEM') NOT NULL COMMENT '변경 주체',
  `changed_by_user_id` int(11) DEFAULT NULL COMMENT '변경한 사용자 ID (User 또는 Admin)',
  `reason` text DEFAULT NULL COMMENT '변경 사유',
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT '추가 메타데이터 (환불 금액, 위약금 등)' CHECK (json_valid(`metadata`)),
  `ip_address` varchar(45) DEFAULT NULL COMMENT '요청 IP 주소',
  `user_agent` varchar(500) DEFAULT NULL COMMENT '사용자 에이전트',
  `created_at` datetime NOT NULL DEFAULT current_timestamp() COMMENT '생성 시점',
  PRIMARY KEY (`id`),
  KEY `idx_contract` (`contract_id`),
  KEY `idx_to_status` (`to_status`),
  KEY `idx_changed_by` (`changed_by`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_contract_created` (`contract_id`,`created_at`),
  CONSTRAINT `fk_contract_status_logs_contract` FOREIGN KEY (`contract_id`) REFERENCES `contracts` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=941 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='계약 상태 변경 이력 (영구 보존)';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `contracts`
--

DROP TABLE IF EXISTS `contracts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `contracts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `order_id` varchar(11) NOT NULL COMMENT '계약 주문번호 (yymmdd + 5자리 숫자)',
  `room_id` int(11) NOT NULL,
  `host_id` int(11) NOT NULL,
  `guest_id` int(11) NOT NULL,
  `check_in_date` datetime NOT NULL COMMENT '체크인 날짜 및 시간',
  `check_out_date` datetime NOT NULL COMMENT '체크아웃 날짜 및 시간',
  `total_days` int(11) NOT NULL COMMENT '총 숙박 일수',
  `total_weeks` int(11) DEFAULT NULL COMMENT '총 숙박 주수 (할인 계산용)',
  `rental_fee` int(11) NOT NULL DEFAULT 0 COMMENT '임대료 (일일 임대료 * 계약 일수)',
  `maintenance_fee` int(11) NOT NULL DEFAULT 0 COMMENT '관리비 (일일 관리비 * 계약 일수)',
  `cleaning_fee` int(11) NOT NULL DEFAULT 0 COMMENT '청소비용 (1회)',
  `rental_items_fee` int(11) NOT NULL DEFAULT 0 COMMENT '렌탈 아이템 비용',
  `snapshot` mediumtext DEFAULT NULL COMMENT '계약 시점 방 정보 스냅샷 (JSON)',
  `platform_fee` int(11) NOT NULL DEFAULT 0 COMMENT '게스트 플랫폼 수수료 (9.9%, 게스트가 추가 결제)',
  `host_platform_fee` int(11) NOT NULL DEFAULT 0 COMMENT '호스트 플랫폼 수수료 (3.3%, 정산 시 차감)',
  `discount_amount` int(11) NOT NULL DEFAULT 0 COMMENT '할인 금액',
  `discount_type` enum('NONE','LONG_TERM_DISCOUNT','QUICK_MOVE_IN','BOTH') DEFAULT NULL,
  `deposit` int(11) NOT NULL DEFAULT 0 COMMENT '보증금',
  `final_total_amount` int(11) NOT NULL DEFAULT 0 COMMENT '최종 결제 금액 (실이용 + 보증금)',
  `rental_items` text DEFAULT NULL COMMENT '선택한 렌탈 아이템 정보 (JSON)',
  `recommended_items` text DEFAULT NULL COMMENT '호스트가 권장하는 렌탈 아이템 목록 (JSON)',
  `payment_method` enum('CREDIT_CARD','BANK_TRANSFER','SIMPLE_PAY') DEFAULT NULL COMMENT '결제 수단',
  `installment_months` int(11) NOT NULL DEFAULT 0 COMMENT '할부 개월 수 (0이면 일시불)',
  `guest_message` text DEFAULT NULL COMMENT '게스트 메시지',
  `host_message` text DEFAULT NULL COMMENT '호스트 응답 메시지 (거절 사유 등)',
  `special_requests` text DEFAULT NULL COMMENT '특별 요청사항 (JSON)',
  `terms_agreed` text NOT NULL COMMENT '약관 동의 정보 (JSON)',
  `pricing_snapshot` text DEFAULT NULL COMMENT '가격 정책 스냅샷 (JSON)',
  `refund_policy_type` varchar(50) DEFAULT NULL COMMENT '계약 시점의 환불정책 타입 (약하게, 보통, 엄격하게)',
  `refund_policy_snapshot` text DEFAULT NULL COMMENT '계약 시점의 환불정책 상세 규칙 (JSON)',
  `status` enum('PENDING_APPROVAL','APPROVED','REJECTED','PAYMENT_COMPLETED','IN_PROGRESS','COMPLETED','CANCELLED_BY_GUEST','CANCELLED_BY_HOST','CANCELLED_BY_ADMIN_WITH_REFUND','CANCELLED_BY_ADMIN_NO_REFUND','REFUNDED','APPROVAL_EXPIRED','PAYMENT_EXPIRED','CANCEL_REQUESTED') NOT NULL DEFAULT 'PENDING_APPROVAL' COMMENT '계약 상태',
  `approved_at` datetime DEFAULT NULL COMMENT '승인 시점',
  `rejected_at` datetime DEFAULT NULL COMMENT '거절 시점',
  `paid_at` datetime DEFAULT NULL COMMENT '결제 완료 시점',
  `checked_in_at` datetime DEFAULT NULL COMMENT '체크인 완료 시점',
  `checked_out_at` datetime DEFAULT NULL COMMENT '체크아웃 완료 시점',
  `cancelled_at` datetime DEFAULT NULL COMMENT '취소 시점',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `cancellation_reason` text DEFAULT NULL COMMENT '취소/거절 사유',
  `cancellation_type` enum('BEFORE_PAYMENT','AFTER_PAYMENT','DURING_STAY','AFTER_COMPLETION') DEFAULT NULL COMMENT '취소 유형 (취소된 경우에만 값 존재)',
  `cancelled_by_admin_id` int(11) DEFAULT NULL COMMENT '취소한 관리자 ID (관리자 취소인 경우)',
  `cancelled_by_user_id` int(11) DEFAULT NULL COMMENT '취소한 사용자 ID',
  `checkout_requested` tinyint(1) NOT NULL DEFAULT 0 COMMENT '게스트 퇴실 요청 여부',
  `checkout_requested_at` datetime DEFAULT NULL COMMENT '게스트 퇴실 요청 시점',
  `host_checked_out` tinyint(1) NOT NULL DEFAULT 0 COMMENT '호스트 퇴실 확인 여부',
  `host_checked_out_at` datetime DEFAULT NULL COMMENT '호스트 퇴실 확인 시점',
  `checkout_status` enum('NOT_STARTED','GUEST_COMPLETED','HOLD_REQUESTED','HOLD_REJECTED','HOST_PENDING','HOST_CONFIRMED') NOT NULL DEFAULT 'NOT_STARTED',
  `hold_requested_at` datetime DEFAULT NULL COMMENT '호스트 보류 신청 시점',
  `hold_remaining_ms` bigint(20) DEFAULT NULL COMMENT '보류 거절 시 남은 카운트다운(ms)',
  `hold_approved_at` datetime DEFAULT NULL COMMENT '관리자 보류 승인 시점 (합의 데드라인 기준)',
  `hold_approved_by_admin_id` int(11) DEFAULT NULL COMMENT '보류 승인 관리자 ID',
  `deposit_deduction` int(11) NOT NULL DEFAULT 0 COMMENT '보증금 차감 금액',
  `deduction_reason` text DEFAULT NULL COMMENT '보증금 차감 사유',
  `refundable_deposit` int(11) DEFAULT NULL COMMENT '반환 가능 보증금 (보증금 - 차감액)',
  `deposit_status` enum('HOLDING','RETURN_PENDING','RETURN_HOLD','RETURN_CONFIRMED','DEDUCTION_CONFIRMED','RETURNED','REFUND_FAILED') NOT NULL DEFAULT 'HOLDING' COMMENT '보증금 상태 (HOLDING=보관중, RETURN_PENDING=반환대기, RETURN_HOLD=반환보류, RETURN_CONFIRMED=반환확정, DEDUCTION_CONFIRMED=차감확정, RETURNED=반환완료, REFUND_FAILED=환불실패)',
  `deposit_returned_at` datetime DEFAULT NULL COMMENT '보증금 환급 완료 시각 (PG 취소 성공 시점)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_order_id` (`order_id`),
  KEY `idx_room_id` (`room_id`),
  KEY `idx_host_id` (`host_id`),
  KEY `idx_guest_id` (`guest_id`),
  KEY `idx_status` (`status`),
  KEY `idx_check_in_date` (`check_in_date`),
  KEY `idx_check_out_date` (`check_out_date`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_status_dates` (`status`,`check_out_date`,`check_in_date`) COMMENT '지도 검색 시 예약 가능 여부 조회 최적화',
  KEY `idx_cancellation_type` (`cancellation_type`),
  KEY `idx_cancelled_by_admin` (`cancelled_by_admin_id`),
  KEY `idx_refund_policy_type` (`refund_policy_type`),
  KEY `idx_checkout_status` (`checkout_status`),
  KEY `fk_contracts_hold_approved_by_admin` (`hold_approved_by_admin_id`),
  CONSTRAINT `fk_contract_guest` FOREIGN KEY (`guest_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_contract_host` FOREIGN KEY (`host_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_contract_room` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_contracts_hold_approved_by_admin` FOREIGN KEY (`hold_approved_by_admin_id`) REFERENCES `admins` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=267 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='계약 정보';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `deposit_agreements`
--

DROP TABLE IF EXISTS `deposit_agreements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `deposit_agreements` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `contract_id` int(11) NOT NULL COMMENT '계약 ID',
  `deduct_amount` int(11) NOT NULL DEFAULT 0 COMMENT '보증금 차감 요청 금액',
  `agreement_text` text DEFAULT NULL,
  `hold_reason` text DEFAULT NULL COMMENT '퇴실 확인 보류 사유',
  `requested_at` datetime DEFAULT NULL COMMENT '보류 신청 시각',
  `rejected_at` datetime DEFAULT NULL COMMENT '관리자 거절 시각',
  `rejected_reason` text DEFAULT NULL COMMENT '거절 사유',
  `rejected_by_admin_id` int(11) DEFAULT NULL COMMENT '거절 관리자 ID',
  `submitted_at` datetime NOT NULL DEFAULT current_timestamp() COMMENT '합의 내용 제출 시각',
  `accepted_at` datetime DEFAULT NULL COMMENT '게스트 합의 동의 시각',
  `admin_approved_at` datetime DEFAULT NULL COMMENT '관리자 보류 승인 시점 (합의 프로세스 시작 시점)',
  `status` enum('REQUESTED','APPROVED','REJECTED','SUBMITTED','ACCEPTED','AUTO_RETURNED') NOT NULL DEFAULT 'REQUESTED',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_deposit_agreement_status` (`status`),
  KEY `idx_deposit_agreement_contract_id` (`contract_id`),
  CONSTRAINT `fk_deposit_agreement_contract` FOREIGN KEY (`contract_id`) REFERENCES `contracts` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='보증금 합의 정보 (퇴실 보류 시 호스트-게스트 간 합의)';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `email_verification_codes`
--

DROP TABLE IF EXISTS `email_verification_codes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `email_verification_codes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `email` varchar(255) NOT NULL COMMENT '인증 요청한 이메일 주소',
  `code` varchar(6) NOT NULL COMMENT '6자리 인증코드',
  `expires_at` datetime NOT NULL COMMENT '인증코드 만료 시간',
  `verified` tinyint(1) NOT NULL DEFAULT 0 COMMENT '인증 완료 여부',
  `verified_at` datetime DEFAULT NULL COMMENT '인증 완료 시간',
  `attempts` int(11) NOT NULL DEFAULT 0 COMMENT '인증 시도 횟수 (최대 5회)',
  `ip_address` varchar(45) DEFAULT NULL COMMENT '요청 IP 주소 (보안 감사용)',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `email_code_index` (`email`,`code`),
  KEY `email_created_at_index` (`email`,`created_at`),
  KEY `expires_at_index` (`expires_at`),
  KEY `verified_index` (`verified`)
) ENGINE=InnoDB AUTO_INCREMENT=25 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='이메일 인증 코드 관리';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ez_services`
--

DROP TABLE IF EXISTS `ez_services`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `ez_services` (
  `room_id` int(11) NOT NULL COMMENT '방 ID (외래키)',
  `cleaning_service` tinyint(1) NOT NULL DEFAULT 0 COMMENT '무료 청소 서비스 제공 여부',
  `room_password` varchar(100) DEFAULT NULL COMMENT '방 출입 비밀번호',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`room_id`),
  KEY `idx_cleaning_service` (`cleaning_service`),
  CONSTRAINT `fk_ez_services_room_id` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci COMMENT='이지서비스 (호스트 제공 무료 부가 서비스)';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `faqcategories`
--

DROP TABLE IF EXISTS `faqcategories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `faqcategories` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL COMMENT '카테고리 이름 (예: 전체, 방 등록, 예약/결제 등)',
  `userType` enum('all','host','guest') DEFAULT 'all' COMMENT '대상 사용자 타입',
  `displayOrder` int(11) DEFAULT 0 COMMENT '표시 순서 (낮을수록 상단)',
  `isActive` tinyint(1) DEFAULT 1 COMMENT '활성화 여부',
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `faq_category_name_user_type_unique` (`name`,`userType`),
  KEY `idx_faq_categories_user_type` (`userType`,`isActive`,`displayOrder`)
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `faqs`
--

DROP TABLE IF EXISTS `faqs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `faqs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `categoryId` int(11) NOT NULL COMMENT 'FAQ 카테고리 ID',
  `question` varchar(300) NOT NULL COMMENT '질문',
  `answer` text NOT NULL COMMENT '답변 (HTML 포함 가능)',
  `displayOrder` int(11) DEFAULT 0 COMMENT '카테고리 내 표시 순서',
  `viewCount` int(11) DEFAULT 0 COMMENT '조회수',
  `isActive` tinyint(1) DEFAULT 1 COMMENT '활성화 여부',
  `createdBy` int(11) NOT NULL COMMENT '작성한 관리자 ID',
  `updatedBy` int(11) DEFAULT NULL COMMENT '마지막 수정한 관리자 ID',
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_faqs_category` (`categoryId`,`isActive`,`displayOrder`),
  KEY `idx_faqs_created_by` (`createdBy`),
  KEY `fk_faqs_updated_by` (`updatedBy`),
  CONSTRAINT `faqs_ibfk_1` FOREIGN KEY (`categoryId`) REFERENCES `faqcategories` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_10` FOREIGN KEY (`categoryId`) REFERENCES `faqcategories` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_11` FOREIGN KEY (`createdBy`) REFERENCES `admins` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_12` FOREIGN KEY (`updatedBy`) REFERENCES `admins` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_13` FOREIGN KEY (`categoryId`) REFERENCES `faqcategories` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_14` FOREIGN KEY (`createdBy`) REFERENCES `admins` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_15` FOREIGN KEY (`updatedBy`) REFERENCES `admins` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_16` FOREIGN KEY (`categoryId`) REFERENCES `faqcategories` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_17` FOREIGN KEY (`createdBy`) REFERENCES `admins` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_18` FOREIGN KEY (`updatedBy`) REFERENCES `admins` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_19` FOREIGN KEY (`categoryId`) REFERENCES `faqcategories` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_2` FOREIGN KEY (`createdBy`) REFERENCES `admins` (`id`),
  CONSTRAINT `faqs_ibfk_20` FOREIGN KEY (`createdBy`) REFERENCES `admins` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_21` FOREIGN KEY (`updatedBy`) REFERENCES `admins` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_22` FOREIGN KEY (`categoryId`) REFERENCES `faqcategories` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_23` FOREIGN KEY (`createdBy`) REFERENCES `admins` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_24` FOREIGN KEY (`updatedBy`) REFERENCES `admins` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_25` FOREIGN KEY (`categoryId`) REFERENCES `faqcategories` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_26` FOREIGN KEY (`createdBy`) REFERENCES `admins` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_27` FOREIGN KEY (`updatedBy`) REFERENCES `admins` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_28` FOREIGN KEY (`categoryId`) REFERENCES `faqcategories` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_29` FOREIGN KEY (`createdBy`) REFERENCES `admins` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_3` FOREIGN KEY (`updatedBy`) REFERENCES `admins` (`id`),
  CONSTRAINT `faqs_ibfk_30` FOREIGN KEY (`updatedBy`) REFERENCES `admins` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_31` FOREIGN KEY (`categoryId`) REFERENCES `faqcategories` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_32` FOREIGN KEY (`createdBy`) REFERENCES `admins` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_33` FOREIGN KEY (`updatedBy`) REFERENCES `admins` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_34` FOREIGN KEY (`categoryId`) REFERENCES `faqcategories` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_35` FOREIGN KEY (`createdBy`) REFERENCES `admins` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_36` FOREIGN KEY (`updatedBy`) REFERENCES `admins` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_37` FOREIGN KEY (`categoryId`) REFERENCES `faqcategories` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_38` FOREIGN KEY (`createdBy`) REFERENCES `admins` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_39` FOREIGN KEY (`updatedBy`) REFERENCES `admins` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_4` FOREIGN KEY (`categoryId`) REFERENCES `faqcategories` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_40` FOREIGN KEY (`categoryId`) REFERENCES `faqcategories` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_41` FOREIGN KEY (`createdBy`) REFERENCES `admins` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_42` FOREIGN KEY (`updatedBy`) REFERENCES `admins` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_43` FOREIGN KEY (`categoryId`) REFERENCES `faqcategories` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_44` FOREIGN KEY (`createdBy`) REFERENCES `admins` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_45` FOREIGN KEY (`updatedBy`) REFERENCES `admins` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_46` FOREIGN KEY (`categoryId`) REFERENCES `faqcategories` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_47` FOREIGN KEY (`createdBy`) REFERENCES `admins` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_48` FOREIGN KEY (`updatedBy`) REFERENCES `admins` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_49` FOREIGN KEY (`categoryId`) REFERENCES `faqcategories` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_5` FOREIGN KEY (`createdBy`) REFERENCES `admins` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_50` FOREIGN KEY (`createdBy`) REFERENCES `admins` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_51` FOREIGN KEY (`updatedBy`) REFERENCES `admins` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_52` FOREIGN KEY (`categoryId`) REFERENCES `faqcategories` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_53` FOREIGN KEY (`createdBy`) REFERENCES `admins` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_54` FOREIGN KEY (`updatedBy`) REFERENCES `admins` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_55` FOREIGN KEY (`categoryId`) REFERENCES `faqcategories` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_56` FOREIGN KEY (`createdBy`) REFERENCES `admins` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_57` FOREIGN KEY (`updatedBy`) REFERENCES `admins` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_58` FOREIGN KEY (`categoryId`) REFERENCES `faqcategories` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_59` FOREIGN KEY (`createdBy`) REFERENCES `admins` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_6` FOREIGN KEY (`updatedBy`) REFERENCES `admins` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_60` FOREIGN KEY (`updatedBy`) REFERENCES `admins` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_61` FOREIGN KEY (`categoryId`) REFERENCES `faqcategories` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_62` FOREIGN KEY (`createdBy`) REFERENCES `admins` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_63` FOREIGN KEY (`updatedBy`) REFERENCES `admins` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_64` FOREIGN KEY (`categoryId`) REFERENCES `faqcategories` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_65` FOREIGN KEY (`createdBy`) REFERENCES `admins` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_66` FOREIGN KEY (`updatedBy`) REFERENCES `admins` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_67` FOREIGN KEY (`categoryId`) REFERENCES `faqcategories` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_68` FOREIGN KEY (`createdBy`) REFERENCES `admins` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_69` FOREIGN KEY (`updatedBy`) REFERENCES `admins` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_7` FOREIGN KEY (`categoryId`) REFERENCES `faqcategories` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_70` FOREIGN KEY (`categoryId`) REFERENCES `faqcategories` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_71` FOREIGN KEY (`createdBy`) REFERENCES `admins` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_72` FOREIGN KEY (`updatedBy`) REFERENCES `admins` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_73` FOREIGN KEY (`categoryId`) REFERENCES `faqcategories` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_74` FOREIGN KEY (`createdBy`) REFERENCES `admins` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_75` FOREIGN KEY (`updatedBy`) REFERENCES `admins` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_76` FOREIGN KEY (`categoryId`) REFERENCES `faqcategories` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_77` FOREIGN KEY (`createdBy`) REFERENCES `admins` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_78` FOREIGN KEY (`updatedBy`) REFERENCES `admins` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_79` FOREIGN KEY (`categoryId`) REFERENCES `faqcategories` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_8` FOREIGN KEY (`createdBy`) REFERENCES `admins` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_80` FOREIGN KEY (`createdBy`) REFERENCES `admins` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_81` FOREIGN KEY (`updatedBy`) REFERENCES `admins` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_82` FOREIGN KEY (`categoryId`) REFERENCES `faqcategories` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_83` FOREIGN KEY (`createdBy`) REFERENCES `admins` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_84` FOREIGN KEY (`updatedBy`) REFERENCES `admins` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_85` FOREIGN KEY (`categoryId`) REFERENCES `faqcategories` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_86` FOREIGN KEY (`createdBy`) REFERENCES `admins` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_87` FOREIGN KEY (`updatedBy`) REFERENCES `admins` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_88` FOREIGN KEY (`categoryId`) REFERENCES `faqcategories` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_89` FOREIGN KEY (`createdBy`) REFERENCES `admins` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_9` FOREIGN KEY (`updatedBy`) REFERENCES `admins` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `faqs_ibfk_90` FOREIGN KEY (`updatedBy`) REFERENCES `admins` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_faqs_created_by` FOREIGN KEY (`createdBy`) REFERENCES `admins` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `fk_faqs_updated_by` FOREIGN KEY (`updatedBy`) REFERENCES `admins` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=20 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `guest_refund_accounts`
--

DROP TABLE IF EXISTS `guest_refund_accounts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `guest_refund_accounts` (
  `id` int(11) NOT NULL AUTO_INCREMENT COMMENT '환급 계좌 고유 ID',
  `user_id` int(11) NOT NULL COMMENT '사용자 ID (users 테이블 참조)',
  `bank_code` varchar(3) NOT NULL COMMENT '은행 코드 (예: 004, 088)',
  `bank_name` varchar(50) NOT NULL COMMENT '은행명 (예: KB국민은행, 신한은행)',
  `account_number` varchar(30) NOT NULL COMMENT '계좌번호 (하이픈 제거)',
  `account_holder` varchar(50) NOT NULL COMMENT '예금주명',
  `is_verified` tinyint(1) NOT NULL DEFAULT 0 COMMENT '예금주 확인 완료 여부 (아임포트)',
  `verified_at` datetime DEFAULT NULL COMMENT '예금주 확인 완료 시간',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `guest_refund_accounts_user_id_unique` (`user_id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='게스트 환급 계좌 정보 (무통장/가상계좌 환불용)';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `inquiries`
--

DROP TABLE IF EXISTS `inquiries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `inquiries` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `userId` int(11) NOT NULL COMMENT '문의 작성자 ID (User.id)',
  `categoryType` enum('general','reservation','payment','room','account','other') NOT NULL COMMENT '문의 카테고리',
  `userType` enum('host','guest') NOT NULL DEFAULT 'guest' COMMENT '문의자 사용자 타입 (host: 호스트, guest: 게스트)',
  `title` varchar(200) NOT NULL COMMENT '문의 제목',
  `content` text NOT NULL COMMENT '문의 내용',
  `status` enum('pending','answered','closed') DEFAULT 'pending' COMMENT 'pending: 확인중, answered: 답변완료, closed: 종료',
  `answer` text DEFAULT NULL COMMENT '관리자 답변',
  `answeredBy` int(11) DEFAULT NULL COMMENT '답변한 관리자 ID',
  `answeredAt` datetime DEFAULT NULL COMMENT '답변 작성 시각',
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_inquiries_user` (`userId`,`status`,`createdAt`),
  KEY `idx_inquiries_status` (`status`,`createdAt`),
  KEY `idx_inquiries_answered_by` (`answeredBy`),
  KEY `idx_inquiries_category_type` (`categoryType`),
  KEY `idx_inquiries_user_type` (`userType`,`status`,`createdAt`),
  CONSTRAINT `fk_inquiries_answered_by` FOREIGN KEY (`answeredBy`) REFERENCES `admins` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_inquiries_user_id` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `local_users`
--

DROP TABLE IF EXISTS `local_users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `local_users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `password` varchar(255) NOT NULL COMMENT '암호화된 비밀번호',
  `password_reset_token` varchar(255) DEFAULT NULL COMMENT '비밀번호 재설정 토큰',
  `password_reset_expires` datetime DEFAULT NULL COMMENT '비밀번호 재설정 토큰 만료일',
  `email_verified` tinyint(1) NOT NULL DEFAULT 0 COMMENT '이메일 인증 여부',
  `email_verification_token` varchar(255) DEFAULT NULL COMMENT '이메일 인증 토큰',
  `failed_login_attempts` int(11) NOT NULL DEFAULT 0 COMMENT '로그인 실패 횟수',
  `lock_until` datetime DEFAULT NULL COMMENT '계정 잠금 해제 시간',
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `local_users_user_id_unique` (`user_id`),
  KEY `local_users_password_reset_token` (`password_reset_token`),
  KEY `local_users_email_verification_token` (`email_verification_token`),
  CONSTRAINT `local_users_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `notices`
--

DROP TABLE IF EXISTS `notices`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `notices` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(200) NOT NULL COMMENT '공지사항 제목',
  `content` text NOT NULL COMMENT '공지사항 내용 (HTML 포함 가능)',
  `isImportant` tinyint(1) DEFAULT 0 COMMENT '중요 공지 여부 (상단 고정)',
  `viewCount` int(11) DEFAULT 0 COMMENT '조회수',
  `publishedAt` datetime DEFAULT NULL COMMENT '게시 시작 날짜',
  `expiresAt` datetime DEFAULT NULL COMMENT '게시 종료 날짜 (null이면 무제한)',
  `status` enum('draft','published','archived') DEFAULT 'draft' COMMENT 'draft: 임시저장, published: 게시중, archived: 보관',
  `userType` enum('all','host','guest') NOT NULL DEFAULT 'all' COMMENT '대상 사용자 타입 (all: 전체, host: 호스트, guest: 게스트)',
  `createdBy` int(11) NOT NULL COMMENT '작성한 관리자 ID (Admin.id)',
  `updatedBy` int(11) DEFAULT NULL COMMENT '마지막 수정한 관리자 ID',
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_notices_status` (`status`),
  KEY `idx_notices_published_at` (`publishedAt`),
  KEY `idx_notices_important_published` (`isImportant`,`publishedAt`),
  KEY `idx_notices_created_by` (`createdBy`),
  KEY `fk_notices_updated_by` (`updatedBy`),
  KEY `idx_notices_user_type` (`userType`,`status`,`publishedAt`),
  CONSTRAINT `fk_notices_created_by` FOREIGN KEY (`createdBy`) REFERENCES `admins` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `fk_notices_updated_by` FOREIGN KEY (`updatedBy`) REFERENCES `admins` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `notification_logs`
--

DROP TABLE IF EXISTS `notification_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `notification_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `contract_id` int(11) NOT NULL COMMENT '계약 ID',
  `chat_room_id` int(11) DEFAULT NULL COMMENT '채팅방 ID (MySQL)',
  `notification_type` varchar(50) NOT NULL COMMENT '알림 타입',
  `auto_message_template_id` int(11) DEFAULT NULL COMMENT '자동메시지 템플릿 ID',
  `message_content` text DEFAULT NULL COMMENT '발송된 메시지 내용',
  `status` enum('SUCCESS','FAILED','SKIPPED') NOT NULL DEFAULT 'SUCCESS',
  `error_message` text DEFAULT NULL COMMENT '실패 시 에러 메시지',
  `target_date` date NOT NULL COMMENT '발송 기준일',
  `sent_at` datetime NOT NULL DEFAULT current_timestamp(),
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_unique_notification` (`contract_id`,`notification_type`,`target_date`),
  KEY `idx_contract_id` (`contract_id`),
  KEY `idx_notification_type` (`notification_type`),
  KEY `idx_target_date` (`target_date`),
  KEY `idx_auto_message_template_id` (`auto_message_template_id`)
) ENGINE=InnoDB AUTO_INCREMENT=16 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `notifications`
--

DROP TABLE IF EXISTS `notifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `notifications` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL COMMENT '알림 수신자 ID',
  `user_mode` enum('guest','host') NOT NULL COMMENT '수신 시점의 사용자 모드',
  `type` enum('MESSAGE','NOTICE','INQUIRY_ANSWERED','PAYMENT_COMPLETED','CHECKIN_TODAY','CHECKOUT_REMINDER','CHECKOUT_CONFIRMED','CONTRACT_CANCELED','CONTRACT','CONTRACT_REQUEST_GUEST','CONTRACT_APPROVED','CONTRACT_REJECTED','PAYMENT_PENDING','OPTION_DEADLINE','CONTRACT_REQUEST_HOST','PROPERTY_REVIEW_RESULT','ADDITIONAL_OPTION_PAYMENT','CHECKIN_CONFIRMED','CHECKOUT_REQUEST') NOT NULL COMMENT '알림 유형',
  `title` varchar(100) NOT NULL COMMENT '알림 제목',
  `message` text NOT NULL COMMENT '알림 본문',
  `is_read` tinyint(1) NOT NULL DEFAULT 0 COMMENT '읽음 여부',
  `related_contract_id` int(11) DEFAULT NULL COMMENT '관련 계약 ID',
  `related_chat_room_id` int(11) DEFAULT NULL COMMENT '관련 채팅방 ID',
  `related_notice_id` int(11) DEFAULT NULL COMMENT '관련 공지사항 ID',
  `related_inquiry_id` int(11) DEFAULT NULL COMMENT '관련 문의 ID',
  `related_room_id` int(11) DEFAULT NULL COMMENT '관련 매물 ID',
  `metadata` text DEFAULT NULL COMMENT '추가 메타데이터 (JSON)',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_user_mode` (`user_id`,`user_mode`),
  KEY `idx_user_read` (`user_id`,`is_read`),
  KEY `idx_type` (`type`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_related_contract` (`related_contract_id`)
) ENGINE=InnoDB AUTO_INCREMENT=141 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `payment_failure_logs`
--

DROP TABLE IF EXISTS `payment_failure_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `payment_failure_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `contractId` int(11) NOT NULL COMMENT '계약 ID',
  `orderId` varchar(100) NOT NULL COMMENT '주문번호',
  `failureCode` varchar(50) DEFAULT NULL COMMENT '토스 에러 코드',
  `failureMessage` text DEFAULT NULL COMMENT '실패 사유 메시지',
  `requestData` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT '결제 요청 데이터 (JSON)' CHECK (json_valid(`requestData`)),
  `responseData` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT '토스 API 응답 데이터 (JSON)' CHECK (json_valid(`responseData`)),
  `userAgent` varchar(500) DEFAULT NULL COMMENT '사용자 브라우저 정보',
  `ipAddress` varchar(50) DEFAULT NULL COMMENT '사용자 IP 주소',
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_failure_log_contract_id` (`contractId`),
  KEY `idx_failure_log_order_id` (`orderId`),
  KEY `idx_failure_log_created_at` (`createdAt`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `payments`
--

DROP TABLE IF EXISTS `payments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `payments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `contractId` int(11) NOT NULL COMMENT '계약 ID',
  `payment_type` enum('CONTRACT','HOST_BURDEN') NOT NULL DEFAULT 'CONTRACT',
  `paymentKey` varchar(255) NOT NULL COMMENT '토스 결제 고유 키',
  `orderId` varchar(100) NOT NULL COMMENT '주문번호 (Contract의 orderId와 동일)',
  `method` enum('CARD','VIRTUAL_ACCOUNT','TRANSFER','MOBILE','EASY_PAY') NOT NULL,
  `easy_pay_provider` enum('KAKAO','NAVER','PAYCO') DEFAULT NULL COMMENT '간편결제 제공사 (method=EASY_PAY일 때만 사용)',
  `status` enum('READY','IN_PROGRESS','WAITING_FOR_DEPOSIT','DONE','CANCELED','PARTIAL_CANCELED','ABORTED','EXPIRED') NOT NULL DEFAULT 'READY' COMMENT '결제 상태',
  `requestedAt` datetime NOT NULL COMMENT '결제 요청 시각',
  `approvedAt` datetime DEFAULT NULL COMMENT '결제 승인 시각',
  `totalAmount` int(11) NOT NULL COMMENT '총 결제 금액',
  `balanceAmount` int(11) DEFAULT NULL COMMENT '취소 가능 금액 (잔액)',
  `suppliedAmount` int(11) DEFAULT NULL COMMENT '공급가액',
  `vat` int(11) DEFAULT NULL COMMENT '부가세',
  `taxFreeAmount` int(11) DEFAULT 0 COMMENT '비과세 금액',
  `currency` varchar(10) NOT NULL DEFAULT 'KRW' COMMENT '통화 (기본: KRW)',
  `receiptUrl` varchar(500) DEFAULT NULL COMMENT '영수증 URL',
  `checkoutUrl` varchar(500) DEFAULT NULL COMMENT '결제 페이지 URL',
  `paymentResponse` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT '토스 API 전체 응답 (JSON 저장)' CHECK (json_valid(`paymentResponse`)),
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `paymentKey` (`paymentKey`),
  UNIQUE KEY `idx_payment_key` (`paymentKey`),
  KEY `idx_payment_contract_id` (`contractId`),
  KEY `idx_payment_order_id` (`orderId`),
  KEY `idx_payment_status` (`status`),
  KEY `idx_payment_type` (`payment_type`)
) ENGINE=InnoDB AUTO_INCREMENT=160 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `payout_logs`
--

DROP TABLE IF EXISTS `payout_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `payout_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `payout_id` int(11) NOT NULL COMMENT '지급 ID',
  `from_status` varchar(20) DEFAULT NULL COMMENT '변경 전 상태',
  `to_status` varchar(20) NOT NULL COMMENT '변경 후 상태',
  `admin_id` int(11) DEFAULT NULL COMMENT '변경한 관리자 ID (스케줄러 자동 변경 시 null)',
  `note` text DEFAULT NULL COMMENT '변경 사유 메모',
  `changed_by` enum('ADMIN','SYSTEM') NOT NULL DEFAULT 'SYSTEM' COMMENT '변경 주체',
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_payout_log_payout_id` (`payout_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `payouts`
--

DROP TABLE IF EXISTS `payouts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `payouts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `contract_id` int(11) NOT NULL COMMENT '계약 ID',
  `settlement_id` int(11) DEFAULT NULL COMMENT '연관 Settlement ID (CONTRACT_SETTLEMENT 타입)',
  `refund_id` int(11) DEFAULT NULL COMMENT '연관 Refund ID (GUEST_PENALTY, DEPOSIT_DEDUCTION 타입)',
  `payout_type` enum('CONTRACT_SETTLEMENT','GUEST_PENALTY','DEPOSIT_DEDUCTION','HOST_CANCELLATION_COMPENSATION') NOT NULL COMMENT '지급 유형',
  `recipient_type` enum('HOST','GUEST') NOT NULL COMMENT '수령인 유형',
  `recipient_id` int(11) NOT NULL COMMENT '수령인 User ID',
  `amount` int(11) NOT NULL COMMENT '지급 금액',
  `status` enum('PENDING','PAYABLE','PROCESSING','COMPLETED','ON_HOLD','FAILED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  `payable_after` date NOT NULL COMMENT '지급 가능 최소 날짜 (결제 승인일 + 3영업일)',
  `bank_name` varchar(50) DEFAULT NULL COMMENT '수령 은행명',
  `account_number` varchar(50) DEFAULT NULL COMMENT '수령 계좌번호',
  `account_holder` varchar(100) DEFAULT NULL COMMENT '수령 예금주명',
  `admin_id` int(11) DEFAULT NULL COMMENT '처리한 관리자 ID',
  `processed_at` datetime DEFAULT NULL COMMENT '지급 완료 시각',
  `failure_reason` text DEFAULT NULL COMMENT '지급 실패 사유',
  `note` text DEFAULT NULL COMMENT '관리자 메모',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_payout_contract_id` (`contract_id`),
  KEY `idx_payout_status_date` (`status`,`payable_after`),
  KEY `idx_payout_recipient` (`recipient_type`,`recipient_id`),
  KEY `idx_payout_type` (`payout_type`)
) ENGINE=InnoDB AUTO_INCREMENT=14 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='지급 관리';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `receipt_settings`
--

DROP TABLE IF EXISTS `receipt_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `receipt_settings` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL COMMENT '사용자 ID (호스트/게스트)',
  `receipt_type` enum('personal','business','tax_invoice') NOT NULL COMMENT '영수증 종류',
  `receipt_number` varchar(30) NOT NULL COMMENT '폰번호/카드번호/사업자번호',
  `business_name` varchar(100) DEFAULT NULL COMMENT '사업자명',
  `rep_name` varchar(50) DEFAULT NULL COMMENT '대표자명',
  `email` varchar(100) DEFAULT NULL COMMENT '이메일 (tax_invoice 전용)',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_receipt_settings_user` (`user_id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='사용자 영수증 발급 정보 설정 테이블';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `receipts`
--

DROP TABLE IF EXISTS `receipts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `receipts` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL COMMENT '대상 사용자 ID',
  `user_type` enum('HOST','GUEST') NOT NULL COMMENT '사용자 유형',
  `contract_id` int(10) unsigned DEFAULT NULL COMMENT '관련 계약 ID',
  `settlement_id` int(10) unsigned DEFAULT NULL COMMENT '관련 정산 ID',
  `receipt_type` enum('personal','business','tax_invoice') NOT NULL COMMENT '영수증 종류 (스냅샷)',
  `target_type` enum('CONTRACT_FEE','HOST_CANCEL_FEE','GUEST_CANCEL_FEE','OPTION_SALE') NOT NULL COMMENT '발급 유형',
  `amount` int(11) NOT NULL COMMENT '발급 대상 금액',
  `date` date NOT NULL COMMENT '결제일 또는 정산 지급일',
  `status` enum('PENDING','ISSUED') NOT NULL DEFAULT 'PENDING' COMMENT '발급 상태',
  `issued_at` datetime DEFAULT NULL COMMENT '발급 완료 시각',
  `issued_by` int(10) unsigned DEFAULT NULL COMMENT '발급 처리 관리자 ID',
  `issue_note` varchar(500) DEFAULT NULL COMMENT '관리자 메모',
  `receipt_number` varchar(30) NOT NULL COMMENT '폰번호/카드번호/사업자번호 (스냅샷)',
  `business_name` varchar(100) DEFAULT NULL COMMENT '사업자명 (스냅샷)',
  `rep_name` varchar(50) DEFAULT NULL COMMENT '대표자명 (스냅샷)',
  `email` varchar(100) DEFAULT NULL COMMENT '이메일 (스냅샷)',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_receipts_user` (`user_id`,`user_type`),
  KEY `idx_receipts_status` (`status`),
  KEY `idx_receipts_contract` (`contract_id`),
  KEY `idx_receipts_date` (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='영수증 발급 건 관리 테이블';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `refund_policy_rules`
--

DROP TABLE IF EXISTS `refund_policy_rules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `refund_policy_rules` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `policy_type` varchar(50) NOT NULL COMMENT '정책 타입 (FK)',
  `days_before_min` int(11) NOT NULL COMMENT '최소 일수 (N일 이전)',
  `days_before_max` int(11) DEFAULT NULL COMMENT '최대 일수 (NULL이면 무제한)',
  `refund_rate` decimal(5,2) NOT NULL COMMENT '환불율 (0-100)',
  `is_same_day_cancellation` tinyint(1) NOT NULL DEFAULT 0 COMMENT '계약 당일 취소 규칙 여부',
  `description` varchar(255) DEFAULT NULL COMMENT '규칙 설명',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_policy_days` (`policy_type`,`days_before_min`,`days_before_max`),
  CONSTRAINT `refund_policy_rules_ibfk_1` FOREIGN KEY (`policy_type`) REFERENCES `refund_policy_types` (`policy_type`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `chk_days_range` CHECK (`days_before_max` is null or `days_before_max` >= `days_before_min`),
  CONSTRAINT `chk_refund_rate` CHECK (`refund_rate` >= 0 and `refund_rate` <= 100)
) ENGINE=InnoDB AUTO_INCREMENT=30 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='환불 정책 기간별 규칙';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `refund_policy_types`
--

DROP TABLE IF EXISTS `refund_policy_types`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `refund_policy_types` (
  `policy_type` varchar(50) NOT NULL COMMENT '정책 타입 (약하게, 보통, 엄격하게)',
  `display_name` varchar(100) NOT NULL COMMENT '표시명 (한글)',
  `description` text DEFAULT NULL COMMENT '정책 설명',
  `is_active` tinyint(1) NOT NULL DEFAULT 1 COMMENT '활성화 여부',
  `special_rules` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT '특별 규칙 (청소비/관리비 환불 등)' CHECK (json_valid(`special_rules`)),
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`policy_type`),
  KEY `idx_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='환불 정책 마스터 테이블';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `refunds`
--

DROP TABLE IF EXISTS `refunds`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `refunds` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `contract_id` int(11) NOT NULL COMMENT '계약 ID',
  `refund_status` enum('REQUESTED','CALCULATING','APPROVED','REJECTED','PROCESSING','COMPLETED','FAILED') NOT NULL DEFAULT 'REQUESTED' COMMENT '환불 상태',
  `policy_type_used` varchar(50) NOT NULL COMMENT '적용된 정책 타입',
  `cancellation_date` datetime NOT NULL COMMENT '취소 시점',
  `check_in_date` datetime NOT NULL COMMENT '입주 예정일',
  `days_before_checkin` int(11) NOT NULL COMMENT '입주일까지 남은 일수',
  `original_rental_fee` int(11) NOT NULL COMMENT '원본 임대료',
  `original_cleaning_fee` int(11) NOT NULL DEFAULT 0 COMMENT '원본 청소비',
  `original_maintenance_fee` int(11) NOT NULL DEFAULT 0 COMMENT '원본 관리비',
  `original_total_amount` int(11) NOT NULL COMMENT '원본 총액',
  `rental_fee_refund_rate` decimal(5,2) NOT NULL COMMENT '임대료 환불율',
  `rental_fee_refund_amount` int(11) NOT NULL COMMENT '임대료 환불액',
  `cleaning_fee_refund_amount` int(11) NOT NULL DEFAULT 0 COMMENT '청소비 환불액',
  `maintenance_fee_refund_amount` int(11) NOT NULL DEFAULT 0 COMMENT '관리비 환불액',
  `total_refund_amount` int(11) NOT NULL COMMENT '총 환불액',
  `platform_fee_deducted` int(11) NOT NULL DEFAULT 0 COMMENT '플랫폼 수수료 공제',
  `penalty_amount` int(11) NOT NULL DEFAULT 0 COMMENT '위약금',
  `final_refund_amount` int(11) NOT NULL COMMENT '최종 환불액 (총 환불액 - 수수료 - 위약금)',
  `refund_method` enum('ORIGINAL_PAYMENT','BANK_TRANSFER') DEFAULT NULL COMMENT '환불 방법',
  `pg_response` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'PG 취소 응답 원문' CHECK (json_valid(`pg_response`)),
  `refund_account_info` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT '환불 계좌 정보' CHECK (json_valid(`refund_account_info`)),
  `cancellation_reason` text DEFAULT NULL COMMENT '취소 사유',
  `rejection_reason` text DEFAULT NULL COMMENT '환불 거절 사유',
  `admin_notes` text DEFAULT NULL COMMENT '관리자 메모',
  `requested_at` datetime NOT NULL DEFAULT current_timestamp() COMMENT '요청 시점',
  `approved_at` datetime DEFAULT NULL COMMENT '승인 시점',
  `rejected_at` datetime DEFAULT NULL COMMENT '거절 시점',
  `completed_at` datetime DEFAULT NULL COMMENT '완료 시점',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `is_same_day_cancellation` tinyint(1) NOT NULL DEFAULT 0 COMMENT '계약 당일 취소 여부',
  `cancellation_fault_type` enum('GUEST','HOST') DEFAULT NULL COMMENT '취소 귀책 구분',
  `has_ez_cleaning_service` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'EZ클리닝 서비스 사용 여부 (계약 시점 스냅샷)',
  `original_deposit` int(11) NOT NULL DEFAULT 0 COMMENT '원본 보증금',
  `original_platform_fee` int(11) NOT NULL DEFAULT 0 COMMENT '원본 게스트 서비스 수수료',
  `usage_fee` int(11) NOT NULL DEFAULT 0 COMMENT '이용료 (환불율 적용 기준 = 임대료, 관리비·청소비는 항상 100% 환불)',
  `usage_fee_refund_amount` int(11) NOT NULL DEFAULT 0 COMMENT '이용료 환불액 (floor(usage_fee * refund_rate%))',
  `deposit_refund_amount` int(11) NOT NULL DEFAULT 0 COMMENT '보증금 환불액 (항상 100%)',
  `host_penalty_amount` int(11) NOT NULL DEFAULT 0 COMMENT '호스트 위약금 수령액 (위약금 - 호스트 수수료 3.3%)',
  `host_penalty_fee` int(11) NOT NULL DEFAULT 0 COMMENT '위약금에 대한 호스트 서비스 수수료 (floor(위약금 * 3.3%))',
  `guest_service_fee_refunded` tinyint(1) NOT NULL DEFAULT 0 COMMENT '게스트 서비스 수수료 환불 여부 (100% 환불 또는 호스트 귀책 시 true)',
  `host_burden_amount` int(11) NOT NULL DEFAULT 0 COMMENT '호스트 부담금 총액 (위약금 + 게스트 서비스 수수료)',
  `host_burden_status` enum('PENDING','PAID','OVERDUE') DEFAULT NULL COMMENT '호스트 부담금 결제 상태',
  `guest_compensation_amount` int(11) NOT NULL DEFAULT 0 COMMENT '게스트 보전 지급액 (위약금)',
  `guest_compensation_status` enum('PENDING','PAID') DEFAULT NULL COMMENT '게스트 보전 지급 상태',
  PRIMARY KEY (`id`),
  KEY `idx_contract` (`contract_id`),
  KEY `idx_status` (`refund_status`),
  KEY `idx_requested_at` (`requested_at`),
  CONSTRAINT `refunds_ibfk_1` FOREIGN KEY (`contract_id`) REFERENCES `contracts` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `chk_refund_amounts` CHECK (`total_refund_amount` >= 0 and `final_refund_amount` >= 0 and `final_refund_amount` <= `total_refund_amount`),
  CONSTRAINT `chk_days_before_checkin` CHECK (`days_before_checkin` >= 0)
) ENGINE=InnoDB AUTO_INCREMENT=28 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='환불 요청 및 처리 이력';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `rental_item_reservations`
--

DROP TABLE IF EXISTS `rental_item_reservations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `rental_item_reservations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `contract_id` int(11) NOT NULL COMMENT '계약 ID',
  `rental_order_id` int(11) DEFAULT NULL COMMENT '렌탈 주문 ID',
  `rental_order_item_id` int(11) DEFAULT NULL COMMENT '렌탈 주문 아이템 ID',
  `rental_item_id` int(11) NOT NULL COMMENT '렌탈 아이템 ID',
  `quantity` int(11) NOT NULL COMMENT '예약 수량',
  `price_per_item` decimal(10,2) NOT NULL COMMENT '아이템당 가격 (예약 당시 가격)',
  `total_price` decimal(10,2) NOT NULL COMMENT '총 가격 (수량 * 아이템당 가격)',
  `reserved_from` datetime NOT NULL COMMENT '예약 시작일 (체크인 날짜)',
  `reserved_until` datetime NOT NULL COMMENT '예약 종료일 (체크아웃 날짜)',
  `status` enum('RESERVED','CONFIRMED','COMPLETED','CANCELLED') NOT NULL DEFAULT 'RESERVED' COMMENT '예약 상태',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_contract_id` (`contract_id`),
  KEY `idx_rental_item_id` (`rental_item_id`),
  KEY `idx_status` (`status`),
  KEY `idx_reserved_from` (`reserved_from`),
  KEY `idx_reserved_until` (`reserved_until`),
  KEY `idx_date_range` (`reserved_from`,`reserved_until`),
  KEY `idx_reservation_rental_order_id` (`rental_order_id`),
  CONSTRAINT `fk_rental_item_reservation_contract` FOREIGN KEY (`contract_id`) REFERENCES `contracts` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_rental_item_reservation_rental_item` FOREIGN KEY (`rental_item_id`) REFERENCES `rental_items` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_reservation_rental_order` FOREIGN KEY (`rental_order_id`) REFERENCES `rental_orders` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=287 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='렌탈 아이템 예약 기록';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `rental_items`
--

DROP TABLE IF EXISTS `rental_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `rental_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `item_type` enum('hair_dryer','bedding_set','amenity_kit','towel_set','other') NOT NULL COMMENT '물품 카테고리',
  `sales_type` enum('SALE','RENTAL') NOT NULL DEFAULT 'SALE',
  `name` varchar(100) NOT NULL COMMENT '물품명 (예: 프리미엄 어메니티 키트)',
  `description` text DEFAULT NULL COMMENT '물품 설명',
  `price` decimal(10,2) NOT NULL DEFAULT 0.00 COMMENT '대여 가격 (1회당)',
  `total_stock` int(11) NOT NULL DEFAULT 0 COMMENT '총 재고 수량',
  `image_url` varchar(255) DEFAULT NULL COMMENT '물품 이미지 URL',
  `is_active` tinyint(1) NOT NULL DEFAULT 1 COMMENT '활성화 여부 (비활성화시 선택 불가)',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  CONSTRAINT `CONSTRAINT_1` CHECK (`total_stock` >= 0),
  CONSTRAINT `CONSTRAINT_4` CHECK (`price` >= 0)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='대여 물품 카탈로그';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `rental_order_items`
--

DROP TABLE IF EXISTS `rental_order_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `rental_order_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `rental_order_id` int(11) NOT NULL COMMENT '렌탈 주문 ID',
  `rental_item_id` int(11) NOT NULL COMMENT '렌탈 아이템 ID',
  `quantity` int(11) NOT NULL DEFAULT 1 COMMENT '수량',
  `price_per_item` decimal(10,2) NOT NULL COMMENT '개당 가격 (주문 시점)',
  `total_price` decimal(10,2) NOT NULL COMMENT '총 가격 (수량 * 개당가격)',
  `status` enum('ACTIVE','CANCEL_REQUESTED','CANCELLED') NOT NULL DEFAULT 'ACTIVE' COMMENT '상태 (입주 중 취소 요청 시 CANCEL_REQUESTED → 관리자 처리 후 CANCELLED)',
  `cancelled_at` datetime DEFAULT NULL COMMENT '취소 시점',
  `refund_amount` decimal(10,2) DEFAULT NULL COMMENT '환불 금액',
  `cancel_reason` varchar(255) DEFAULT NULL COMMENT '취소 사유',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_rental_order_items_order_id` (`rental_order_id`),
  KEY `idx_rental_order_items_item_id` (`rental_item_id`),
  KEY `idx_rental_order_items_status` (`status`),
  CONSTRAINT `fk_order_items_item` FOREIGN KEY (`rental_item_id`) REFERENCES `rental_items` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `fk_order_items_order` FOREIGN KEY (`rental_order_id`) REFERENCES `rental_orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=264 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='렌탈 주문 상세 아이템';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `rental_order_logs`
--

DROP TABLE IF EXISTS `rental_order_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `rental_order_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `contract_id` int(11) NOT NULL COMMENT '계약 ID (빠른 조회용)',
  `rental_order_id` int(11) DEFAULT NULL COMMENT '렌탈 주문 ID',
  `rental_order_item_id` int(11) DEFAULT NULL COMMENT '렌탈 주문 아이템 ID',
  `action` enum('ORDER_CREATED','ITEM_ADDED','ITEM_CANCELLED','PAYMENT_PENDING','PAYMENT_COMPLETED','PAYMENT_FAILED','REFUND_REQUESTED','REFUND_COMPLETED','REFUND_FAILED','ORDER_CANCELLED','ORDER_EXPIRED','CANCEL_REQUESTED','DELIVERY_STARTED','DELIVERY_COMPLETED','ADMIN_REFUND','PG_DB_MISMATCH') NOT NULL,
  `actor` enum('GUEST','HOST','ADMIN','SYSTEM') NOT NULL COMMENT '행위자',
  `actor_id` int(11) DEFAULT NULL COMMENT '행위자 ID (User 또는 Admin)',
  `amount_change` int(11) DEFAULT 0 COMMENT '금액 변동 (+결제, -환불)',
  `balance_after` int(11) DEFAULT 0 COMMENT '변동 후 잔액 (순 결제액)',
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT '상세 정보 (아이템명, 수량, 결제키 등)' CHECK (json_valid(`metadata`)),
  `description` varchar(500) DEFAULT NULL COMMENT '설명 (관리자용)',
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` varchar(500) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_rental_order_logs_contract_id` (`contract_id`),
  KEY `idx_rental_order_logs_order_id` (`rental_order_id`),
  KEY `idx_rental_order_logs_action` (`action`),
  KEY `idx_rental_order_logs_actor` (`actor`),
  KEY `idx_rental_order_logs_created_at` (`created_at`),
  CONSTRAINT `fk_rental_logs_contract` FOREIGN KEY (`contract_id`) REFERENCES `contracts` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `fk_rental_logs_order` FOREIGN KEY (`rental_order_id`) REFERENCES `rental_orders` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=372 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='렌탈 주문 변경 이력';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `rental_order_refund_requests`
--

DROP TABLE IF EXISTS `rental_order_refund_requests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `rental_order_refund_requests` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `rental_order_id` int(11) NOT NULL COMMENT '대상 렌탈 주문 ID',
  `contract_id` int(11) NOT NULL COMMENT '계약 ID (빠른 조회용)',
  `requested_by` int(11) NOT NULL COMMENT '요청한 게스트 user_id',
  `status` enum('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING' COMMENT '처리 상태',
  `cancel_reason` varchar(255) DEFAULT NULL COMMENT '게스트 취소 사유',
  `reject_reason` varchar(255) DEFAULT NULL COMMENT '관리자 거절 사유',
  `delivery_status_snapshot` enum('PENDING','IN_TRANSIT','DELIVERED') NOT NULL COMMENT '요청 시점의 배송 상태',
  `item_total_amount` int(11) NOT NULL DEFAULT 0 COMMENT '아이템 합계 금액 (배송비 차감 전)',
  `shipping_deduction` int(11) NOT NULL DEFAULT 0 COMMENT '수거비 차감액 = 플랫폼 수거비 수입 (0 or 7000)',
  `final_refund_amount` int(11) NOT NULL DEFAULT 0 COMMENT '실제 환불 금액 (수락 시 확정)',
  `retrieval_status` enum('RETRIEVAL_PENDING','IN_RETRIEVAL','RETRIEVED') DEFAULT NULL COMMENT '수거 상태 (수락 후 배송된 상품에만 적용)',
  `retrieval_started_at` datetime DEFAULT NULL COMMENT '수거 시작 시점',
  `retrieval_completed_at` datetime DEFAULT NULL COMMENT '수거 완료 시점',
  `admin_id` int(11) DEFAULT NULL COMMENT '처리한 관리자 ID',
  `processed_at` datetime DEFAULT NULL COMMENT '수락/거절 처리 시점',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_rorr_rental_order_id` (`rental_order_id`),
  KEY `idx_rorr_contract_id` (`contract_id`),
  KEY `idx_rorr_requested_by` (`requested_by`),
  KEY `idx_rorr_status` (`status`),
  KEY `idx_rorr_retrieval_status` (`retrieval_status`),
  KEY `idx_rorr_created_at` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `rental_orders`
--

DROP TABLE IF EXISTS `rental_orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `rental_orders` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `contract_id` int(11) NOT NULL COMMENT '연결된 계약 ID',
  `order_id` varchar(15) NOT NULL COMMENT '주문번호 (YYMMDD-R0001)',
  `order_type` enum('INITIAL','ADDITIONAL') NOT NULL COMMENT '주문 유형',
  `total_amount` int(11) NOT NULL DEFAULT 0 COMMENT '결제 예정 금액 (아이템 합계)',
  `paid_amount` int(11) NOT NULL DEFAULT 0 COMMENT '실제 결제된 금액',
  `refunded_amount` int(11) NOT NULL DEFAULT 0 COMMENT '환불된 총 금액',
  `status` enum('PENDING','PAID','PARTIAL_REFUND','FULLY_REFUNDED','CANCELLED') NOT NULL DEFAULT 'PENDING' COMMENT '주문 상태',
  `delivery_status` enum('PENDING','IN_TRANSIT','DELIVERED') NOT NULL DEFAULT 'PENDING' COMMENT '배송 상태 (PENDING: 배송전, IN_TRANSIT: 배송중, DELIVERED: 배송완료)',
  `delivered_at` datetime DEFAULT NULL COMMENT '배송 완료 시점',
  `payment_key` varchar(100) DEFAULT NULL COMMENT '토스페이먼츠 결제키',
  `payment_method` varchar(50) DEFAULT NULL COMMENT '결제 수단',
  `paid_at` datetime DEFAULT NULL COMMENT '결제 완료 시점',
  `modifiable_until` datetime NOT NULL COMMENT '수정 가능 기한 (체크인 5일 전)',
  `items_snapshot` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT '주문 시점 아이템 정보' CHECK (json_valid(`items_snapshot`)),
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `order_id` (`order_id`),
  KEY `idx_rental_orders_contract_id` (`contract_id`),
  KEY `idx_rental_orders_order_type` (`order_type`),
  KEY `idx_rental_orders_status` (`status`),
  KEY `idx_rental_orders_modifiable_until` (`modifiable_until`),
  KEY `idx_rental_orders_paid_at` (`paid_at`),
  KEY `idx_rental_orders_delivery_status` (`delivery_status`),
  CONSTRAINT `fk_rental_orders_contract` FOREIGN KEY (`contract_id`) REFERENCES `contracts` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=152 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='렌탈 아이템 주문 (플랫폼 서비스)';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `rental_payment_failure_logs`
--

DROP TABLE IF EXISTS `rental_payment_failure_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `rental_payment_failure_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `rentalOrderId` int(11) NOT NULL COMMENT '렌탈 주문 ID',
  `contractId` int(11) NOT NULL COMMENT '계약 ID (조회 편의용)',
  `orderId` varchar(100) NOT NULL COMMENT '주문번호',
  `failureCode` varchar(50) DEFAULT NULL COMMENT '토스 에러 코드',
  `failureMessage` text DEFAULT NULL COMMENT '실패 사유 메시지',
  `requestData` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT '결제 요청 데이터 (JSON)' CHECK (json_valid(`requestData`)),
  `responseData` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT '토스 API 응답 데이터 (JSON)' CHECK (json_valid(`responseData`)),
  `userAgent` varchar(500) DEFAULT NULL COMMENT '사용자 브라우저 정보',
  `ipAddress` varchar(50) DEFAULT NULL COMMENT '사용자 IP 주소',
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_rental_failure_log_rental_order_id` (`rentalOrderId`),
  KEY `idx_rental_failure_log_contract_id` (`contractId`),
  KEY `idx_rental_failure_log_order_id` (`orderId`),
  KEY `idx_rental_failure_log_created_at` (`createdAt`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `rental_payments`
--

DROP TABLE IF EXISTS `rental_payments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `rental_payments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `rentalOrderId` int(11) NOT NULL COMMENT '렌탈 주문 ID',
  `contractId` int(11) NOT NULL COMMENT '계약 ID (조회 편의용)',
  `paymentKey` varchar(255) NOT NULL COMMENT '토스 결제 고유 키',
  `orderId` varchar(100) NOT NULL COMMENT '주문번호 (RentalOrder의 orderId와 동일)',
  `method` enum('CARD','VIRTUAL_ACCOUNT','TRANSFER','MOBILE','EASY_PAY') NOT NULL COMMENT '결제 수단',
  `easy_pay_provider` enum('KAKAO','NAVER','PAYCO') DEFAULT NULL COMMENT '간편결제 제공사 (method=EASY_PAY일 때만 사용)',
  `status` enum('READY','IN_PROGRESS','WAITING_FOR_DEPOSIT','DONE','CANCELED','PARTIAL_CANCELED','ABORTED','EXPIRED') NOT NULL DEFAULT 'READY' COMMENT '결제 상태',
  `requestedAt` datetime NOT NULL COMMENT '결제 요청 시각',
  `approvedAt` datetime DEFAULT NULL COMMENT '결제 승인 시각',
  `totalAmount` int(11) NOT NULL COMMENT '총 결제 금액',
  `balanceAmount` int(11) DEFAULT NULL COMMENT '취소 가능 금액 (잔액)',
  `suppliedAmount` int(11) DEFAULT NULL COMMENT '공급가액',
  `vat` int(11) DEFAULT NULL COMMENT '부가세',
  `taxFreeAmount` int(11) DEFAULT 0 COMMENT '비과세 금액',
  `currency` varchar(10) NOT NULL DEFAULT 'KRW' COMMENT '통화 (기본: KRW)',
  `receiptUrl` varchar(500) DEFAULT NULL COMMENT '영수증 URL',
  `checkoutUrl` varchar(500) DEFAULT NULL COMMENT '결제 페이지 URL',
  `paymentResponse` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT '토스 API 전체 응답 (JSON 저장)' CHECK (json_valid(`paymentResponse`)),
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `paymentKey` (`paymentKey`),
  UNIQUE KEY `idx_rental_payment_key` (`paymentKey`),
  KEY `idx_rental_payment_rental_order_id` (`rentalOrderId`),
  KEY `idx_rental_payment_contract_id` (`contractId`),
  KEY `idx_rental_payment_order_id` (`orderId`),
  KEY `idx_rental_payment_status` (`status`)
) ENGINE=InnoDB AUTO_INCREMENT=103 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `room_amenities`
--

DROP TABLE IF EXISTS `room_amenities`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `room_amenities` (
  `room_id` int(11) NOT NULL,
  `basic_options` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT '기본 옵션 (에어컨, 세탁기 등)' CHECK (json_valid(`basic_options`)),
  `additional_options` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT '추가 옵션' CHECK (json_valid(`additional_options`)),
  `convenience_options` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT '편의 옵션' CHECK (json_valid(`convenience_options`)),
  `wifi_password` varchar(100) DEFAULT NULL COMMENT '와이파이 비밀번호',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `pets_allowed` tinyint(1) NOT NULL DEFAULT 0 COMMENT '반려동물 동반 가능 여부',
  PRIMARY KEY (`room_id`),
  KEY `idx_pets_allowed` (`pets_allowed`),
  CONSTRAINT `fk_room_amenities_room` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='숙소 편의시설';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `room_free_services`
--

DROP TABLE IF EXISTS `room_free_services`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `room_free_services` (
  `room_id` int(11) NOT NULL,
  `cleaning_service` tinyint(1) NOT NULL DEFAULT 0 COMMENT '청소 서비스 제공 여부',
  `hair_dryer_rental` tinyint(1) NOT NULL DEFAULT 0 COMMENT '드라이기 대여 여부',
  `bedding_service` tinyint(1) NOT NULL DEFAULT 0 COMMENT '침구 서비스 여부',
  `amenity_kit` tinyint(1) NOT NULL DEFAULT 0,
  `auto_password_change` tinyint(1) NOT NULL DEFAULT 0 COMMENT '자동 비밀번호 변경 여부',
  `room_password` varchar(100) DEFAULT NULL COMMENT '방 비밀번호',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `towel_set_rental` tinyint(1) DEFAULT 0 COMMENT '수건 세트 대여 가능 여부',
  PRIMARY KEY (`room_id`),
  CONSTRAINT `fk_room_free_services_room` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='숙소 무료 부가서비스';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `room_memos`
--

DROP TABLE IF EXISTS `room_memos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `room_memos` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `room_id` int(11) NOT NULL,
  `admin_id` int(11) NOT NULL,
  `content` text NOT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_room_memos_room_id` (`room_id`),
  KEY `idx_room_memos_admin_id` (`admin_id`),
  KEY `idx_room_memos_created_at` (`created_at`),
  CONSTRAINT `room_memos_ibfk_1` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`),
  CONSTRAINT `room_memos_ibfk_2` FOREIGN KEY (`admin_id`) REFERENCES `admins` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `room_password_histories`
--

DROP TABLE IF EXISTS `room_password_histories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `room_password_histories` (
  `id` int(11) NOT NULL AUTO_INCREMENT COMMENT '이력 고유 ID',
  `room_id` int(11) NOT NULL COMMENT '방 ID (외래키는 models/index.js에서 설정)',
  `admin_id` int(11) NOT NULL COMMENT '변경한 관리자 ID (외래키는 models/index.js에서 설정)',
  `previous_password` varchar(50) DEFAULT NULL COMMENT '변경 전 비밀번호 (최초 설정 시 null)',
  `new_password` varchar(50) NOT NULL COMMENT '변경 후 비밀번호',
  `reason` varchar(255) DEFAULT NULL COMMENT '변경 사유 (예: 호스트 분실 신고, 게스트 체크아웃 후 변경)',
  `ip_address` varchar(45) DEFAULT NULL COMMENT '관리자 IP 주소 (IPv4/IPv6, 보안 감사용)',
  `user_agent` varchar(255) DEFAULT NULL COMMENT '관리자 브라우저/디바이스 정보 (보안 감사용)',
  `changed_at` datetime NOT NULL COMMENT '비밀번호 변경 시각',
  PRIMARY KEY (`id`),
  KEY `idx_room_password_history_room_time` (`room_id`,`changed_at`),
  KEY `idx_room_password_history_admin` (`admin_id`),
  KEY `idx_room_password_history_time` (`changed_at`),
  CONSTRAINT `room_password_histories_ibfk_1` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `room_password_histories_ibfk_2` FOREIGN KEY (`admin_id`) REFERENCES `admins` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='방 비밀번호 변경 이력 테이블 (보안 감사용)';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `room_photos`
--

DROP TABLE IF EXISTS `room_photos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `room_photos` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `room_id` int(11) NOT NULL,
  `url` varchar(500) NOT NULL COMMENT '사진 URL',
  `order` int(11) NOT NULL DEFAULT 0 COMMENT '사진 순서',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_room_id` (`room_id`),
  KEY `idx_order` (`order`),
  KEY `idx_room_photos_url` (`url`(191)),
  CONSTRAINT `fk_room_photos_room` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=6146 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='숙소 사진';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `room_status_histories`
--

DROP TABLE IF EXISTS `room_status_histories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `room_status_histories` (
  `id` int(11) NOT NULL AUTO_INCREMENT COMMENT '이력 고유 ID',
  `room_id` int(11) NOT NULL COMMENT '방 ID (외래키는 models/index.js에서 설정)',
  `admin_id` int(11) NOT NULL COMMENT '변경한 관리자 ID (외래키는 models/index.js에서 설정)',
  `previous_status` enum('draft','pending_review','approved','rejected','published','hidden_by_admin') NOT NULL COMMENT '변경 전 상태',
  `new_status` enum('draft','pending_review','approved','rejected','published','hidden_by_admin') NOT NULL COMMENT '변경 후 상태',
  `reason` varchar(255) DEFAULT NULL COMMENT '변경 사유 (예: 부적절한 콘텐츠, 호스트 요청, 임시 숨김)',
  `ip_address` varchar(45) DEFAULT NULL COMMENT '관리자 IP 주소 (IPv4/IPv6, 보안 감사용)',
  `user_agent` varchar(255) DEFAULT NULL COMMENT '관리자 브라우저/디바이스 정보 (보안 감사용)',
  `changed_at` datetime NOT NULL COMMENT '상태 변경 시각',
  PRIMARY KEY (`id`),
  KEY `idx_room_status_history_room_time` (`room_id`,`changed_at`),
  KEY `idx_room_status_history_admin` (`admin_id`),
  KEY `idx_room_status_history_time` (`changed_at`),
  KEY `idx_room_status_history_new_status` (`new_status`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='방 게시 상태 변경 이력 테이블 (보안 감사용)';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `rooms`
--

DROP TABLE IF EXISTS `rooms`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `rooms` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `host_id` int(11) NOT NULL,
  `room_name` varchar(255) NOT NULL COMMENT '방 이름',
  `address` varchar(500) NOT NULL COMMENT '주소',
  `detail_address` varchar(500) NOT NULL COMMENT '상세 주소',
  `latitude` decimal(10,8) DEFAULT NULL COMMENT '위도 (WGS84)',
  `longitude` decimal(11,8) DEFAULT NULL COMMENT '경도 (WGS84)',
  `area` decimal(10,2) NOT NULL COMMENT '면적(㎡)',
  `floor` varchar(50) DEFAULT NULL COMMENT '층수',
  `building_type` varchar(50) NOT NULL COMMENT '건물 유형',
  `parking_available` tinyint(1) NOT NULL DEFAULT 0 COMMENT '주차 가능 여부',
  `parking_info` varchar(500) DEFAULT NULL COMMENT '주차 정보',
  `elevator_available` tinyint(1) NOT NULL DEFAULT 0 COMMENT '엘리베이터 유무',
  `room_count` int(11) NOT NULL COMMENT '방 개수',
  `bathroom_count` int(11) NOT NULL COMMENT '욕실 개수',
  `is_duplex` tinyint(1) NOT NULL DEFAULT 0 COMMENT '복층 여부',
  `entrance_password` varchar(100) DEFAULT NULL COMMENT '현관 비밀번호',
  `daily_rent` int(11) DEFAULT NULL COMMENT '1일 임대료',
  `long_term_weeks` int(11) DEFAULT NULL COMMENT '장기 할인 적용 주수',
  `long_term_discount` int(11) DEFAULT NULL COMMENT '장기 할인 금액',
  `quick_move_in` int(11) DEFAULT NULL COMMENT '빠른 입주 가능일 (일 단위, 예: 7 = 7일 이내)',
  `quick_move_in_discount` int(11) DEFAULT NULL COMMENT '빠른 입주 할인 금액',
  `daily_maintenance_fee` int(11) DEFAULT NULL COMMENT '1일 관리비',
  `maintenance_detail` varchar(500) DEFAULT NULL COMMENT '관리비 세부사항',
  `include_electricity` tinyint(1) NOT NULL DEFAULT 0 COMMENT '전기료 포함 여부',
  `include_water` tinyint(1) NOT NULL DEFAULT 0 COMMENT '수도료 포함 여부',
  `include_gas` tinyint(1) NOT NULL DEFAULT 0 COMMENT '가스료 포함 여부',
  `include_internet` tinyint(1) NOT NULL DEFAULT 0 COMMENT '인터넷 포함 여부',
  `cleaning_fee` int(11) DEFAULT NULL COMMENT '청소비',
  `min_contract_days` int(11) DEFAULT NULL COMMENT '최소 계약 일수 (7-90)',
  `refund_policy` varchar(50) DEFAULT NULL COMMENT '환불 정책',
  `description` text DEFAULT NULL COMMENT '방 설명',
  `max_guests` int(11) NOT NULL DEFAULT 2 COMMENT '최대 가능인원',
  `status` enum('draft','pending_review','approved','rejected','published','hidden_by_admin') NOT NULL DEFAULT 'draft',
  `rejection_reason` text DEFAULT NULL COMMENT '매물 반려 사유',
  `submitted_at` datetime DEFAULT NULL COMMENT '심사 요청 일시',
  `approved_at` datetime DEFAULT NULL COMMENT '승인 일시',
  `published_at` datetime DEFAULT NULL COMMENT '게시 일시',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `is_active` tinyint(1) NOT NULL DEFAULT 1 COMMENT '게시 여부',
  `deleted_at` datetime DEFAULT NULL COMMENT 'Soft Delete 타임스탬프',
  `check_in_time` int(11) NOT NULL DEFAULT 14 COMMENT '입실 시간 (14~17, 정시 기준)',
  `check_out_time` int(11) NOT NULL DEFAULT 11 COMMENT '퇴실 시간 (8~11, 정시 기준)',
  PRIMARY KEY (`id`),
  KEY `idx_host_id` (`host_id`),
  KEY `idx_status` (`status`),
  KEY `idx_coordinates` (`latitude`,`longitude`),
  KEY `idx_status_location` (`status`,`latitude`,`longitude`) COMMENT '지도 영역 검색 최적화 (카카오맵 클러스터링)',
  KEY `fk_rooms_refund_policy` (`refund_policy`),
  KEY `idx_host_status_active` (`host_id`,`status`,`is_active`),
  KEY `idx_search_name_address` (`room_name`,`address`),
  CONSTRAINT `fk_rooms_host` FOREIGN KEY (`host_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rooms_refund_policy` FOREIGN KEY (`refund_policy`) REFERENCES `refund_policy_types` (`policy_type`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=1030 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='숙소 정보';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `service_task_logs`
--

DROP TABLE IF EXISTS `service_task_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `service_task_logs` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `service_task_id` int(11) NOT NULL COMMENT '서비스 태스크 ID',
  `contract_id` int(11) NOT NULL COMMENT '계약 ID (빠른 조회용)',
  `from_status` varchar(20) DEFAULT NULL COMMENT '변경 전 상태 (NULL = 최초 생성)',
  `to_status` varchar(20) NOT NULL COMMENT '변경 후 상태',
  `changed_by` enum('ADMIN','SYSTEM') NOT NULL DEFAULT 'ADMIN',
  `admin_id` int(11) DEFAULT NULL COMMENT '관리자 ID',
  `admin_name` varchar(100) DEFAULT NULL COMMENT '관리자 이름 (로그 스냅샷)',
  `cleared_vendor_name` varchar(100) DEFAULT NULL,
  `cleared_vendor_contact` varchar(100) DEFAULT NULL,
  `cleared_vendor_ref_no` varchar(100) DEFAULT NULL,
  `cleared_reserved_amount` int(11) DEFAULT NULL COMMENT 'PENDING 복귀 시 초기화된 견적 금액',
  `cleared_actual_amount` int(11) DEFAULT NULL COMMENT 'PENDING 복귀 시 초기화된 실제 청구 금액',
  `ip_address` varchar(45) DEFAULT NULL,
  `note` varchar(500) DEFAULT NULL COMMENT '관리자 메모',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_service_task_id` (`service_task_id`),
  KEY `idx_contract_id` (`contract_id`),
  KEY `idx_to_status` (`to_status`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_stl_service_task_id` (`service_task_id`),
  KEY `idx_stl_contract_id` (`contract_id`),
  KEY `idx_stl_to_status` (`to_status`),
  KEY `idx_stl_created_at` (`created_at`),
  CONSTRAINT `fk_stl_service_task` FOREIGN KEY (`service_task_id`) REFERENCES `service_tasks` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `service_tasks`
--

DROP TABLE IF EXISTS `service_tasks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `service_tasks` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `contract_id` int(11) NOT NULL,
  `task_type` enum('CLEANING','BEDDING_DELIVERY','BEDDING_RETRIEVAL') NOT NULL,
  `reference_date` date NOT NULL,
  `quantity` int(11) DEFAULT NULL,
  `status` enum('PENDING','RESERVED','COMPLETED','ISSUE') NOT NULL DEFAULT 'PENDING',
  `vendor_name` varchar(100) DEFAULT NULL,
  `vendor_contact` varchar(100) DEFAULT NULL,
  `vendor_ref_no` varchar(100) DEFAULT NULL,
  `reserved_amount` int(11) DEFAULT NULL COMMENT '예약 시 견적 금액',
  `actual_amount` int(11) DEFAULT NULL COMMENT '완료 후 실제 청구 금액',
  `issue_note` varchar(500) DEFAULT NULL COMMENT 'ISSUE 상태 시 이슈 내용 메모',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_contract_task` (`contract_id`,`task_type`),
  KEY `idx_status` (`status`),
  KEY `idx_reference_date` (`reference_date`),
  KEY `idx_contract_id` (`contract_id`),
  KEY `idx_task_type` (`task_type`),
  KEY `service_tasks_status` (`status`),
  KEY `service_tasks_reference_date` (`reference_date`),
  KEY `service_tasks_task_type` (`task_type`),
  CONSTRAINT `fk_service_tasks_contract` FOREIGN KEY (`contract_id`) REFERENCES `contracts` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `settlements`
--

DROP TABLE IF EXISTS `settlements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `settlements` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `contract_id` int(11) NOT NULL COMMENT '계약 ID',
  `host_id` int(11) NOT NULL COMMENT '호스트 ID',
  `status` enum('PENDING','READY','PROCESSING','COMPLETED','ON_HOLD','FAILED') NOT NULL DEFAULT 'PENDING' COMMENT '정산 상태',
  `rental_fee` int(11) NOT NULL DEFAULT 0 COMMENT '임대료',
  `maintenance_fee` int(11) NOT NULL DEFAULT 0 COMMENT '관리비',
  `cleaning_fee` int(11) NOT NULL DEFAULT 0 COMMENT '청소비',
  `host_platform_fee` int(11) NOT NULL DEFAULT 0 COMMENT '호스트 플랫폼 수수료 (3.3%)',
  `refund_deduction` int(11) NOT NULL DEFAULT 0 COMMENT '환불 차감액',
  `gross_amount` int(11) NOT NULL DEFAULT 0 COMMENT '정산 총액 (수수료 차감 전)',
  `net_amount` int(11) NOT NULL DEFAULT 0 COMMENT '실 정산 금액',
  `expected_date` date NOT NULL COMMENT '정산 예정일 (입주일 + 3영업일)',
  `completed_at` datetime DEFAULT NULL COMMENT '정산 완료 시점',
  `note` text DEFAULT NULL COMMENT '관리자 메모',
  `pg_settled_at` datetime DEFAULT NULL COMMENT 'PG 정산 입금 확인 시각 (관리자 확인 시점)',
  `pg_settled_confirmed_by` int(11) DEFAULT NULL COMMENT 'PG 정산 확인한 관리자 ID',
  `payout_available_date` date DEFAULT NULL COMMENT '지급 가능 최소 날짜 (결제 승인일 + 3영업일)',
  `admin_id` int(11) DEFAULT NULL COMMENT '처리한 관리자 ID',
  `toss_data` text DEFAULT NULL COMMENT '토스 서브몰 정산 데이터 (JSON)',
  `settlement_snapshot` text DEFAULT NULL COMMENT '정산 시점 스냅샷 (JSON)',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_settlement_contract_id` (`contract_id`),
  KEY `idx_settlement_host_id` (`host_id`),
  KEY `idx_settlement_status` (`status`),
  KEY `idx_settlement_expected_date` (`expected_date`),
  KEY `idx_settlement_status_date` (`status`,`expected_date`),
  CONSTRAINT `settlements_ibfk_1` FOREIGN KEY (`contract_id`) REFERENCES `contracts` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `settlements_ibfk_2` FOREIGN KEY (`host_id`) REFERENCES `users` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=17 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `social_users`
--

DROP TABLE IF EXISTS `social_users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `social_users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `provider` enum('kakao') NOT NULL COMMENT '소셜 로그인 제공자',
  `provider_id` varchar(255) NOT NULL COMMENT '제공자별 고유 ID',
  `provider_email` varchar(255) DEFAULT NULL COMMENT '제공자에서 받아온       \r\n  이메일 (다를 수 있음)',
  `access_token` text DEFAULT NULL COMMENT '제공자 액세스 토큰 (선택적 저장)',
  `refresh_token_provider` text DEFAULT NULL COMMENT '제공자 리프레시 토큰',
  `token_expires_at` datetime DEFAULT NULL COMMENT '제공자 토큰 만료일',
  `additional_data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT '제공자별 추가 정보 (JSON       \r\n  형태)' CHECK (json_valid(`additional_data`)),
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_provider_user` (`provider`,`provider_id`),
  KEY `user_id` (`user_id`),
  KEY `provider` (`provider`),
  CONSTRAINT `social_users_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user_bank_accounts`
--

DROP TABLE IF EXISTS `user_bank_accounts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `user_bank_accounts` (
  `id` int(11) NOT NULL AUTO_INCREMENT COMMENT '계좌 정보 고유     \r\n  ID',
  `user_id` int(11) NOT NULL COMMENT '사용자 ID (users 테이블\r\n  참조)',
  `bank_name` varchar(50) NOT NULL COMMENT '은행명 (예:\r\n  국민은행, 신한은행)',
  `account_number` varchar(50) NOT NULL COMMENT '계좌번호\r\n  (하이픈 제거된 숫자)',
  `account_holder` varchar(100) NOT NULL COMMENT '예금주명        \r\n  (실명)',
  `is_primary` tinyint(1) DEFAULT 1 COMMENT '주 계좌 여부\r\n  (정산용 기본 계좌)',
  `is_verified` tinyint(1) DEFAULT 0 COMMENT '계좌 인증 완료     \r\n  여부',
  `verified_at` datetime DEFAULT NULL COMMENT '계좌 인증 완료 시간',
  `created_at` timestamp NULL DEFAULT current_timestamp() COMMENT '등록일시',
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp() COMMENT '수정일시',
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `user_bank_accounts_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=21 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci COMMENT='호스트 계좌 정보 테이블 (정산용)';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user_sessions`
--

DROP TABLE IF EXISTS `user_sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `user_sessions` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL COMMENT 'User.id 또는 Admin.id',
  `refresh_token` text NOT NULL,
  `device_info` varchar(255) DEFAULT NULL COMMENT 'User-Agent 기반 기기 식별 문자열',
  `ip_address` varchar(45) DEFAULT NULL COMMENT 'IPv4/IPv6',
  `user_type` enum('user','admin') NOT NULL DEFAULT 'user',
  `expires_at` datetime NOT NULL COMMENT 'refreshToken 만료 시각',
  `last_used_at` datetime NOT NULL COMMENT '마지막 토큰 갱신 시각',
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=112 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `email` varchar(255) NOT NULL,
  `name` varchar(100) DEFAULT NULL,
  `nickname` varchar(100) DEFAULT NULL COMMENT '표시 이름 (닉네임)',
  `profile_image_url` varchar(500) DEFAULT NULL,
  `user_type` enum('local','social') NOT NULL COMMENT 'local: 일반 회원,      \r\n  social: 소셜 회원',
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `account_status` enum('active','suspended','withdrawn') NOT NULL DEFAULT 'active',
  `last_login_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  `phone_number` varchar(20) DEFAULT NULL COMMENT '휴대폰        \r\n  번호',
  `phone_verified` tinyint(1) NOT NULL DEFAULT 0 COMMENT '휴대폰 인증 여부',
  `phone_verified_at` datetime DEFAULT NULL COMMENT '휴대폰      \r\n  인증 완료 시간',
  `service_terms_agreed` tinyint(1) NOT NULL DEFAULT 0 COMMENT '서비스 이용약관 동의 여부',
  `privacy_policy_agreed` tinyint(1) NOT NULL DEFAULT 0 COMMENT '개인정보처리방침 동의 여부',
  `marketing_consent` tinyint(1) NOT NULL DEFAULT 0 COMMENT '마케팅 정보 수신 동의 여부',
  `age_confirmed` tinyint(1) NOT NULL DEFAULT 0 COMMENT '만 19세 이상 확인 여부',
  `terms_agreed_at` datetime DEFAULT NULL COMMENT '약관 동의 시간',
  `ci` varchar(255) DEFAULT NULL COMMENT 'KMC 연계정보(CI) - 서비스 간 동일인 식별',
  `di` varchar(255) DEFAULT NULL COMMENT 'KMC 중복가입확인정보(DI) - 동일 서비스 내 중복가입 방지',
  `birth` varchar(8) DEFAULT NULL COMMENT '생년월일 (YYYYMMDD)',
  `gender` varchar(1) DEFAULT NULL COMMENT '성별 (M/F)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  KEY `idx_users_account_status` (`account_status`),
  KEY `idx_users_di` (`di`)
) ENGINE=InnoDB AUTO_INCREMENT=2049 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*M!100616 SET NOTE_VERBOSITY=@OLD_NOTE_VERBOSITY */;

-- Dump completed on 2026-04-10  5:24:53
