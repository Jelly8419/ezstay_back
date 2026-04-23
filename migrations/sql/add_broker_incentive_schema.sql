-- ============================================================
-- 중개인 인센티브 스키마 (회계 시스템 Week 2)
-- ------------------------------------------------------------
-- 목적: 중개인이 유입시킨 임대인(호스트)의 계약에 대해 플랫폼이 월 단위로
--       인센티브를 지급·관리. 정책은 docs/accounting/02-broker-incentive.md 참조.
--
-- 설계 원칙:
--   1) 스냅샷 (contracts.broker_*_snapshot):
--      - 결제 승인 시점의 중개인 ID / 요율 / 타입을 계약에 박아 이후 요율/매핑 변경과 분리
--      - 판정 기준 시점은 payments.approved_at (결제 시점 활동기간 판정)
--   2) 시간 구간 (broker_rates, broker_host_mappings):
--      - effective_from / end_date NULL = 현재 유효
--      - 앱 로직에서 중복 활성 구간 방지 (DB 제약으로 커버하기 어려운 케이스 있음)
--   3) 세무 분기 (broker_incentives):
--      - individual: withholding_amount (기타소득 원천징수 8.8%)
--      - business  : supply_amount + vat_amount (세금계산서 수취)
--      - 불변식:
--          individual → gross = withholding + net
--          business   → gross = supply + vat, net = gross
--   4) 월별 집계 (broker_incentive_payouts):
--      - settlement_month = settlement.expected_date 의 YYYY-MM
--      - 브로커 × 월 단위로 UNIQUE
--
-- 외래키 정책: models/index.js belongsTo/hasMany 로 관계 설정 (CLAUDE.md 규칙).
--             테이블 레벨 FOREIGN KEY 는 명시하지 않음.
--
-- 롤백: 파일 하단 주석의 DROP 문 순서대로 실행.
-- ============================================================


-- 1) brokers : 중개인 마스터
CREATE TABLE brokers (
  id              INT AUTO_INCREMENT PRIMARY KEY,

  name            VARCHAR(100) NOT NULL COMMENT '중개인명 (개인 이름 또는 상호)',
  phone           VARCHAR(20)  NOT NULL COMMENT '연락처',

  broker_type     ENUM('individual','business') NOT NULL
                  COMMENT '세무 구분: individual=개인(기타소득 8.8% 원천), business=사업자(세금계산서)',
  tax_id          VARCHAR(20)  NULL DEFAULT NULL
                  COMMENT '사업자등록번호 (business 타입일 때 필수, 앱 레벨 검증)',

  bank_name       VARCHAR(50)  NULL DEFAULT NULL COMMENT '지급 계좌 은행명',
  bank_account    VARCHAR(50)  NULL DEFAULT NULL COMMENT '지급 계좌번호',
  bank_holder     VARCHAR(50)  NULL DEFAULT NULL COMMENT '예금주',

  start_date      DATE NOT NULL COMMENT '활동 시작일 (이 날 포함)',
  end_date        DATE NOT NULL COMMENT '활동 종료일 (이 날 포함)',

  status          ENUM('active','inactive') NOT NULL DEFAULT 'active'
                  COMMENT '활성 여부 (inactive 시 요율 0% 취급)',
  memo            TEXT NULL DEFAULT NULL COMMENT '관리자 메모',

  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_brokers_status (status),
  INDEX idx_brokers_active_range (status, start_date, end_date)
);


-- 2) broker_rates : 시간 구간별 적용률
--    관리자가 요율을 변경할 때 기존 활성 row 의 effective_to 를 현재 시각으로 마감하고
--    새 row 를 effective_to = NULL 로 추가. 결제 시점 판정은 앱에서 BETWEEN 조회.
CREATE TABLE broker_rates (
  id              INT AUTO_INCREMENT PRIMARY KEY,

  broker_id       INT NOT NULL COMMENT '중개인 ID',

  rate            DECIMAL(5,4) NOT NULL
                  COMMENT '적용률 (0.5000 = 50%). 호스트 수수료 3.3% 에 곱해 인센티브 산출',

  effective_from  DATETIME NOT NULL COMMENT '요율 적용 시작 시점 (이 시점 포함)',
  effective_to    DATETIME NULL DEFAULT NULL COMMENT 'NULL = 현재 유효',

  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_broker_rates_broker (broker_id),
  INDEX idx_broker_rates_range  (broker_id, effective_from, effective_to)
);


-- 3) broker_host_mappings : 중개인 ↔ 임대인 귀속 (시간 구간)
--    호스트가 이관될 수 있으므로 start_date ~ end_date 구간 관리.
--    동일 호스트에 대한 중복 활성 매핑 방지는 앱 레벨에서 검증.
CREATE TABLE broker_host_mappings (
  id                    INT AUTO_INCREMENT PRIMARY KEY,

  broker_id             INT NOT NULL COMMENT '중개인 ID',
  host_id               INT NOT NULL COMMENT '임대인(users.id, userMode=host)',

  start_date            DATETIME NOT NULL COMMENT '귀속 시작 시점',
  end_date              DATETIME NULL DEFAULT NULL COMMENT 'NULL = 현재 유효',

  created_by_admin_id   INT NULL DEFAULT NULL COMMENT '등록한 관리자 ID',

  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_broker_host_mappings_host_active (host_id, end_date)
    COMMENT '특정 호스트의 활성 매핑 조회용',
  INDEX idx_broker_host_mappings_broker (broker_id)
);


-- 4) broker_incentives : 계약 × 중개인 = 1:1 인센티브 스냅샷
--    Settlement 당 최대 1개. Settlement.status = READY 전환 시점에 생성.
CREATE TABLE broker_incentives (
  id                  INT AUTO_INCREMENT PRIMARY KEY,

  settlement_id       INT NOT NULL COMMENT '정산 ID (1:1)',
  contract_id         INT NOT NULL COMMENT '계약 ID',
  broker_id           INT NOT NULL COMMENT '중개인 ID',

  -- 스냅샷 (불변)
  base_fee            INT NOT NULL
                      COMMENT '기준 금액 = settlement.host_platform_fee (VAT 포함 총액)',
  applied_rate        DECIMAL(5,4) NOT NULL COMMENT '적용 요율 스냅샷 (0.5000 = 50%)',
  broker_type         ENUM('individual','business') NOT NULL
                      COMMENT '중개인 타입 스냅샷 (결제 시점 기준)',

  -- 계산 결과
  gross_amount        INT NOT NULL
                      COMMENT '지급 대상액 = floor(base_fee × applied_rate) (세전)',
  withholding_amount  INT NOT NULL DEFAULT 0
                      COMMENT '원천징수액 (individual 만 >0, 기타소득 8.8% 절사)',
  supply_amount       INT NOT NULL DEFAULT 0
                      COMMENT '공급가액 (business 만 >0, floor(gross × 10/11))',
  vat_amount          INT NOT NULL DEFAULT 0
                      COMMENT '부가세 (business 만 >0, gross - supply)',
  net_amount          INT NOT NULL
                      COMMENT '실지급액. individual=gross-withholding, business=gross',

  -- 집계 키
  settlement_month    CHAR(7) NOT NULL
                      COMMENT 'YYYY-MM (settlement.expected_date 기준월)',

  -- 상태
  status              ENUM('PENDING','AGGREGATED','ON_HOLD','CANCELLED') NOT NULL DEFAULT 'PENDING'
                      COMMENT 'PENDING=생성, AGGREGATED=월별 payout 집계됨, ON_HOLD=보류, CANCELLED=취소',
  payout_id           INT NULL DEFAULT NULL COMMENT '집계된 월별 지급 ID',

  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_broker_incentive_settlement (settlement_id),
  INDEX idx_broker_incentive_broker_month (broker_id, settlement_month),
  INDEX idx_broker_incentive_status       (status),
  INDEX idx_broker_incentive_payout       (payout_id),
  INDEX idx_broker_incentive_contract     (contract_id)
);


-- 5) broker_incentive_payouts : 월별 지급 단위 (중개인 × 월)
--    Admin 이 월별 리스트 조회 시 동기 계산 / upsert. 지급완료된 행은 재계산 금지.
CREATE TABLE broker_incentive_payouts (
  id                  INT AUTO_INCREMENT PRIMARY KEY,

  broker_id           INT NOT NULL COMMENT '중개인 ID',
  settlement_month    CHAR(7) NOT NULL COMMENT 'YYYY-MM',

  contract_count      INT NOT NULL DEFAULT 0 COMMENT '집계된 계약 수',
  total_gross         INT NOT NULL DEFAULT 0 COMMENT '지급대상액 합계 (세전)',
  total_withholding   INT NOT NULL DEFAULT 0 COMMENT '원천징수 합계 (individual)',
  total_supply        INT NOT NULL DEFAULT 0 COMMENT '공급가액 합계 (business)',
  total_vat           INT NOT NULL DEFAULT 0 COMMENT '부가세 합계 (business)',
  total_net           INT NOT NULL DEFAULT 0 COMMENT '실지급액 합계',

  status              ENUM('PENDING','PAID') NOT NULL DEFAULT 'PENDING'
                      COMMENT 'PENDING=지급대기, PAID=지급완료',
  paid_at             DATETIME NULL DEFAULT NULL COMMENT '지급 완료 시각',
  paid_by_admin_id    INT NULL DEFAULT NULL COMMENT '지급 처리 관리자 ID',
  memo                TEXT NULL DEFAULT NULL COMMENT '관리자 메모',

  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_broker_incentive_payout_broker_month (broker_id, settlement_month),
  INDEX idx_broker_incentive_payout_status (status),
  INDEX idx_broker_incentive_payout_month  (settlement_month)
);


-- 6) contracts : 결제 시점 중개인 스냅샷 3필드
--    - 결제 승인 시점에 brokerResolver 가 확정한 값을 박아둔다.
--    - 중개인 매핑/요율이 미존재하거나 활동기간 밖이면 NULL 로 둔다 (= 미귀속).
ALTER TABLE contracts
  ADD COLUMN broker_id_snapshot    INT          NULL DEFAULT NULL
    COMMENT '결제 승인 시점 귀속 중개인 ID (NULL=미귀속)'
    AFTER host_platform_fee_vat,
  ADD COLUMN broker_rate_snapshot  DECIMAL(5,4) NULL DEFAULT NULL
    COMMENT '결제 승인 시점 적용 요율 스냅샷 (0.5000=50%)'
    AFTER broker_id_snapshot,
  ADD COLUMN broker_type_snapshot  ENUM('individual','business') NULL DEFAULT NULL
    COMMENT '결제 승인 시점 중개인 타입 스냅샷'
    AFTER broker_rate_snapshot;


-- ============================================================
-- 롤백 (역순 실행)
-- ============================================================
-- ALTER TABLE contracts
--   DROP COLUMN broker_type_snapshot,
--   DROP COLUMN broker_rate_snapshot,
--   DROP COLUMN broker_id_snapshot;
--
-- DROP TABLE broker_incentive_payouts;
-- DROP TABLE broker_incentives;
-- DROP TABLE broker_host_mappings;
-- DROP TABLE broker_rates;
-- DROP TABLE brokers;
