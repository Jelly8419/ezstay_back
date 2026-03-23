const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const { getEmailTemplate } = require('./emailTemplates');

// AWS SES 클라이언트 설정
let sesClient = null;

if (process.env.AWS_SES_ACCESS_KEY_ID && process.env.AWS_SES_SECRET_ACCESS_KEY) {
  sesClient = new SESClient({
    region: process.env.AWS_SES_REGION || 'ap-northeast-2',
    credentials: {
      accessKeyId: process.env.AWS_SES_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SES_SECRET_ACCESS_KEY,
    },
  });
} else {
  console.warn('⚠️  AWS SES 인증 정보가 설정되지 않았습니다. 이메일 발송이 불가능합니다.');
}

/**
 * 인증코드 이메일 발송 (AWS SES)
 * @param {string} to - 수신자 이메일
 * @param {string} code - 6자리 인증코드
 * @param {string} type - 'signup' | 'password_reset'
 * @returns {Promise<boolean>} 발송 성공 여부
 */
const sendVerificationEmail = async (to, code, type = 'signup') => {
  try {
    if (!sesClient) {
      console.error('❌ AWS SES 인증 정보가 설정되지 않았습니다.');
      return false;
    }

    const subject = type === 'signup'
      ? '[Ezstay] 이메일 인증코드입니다'
      : '[Ezstay] 비밀번호 재설정 인증코드';

    const htmlContent = getEmailTemplate(code, type);
    const fromAddress = process.env.EMAIL_FROM || 'noreply@ezstay.com';

    const command = new SendEmailCommand({
      Source: fromAddress,
      Destination: {
        ToAddresses: [to],
      },
      Message: {
        Subject: {
          Data: subject,
          Charset: 'UTF-8',
        },
        Body: {
          Html: {
            Data: htmlContent,
            Charset: 'UTF-8',
          },
        },
      },
    });

    const response = await sesClient.send(command);

    console.log('✅ 이메일 발송 성공:', to);
    console.log('📧 AWS SES MessageId:', response.MessageId);
    return true;
  } catch (error) {
    console.error('❌ AWS SES 이메일 발송 실패:', error);
    return false;
  }
};

/**
 * AWS SES 설정 검증
 * @returns {boolean} 설정 여부
 */
const isConfigured = () => {
  return !!(process.env.AWS_SES_ACCESS_KEY_ID && process.env.AWS_SES_SECRET_ACCESS_KEY);
};

module.exports = {
  sendVerificationEmail,
  isConfigured
};
