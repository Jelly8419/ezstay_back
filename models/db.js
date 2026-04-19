const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(process.env.DB_NAME || 'ezstay', process.env.DB_USER || 'root', process.env.DB_PASSWORD || '', {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  dialect: 'mysql',
  timezone: '+00:00', // UTC로 통일 — 저장/읽기 모두 UTC 기준
  dialectOptions: {
    // MariaDB 인증 플러그인 문제 해결
    authPlugins: {
      mysql_native_password: () => () => Buffer.alloc(0)
    }
  },
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000
  },
  logging: false
});

module.exports = { sequelize };
