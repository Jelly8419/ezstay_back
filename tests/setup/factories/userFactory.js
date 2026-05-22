/**
 * userFactory.js
 * 테스트용 유저(게스트/호스트) 생성 헬퍼
 */

'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

let counter = 0;
const uid = () => `${Date.now()}_${++counter}_${Math.random().toString(36).slice(2, 6)}`;

/**
 * 게스트 유저 생성
 * @returns {{ user, token }} 생성된 유저와 JWT 토큰
 */
async function createGuest(overrides = {}) {
  const { User, LocalUser } = require('../../../models');

  const email = overrides.email || `guest_${uid()}@test.com`;
  const password = 'Test1234!';
  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await User.create({
    email,
    name: overrides.name || '테스트게스트',
    nickname: overrides.nickname || `guest_${uid()}`,
    phoneNumber: overrides.phoneNumber || '01012345678',
    phoneVerified: true,
    userType: 'local',
    accountStatus: 'active',
    isActive: true,
    serviceTermsAgreed: true,
    privacyPolicyAgreed: true,
    ageConfirmed: true,
    ...overrides,
  });

  await LocalUser.create({
    userId: user.id,
    password: hashedPassword,
    emailVerified: true,
  });

  const token = generateToken(user);
  return { user, token, password };
}

/**
 * 호스트 유저 생성 (방 등록 가능한 유저)
 * @returns {{ user, token }}
 */
async function createHost(overrides = {}) {
  const { User, LocalUser, UserBankAccount } = require('../../../models');

  const email = overrides.email || `host_${uid()}@test.com`;
  const password = 'Test1234!';
  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await User.create({
    email,
    name: overrides.name || '테스트호스트',
    nickname: overrides.nickname || `host_${uid()}`,
    phoneNumber: overrides.phoneNumber || '01098765432',
    phoneVerified: true,
    userType: 'local',
    accountStatus: 'active',
    isActive: true,
    serviceTermsAgreed: true,
    privacyPolicyAgreed: true,
    ageConfirmed: true,
    ...overrides,
  });

  await LocalUser.create({
    userId: user.id,
    password: hashedPassword,
    emailVerified: true,
  });

  // 호스트 정산 계좌 (정산 TC에 필요)
  await UserBankAccount.create({
    userId: user.id,
    bankCode: '004',
    bankName: '국민은행',
    accountNumber: '123456789012',
    accountHolder: user.name,
    isDefault: true,
    isVerified: true,
  }).catch(() => {}); // 테이블 없으면 무시

  const token = generateToken(user);
  return { user, token };
}

/**
 * JWT 토큰 생성
 */
function generateToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email },
    process.env.JWT_SECRET || 'test_jwt_secret_key_for_testing_only',
    { expiresIn: '1h' }
  );
}

/**
 * 테스트 데이터 정리
 *
 * 주의: alimtalk_logs.receiver_id 가 users 를 FK 참조하므로,
 *       알림톡이 발송된 user 는 로그를 먼저 지워야 User.destroy 가 성공한다.
 */
async function cleanupUsers(userIds) {
  if (!userIds || userIds.length === 0) return;
  const { User, LocalUser, UserBankAccount, AlimtalkLog } = require('../../../models');
  await LocalUser.destroy({ where: { userId: userIds } });
  await UserBankAccount.destroy({ where: { userId: userIds } }).catch(() => {});
  await AlimtalkLog.destroy({ where: { receiverId: userIds } }).catch(() => {});
  await User.destroy({ where: { id: userIds } });
}

module.exports = { createGuest, createHost, generateToken, cleanupUsers };
