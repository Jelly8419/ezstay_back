/**
 * Aligo 카카오 알림톡 API 클라이언트
 * API 문서: https://smartsms.aligo.in/admin/api/kakao.html
 *
 * POST https://kakaoapi.aligo.in/akv10/alimtalk/send/
 */

const axios = require('axios');

const ALIGO_API_URL = 'https://kakaoapi.aligo.in/akv10/alimtalk/send/';

/**
 * Aligo 알림톡 발송
 * @param {Object} params
 * @param {string} params.receiver - 수신자 전화번호
 * @param {string} params.tplCode - 템플릿 코드
 * @param {string} params.subject - 알림톡 제목
 * @param {string} params.message - 알림톡 내용
 * @param {Object} [params.button] - 버튼 JSON (optional)
 * @param {string} [params.failover='Y'] - SMS fallback 여부
 * @param {string} [params.fsubject] - fallback SMS 제목
 * @param {string} [params.fmessage] - fallback SMS 내용
 * @returns {Promise<{success: boolean, data: Object|null, error: string|null}>}
 */
const sendAlimtalk = async (params) => {
  const {
    receiver,
    tplCode,
    subject,
    message,
    button = null,
    failover = 'Y',
    fsubject = null,
    fmessage = null
  } = params;

  // 환경변수 검증
  const apiKey = process.env.ALIGO_API_KEY;
  const userId = process.env.ALIGO_USER_ID;
  const senderKey = process.env.ALIGO_SENDER_KEY;
  const sender = process.env.ALIGO_SENDER_PHONE;

  if (!apiKey || !userId || !senderKey || !sender) {
    console.warn('[AligoClient] 환경변수 미설정 (ALIGO_API_KEY, ALIGO_USER_ID, ALIGO_SENDER_KEY, ALIGO_SENDER_PHONE)');
    return { success: false, data: null, error: 'Aligo 환경변수 미설정' };
  }

  try {
    // form-urlencoded payload 구성
    const formData = new URLSearchParams();
    formData.append('apikey', apiKey);
    formData.append('userid', userId);
    formData.append('senderkey', senderKey);
    formData.append('tpl_code', tplCode);
    formData.append('sender', sender);
    formData.append('receiver_1', receiver);
    formData.append('subject_1', subject);
    formData.append('message_1', message);

    if (button) {
      formData.append('button_1', typeof button === 'string' ? button : JSON.stringify(button));
    }

    // SMS fallback 설정
    formData.append('failover', failover);
    if (failover === 'Y') {
      if (fsubject) formData.append('fsubject_1', fsubject);
      if (fmessage) formData.append('fmessage_1', fmessage);
    }

    // 테스트 모드
    const testMode = process.env.ALIGO_TEST_MODE || 'Y';
    formData.append('testMode', testMode);

    const response = await axios.post(ALIGO_API_URL, formData.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000
    });

    const result = response.data;

    // Aligo 응답 코드 확인 (code: 0 = 성공)
    if (result.code === 0 || result.code === '0') {
      console.log(`[AligoClient] 알림톡 발송 성공: ${tplCode} → ${receiver}`);
      return { success: true, data: result, error: null };
    }

    console.error(`[AligoClient] 알림톡 발송 실패: code=${result.code}, message=${result.message}`);
    return { success: false, data: result, error: result.message || '알림톡 발송 실패' };
  } catch (err) {
    console.error(`[AligoClient] 알림톡 발송 에러: ${err.message}`);
    return { success: false, data: null, error: err.message };
  }
};

module.exports = { sendAlimtalk };
