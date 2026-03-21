-- payments.method ENUM 한글 → 영문 마이그레이션
-- 대상: 로컬, 테스트서버, 운영서버 모두 실행 필요
-- 날짜: 2026-03-18
-- 사유: PayTag PG 전환으로 인한 ENUM 통일 (rental_payments와 동일하게)

-- 1단계: ENUM에 영문 값 추가 (기존 한글 유지하면서)
ALTER TABLE payments
MODIFY COLUMN method ENUM(
  'CARD','VIRTUAL_ACCOUNT','TRANSFER','MOBILE','EASY_PAY',
  '카드','가상계좌','계좌이체','휴대폰','상품권','간편결제','문화상품권','도서문화상품권','게임문화상품권'
) NOT NULL;

-- 2단계: 기존 한글 데이터를 영문으로 변환
UPDATE payments SET method='CARD' WHERE method='카드';
UPDATE payments SET method='VIRTUAL_ACCOUNT' WHERE method='가상계좌';
UPDATE payments SET method='TRANSFER' WHERE method='계좌이체';
UPDATE payments SET method='MOBILE' WHERE method='휴대폰';
UPDATE payments SET method='EASY_PAY' WHERE method='간편결제';
UPDATE payments SET method='EASY_PAY' WHERE method='상품권';
UPDATE payments SET method='EASY_PAY' WHERE method='문화상품권';
UPDATE payments SET method='EASY_PAY' WHERE method='도서문화상품권';
UPDATE payments SET method='EASY_PAY' WHERE method='게임문화상품권';

-- 3단계: ENUM을 영문만으로 축소
ALTER TABLE payments
MODIFY COLUMN method ENUM('CARD','VIRTUAL_ACCOUNT','TRANSFER','MOBILE','EASY_PAY') NOT NULL;

-- 확인
SELECT method, COUNT(*) as cnt FROM payments GROUP BY method;
