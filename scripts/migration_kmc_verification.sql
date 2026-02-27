-- KMC 본인인증 관련 컬럼 추가
-- 실행 대상: users 테이블
-- 날짜: 2026-02-26

ALTER TABLE users ADD COLUMN ci VARCHAR(255) NULL COMMENT 'KMC 연계정보(CI) - 서비스 간 동일인 식별' AFTER terms_agreed_at;
ALTER TABLE users ADD COLUMN di VARCHAR(255) NULL COMMENT 'KMC 중복가입확인정보(DI) - 동일 서비스 내 중복가입 방지' AFTER ci;
ALTER TABLE users ADD COLUMN birth VARCHAR(8) NULL COMMENT '생년월일 (YYYYMMDD)' AFTER di;
ALTER TABLE users ADD COLUMN gender VARCHAR(1) NULL COMMENT '성별 (M/F)' AFTER birth;

-- DI 인덱스 (중복가입 방지 조회용)
CREATE INDEX idx_users_di ON users(di);
