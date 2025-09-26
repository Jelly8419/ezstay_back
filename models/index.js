const { Sequelize } = require('sequelize');
const { User } = require('./User');
const { LocalUser } = require('./LocalUser');
const { SocialUser } = require('./SocialUser');
const { Room } = require('./Room');

const sequelize = new Sequelize('livemoment', process.env.DB_USER || 'root', process.env.DB_PASSWORD || '', {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  dialect: 'mysql'
});

// 모델 관계 설정
User.hasOne(LocalUser, {
  foreignKey: 'userId',
  as: 'localProfile'
});
LocalUser.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});

User.hasMany(SocialUser, {
  foreignKey: 'userId',
  as: 'socialProfiles'
});
SocialUser.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});

User.hasMany(Room, {
  foreignKey: 'hostId',
  as: 'rooms'
});
Room.belongsTo(User, {
  foreignKey: 'hostId',
  as: 'host'
});

module.exports = {
  sequelize,
  User,
  LocalUser,
  SocialUser,
  Room
};