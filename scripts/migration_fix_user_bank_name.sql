-- =====================================================
-- user_bank_accounts.bank_name 데이터 정규화 마이그레이션
-- =====================================================
-- 배경: saveAccount 컨트롤러가 bank_code(원본 입력)를 그대로 bank_name 에 저장하여
--       프론트가 코드(예: '081')를 보내면 숫자, 은행명('신한은행')을 보내면 한글이
--       혼합 저장되는 버그가 있었음.
-- 조치: bank_name 에 숫자 코드로 저장된 행을 BANK_CODE_TO_NAME 매핑(utils/bankCodes.js)
--       기준으로 한글 은행명으로 일괄 보정.
--
-- 실행 전 백업 권장:
--   CREATE TABLE user_bank_accounts_bak_20260531 AS SELECT * FROM user_bank_accounts;
--
-- 영향 대상 사전 확인:
--   SELECT id, user_id, bank_name FROM user_bank_accounts WHERE bank_name REGEXP '^[0-9]+$';
-- =====================================================

UPDATE user_bank_accounts SET bank_name = '산업은행'        WHERE bank_name = '002';
UPDATE user_bank_accounts SET bank_name = '기업은행'        WHERE bank_name = '003';
UPDATE user_bank_accounts SET bank_name = '국민은행'        WHERE bank_name = '004';
UPDATE user_bank_accounts SET bank_name = '수협은행'        WHERE bank_name = '007';
UPDATE user_bank_accounts SET bank_name = '수출입은행'      WHERE bank_name = '008';
UPDATE user_bank_accounts SET bank_name = '농협은행'        WHERE bank_name = '011';
UPDATE user_bank_accounts SET bank_name = '우리은행'        WHERE bank_name = '020';
UPDATE user_bank_accounts SET bank_name = 'SC제일은행'      WHERE bank_name = '023';
UPDATE user_bank_accounts SET bank_name = '씨티은행'        WHERE bank_name = '027';
UPDATE user_bank_accounts SET bank_name = '대구은행'        WHERE bank_name = '031';
UPDATE user_bank_accounts SET bank_name = '부산은행'        WHERE bank_name = '032';
UPDATE user_bank_accounts SET bank_name = '광주은행'        WHERE bank_name = '034';
UPDATE user_bank_accounts SET bank_name = '제주은행'        WHERE bank_name = '035';
UPDATE user_bank_accounts SET bank_name = '전북은행'        WHERE bank_name = '037';
UPDATE user_bank_accounts SET bank_name = '경남은행'        WHERE bank_name = '039';
UPDATE user_bank_accounts SET bank_name = '새마을금고'      WHERE bank_name = '045';
UPDATE user_bank_accounts SET bank_name = '신협'            WHERE bank_name = '048';
UPDATE user_bank_accounts SET bank_name = '우체국예금보험'  WHERE bank_name = '071';
UPDATE user_bank_accounts SET bank_name = '하나은행'        WHERE bank_name = '081';
UPDATE user_bank_accounts SET bank_name = '신한은행'        WHERE bank_name = '088';
UPDATE user_bank_accounts SET bank_name = '카카오뱅크'      WHERE bank_name = '090';
UPDATE user_bank_accounts SET bank_name = '토스뱅크'        WHERE bank_name = '092';

-- 실행 후 잔여 숫자 데이터(매핑 누락) 확인:
--   SELECT id, user_id, bank_name FROM user_bank_accounts WHERE bank_name REGEXP '^[0-9]+$';
-- 위 쿼리 결과가 0건이어야 정상.
