const { Sequelize } = require('sequelize');
const { User } = require('./User');
const { LocalUser } = require('./LocalUser');
const { SocialUser } = require('./SocialUser');
const AdminModel = require('./Admin');
const AdminActionLogModel = require('./AdminActionLog');
const { Room } = require('./Room');
const { RoomPhoto } = require('./RoomPhoto');
const { RoomAmenity } = require('./RoomAmenity');
const { RoomFreeService } = require('./RoomFreeService');
const { UserBankAccount } = require('./UserBankAccount');
const RentalItem = require('./RentalItem');
const Contract = require('./Contract');
const RentalItemReservation = require('./RentalItemReservation');
const ChatRoom = require('./ChatRoom');

const sequelize = new Sequelize('ezstay', process.env.DB_USER || 'root', process.env.DB_PASSWORD || '', {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  dialect: 'mysql',
  timezone: '+09:00', // 한국 시간대 (Asia/Seoul)
  dialectOptions: {
    // MariaDB 인증 플러그인 문제 해결
    authPlugins: {
      mysql_native_password: () => () => Buffer.alloc(0)
    },
    timezone: '+09:00' // MySQL 연결 시 타임존 설정
  },
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000
  },

  // 환경별 로깅 설정
  // false: 로그 끄기 | console.log: 모든 쿼리 | 커스텀 함수: 필터링
  logging: false  // 강제로 모든 쿼리 로그 비활성화 (개발 중 필요시 true로 변경)
});

// Admin 모델 초기화
const Admin = AdminModel(sequelize);
const AdminActionLog = AdminActionLogModel(sequelize);

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

// Contract 관계 설정
Contract.belongsTo(Room, {
  foreignKey: 'roomId',
  as: 'room'
});
Room.hasMany(Contract, {
  foreignKey: 'roomId',
  as: 'contracts'
});

Contract.belongsTo(User, {
  foreignKey: 'hostId',
  as: 'host'
});
User.hasMany(Contract, {
  foreignKey: 'hostId',
  as: 'hostedContracts'
});

Contract.belongsTo(User, {
  foreignKey: 'guestId',
  as: 'guest'
});
User.hasMany(Contract, {
  foreignKey: 'guestId',
  as: 'guestContracts'
});

// RentalItemReservation 관계 설정
RentalItemReservation.belongsTo(Contract, {
  foreignKey: 'contractId',
  as: 'contract'
});
Contract.hasMany(RentalItemReservation, {
  foreignKey: 'contractId',
  as: 'rentalItemReservations'
});

RentalItemReservation.belongsTo(RentalItem, {
  foreignKey: 'rentalItemId',
  as: 'rentalItem'
});
RentalItem.hasMany(RentalItemReservation, {
  foreignKey: 'rentalItemId',
  as: 'reservations'
});

// ChatRoom 관계 설정
ChatRoom.belongsTo(Contract, {
  foreignKey: 'contractId',
  as: 'contract'
});
Contract.hasOne(ChatRoom, {
  foreignKey: 'contractId',
  as: 'chatRoom'
});

ChatRoom.belongsTo(User, {
  foreignKey: 'hostId',
  as: 'host'
});

ChatRoom.belongsTo(User, {
  foreignKey: 'guestId',
  as: 'guest'
});

ChatRoom.belongsTo(Room, {
  foreignKey: 'roomId',
  as: 'room'
});

// AdminActionLog 관계 설정
AdminActionLog.belongsTo(Admin, {
  foreignKey: 'adminId',
  as: 'admin'
});
Admin.hasMany(AdminActionLog, {
  foreignKey: 'adminId',
  as: 'actionLogs'
});

module.exports = {
  sequelize,
  User,
  LocalUser,
  SocialUser,
  Admin,
  AdminActionLog,
  Room,
  RoomPhoto,
  RoomAmenity,
  RoomFreeService,
  UserBankAccount,
  RentalItem,
  Contract,
  RentalItemReservation,
  ChatRoom
};