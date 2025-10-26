/**
 * 실제 bcrypt 해싱된 비밀번호로 Admin 계정 INSERT 쿼리 생성
 *
 * 사용법:
 * node scripts/generateAdminSQL.js
 */

const bcrypt = require('bcryptjs');

async function generateSQL() {
  console.log('=== Admin 계정 SQL 쿼리 생성 ===\n');

  // 기본 관리자 계정 정보
  const admins = [
    {
      username: 'admin',
      password: 'admin1234!',
      name: '최고관리자',
      phoneNumber: '010-1234-5678',
      role: 'super_admin'
    },
    {
      username: 'manager',
      password: 'manager1234!',
      name: '일반관리자',
      phoneNumber: '010-2345-6789',
      role: 'admin'
    },
    {
      username: 'cs',
      password: 'cs1234!',
      name: '고객센터',
      phoneNumber: '010-3456-7890',
      role: 'cs_admin'
    }
  ];

  console.log('비밀번호 해싱 중...\n');

  const queries = [];

  for (const admin of admins) {
    const hashedPassword = await bcrypt.hash(admin.password, 10);

    const query = `INSERT INTO admins (username, password, name, phone_number, role, is_active, created_at, updated_at)
VALUES (
  '${admin.username}',
  '${hashedPassword}',
  '${admin.name}',
  '${admin.phoneNumber}',
  '${admin.role}',
  1,
  NOW(),
  NOW()
);`;

    queries.push(query);

    console.log(`✅ ${admin.username} (${admin.role}) - 비밀번호: ${admin.password}`);
  }

  console.log('\n=== 생성된 SQL 쿼리 ===\n');
  console.log('-- Admin 계정 생성 쿼리 (bcrypt 해싱 완료)');
  console.log('-- 생성일:', new Date().toISOString());
  console.log('');
  console.log(queries.join('\n\n'));
  console.log('');
  console.log('-- 생성 확인');
  console.log('SELECT id, username, name, role, is_active, created_at FROM admins;');
  console.log('');
  console.log('⚠️  주의: 위 쿼리를 복사하여 MySQL에서 실행하세요!');
  console.log('실행 방법: mysql -u root -p ezstay < scripts/admin_insert.sql');
}

generateSQL().catch(console.error);
