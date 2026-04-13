/**
 * 국세청 사업자등록 상태조회 클라이언트
 * https://api.odcloud.kr/api/nts-businessman/v1/status
 */

const axios = require('axios');

const NTS_API_URL = 'https://api.odcloud.kr/api/nts-businessman/v1/status';
const NTS_SERVICE_KEY = process.env.NTS_SERVICE_KEY;

/**
 * b_stt 값 기준 처리 결과
 * - 계속사업자: allowed
 * - 휴업자: suspended (저장 허용, 경고)
 * - 폐업자: closed (저장 불가)
 * - 국세청에 등록되지 않은 사업자등록번호입니다: not_found (저장 불가)
 */
const B_STT_RESULT = {
  '계속사업자': 'allowed',
  '휴업자': 'suspended',
  '폐업자': 'closed'
};

/**
 * 사업자등록번호 국세청 상태 조회
 *
 * @param {string} bNo - 사업자등록번호 (숫자 10자리)
 * @returns {Promise<{ status: 'allowed'|'suspended'|'closed'|'not_found', rawData: object }>}
 * @throws {Error} API 호출 실패 시 (타임아웃, 네트워크 오류, 서비스키 미설정 등)
 */
async function checkBusinessStatus(bNo) {
  if (!NTS_SERVICE_KEY) {
    throw new Error('NTS_SERVICE_KEY 환경변수가 설정되지 않았습니다.');
  }

  const response = await axios.post(
    NTS_API_URL,
    { b_no: [bNo] },
    {
      params: { serviceKey: NTS_SERVICE_KEY },
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000
    }
  );

  const data = response.data?.data?.[0];
  if (!data) {
    throw new Error('국세청 API 응답 형식이 올바르지 않습니다.');
  }

  const bStt = data.b_stt;

  // "국세청에 등록되지 않은 사업자등록번호입니다" 메시지는 b_stt에 포함됨
  const status = B_STT_RESULT[bStt] ?? 'not_found';

  return { status, rawData: data };
}

module.exports = { checkBusinessStatus };
