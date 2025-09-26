const express = require('express');
const router = express.Router();
const { register, login, refreshToken, logout, getProfile } = require('../controllers/authController');
const { kakaoLogin } = require('../controllers/oauthController');
const { authenticateToken } = require('../middleware/auth');

// 일반 회원가입/로그인
router.post('/register', register);
router.post('/login', login);
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

module.exports = router;