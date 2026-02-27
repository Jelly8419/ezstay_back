/**
 * 인증코드 이메일 HTML 템플릿
 * @param {string} code - 6자리 인증코드
 * @param {string} type - 'signup' | 'password_reset'
 * @returns {string} HTML 템플릿
 */
const getEmailTemplate = (code, type = 'signup') => {
  const title = type === 'signup'
    ? '이메일 인증코드'
    : '비밀번호 재설정 인증코드';

  const message = type === 'signup'
    ? 'Ezstay 회원가입을 위한 인증코드입니다.'
    : '비밀번호 재설정을 위한 인증코드입니다.';

  return `
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;
      background-color: #f5f5f5;
      margin: 0;
      padding: 20px;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }
    .header {
      background-color: #4A90E2;
      padding: 30px 20px;
      text-align: center;
      color: #ffffff;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
      font-weight: bold;
    }
    .content {
      padding: 40px 30px;
      text-align: center;
    }
    .content p {
      font-size: 16px;
      color: #333333;
      line-height: 1.6;
      margin-bottom: 30px;
    }
    .code-box {
      background-color: #f8f9fa;
      border: 2px dashed #4A90E2;
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
    }
    .code {
      font-size: 36px;
      font-weight: bold;
      color: #4A90E2;
      letter-spacing: 8px;
      font-family: 'Courier New', monospace;
    }
    .warning {
      font-size: 14px;
      color: #e74c3c;
      margin-top: 20px;
    }
    .footer {
      background-color: #f8f9fa;
      padding: 20px;
      text-align: center;
      font-size: 12px;
      color: #999999;
      border-top: 1px solid #e0e0e0;
    }
    .footer a {
      color: #4A90E2;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Ezstay</h1>
    </div>
    <div class="content">
      <p>${message}</p>
      <p>아래 인증코드를 입력하여 인증을 완료해주세요.</p>

      <div class="code-box">
        <div class="code">${code}</div>
      </div>

      <p class="warning">
        ⏰ 이 인증코드는 <strong>5분간</strong> 유효합니다.<br>
        🔒 본인이 요청하지 않았다면 이 이메일을 무시해주세요.
      </p>
    </div>
    <div class="footer">
      <p>
        본 메일은 발신 전용입니다.<br>
        문의사항은 <a href="mailto:support@ezstay.io">support@ezstay.io</a>으로 연락주세요.
      </p>
      <p>&copy; 2025 Ezstay. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `.trim();
};

module.exports = {
  getEmailTemplate
};
