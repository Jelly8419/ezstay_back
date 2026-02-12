-- =====================================================
-- 렌탈 주문 시스템 마이그레이션 - 직접 실행용 SQL
-- DELIMITER 명령어 없이 실행 가능
-- 버전: 1.0
-- 날짜: 2025-02-01
-- =====================================================

-- =====================================================
-- 파트 1: 테이블 생성 (먼저 실행)
-- =====================================================

-- 1. rental_orders 테이블 생성
CREATE TABLE IF NOT EXISTS rental_orders (
  id INT AUTO_INCREMENT PRIMARY KEY COMMENT '렌탈 주문 고유 ID',
  contract_id INT NOT NULL COMMENT '연결된 계약 ID (FK → contracts.id)',
  order_id VARCHAR(15) NOT NULL UNIQUE COMMENT '주문번호 (YYMMDD-R0001 형식, 마이그레이션: YYMMDD-M0001)',
  order_type ENUM('INITIAL', 'ADDITIONAL') NOT NULL COMMENT '주문 유형 (INITIAL: 계약 시 초기 주문, ADDITIONAL: 추가 주문)',

  -- 금액 정보 (렌탈 아이템은 수수료 없음 - 플랫폼 직접 제공 서비스)
  total_amount INT NOT NULL DEFAULT 0 COMMENT '결제 예정 금액 (렌탈 아이템 합계, 수수료 없음)',

  -- 실제 결제/환불 금액
  paid_amount INT NOT NULL DEFAULT 0 COMMENT '실제 결제된 금액',
  refunded_amount INT NOT NULL DEFAULT 0 COMMENT '환불된 총 금액 (부분환불 누적)',

  -- 결제 상태
  status ENUM(
    'PENDING',           -- 결제 대기
    'PAID',              -- 결제 완료
    'PARTIAL_REFUND',    -- 부분 환불
    'FULLY_REFUNDED',    -- 전액 환불
    'CANCELLED'          -- 결제 전 취소
  ) NOT NULL DEFAULT 'PENDING' COMMENT '주문 상태 (PENDING/PAID/PARTIAL_REFUND/FULLY_REFUNDED/CANCELLED)',

  -- 결제 정보
  payment_key VARCHAR(100) NULL COMMENT '토스페이먼츠 결제키 (결제 승인 후 저장)',
  payment_method VARCHAR(50) NULL COMMENT '결제 수단 (카드, 계좌이체, 가상계좌 등)',
  paid_at DATETIME NULL COMMENT '결제 완료 시점',

  -- 수정 기한
  modifiable_until DATETIME NOT NULL COMMENT '수정 가능 기한 (체크인 5일 전 23:59:59)',

  -- 스냅샷 (분쟁 대비)
  items_snapshot JSON NULL COMMENT '주문 시점 아이템 정보 스냅샷 (분쟁 대비용)',

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정일시',

  CONSTRAINT fk_rental_orders_contract FOREIGN KEY (contract_id)
    REFERENCES contracts(id) ON DELETE NO ACTION ON UPDATE CASCADE,

  INDEX idx_rental_orders_contract_id (contract_id),
  INDEX idx_rental_orders_order_type (order_type),
  INDEX idx_rental_orders_status (status),
  INDEX idx_rental_orders_modifiable_until (modifiable_until),
  INDEX idx_rental_orders_paid_at (paid_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='렌탈 아이템 주문 - 플랫폼 직접 제공 서비스 (수수료 없음)';

-- 2. rental_order_items 테이블 생성
CREATE TABLE IF NOT EXISTS rental_order_items (
  id INT AUTO_INCREMENT PRIMARY KEY COMMENT '렌탈 주문 아이템 고유 ID',
  rental_order_id INT NOT NULL COMMENT '렌탈 주문 ID (FK → rental_orders.id)',
  rental_item_id INT NOT NULL COMMENT '렌탈 아이템 마스터 ID (FK → rental_items.id)',

  -- 수량 및 가격
  quantity INT NOT NULL DEFAULT 1 COMMENT '주문 수량',
  price_per_item DECIMAL(10,2) NOT NULL COMMENT '개당 가격 (주문 시점 가격 고정)',
  total_price DECIMAL(10,2) NOT NULL COMMENT '총 가격 (수량 × 개당가격)',

  -- 상태
  status ENUM('ACTIVE', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE' COMMENT '아이템 상태 (ACTIVE: 활성, CANCELLED: 취소됨)',
  cancelled_at DATETIME NULL COMMENT '취소 처리 시점',
  refund_amount DECIMAL(10,2) NULL COMMENT '환불 금액',
  cancel_reason VARCHAR(255) NULL COMMENT '취소 사유 (게스트/관리자 입력)',

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정일시',

  CONSTRAINT fk_order_items_order FOREIGN KEY (rental_order_id)
    REFERENCES rental_orders(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_order_items_item FOREIGN KEY (rental_item_id)
    REFERENCES rental_items(id) ON DELETE NO ACTION ON UPDATE CASCADE,

  INDEX idx_rental_order_items_order_id (rental_order_id),
  INDEX idx_rental_order_items_item_id (rental_item_id),
  INDEX idx_rental_order_items_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='렌탈 주문 상세 아이템 - 주문에 포함된 개별 렌탈 아이템';

-- 3. rental_order_logs 테이블 생성
CREATE TABLE IF NOT EXISTS rental_order_logs (
  id INT AUTO_INCREMENT PRIMARY KEY COMMENT '로그 고유 ID',
  contract_id INT NOT NULL COMMENT '계약 ID (빠른 조회용, FK → contracts.id)',
  rental_order_id INT NULL COMMENT '렌탈 주문 ID (FK → rental_orders.id)',
  rental_order_item_id INT NULL COMMENT '렌탈 주문 아이템 ID (아이템 단위 액션 시)',

  -- 액션 정보
  action ENUM(
    'ORDER_CREATED',      -- 주문 생성
    'ITEM_ADDED',         -- 아이템 추가
    'ITEM_CANCELLED',     -- 아이템 취소
    'PAYMENT_PENDING',    -- 결제 대기
    'PAYMENT_COMPLETED',  -- 결제 완료
    'PAYMENT_FAILED',     -- 결제 실패
    'REFUND_REQUESTED',   -- 환불 요청
    'REFUND_COMPLETED',   -- 환불 완료
    'REFUND_FAILED',      -- 환불 실패
    'ORDER_CANCELLED'     -- 주문 전체 취소
  ) NOT NULL COMMENT '액션 유형 (ORDER_CREATED/ITEM_ADDED/ITEM_CANCELLED/PAYMENT_*/REFUND_*/ORDER_CANCELLED)',

  -- 행위자 정보
  actor ENUM('GUEST', 'HOST', 'ADMIN', 'SYSTEM') NOT NULL COMMENT '행위자 유형 (GUEST: 게스트, HOST: 호스트, ADMIN: 관리자, SYSTEM: 시스템)',
  actor_id INT NULL COMMENT '행위자 ID (User.id 또는 Admin.id, SYSTEM인 경우 NULL)',

  -- 금액 변동
  amount_change INT DEFAULT 0 COMMENT '금액 변동 (양수: 결제, 음수: 환불)',
  balance_after INT DEFAULT 0 COMMENT '변동 후 순 결제액 (paidAmount - refundedAmount)',

  -- 상세 정보
  metadata JSON NULL COMMENT '상세 정보 JSON (아이템명, 수량, 결제키, 환불사유 등)',
  description VARCHAR(500) NULL COMMENT '로그 설명 (관리자/시스템 메모)',

  -- 추적 정보
  ip_address VARCHAR(45) NULL COMMENT '요청 IP 주소 (IPv4/IPv6)',
  user_agent VARCHAR(500) NULL COMMENT '요청 User-Agent (브라우저/앱 정보)',

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '로그 생성일시',

  CONSTRAINT fk_rental_logs_contract FOREIGN KEY (contract_id)
    REFERENCES contracts(id) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT fk_rental_logs_order FOREIGN KEY (rental_order_id)
    REFERENCES rental_orders(id) ON DELETE SET NULL ON UPDATE CASCADE,

  INDEX idx_rental_order_logs_contract_id (contract_id),
  INDEX idx_rental_order_logs_order_id (rental_order_id),
  INDEX idx_rental_order_logs_action (action),
  INDEX idx_rental_order_logs_actor (actor),
  INDEX idx_rental_order_logs_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='렌탈 주문 변경 이력 - 모든 주문/결제/환불 액션 추적';

-- =====================================================
-- 파트 2: rental_item_reservations 컬럼 추가
-- =====================================================

-- 컬럼 존재 여부에 따라 개별 실행
-- 에러가 나면 이미 존재하는 것이므로 무시하고 다음으로 진행

-- rental_order_id 컬럼 추가
ALTER TABLE rental_item_reservations
ADD COLUMN rental_order_id INT NULL COMMENT '렌탈 주문 ID' AFTER contract_id;

-- rental_order_item_id 컬럼 추가
ALTER TABLE rental_item_reservations
ADD COLUMN rental_order_item_id INT NULL COMMENT '렌탈 주문 아이템 ID' AFTER rental_order_id;

-- 외래키 추가
ALTER TABLE rental_item_reservations
ADD CONSTRAINT fk_reservation_rental_order
FOREIGN KEY (rental_order_id) REFERENCES rental_orders(id)
ON DELETE SET NULL ON UPDATE CASCADE;

-- 인덱스 추가
ALTER TABLE rental_item_reservations
ADD INDEX idx_reservation_rental_order_id (rental_order_id);

-- =====================================================
-- 파트 3: 마이그레이션 대상 확인
-- =====================================================

SELECT
  'Migration candidates' AS info,
  COUNT(*) AS total_contracts,
  SUM(CASE WHEN status IN ('PAYMENT_COMPLETED', 'IN_PROGRESS', 'COMPLETED') THEN 1 ELSE 0 END) AS paid_contracts,
  SUM(CASE WHEN rental_items IS NOT NULL AND JSON_LENGTH(rental_items) > 0 THEN 1 ELSE 0 END) AS contracts_with_rentals
FROM contracts
WHERE rental_items IS NOT NULL
  AND JSON_LENGTH(rental_items) > 0;

-- =====================================================
-- 파트 4: 기존 데이터 마이그레이션 (직접 INSERT)
-- =====================================================
-- 주의: 이 쿼리들을 순서대로 실행하세요

-- 4.1 rental_orders에 기존 계약 데이터 삽입
INSERT INTO rental_orders (
  contract_id,
  order_id,
  order_type,
  total_amount,
  paid_amount,
  refunded_amount,
  status,
  paid_at,
  modifiable_until,
  items_snapshot,
  created_at,
  updated_at
)
SELECT
  c.id AS contract_id,
  CONCAT(DATE_FORMAT(COALESCE(c.paid_at, NOW()), '%y%m%d'), '-M', LPAD(c.id, 4, '0')) AS order_id,
  'INITIAL' AS order_type,
  0 AS total_amount,  -- 임시값, 나중에 업데이트
  0 AS paid_amount,
  0 AS refunded_amount,
  CASE
    WHEN c.status IN ('PAYMENT_COMPLETED', 'IN_PROGRESS', 'COMPLETED') THEN 'PAID'
    ELSE 'PENDING'
  END AS status,
  c.paid_at,
  DATE_SUB(c.check_in_date, INTERVAL 5 DAY) AS modifiable_until,
  c.rental_items AS items_snapshot,
  COALESCE(c.paid_at, NOW()) AS created_at,
  NOW() AS updated_at
FROM contracts c
WHERE c.rental_items IS NOT NULL
  AND JSON_LENGTH(c.rental_items) > 0
  AND c.status IN ('PAYMENT_COMPLETED', 'IN_PROGRESS', 'COMPLETED')
  AND NOT EXISTS (
    SELECT 1 FROM rental_orders ro
    WHERE ro.contract_id = c.id AND ro.order_type = 'INITIAL'
  );

-- 4.2 rental_order_items에 아이템 데이터 삽입 (MySQL 8.0+ 필요)
-- COLLATE 추가로 collation 충돌 해결
-- COALESCE로 null 값 처리 (price가 없으면 rental_items 테이블에서 가져옴)
INSERT INTO rental_order_items (
  rental_order_id,
  rental_item_id,
  quantity,
  price_per_item,
  total_price,
  status,
  created_at,
  updated_at
)
SELECT
  ro.id AS rental_order_id,
  COALESCE(jt.item_id, ri.id) AS rental_item_id,
  COALESCE(jt.quantity, 1) AS quantity,
  COALESCE(jt.price, ri.price, 0) AS price_per_item,
  COALESCE(jt.quantity, 1) * COALESCE(jt.price, ri.price, 0) AS total_price,
  'ACTIVE' AS status,
  ro.created_at,
  NOW() AS updated_at
FROM rental_orders ro
JOIN contracts c ON c.id = ro.contract_id
CROSS JOIN JSON_TABLE(
  c.rental_items,
  '$[*]' COLUMNS (
    item_id INT PATH '$.itemId',
    item_name VARCHAR(100) PATH '$.name',
    quantity INT PATH '$.quantity',
    price DECIMAL(10,2) PATH '$.price'
  )
) AS jt
LEFT JOIN rental_items ri ON ri.name COLLATE utf8mb4_unicode_ci = jt.item_name COLLATE utf8mb4_unicode_ci
WHERE ro.order_id LIKE '%-M%'  -- 마이그레이션된 주문만
  AND COALESCE(jt.quantity, 1) > 0
  AND COALESCE(jt.item_id, ri.id) IS NOT NULL  -- rental_item_id가 반드시 있어야 함
  AND NOT EXISTS (
    SELECT 1 FROM rental_order_items roi
    WHERE roi.rental_order_id = ro.id
  );

-- 4.3 rental_orders의 금액 업데이트
UPDATE rental_orders ro
SET
  total_amount = (
    SELECT COALESCE(SUM(total_price), 0)
    FROM rental_order_items
    WHERE rental_order_id = ro.id
  ),
  paid_amount = (
    SELECT COALESCE(SUM(total_price), 0)
    FROM rental_order_items
    WHERE rental_order_id = ro.id
  )
WHERE ro.order_id LIKE '%-M%';

-- 4.4 rental_item_reservations 업데이트 (기존 예약과 연결)
UPDATE rental_item_reservations rir
JOIN rental_orders ro ON ro.contract_id = rir.contract_id AND ro.order_type = 'INITIAL'
JOIN rental_order_items roi ON roi.rental_order_id = ro.id AND roi.rental_item_id = rir.rental_item_id
SET
  rir.rental_order_id = ro.id,
  rir.rental_order_item_id = roi.id,
  rir.status = 'CONFIRMED'
WHERE ro.order_id LIKE '%-M%';

-- 4.5 마이그레이션 로그 기록
INSERT INTO rental_order_logs (
  contract_id,
  rental_order_id,
  action,
  actor,
  description,
  metadata,
  created_at
)
SELECT
  ro.contract_id,
  ro.id,
  'ORDER_CREATED',
  'SYSTEM',
  '기존 계약 데이터 마이그레이션',
  JSON_OBJECT(
    'migration', true,
    'original_contract_status', c.status,
    'migrated_at', NOW()
  ),
  NOW()
FROM rental_orders ro
JOIN contracts c ON c.id = ro.contract_id
WHERE ro.order_id LIKE '%-M%'
  AND NOT EXISTS (
    SELECT 1 FROM rental_order_logs rol
    WHERE rol.rental_order_id = ro.id AND rol.action = 'ORDER_CREATED'
  );

-- =====================================================
-- 파트 5: 마이그레이션 결과 확인
-- =====================================================

SELECT
  'Migration Result' AS info,
  (SELECT COUNT(*) FROM rental_orders WHERE order_id LIKE '%-M%') AS migrated_orders,
  (SELECT COUNT(*) FROM rental_order_items roi
   JOIN rental_orders ro ON ro.id = roi.rental_order_id
   WHERE ro.order_id LIKE '%-M%') AS migrated_items,
  (SELECT COUNT(*) FROM rental_order_logs WHERE description LIKE '%마이그레이션%') AS migration_logs;

-- 생성된 테이블 확인
SELECT TABLE_NAME, TABLE_COMMENT
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('rental_orders', 'rental_order_items', 'rental_order_logs');

SELECT 'Migration completed successfully!' AS status;
