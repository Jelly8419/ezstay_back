/**
 * adminFactory.js
 * 테스트용 관리자 생성 헬퍼
 */

'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

let counter = 0;
const uid = () => `${Date.now()}_${++counter}_${Math.random().toString(36).slice(2, 6)}`;

async function createAdmin(overrides = {}) {
  const { Admin } = require('../../../models');
  const password = 'AdminTest1234!';
  const hashedPassword = await bcrypt.hash(password, 10);

  const admin = await Admin.create({
    username: overrides.username || `admin_${uid()}`,
    password: hashedPassword,
    name: overrides.name || '테스트관리자',
    phoneNumber: overrides.phoneNumber || '01000000000',
    role: overrides.role || 'admin',
    isActive: true,
    ...overrides
  });

  const token = jwt.sign(
    { userId: admin.id, role: admin.role },
    process.env.JWT_SECRET || 'test_jwt_secret_key_for_testing_only',
    { expiresIn: '1h' }
  );

  return { admin, token };
}

async function cleanupAdmins(adminIds) {
  if (!adminIds || adminIds.length === 0) return;
  const { Admin } = require('../../../models');
  // FK 제약(예: admin_action_logs) 때문에 삭제 실패 가능 — 테스트 독립성에는 영향 없음
  try {
    await Admin.destroy({ where: { id: adminIds } });
  } catch (err) {
    // 정리 실패 무시 (각 테스트는 새 admin 생성)
  }
}

module.exports = { createAdmin, cleanupAdmins };
