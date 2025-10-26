/**
 * 관리자 계정 생성 스크립트
 *
 * 사용법:
 * node scripts/createAdmin.js
 */

const bcrypt = require('bcryptjs');
const readline = require('readline');
const { Admin, sequelize } = require('../models');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function createAdmin() {
  try {
    console.log('\n=== Ezstay 관리자 계정 생성 ===\n');

    // DB 연결
    await sequelize.authenticate();
    console.log('✅ 데이터베이스 연결 성공\n');

    // 입력 받기
    const username = await question('아이디: ');
    const password = await question('비밀번호: ');
    const name = await question('이름: ');
    const phoneNumber = await question('전화번호 (선택, Enter로 건너뛰기): ');

    console.log('\n관리자 역할을 선택하세요:');
    console.log('1. super_admin (최고관리자)');
    console.log('2. admin (일반관리자)');
    console.log('3. cs_admin (고객센터 관리자)');
    const roleChoice = await question('선택 (1-3): ');

    const roleMap = {
      '1': 'super_admin',
      '2': 'admin',
      '3': 'cs_admin'
    };

    const role = roleMap[roleChoice] || 'admin';

    // 기존 계정 확인
    const existingAdmin = await Admin.findOne({ where: { username } });
    if (existingAdmin) {
      console.log('\n❌ 이미 존재하는 아이디입니다.');
      rl.close();
      process.exit(1);
    }

    // 비밀번호 해싱
    const hashedPassword = await bcrypt.hash(password, 10);

    // 관리자 생성
    const admin = await Admin.create({
      username,
      password: hashedPassword,
      name,
      phoneNumber: phoneNumber || null,
      role,
      isActive: true
    });

    console.log('\n✅ 관리자 계정 생성 완료!');
    console.log('\n--- 계정 정보 ---');
    console.log(`ID: ${admin.id}`);
    console.log(`아이디: ${admin.username}`);
    console.log(`이름: ${admin.name}`);
    console.log(`역할: ${admin.role}`);
    console.log(`생성일: ${admin.createdAt}`);
    console.log('\n로그인 URL: POST /api/admin/auth/login');

    rl.close();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ 오류 발생:', error.message);
    rl.close();
    process.exit(1);
  }
}

createAdmin();
