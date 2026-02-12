-- =====================================================
-- 렌탈 주문 시스템 마이그레이션 스크립트
-- 버전: 1.0
-- 날짜: 2025-02-01
-- 설계 문서: docs/RENTAL_ORDER_DESIGN.md
-- =====================================================

-- 트랜잭션 시작
START TRANSACTION;

-- =====================================================
-- 1. rental_orders 테이블 생성
-- =====================================================
CREATE TABLE IF NOT EXISTS rental_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  contract_id INT NOT NULL COMMENT '연결된 계약 ID',
  order_id VARCHAR(15) NOT NULL UNIQUE COMMENT '주문번호 (YYMMDD-R0001)',
  order_type ENUM('INITIAL', 'ADDITIONAL') NOT NULL COMMENT '주문 유형',

  -- 금액 정보 (렌탈 아이템은 수수료 없음 - 플랫폼 직접 제공 서비스)
  total_amount INT NOT NULL DEFAULT 0 COMMENT '결제 예정 금액 (아이템 합계)',

  -- 실제 결제/환불 금액
  paid_amount INT NOT NULL DEFAULT 0 COMMENT '실제 결제된 금액',
  refunded_amount INT NOT NULL DEFAULT 0 COMMENT '환불된 총 금액',

  -- 결제 상태
  status ENUM(
    'PENDING',           -- 결제 대기
    'PAID',              -- 결제 완료
    'PARTIAL_REFUND',    -- 부분 환불
    'FULLY_REFUNDED',    -- 전액 환불
    'CANCELLED'          -- 결제 전 취소
  ) NOT NULL DEFAULT 'PENDING' COMMENT '주문 상태',

  -- 결제 정보
  payment_key VARCHAR(100) NULL COMMENT '토스페이먼츠 결제키',
  payment_method VARCHAR(50) NULL COMMENT '결제 수단',
  paid_at DATETIME NULL COMMENT '결제 완료 시점',

  -- 수정 기한
  modifiable_until DATETIME NOT NULL COMMENT '수정 가능 기한 (체크인 5일 전)',

  -- 스냅샷 (분쟁 대비)
  items_snapshot JSON NULL COMMENT '주문 시점 아이템 정보',

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_rental_orders_contract FOREIGN KEY (contract_id)
    REFERENCES contracts(id) ON DELETE NO ACTION ON UPDATE CASCADE,

  INDEX idx_rental_orders_contract_id (contract_id),
  INDEX idx_rental_orders_order_type (order_type),
  INDEX idx_rental_orders_status (status),
  INDEX idx_rental_orders_modifiable_until (modifiable_until),
  INDEX idx_rental_orders_paid_at (paid_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='렌탈 아이템 주문 (플랫폼 서비스)';

-- =====================================================
-- 2. rental_order_items 테이블 생성
-- =====================================================
CREATE TABLE IF NOT EXISTS rental_order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rental_order_id INT NOT NULL COMMENT '렌탈 주문 ID',
  rental_item_id INT NOT NULL COMMENT '렌탈 아이템 ID',

  -- 수량 및 가격
  quantity INT NOT NULL DEFAULT 1 COMMENT '수량',
  price_per_item DECIMAL(10,2) NOT NULL COMMENT '개당 가격 (주문 시점)',
  total_price DECIMAL(10,2) NOT NULL COMMENT '총 가격 (수량 * 개당가격)',

  -- 상태
  status ENUM('ACTIVE', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE' COMMENT '상태',
  cancelled_at DATETIME NULL COMMENT '취소 시점',
  refund_amount DECIMAL(10,2) NULL COMMENT '환불 금액',
  cancel_reason VARCHAR(255) NULL COMMENT '취소 사유',

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_order_items_order FOREIGN KEY (rental_order_id)
    REFERENCES rental_orders(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_order_items_item FOREIGN KEY (rental_item_id)
    REFERENCES rental_items(id) ON DELETE NO ACTION ON UPDATE CASCADE,

  INDEX idx_rental_order_items_order_id (rental_order_id),
  INDEX idx_rental_order_items_item_id (rental_item_id),
  INDEX idx_rental_order_items_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='렌탈 주문 상세 아이템';

-- =====================================================
-- 3. rental_order_logs 테이블 생성
-- =====================================================
CREATE TABLE IF NOT EXISTS rental_order_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  contract_id INT NOT NULL COMMENT '계약 ID (빠른 조회용)',
  rental_order_id INT NULL COMMENT '렌탈 주문 ID',
  rental_order_item_id INT NULL COMMENT '렌탈 주문 아이템 ID',

  -- 액션 정보
  action ENUM(
    'ORDER_CREATED',        -- 주문 생성
    'ITEM_ADDED',           -- 아이템 추가 (주문 내)
    'ITEM_CANCELLED',       -- 아이템 취소
    'PAYMENT_PENDING',      -- 결제 대기
    'PAYMENT_COMPLETED',    -- 결제 완료
    'PAYMENT_FAILED',       -- 결제 실패
    'REFUND_REQUESTED',     -- 환불 요청
    'REFUND_COMPLETED',     -- 환불 완료
    'REFUND_FAILED',        -- 환불 실패
    'ORDER_CANCELLED'       -- 주문 전체 취소
  ) NOT NULL COMMENT '액션 유형',

  -- 행위자 정보
  actor ENUM('GUEST', 'HOST', 'ADMIN', 'SYSTEM') NOT NULL COMMENT '행위자',
  actor_id INT NULL COMMENT '행위자 ID (User 또는 Admin)',

  -- 금액 변동
  amount_change INT DEFAULT 0 COMMENT '금액 변동 (+결제, -환불)',
  balance_after INT DEFAULT 0 COMMENT '변동 후 잔액 (순 결제액)',

  -- 상세 정보
  metadata JSON NULL COMMENT '상세 정보 (아이템명, 수량, 결제키 등)',
  description VARCHAR(500) NULL COMMENT '설명 (관리자용)',

  -- 추적 정보
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(500) NULL,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
COMMENT='렌탈 주문 변경 이력';

-- =====================================================
-- 4. rental_item_reservations 테이블에 컬럼 추가
-- =====================================================
-- 기존 테이블에 rental_order_id, rental_order_item_id 컬럼 추가

-- 4.1 rental_order_id 컬럼 추가 (이미 존재하면 스킵)
SET @column_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'rental_item_reservations'
    AND COLUMN_NAME = 'rental_order_id'
);

SET @sql = IF(@column_exists = 0,
  'ALTER TABLE rental_item_reservations ADD COLUMN rental_order_id INT NULL COMMENT ''렌탈 주문 ID'' AFTER contract_id',
  'SELECT ''rental_order_id column already exists'' AS message'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4.2 rental_order_item_id 컬럼 추가 (이미 존재하면 스킵)
SET @column_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'rental_item_reservations'
    AND COLUMN_NAME = 'rental_order_item_id'
);

SET @sql = IF(@column_exists = 0,
  'ALTER TABLE rental_item_reservations ADD COLUMN rental_order_item_id INT NULL COMMENT ''렌탈 주문 아이템 ID'' AFTER rental_order_id',
  'SELECT ''rental_order_item_id column already exists'' AS message'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4.3 외래키 추가 (이미 존재하면 스킵)
SET @fk_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'rental_item_reservations'
    AND CONSTRAINT_NAME = 'fk_reservation_rental_order'
);

SET @sql = IF(@fk_exists = 0,
  'ALTER TABLE rental_item_reservations ADD CONSTRAINT fk_reservation_rental_order FOREIGN KEY (rental_order_id) REFERENCES rental_orders(id) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT ''fk_reservation_rental_order already exists'' AS message'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4.4 인덱스 추가 (이미 존재하면 스킵)
SET @idx_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'rental_item_reservations'
    AND INDEX_NAME = 'idx_reservation_rental_order_id'
);

SET @sql = IF(@idx_exists = 0,
  'ALTER TABLE rental_item_reservations ADD INDEX idx_reservation_rental_order_id (rental_order_id)',
  'SELECT ''idx_reservation_rental_order_id already exists'' AS message'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 트랜잭션 커밋
COMMIT;

-- =====================================================
-- 5. 기존 계약 데이터 마이그레이션 (선택적)
-- =====================================================
-- 주의: 이 섹션은 별도 트랜잭션으로 실행 (데이터 양에 따라 시간 소요)
-- 실행 전 반드시 백업 권장

-- 기존 contracts.rental_items JSON에 데이터가 있고
-- 결제 완료된 계약들을 새 시스템으로 마이그레이션

-- 마이그레이션 대상 확인
SELECT
  'Migration candidates' AS info,
  COUNT(*) AS total_contracts,
  SUM(CASE WHEN status IN ('PAYMENT_COMPLETED', 'IN_PROGRESS', 'COMPLETED') THEN 1 ELSE 0 END) AS paid_contracts,
  SUM(CASE WHEN rental_items IS NOT NULL AND JSON_LENGTH(rental_items) > 0 THEN 1 ELSE 0 END) AS contracts_with_rentals
FROM contracts
WHERE rental_items IS NOT NULL
  AND JSON_LENGTH(rental_items) > 0;

-- =====================================================
-- 5.1 마이그레이션 프로시저 생성
-- =====================================================
DROP PROCEDURE IF EXISTS migrate_existing_rentals;

DELIMITER //

CREATE PROCEDURE migrate_existing_rentals()
BEGIN
  DECLARE done INT DEFAULT FALSE;
  DECLARE v_contract_id INT;
  DECLARE v_check_in_date DATE;
  DECLARE v_check_out_date DATE;
  DECLARE v_guest_id INT;
  DECLARE v_status VARCHAR(50);
  DECLARE v_paid_at DATETIME;
  DECLARE v_rental_items JSON;
  DECLARE v_order_id VARCHAR(15);
  DECLARE v_rental_order_id INT;
  DECLARE v_total_amount INT DEFAULT 0;
  DECLARE v_item_count INT DEFAULT 0;
  DECLARE v_migrated_count INT DEFAULT 0;
  DECLARE v_skipped_count INT DEFAULT 0;

  -- 마이그레이션 대상 계약 커서
  DECLARE contract_cursor CURSOR FOR
    SELECT
      c.id,
      c.check_in_date,
      c.check_out_date,
      c.guest_id,
      c.status,
      c.paid_at,
      c.rental_items
    FROM contracts c
    WHERE c.rental_items IS NOT NULL
      AND JSON_LENGTH(c.rental_items) > 0
      AND c.status IN ('PAYMENT_COMPLETED', 'IN_PROGRESS', 'COMPLETED')
      AND NOT EXISTS (
        SELECT 1 FROM rental_orders ro
        WHERE ro.contract_id = c.id AND ro.order_type = 'INITIAL'
      );

  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

  -- 마이그레이션 시작
  START TRANSACTION;

  OPEN contract_cursor;

  read_loop: LOOP
    FETCH contract_cursor INTO
      v_contract_id, v_check_in_date, v_check_out_date,
      v_guest_id, v_status, v_paid_at, v_rental_items;

    IF done THEN
      LEAVE read_loop;
    END IF;

    -- 주문번호 생성 (기존 데이터용: M + 계약ID)
    SET v_order_id = CONCAT(DATE_FORMAT(NOW(), '%y%m%d'), '-M', LPAD(v_contract_id, 4, '0'));

    -- 이미 같은 주문번호가 있으면 스킵
    IF EXISTS (SELECT 1 FROM rental_orders WHERE order_id = v_order_id) THEN
      SET v_skipped_count = v_skipped_count + 1;
      ITERATE read_loop;
    END IF;

    -- 총 금액 계산 (JSON에서)
    SET v_total_amount = 0;
    SET v_item_count = JSON_LENGTH(v_rental_items);

    -- RentalOrder 생성
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
    ) VALUES (
      v_contract_id,
      v_order_id,
      'INITIAL',
      0,  -- 임시값, 아래에서 업데이트
      0,
      0,
      CASE
        WHEN v_status IN ('PAYMENT_COMPLETED', 'IN_PROGRESS', 'COMPLETED') THEN 'PAID'
        ELSE 'PENDING'
      END,
      v_paid_at,
      DATE_SUB(v_check_in_date, INTERVAL 5 DAY),
      v_rental_items,
      COALESCE(v_paid_at, NOW()),
      NOW()
    );

    SET v_rental_order_id = LAST_INSERT_ID();

    -- JSON 배열의 각 아이템을 rental_order_items로 이관
    -- MySQL 8.0+ JSON_TABLE 사용
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
      v_rental_order_id,
      COALESCE(jt.item_id, ri.id),
      jt.quantity,
      jt.price,
      jt.quantity * jt.price,
      'ACTIVE',
      COALESCE(v_paid_at, NOW()),
      NOW()
    FROM JSON_TABLE(
      v_rental_items,
      '$[*]' COLUMNS (
        item_id INT PATH '$.itemId',
        item_name VARCHAR(100) PATH '$.name',
        quantity INT PATH '$.quantity',
        price DECIMAL(10,2) PATH '$.price'
      )
    ) AS jt
    LEFT JOIN rental_items ri ON ri.name = jt.item_name
    WHERE jt.quantity > 0;

    -- 총 금액 업데이트
    UPDATE rental_orders
    SET
      total_amount = (
        SELECT COALESCE(SUM(total_price), 0)
        FROM rental_order_items
        WHERE rental_order_id = v_rental_order_id
      ),
      paid_amount = (
        SELECT COALESCE(SUM(total_price), 0)
        FROM rental_order_items
        WHERE rental_order_id = v_rental_order_id
      )
    WHERE id = v_rental_order_id;

    -- 기존 rental_item_reservations 업데이트 (있는 경우)
    UPDATE rental_item_reservations rir
    JOIN rental_order_items roi ON roi.rental_order_id = v_rental_order_id
      AND roi.rental_item_id = rir.rental_item_id
    SET
      rir.rental_order_id = v_rental_order_id,
      rir.rental_order_item_id = roi.id,
      rir.status = 'CONFIRMED'
    WHERE rir.contract_id = v_contract_id;

    -- 마이그레이션 로그 기록
    INSERT INTO rental_order_logs (
      contract_id,
      rental_order_id,
      action,
      actor,
      description,
      metadata,
      created_at
    ) VALUES (
      v_contract_id,
      v_rental_order_id,
      'ORDER_CREATED',
      'SYSTEM',
      '기존 계약 데이터 마이그레이션',
      JSON_OBJECT(
        'migration', true,
        'original_status', v_status,
        'migrated_at', NOW()
      ),
      NOW()
    );

    SET v_migrated_count = v_migrated_count + 1;
  END LOOP;

  CLOSE contract_cursor;

  COMMIT;

  -- 결과 출력
  SELECT
    'Migration completed' AS status,
    v_migrated_count AS migrated_contracts,
    v_skipped_count AS skipped_contracts;
END //

DELIMITER ;

-- =====================================================
-- 5.2 마이그레이션 실행 (선택적)
-- =====================================================
-- 아래 주석을 해제하여 마이그레이션 실행
-- 주의: 실행 전 데이터 백업 필수!

CALL migrate_existing_rentals();

-- 마이그레이션 결과 확인
-- SELECT
--   'After migration' AS info,
--   (SELECT COUNT(*) FROM rental_orders WHERE order_id LIKE '%-M%') AS migrated_orders,
--   (SELECT COUNT(*) FROM rental_order_items roi
--    JOIN rental_orders ro ON ro.id = roi.rental_order_id
--    WHERE ro.order_id LIKE '%-M%') AS migrated_items;

-- =====================================================
-- 마이그레이션 완료 확인
-- =====================================================
SELECT 'Schema migration completed successfully!' AS status;

-- 생성된 테이블 확인
SELECT TABLE_NAME, TABLE_COMMENT
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('rental_orders', 'rental_order_items', 'rental_order_logs');

-- rental_item_reservations 컬럼 확인
SELECT COLUMN_NAME, DATA_TYPE, COLUMN_COMMENT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'rental_item_reservations'
  AND COLUMN_NAME IN ('rental_order_id', 'rental_order_item_id');
