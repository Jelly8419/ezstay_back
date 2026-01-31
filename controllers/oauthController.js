const { User, SocialUser, UserBankAccount, sequelize } = require('../models');
const { generateTokens } = require('../utils/auth');
const axios = require('axios');

const kakaoLogin = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { code, user_mode } = req.body;

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

    // 닉네임 추출: profile.nickname 우선, 없으면 kakao_account.name
    const kakaoNickname = profile?.nickname || null;
    const kakaoName = kakao_account?.name || null;

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
      // 신규 사용자 - 자동 회원가입
      user = await User.create({
        email: email,
        name: kakaoName || kakaoNickname,           // 실명 우선, 없으면 닉네임
        nickname: kakaoNickname || kakaoName,        // 닉네임 우선, 없으면 실명
        profileImageUrl: profile.profile_image_url,
        userType: 'social'
      }, { transaction });

      await SocialUser.create({
        userId: user.id,
        provider: 'kakao',
        providerId: kakaoId.toString(),
        providerEmail: email,
        accessToken: access_token,
        refreshTokenProvider: refresh_token,
        tokenExpiresAt: new Date(Date.now() + expires_in * 1000),
        additionalData: {
          name: kakao_account.name,
          profileImageUrl: profile.profile_image_url,
          thumbnailImageUrl: profile.thumbnail_image_url
        }
      }, { transaction });
    }

    // 계좌 등록 여부 확인
    const bankAccount = await UserBankAccount.findOne({
      where: { userId: user.id }
    });

    // user_mode 결정: 계좌가 없으면 guest 강제, 있으면 요청값 또는 기본값
    let userMode = 'guest';
    if (bankAccount) {
      userMode = user_mode === 'host' ? 'host' : 'guest';
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
          nickname: user.nickname,
          profileImageUrl: user.profileImageUrl,
          userType: user.userType,
          userMode: userMode,
          phoneVerified: user.phoneVerified || false,
          hasBank: !!bankAccount
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