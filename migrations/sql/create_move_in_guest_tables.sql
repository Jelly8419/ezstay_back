-- ============================================================
-- ⚠️ 참고용 / 미실행 (Reference Only — DO NOT EXECUTE)
--
-- 5개 테이블은 이미 ezstay / ezstay_test DB 에 존재함 (Sequelize sync 로 선생성).
-- 따라서 본 CREATE DDL 은 **실행하지 않음**.
-- 인덱스 추가는 별도 파일에서 처리: add_move_in_guest_indexes.sql
--
-- 본 파일의 용도:
--   - 컬럼 구조/제약/주석의 의도된 풀버전 명세 (스키마 문서)
--   - 운영 외 환경에서 테이블 재생성이 필요할 때 참조
--
-- 입주 준비 서비스 - 임차인(게스트) 도메인 테이블 명세
-- 출처 PRD: Notion - 임차인 PRD `3587d336b0e580d29284d42470054eb7`
-- 구현계획: backend_md_list/입주준비서비스_임차인_구현계획.md (Phase 1)
--
-- 테이블 5개:
--   1) move_in_options           옵션 카탈로그 (관리자 CRUD)
--   2) move_in_guest_orders      임차인 주문 (= 결제 1건)
--   3) move_in_guest_order_items 주문 라인
--   4) move_in_guest_payments    PG 결제 (청소 결제 move_in_payments 와 분리)
--   5) move_in_guest_order_logs  상태 변경 이력
--
-- 주의:
--   - itemsSnapshot / metadata 등 JSON 컬럼은 LONGTEXT 로 저장 (MariaDB 호환)
--     → Sequelize 모델에서 명시 직렬화 getter/setter 사용
--   - 외래키는 CLAUDE.md 정책에 따라 모델 layer (belongsTo/hasMany) 에서만 관리
-- ============================================================


-- ============================================================
-- 1) move_in_options : 옵션 카탈로그
-- ============================================================
CREATE TABLE move_in_options (
  id                 INT AUTO_INCREMENT PRIMARY KEY,

  name               VARCHAR(100)  NOT NULL                COMMENT '옵션명 (예: 프리미엄 어메니티 키트)',
  description        TEXT          NULL                    COMMENT '옵션 설명',

  option_type        ENUM('PURCHASE', 'RENTAL') NOT NULL   COMMENT 'PURCHASE=구매(재고 차감), RENTAL=대여(기간 점유)',
  category           ENUM('AMENITY_KIT', 'BEDDING_SET', 'HAIR_DRYER', 'TOWEL_SET', 'OTHER')
                                   NOT NULL DEFAULT 'OTHER' COMMENT '카테고리',

  price              INT           NOT NULL                COMMENT '가격 (원, 부가세 포함)',
  total_stock        INT           NOT NULL DEFAULT 0      COMMENT '총 재고 (PURCHASE/RENTAL 공통)',

  image_url          VARCHAR(255)  NULL                    COMMENT '이미지 URL',
  display_order      INT           NOT NULL DEFAULT 0      COMMENT '노출 정렬 순서 (오름차순)',

  is_active          TINYINT(1)    NOT NULL DEFAULT 1      COMMENT '활성화 여부 (소프트 비활성화)',

  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_move_in_options_active     (is_active),
  INDEX idx_move_in_options_category   (category),
  INDEX idx_move_in_options_display    (display_order),

  CONSTRAINT chk_move_in_options_price        CHECK (price >= 0),
  CONSTRAINT chk_move_in_options_total_stock  CHECK (total_stock >= 0)
);


-- ============================================================
-- 2) move_in_guest_orders : 임차인 주문 (결제 1건 단위)
-- ============================================================
CREATE TABLE move_in_guest_orders (
  id                 INT AUTO_INCREMENT PRIMARY KEY,

  case_id            INT           NOT NULL                COMMENT 'move_in_cases.id',
  guest_user_id      INT           NOT NULL                COMMENT 'users.id (PRD 10.2 결제는 매칭된 게스트만)',

  order_id           VARCHAR(15)   NOT NULL UNIQUE         COMMENT '주문번호 YYMMDD-G####',
  order_type         ENUM('INITIAL', 'ADDITIONAL') NOT NULL COMMENT 'INITIAL=최초 결제, ADDITIONAL=추가 결제(정책4)',

  total_amount       INT           NOT NULL DEFAULT 0      COMMENT '주문 총액 (원)',
  paid_amount        INT           NOT NULL DEFAULT 0      COMMENT '실제 결제된 금액',
  refunded_amount    INT           NOT NULL DEFAULT 0      COMMENT '환불된 금액',

  status             ENUM('PENDING', 'PAID', 'PARTIAL_REFUND', 'FULLY_REFUNDED', 'CANCELLED')
                                   NOT NULL DEFAULT 'PENDING' COMMENT '주문 상태',

  payment_key        VARCHAR(100)  NULL                    COMMENT 'PG 결제키 (paymentKey)',
  payment_method     VARCHAR(50)   NULL                    COMMENT '결제 수단',
  paid_at            DATETIME      NULL                    COMMENT '결제 완료 시각',

  modifiable_until   DATETIME      NOT NULL                COMMENT '결제/취소 가능 기한 (입주일 -5일 KST 23:59:59)',

  -- MariaDB JSON 컬럼은 LONGTEXT 로 저장 (Sequelize 모델에서 직렬화)
  items_snapshot     LONGTEXT      NULL                    COMMENT '주문 시점 옵션 정보 스냅샷 JSON',

  delivery_status    ENUM('PENDING', 'IN_TRANSIT', 'DELIVERED')
                                   NOT NULL DEFAULT 'PENDING' COMMENT '배송 상태',
  delivered_at       DATETIME      NULL                    COMMENT '배송 완료 시각',

  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_move_in_guest_orders_case      (case_id),
  INDEX idx_move_in_guest_orders_guest     (guest_user_id, status),
  INDEX idx_move_in_guest_orders_status    (status),
  INDEX idx_move_in_guest_orders_delivery  (delivery_status),
  INDEX idx_move_in_guest_orders_modify    (modifiable_until),
  INDEX idx_move_in_guest_orders_paid_at   (paid_at),

  CONSTRAINT chk_mig_orders_total_amount     CHECK (total_amount     >= 0),
  CONSTRAINT chk_mig_orders_paid_amount      CHECK (paid_amount      >= 0),
  CONSTRAINT chk_mig_orders_refunded_amount  CHECK (refunded_amount  >= 0),

  CONSTRAINT fk_move_in_guest_orders_case
    FOREIGN KEY (case_id) REFERENCES move_in_cases (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,

  CONSTRAINT fk_move_in_guest_orders_guest
    FOREIGN KEY (guest_user_id) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
);


-- ============================================================
-- 3) move_in_guest_order_items : 주문 라인
-- ============================================================
CREATE TABLE move_in_guest_order_items (
  id                 INT AUTO_INCREMENT PRIMARY KEY,

  guest_order_id     INT           NOT NULL                COMMENT 'move_in_guest_orders.id',
  option_id          INT           NOT NULL                COMMENT 'move_in_options.id',

  quantity           INT           NOT NULL                COMMENT '수량',
  price_per_item     INT           NOT NULL                COMMENT '개당 가격 스냅샷 (결제 당시)',
  total_price        INT           NOT NULL                COMMENT '라인 총액 (quantity * price_per_item)',

  status             ENUM('ACTIVE', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE' COMMENT '라인 상태',
  cancelled_at       DATETIME      NULL                    COMMENT '취소 시각',
  cancel_reason      VARCHAR(255)  NULL                    COMMENT '취소 사유',
  refund_amount      INT           NULL                    COMMENT '환불 금액 (취소 시)',

  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_mig_order_items_order   (guest_order_id),
  INDEX idx_mig_order_items_option  (option_id),
  INDEX idx_mig_order_items_status  (status),

  CONSTRAINT chk_mig_order_items_quantity    CHECK (quantity       >= 1),
  CONSTRAINT chk_mig_order_items_price       CHECK (price_per_item >= 0),
  CONSTRAINT chk_mig_order_items_total       CHECK (total_price    >= 0),

  CONSTRAINT fk_move_in_guest_order_items_order
    FOREIGN KEY (guest_order_id) REFERENCES move_in_guest_orders (id)
    ON DELETE CASCADE ON UPDATE CASCADE,

  CONSTRAINT fk_move_in_guest_order_items_option
    FOREIGN KEY (option_id) REFERENCES move_in_options (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
);


-- ============================================================
-- 4) move_in_guest_payments : PG 결제 (청소 결제 move_in_payments 와 분리)
-- ============================================================
CREATE TABLE move_in_guest_payments (
  id                 INT AUTO_INCREMENT PRIMARY KEY,

  guest_order_id     INT           NOT NULL                COMMENT 'move_in_guest_orders.id',
  case_id            INT           NOT NULL                COMMENT 'move_in_cases.id (조회 편의)',
  guest_user_id      INT           NOT NULL                COMMENT 'users.id (조회 편의)',

  order_id           VARCHAR(15)   NULL                    COMMENT '주문번호 (YYMMDD-G####), order 와 동일 값',

  amount             INT           NOT NULL                COMMENT '결제 금액 (원)',

  status             ENUM('PENDING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED')
                                   NOT NULL DEFAULT 'PENDING' COMMENT '결제 상태',

  pg_provider        VARCHAR(30)   NULL                    COMMENT 'PG사 (toss/kcp 등)',
  pg_tid             VARCHAR(100)  NULL                    COMMENT 'PG 거래번호',
  pg_method          VARCHAR(30)   NULL                    COMMENT '결제 수단 (CARD 등)',

  paid_at            DATETIME      NULL                    COMMENT '결제 완료 시각',
  failed_at          DATETIME      NULL                    COMMENT '결제 실패 시각',
  failure_reason     VARCHAR(255)  NULL                    COMMENT '실패 사유',

  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_mig_payments_order   (guest_order_id),
  INDEX idx_mig_payments_guest   (guest_user_id, status),
  INDEX idx_mig_payments_case    (case_id),
  INDEX idx_mig_payments_status  (status),

  CONSTRAINT chk_mig_payments_amount CHECK (amount >= 0),

  CONSTRAINT fk_move_in_guest_payments_order
    FOREIGN KEY (guest_order_id) REFERENCES move_in_guest_orders (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,

  CONSTRAINT fk_move_in_guest_payments_case
    FOREIGN KEY (case_id) REFERENCES move_in_cases (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,

  CONSTRAINT fk_move_in_guest_payments_guest
    FOREIGN KEY (guest_user_id) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
);


-- ============================================================
-- 5) move_in_guest_order_logs : 상태 변경 이력
-- ============================================================
CREATE TABLE move_in_guest_order_logs (
  id                 BIGINT AUTO_INCREMENT PRIMARY KEY,

  guest_order_id        INT           NOT NULL                COMMENT 'move_in_guest_orders.id',
  guest_order_item_id   INT           NULL                    COMMENT 'move_in_guest_order_items.id (라인 단위 액션 시)',
  case_id               INT           NOT NULL                COMMENT 'move_in_cases.id (조회 편의)',

  actor              ENUM('GUEST', 'ADMIN', 'SYSTEM') NOT NULL COMMENT '주체',
  actor_id           INT           NULL                    COMMENT 'users.id 또는 admins.id',

  action             VARCHAR(50)   NOT NULL                COMMENT 'ORDER_CREATED/PAYMENT_SUCCESS/ITEM_CANCELLED/DELIVERY_UPDATED 등',
  amount_change      INT           NOT NULL DEFAULT 0      COMMENT '금액 변동 (양수=증가, 음수=환불)',
  balance_after      INT           NOT NULL DEFAULT 0      COMMENT '액션 후 net 결제 금액',

  -- MariaDB JSON 컬럼은 LONGTEXT 로 저장
  metadata           LONGTEXT      NULL                    COMMENT '부가 정보 JSON',
  description        VARCHAR(500)  NULL                    COMMENT '설명',

  ip_address         VARCHAR(45)   NULL                    COMMENT '요청 IP',
  user_agent         VARCHAR(500)  NULL                    COMMENT 'User-Agent',

  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_mig_logs_order   (guest_order_id),
  INDEX idx_mig_logs_item    (guest_order_item_id),
  INDEX idx_mig_logs_case    (case_id),
  INDEX idx_mig_logs_action  (action),
  INDEX idx_mig_logs_actor   (actor, actor_id),
  INDEX idx_mig_logs_created (created_at),

  CONSTRAINT fk_mig_logs_order
    FOREIGN KEY (guest_order_id) REFERENCES move_in_guest_orders (id)
    ON DELETE CASCADE ON UPDATE CASCADE,

  CONSTRAINT fk_mig_logs_order_item
    FOREIGN KEY (guest_order_item_id) REFERENCES move_in_guest_order_items (id)
    ON DELETE SET NULL ON UPDATE CASCADE,

  CONSTRAINT fk_mig_logs_case
    FOREIGN KEY (case_id) REFERENCES move_in_cases (id)
    ON DELETE CASCADE ON UPDATE CASCADE
);


-- ============================================================
-- 적용 후 검증 쿼리 (참고)
-- ============================================================
-- SHOW TABLES LIKE 'move_in_guest_%';
-- SHOW TABLES LIKE 'move_in_options';
-- SHOW CREATE TABLE move_in_guest_orders\G
-- SHOW CREATE TABLE move_in_guest_order_items\G
-- SHOW CREATE TABLE move_in_guest_payments\G
-- SHOW CREATE TABLE move_in_guest_order_logs\G
-- SHOW CREATE TABLE move_in_options\G
