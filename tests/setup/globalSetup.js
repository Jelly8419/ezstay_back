/**
 * globalSetup.js
 * Jest 전체 테스트 시작 전 1회 실행
 * - 환경변수 로드 (.env.test)
 * - 테스트 DB 생성 및 테이블 동기화
 */

'use strict';

process.env.TZ = 'Asia/Seoul';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.test') });

module.exports = async () => {
  console.log('\n[globalSetup] 테스트 환경 초기화 시작...');
  console.log(`[globalSetup] DB: ${process.env.DB_NAME} @ ${process.env.DB_HOST}:${process.env.DB_PORT}`);

  // Firebase mock — 실제 Firebase 연결 차단
  process.env.FIREBASE_PROJECT_ID = 'test-project';
  process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN RSA PRIVATE KEY-----\nMOCK\n-----END RSA PRIVATE KEY-----';
  process.env.FIREBASE_CLIENT_EMAIL = 'test@test-project.iam.gserviceaccount.com';

  // 테스트 DB 생성 (없으면)
  const mysql2 = require('mysql2/promise');
  const conn = await mysql2.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  console.log(`[globalSetup] DB '${process.env.DB_NAME}' 준비 완료`);
  await conn.end();

  // Sequelize 연결 확인만 (테이블은 실 DB 스키마 그대로 사용)
  // sync({ alter }) 사용 시 컬럼 변경 위험 있으므로 사용 안 함
  // 테스트 DB는 실 DB 덤프로 스키마만 미리 구성해두어야 함
  const { sequelize } = require('../../models');
  await sequelize.authenticate();
  console.log('[globalSetup] DB 연결 확인 완료');

  await sequelize.close();
  console.log('[globalSetup] 초기화 완료\n');
};
