/**
 * 테스트용 관리자 계정 자동 생성 스크립트
 *
 * 사용법:
 * node scripts/createTestAdmin.js
 */

const bcrypt = require('bcryptjs');
const { Admin, sequelize } = require('../models/index');

async function createTestAdmin() {
  try {
    console.log('\n=== Ezstay 테스트 관리자 계정 생성 ===\n');

    // DB 연결
    await sequelize.authenticate();
    console.log('✅ 데이터베이스 연결 성공\n');

    const testAdmins = [
      {
        username: 'admin',
        password: 'admin1234!',
        name: '슈퍼관리자',
        phoneNumber: '010-1234-5678',
        role: 'super_admin'
      },
      {
        username: 'manager',
        password: 'manager1234!',
        name: '일반관리자',
        phoneNumber: '010-2234-5678',
        role: 'admin'
      },
      {
        username: 'csadmin',
        password: 'cs1234!',
        name: 'CS관리자',
        phoneNumber: '010-3234-5678',
        role: 'cs_admin'
      }
    ];

    for (const adminData of testAdmins) {
      // 기존 계정 확인
      const existingAdmin = await Admin.findOne({ where: { username: adminData.username } });

      if (existingAdmin) {
        console.log(`⚠️  이미 존재: ${adminData.username} (${adminData.role})`);
        continue;
      }

      // 비밀번호 해싱
      const hashedPassword = await bcrypt.hash(adminData.password, 10);

      // 관리자 생성
      const admin = await Admin.create({
        username: adminData.username,
        password: hashedPassword,
        name: adminData.name,
        phoneNumber: adminData.phoneNumber,
        role: adminData.role,
        isActive: true
      });

      console.log(`✅ 생성 완료: ${admin.username} (${admin.role})`);
    }

    console.log('\n--- 테스트 계정 정보 ---');
    console.log('슈퍼관리자:');
    console.log('  아이디: admin');
    console.log('  비밀번호: admin1234!');
    console.log('');
    console.log('일반관리자:');
    console.log('  아이디: manager');
    console.log('  비밀번호: manager1234!');
    console.log('');
    console.log('CS관리자:');
    console.log('  아이디: csadmin');
    console.log('  비밀번호: cs1234!');
    console.log('');
    console.log('로그인 URL: POST http://localhost:8080/api/admin/auth/login\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ 오류 발생:', error.message);
    console.error(error);
    process.exit(1);
  }
}

createTestAdmin();
