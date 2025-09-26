const { User, SocialUser, sequelize } = require('../models');
const { generateTokens } = require('../utils/auth');
const axios = require('axios');

const kakaoLogin = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        message: '카카오 인증 코드가 필요합니다.'
      });
    }

    // 카카오 토큰 획득
    console.log('카카오 토큰 요청 파라미터:', {
      client_id: process.env.KAKAO_CLIENT_ID,
      client_secret: process.env.KAKAO_CLIENT_SECRET,
      redirect_uri: process.env.KAKAO_REDIRECT_URI,
      code: code
    });

    let tokenResponse;
    try {
      tokenResponse = await axios.post('https://kauth.kakao.com/oauth/token', null, {
        params: {
          grant_type: 'authorization_code',
          client_id: process.env.KAKAO_CLIENT_ID,
          client_secret: process.env.KAKAO_CLIENT_SECRET,
          redirect_uri: process.env.KAKAO_REDIRECT_URI,
          code: code
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      console.log('카카오 토큰 응답:', tokenResponse.data);
    } catch (tokenError) {
      console.error('카카오 토큰 요청 실패:', tokenError.response?.data || tokenError.message);
      throw tokenError;
    }

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    // 카카오 사용자 정보 획득
    const userResponse = await axios.get('https://kapi.kakao.com/v2/user/me', {
      headers: {
        Authorization: `Bearer ${access_token}`
      }
    });

    const kakaoUser = userResponse.data;
    const { id: kakaoId, kakao_account } = kakaoUser;
    const { email, profile } = kakao_account;

    // 기존 소셜 사용자 확인
    let socialUser = await SocialUser.findOne({
      where: {
        provider: 'kakao',
        providerId: kakaoId.toString()
      },
      include: [{
        model: User,
        as: 'user'
      }]
    });

    let user;

    if (socialUser) {
      // 기존 사용자 - 토큰 업데이트
      user = socialUser.user;
      await socialUser.update({
        accessToken: access_token,
        refreshTokenProvider: refresh_token,
        tokenExpiresAt: new Date(Date.now() + expires_in * 1000)
      }, { transaction });
    } else {
      // 이메일로 기존 사용자 확인 (다른 방법으로 가입된 경우)
      const existingUser = await User.findOne({
        where: { email: email }
      });

      if (existingUser) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: '이미 다른 방법으로 가입된 이메일입니다.'
        });
      }

      // 새 사용자 생성
      user = await User.create({
        email: email,
        name: profile.nickname,
        profileImageUrl: profile.profile_image_url || null,
        userType: 'social'
      }, { transaction });

      // 소셜 사용자 정보 생성
      await SocialUser.create({
        userId: user.id,
        provider: 'kakao',
        providerId: kakaoId.toString(),
        providerEmail: email,
        accessToken: access_token,
        refreshTokenProvider: refresh_token,
        tokenExpiresAt: new Date(Date.now() + expires_in * 1000),
        additionalData: {
          nickname: profile.nickname,
          profileImageUrl: profile.profile_image_url,
          thumbnailImageUrl: profile.thumbnail_image_url
        }
      }, { transaction });
    }

    const { accessToken, refreshToken } = generateTokens({
      userId: user.id,
      email: user.email
    });

    await user.update({
      refreshToken,
      lastLoginAt: new Date()
    }, { transaction });

    await transaction.commit();

    res.status(200).json({
      success: true,
      message: '카카오 로그인이 완료되었습니다.',
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          profileImageUrl: user.profileImageUrl,
          userType: user.userType
        },
        accessToken,
        refreshToken
      }
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Kakao login error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: '카카오 로그인 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};


module.exports = {
  kakaoLogin
};