const { Sequelize } = require('sequelize');
const { User } = require('./User');
const { LocalUser } = require('./LocalUser');
const { SocialUser } = require('./SocialUser');
const { Room } = require('./Room');
const { RoomPhoto } = require('./RoomPhoto');
const { RoomAmenity } = require('./RoomAmenity');
const { RoomFreeService } = require('./RoomFreeService');
const { UserBankAccount } = require('./UserBankAccount');

const sequelize = new Sequelize('livemoment', process.env.DB_USER || 'root', process.env.DB_PASSWORD || '', {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  dialect: 'mysql',
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
  }
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

// Room 관계 설정
Room.hasMany(RoomPhoto, {
  foreignKey: 'roomId',
  as: 'photos'
});
RoomPhoto.belongsTo(Room, {
  foreignKey: 'roomId',
  as: 'room'
});

Room.hasOne(RoomAmenity, {
  foreignKey: 'roomId',
  as: 'amenity'
});
RoomAmenity.belongsTo(Room, {
  foreignKey: 'roomId',
  as: 'room'
});

Room.hasOne(RoomFreeService, {
  foreignKey: 'roomId',
  as: 'freeService'
});
RoomFreeService.belongsTo(Room, {
  foreignKey: 'roomId',
  as: 'room'
});

User.hasMany(UserBankAccount, {
  foreignKey: 'userId',
  as: 'bankAccounts'
});
UserBankAccount.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});

module.exports = {
  sequelize,
  User,
  LocalUser,
  SocialUser,
  Room,
  RoomPhoto,
  RoomAmenity,
  RoomFreeService,
  UserBankAccount
};