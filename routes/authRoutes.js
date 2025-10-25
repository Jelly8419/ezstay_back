const express = require('express');
const router = express.Router();
const { register, login, refreshToken, logout, getProfile, devBypassLogin } = require('../controllers/authController');
const { kakaoLogin } = require('../controllers/oauthController');
const { authenticateToken } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');

// 일반 회원가입/로그인 (Rate Limiting 적용)
router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.post('/refresh', refreshToken);
router.post('/logout', authenticateToken, logout);

// 소셜 로그인
router.post('/kakao', kakaoLogin);
router.get('/kakao', async (req, res) => {
  const { code } = req.query;
  if (code) {
    try {
      // code를 body로 변환해서 kakaoLogin 호출
      req.body = { code };

      // 응답을 가로채서 프론트엔드로 리디렉트
      const originalJson = res.json;
      res.json = function(data) {
        if (data.success) {
          // 성공 시 JWT 토큰만 전달 (사용자 데이터는 토큰에 포함됨)
          const { accessToken, refreshToken } = data.data;
          res.redirect(`http://localhost:3000/auth/callback?token=${accessToken}&refresh=${refreshToken}`);
        } else {
          // 실패 시 에러 메시지와 함께 리디렉트
          res.redirect(`http://localhost:3000/auth/callback?error=${encodeURIComponent(data.message)}`);
        }
      };

      kakaoLogin(req, res);
    } catch (error) {
      res.redirect(`http://localhost:3000/auth/callback?error=${encodeURIComponent('로그인 중 오류가 발생했습니다.')}`);
    }
  } else {
    res.redirect(`http://localhost:3000/auth/callback?error=${encodeURIComponent('카카오 인증 코드가 필요합니다.')}`);
  }
});

// 사용자 프로필
router.get('/profile', authenticateToken, getProfile);

// 개발 환경 전용 로그인 우회 (프로덕션에서 자동 차단됨)
router.get('/dev-bypass/:userid', devBypassLogin);

module.exports = router;