const sgMail = require('@sendgrid/mail');
const { getEmailTemplate } = require('./emailTemplates');

// SendGrid API Key 설정
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
} else {
  console.warn('⚠️  SENDGRID_API_KEY가 설정되지 않았습니다. 이메일 발송이 불가능합니다.');
}

/**
 * 인증코드 이메일 발송 (SendGrid)
 * @param {string} to - 수신자 이메일
 * @param {string} code - 6자리 인증코드
 * @param {string} type - 'signup' | 'password_reset'
 * @returns {Promise<boolean>} 발송 성공 여부
 */
const sendVerificationEmail = async (to, code, type = 'signup') => {
  try {
    if (!process.env.SENDGRID_API_KEY) {
      console.error('❌ SendGrid API Key가 설정되지 않았습니다.');
      return false;
    }

    const subject = type === 'signup'
      ? '[Ezstay] 이메일 인증코드입니다'
      : '[Ezstay] 비밀번호 재설정 인증코드';

    const htmlContent = getEmailTemplate(code, type);

    const msg = {
      to: to,
      from: process.env.EMAIL_FROM || 'noreply@ezstay.com',
      subject: subject,
      html: htmlContent
    };

    const response = await sgMail.send(msg);

    console.log('✅ 이메일 발송 성공:', to);
    console.log('📧 SendGrid 응답:', JSON.stringify(response[0], null, 2));
    return true;
  } catch (error) {
    console.error('❌ SendGrid 이메일 발송 실패:', error);

    if (error.response) {
      console.error('에러 상세:', error.response.body);
    }

    return false;
  }
};

/**
 * SendGrid API Key 검증 (선택사항)
 * @returns {boolean} 설정 여부
 */
const isConfigured = () => {
  return !!process.env.SENDGRID_API_KEY;
};

module.exports = {
  sendVerificationEmail,
  isConfigured
};
