# Admin 테이블 및 계정 생성 가이드

Admin 테이블을 생성하고 초기 관리자 계정을 만드는 방법을 설명합니다.

---

## 📋 목차

1. [방법 1: Node.js 대화형 스크립트 (추천)](#방법-1-nodejs-대화형-스크립트-추천)
2. [방법 2: SQL 직접 실행](#방법-2-sql-직접-실행)
3. [방법 3: SQL 쿼리 생성기](#방법-3-sql-쿼리-생성기)
4. [테이블 확인](#테이블-확인)

---

## 방법 1: Node.js 대화형 스크립트 (추천) ⭐

가장 쉽고 안전한 방법입니다.

### 1단계: 서버 실행 (테이블 자동 생성)

```bash
npm run dev
```

> Sequelize가 `admins` 테이블을 자동으로 생성합니다 (`alter: true` 설정).

### 2단계: 관리자 계정 생성

```bash
node scripts/createAdmin.js
```

### 3단계: 대화형 입력

```
=== Ezstay 관리자 계정 생성 ===

아이디: admin
비밀번호: admin1234!
이름: 최고관리자
전화번호 (선택, Enter로 건너뛰기): 010-1234-5678

관리자 역할을 선택하세요:
1. super_admin (최고관리자)
2. admin (일반관리자)
3. cs_admin (고객센터 관리자)
선택 (1-3): 1

✅ 관리자 계정 생성 완료!

--- 계정 정보 ---
ID: 1
아이디: admin
이름: 최고관리자
역할: super_admin
생성일: 2025-10-27T...
```

### 4단계: 로그인 테스트

```bash
curl -X POST http://localhost:3000/api/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "admin1234!"
  }'
```

---

## 방법 2: SQL 직접 실행

### 옵션 A: 테이블만 생성

```bash
mysql -u root -p ezstay < scripts/createAdminTable.sql
```

그 다음 방법 1의 2단계로 계정 생성.

### 옵션 B: 테이블 + 더미 계정 생성

**주의**: 비밀번호가 해싱되지 않은 상태로 삽입되므로 실제 사용 불가!

```bash
mysql -u root -p ezstay < scripts/initAdmin.sql
```

생성 후 반드시 방법 3으로 실제 비밀번호 업데이트 필요.

---

## 방법 3: SQL 쿼리 생성기

실제 bcrypt 해싱된 비밀번호로 INSERT 쿼리를 생성합니다.

### 1단계: 쿼리 생성

```bash
node scripts/generateAdminSQL.js
```

### 2단계: 출력된 SQL 복사

```sql
-- 출력 예시:
INSERT INTO admins (email, password, name, phone_number, role, is_active, created_at, updated_at)
VALUES (
  'admin@ezstay.com',
  '$2a$10$kX7J.xXxXxXxXxXxXxXxXuOQ7Jx9yYyYyYyYyYyYyYyYyYyYyYyY',
  '최고관리자',
  '010-1234-5678',
  'super_admin',
  1,
  NOW(),
  NOW()
);
```

### 3단계: MySQL에서 실행

```bash
mysql -u root -p ezstay
```

```sql
-- 생성된 쿼리 붙여넣기
INSERT INTO admins ...
```

---

## 테이블 확인

### 테이블 구조 확인

```sql
DESCRIBE admins;
```

```
+---------------+-----------------------------------------+------+-----+-------------------+
| Field         | Type                                    | Null | Key | Default           |
+---------------+-----------------------------------------+------+-----+-------------------+
| id            | int                                     | NO   | PRI | NULL              |
| email         | varchar(255)                            | NO   | UNI | NULL              |
| password      | varchar(255)                            | NO   |     | NULL              |
| name          | varchar(100)                            | NO   |     | NULL              |
| phone_number  | varchar(20)                             | YES  |     | NULL              |
| role          | enum('super_admin','admin','cs_admin') | NO   |     | admin             |
| is_active     | tinyint(1)                              | NO   |     | 1                 |
| refresh_token | text                                    | YES  |     | NULL              |
| last_login_at | datetime                                | YES  |     | NULL              |
| created_at    | datetime                                | NO   |     | CURRENT_TIMESTAMP |
| updated_at    | datetime                                | NO   |     | CURRENT_TIMESTAMP |
+---------------+-----------------------------------------+------+-----+-------------------+
```

### 생성된 계정 확인

```sql
SELECT id, email, name, role, is_active, created_at
FROM admins
ORDER BY role DESC, id ASC;
```

```
+----+---------------------+--------------+-------------+-----------+---------------------+
| id | email               | name         | role        | is_active | created_at          |
+----+---------------------+--------------+-------------+-----------+---------------------+
|  1 | admin@ezstay.com    | 최고관리자   | super_admin |         1 | 2025-10-27 10:00:00 |
|  2 | manager@ezstay.com  | 일반관리자   | admin       |         1 | 2025-10-27 10:00:01 |
|  3 | cs@ezstay.com       | 고객센터     | cs_admin    |         1 | 2025-10-27 10:00:02 |
+----+---------------------+--------------+-------------+-----------+---------------------+
```

---

## 기본 관리자 계정 정보

방법 1 또는 방법 3으로 생성 시 기본 계정:

| 이메일 | 비밀번호 | 역할 | 설명 |
|--------|---------|------|------|
| admin@ezstay.com | admin1234! | super_admin | 최고관리자 (모든 권한) |
| manager@ezstay.com | manager1234! | admin | 일반관리자 |
| cs@ezstay.com | cs1234! | cs_admin | 고객센터 관리자 |

**⚠️ 보안 경고**: 프로덕션 환경에서는 반드시 비밀번호를 변경하세요!

---

## 로그인 테스트

### cURL

```bash
curl -X POST http://localhost:3000/api/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "admin1234!"
  }'
```

### JavaScript (Fetch)

```javascript
const response = await fetch('http://localhost:3000/api/admin/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'admin@ezstay.com',
    password: 'admin1234!'
  })
});

const result = await response.json();
console.log(result);
```

### 성공 응답

```json
{
  "success": true,
  "message": "로그인 성공",
  "data": {
    "admin": {
      "id": 1,
      "username": "admin",
      "name": "최고관리자",
      "role": "super_admin",
      "lastLoginAt": "2025-10-27T10:30:00.000Z"
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

---

## 문제 해결

### 테이블이 생성되지 않음

```bash
# 서버를 한 번 실행하여 Sequelize가 테이블 생성하도록 함
npm run dev
```

또는 수동으로 생성:

```bash
mysql -u root -p ezstay < scripts/createAdminTable.sql
```

### 계정 생성 실패

1. **이메일 중복**: 다른 이메일로 시도
2. **DB 연결 실패**: `.env` 파일의 DB 설정 확인
3. **권한 문제**: MySQL 사용자 권한 확인

### 로그인 실패

1. **비밀번호 불일치**: 정확한 비밀번호 입력 확인
2. **계정 비활성화**: `is_active = 1` 확인
3. **토큰 에러**: JWT_SECRET 환경변수 설정 확인

---

## 추가 명령어

### 관리자 비활성화

```sql
UPDATE admins
SET is_active = 0
WHERE email = 'admin@ezstay.com';
```

### 비밀번호 변경

Node.js에서 새 비밀번호 해싱:

```javascript
const bcrypt = require('bcryptjs');
const newPassword = await bcrypt.hash('new_password123!', 10);
console.log(newPassword);
```

MySQL에서 업데이트:

```sql
UPDATE admins
SET password = '$2a$10$...' -- 위에서 생성한 해시
WHERE email = 'admin@ezstay.com';
```

### 관리자 삭제

```sql
DELETE FROM admins
WHERE email = 'admin@ezstay.com';
```

---

**참고 문서**:
- [ADMIN_API_DOCUMENTATION.md](../ADMIN_API_DOCUMENTATION.md) - 전체 API 문서
- [CLAUDE.md](../CLAUDE.md) - 프로젝트 가이드
