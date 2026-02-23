const { User, SocialUser, UserBankAccount, sequelize } = require('../models');
const { generateTokens } = require('../utils/auth');
const { success, error, ErrorCodes } = require('../utils/responseHelper');
const axios = require('axios');

const kakaoLogin = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { code, user_mode } = req.body;

    if (!code) {
      await transaction.rollback();
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
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
      await transaction.rollback();
      return error(res, { code: 1008, message: '카카오 로그인에 실패했습니다. 다시 시도해주세요.' }, 401);
    }

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    // 카카오 사용자 정보 획득
    let userResponse;
    try {
      userResponse = await axios.get('https://kapi.kakao.com/v2/user/me', {
        headers: {
          Authorization: `Bearer ${access_token}`
        }
      });
    } catch (userInfoError) {
      console.error('카카오 사용자 정보 획득 실패:', userInfoError.response?.data || userInfoError.message);
      await transaction.rollback();
      return error(res, { code: 1009, message: '카카오 계정 연동에 실패했습니다.' }, 401);
    }

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
      // 이메일로 기존 유저 확인
      if (email) {
        const existingUser = await User.findOne({
          where: { email: email }
        });

        if (existingUser && existingUser.userType === 'local') {
          // 로컬 회원이면 차단
          await transaction.rollback();
          return error(res, {
            ...ErrorCodes.EMAIL_EXISTS_AS_LOCAL,
            message: `이미 이메일로 가입된 계정입니다.(${email}) 이메일로 로그인해주세요.`
          }, 400);
        }

        if (existingUser) {
          // 기존 소셜 유저에 카카오 계정 연결
          user = existingUser;
        }
      }

      if (!user) {
        // 완전 신규 사용자 - 자동 회원가입
        user = await User.create({
          email: email,
          name: kakaoName || kakaoNickname,
          nickname: kakaoNickname || kakaoName,
          profileImageUrl: profile?.profile_image_url,
          userType: 'social'
        }, { transaction });
      }

      // 소셜 계정 연결
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
          profileImageUrl: profile?.profile_image_url,
          thumbnailImageUrl: profile?.thumbnail_image_url
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

    return success(res, {
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
    }, '카카오 로그인이 완료되었습니다.');
  } catch (err) {
    await transaction.rollback();
    console.error('Kakao login error:', err.response?.data || err.message);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};
module.exports = {
  kakaoLogin
};
