/**
 * globalTeardown.js
 * 전체 테스트 종료 후 1회 실행
 * - DB 연결 정리
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.test') });

module.exports = async () => {
  console.log('\n[globalTeardown] 테스트 환경 정리 중...');
  try {
    const { sequelize } = require('../../models');
    await sequelize.close();
  } catch (e) {
    // 이미 닫혀있으면 무시
  }
  console.log('[globalTeardown] 완료');
};
