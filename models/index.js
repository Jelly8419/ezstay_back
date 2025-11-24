const { Sequelize } = require('sequelize');
const { User } = require('./User');
const { LocalUser } = require('./LocalUser');
const { SocialUser } = require('./SocialUser');
const AdminModel = require('./Admin');
const AdminActionLogModel = require('./AdminActionLog');
const { Room } = require('./Room');
const { RoomPhoto } = require('./RoomPhoto');
const { RoomAmenity } = require('./RoomAmenity');
const { EzService } = require('./EzService');
// 하위 호환성을 위한 별칭 (DEPRECATED: EzService 사용 권장)
const RoomFreeService = EzService;
const { UserBankAccount } = require('./UserBankAccount');
const RentalItem = require('./RentalItem');
const Contract = require('./Contract');
const RentalItemReservation = require('./RentalItemReservation');
const ChatRoom = require('./ChatRoom');
const NoticeModel = require('./Notice');
const FAQCategoryModel = require('./FAQCategory');
const FAQModel = require('./FAQ');
const InquiryModel = require('./Inquiry');
const RefundPolicyType = require('./RefundPolicyType');
const RefundPolicyRule = require('./RefundPolicyRule');
const Refund = require('./Refund');

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

// 고객센터 모델 초기화
const Notice = NoticeModel(sequelize);
const FAQCategory = FAQCategoryModel(sequelize);
const FAQ = FAQModel(sequelize);
const Inquiry = InquiryModel(sequelize);

// 방 관리 모델 초기화
const RoomMemoModel = require('./RoomMemo');
const RoomPasswordHistoryModel = require('./RoomPasswordHistory');
const RoomStatusHistoryModel = require('./RoomStatusHistory');
const RoomMemoInstance = RoomMemoModel(sequelize);
const RoomPasswordHistoryInstance = RoomPasswordHistoryModel(sequelize);
const RoomStatusHistoryInstance = RoomStatusHistoryModel(sequelize);

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

// EzService (이지서비스) 관계 설정
Room.hasOne(EzService, {
  foreignKey: 'roomId',
  as: 'ezService'
});
EzService.belongsTo(Room, {
  foreignKey: 'roomId',
  as: 'room'
});

// 하위 호환성을 위한 freeService 별칭 (DEPRECATED)
Room.hasOne(EzService, {
  foreignKey: 'roomId',
  as: 'freeService'
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

// Notice 관계 설정
Notice.belongsTo(Admin, {
  foreignKey: 'createdBy',
  as: 'author'
});
Notice.belongsTo(Admin, {
  foreignKey: 'updatedBy',
  as: 'editor'
});
Admin.hasMany(Notice, {
  foreignKey: 'createdBy',
  as: 'notices'
});

// FAQCategory와 FAQ 관계 설정
FAQCategory.hasMany(FAQ, {
  foreignKey: 'categoryId',
  as: 'faqs'
});
FAQ.belongsTo(FAQCategory, {
  foreignKey: 'categoryId',
  as: 'category'
});

// FAQ와 Admin 관계 설정
FAQ.belongsTo(Admin, {
  foreignKey: 'createdBy',
  as: 'author'
});
FAQ.belongsTo(Admin, {
  foreignKey: 'updatedBy',
  as: 'editor'
});
Admin.hasMany(FAQ, {
  foreignKey: 'createdBy',
  as: 'faqs'
});

// Inquiry 관계 설정
Inquiry.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});
User.hasMany(Inquiry, {
  foreignKey: 'userId',
  as: 'inquiries'
});

Inquiry.belongsTo(Admin, {
  foreignKey: 'answeredBy',
  as: 'admin'
});
Admin.hasMany(Inquiry, {
  foreignKey: 'answeredBy',
  as: 'answeredInquiries'
});

// RoomMemo 관계 설정
RoomMemoInstance.belongsTo(Room, {
  foreignKey: 'roomId',
  as: 'room'
});
Room.hasMany(RoomMemoInstance, {
  foreignKey: 'roomId',
  as: 'memos'
});

RoomMemoInstance.belongsTo(Admin, {
  foreignKey: 'adminId',
  as: 'admin'
});
Admin.hasMany(RoomMemoInstance, {
  foreignKey: 'adminId',
  as: 'roomMemos'
});

// RoomPasswordHistory 관계 설정
RoomPasswordHistoryInstance.belongsTo(Room, {
  foreignKey: 'roomId',
  as: 'room'
});
Room.hasMany(RoomPasswordHistoryInstance, {
  foreignKey: 'roomId',
  as: 'passwordHistories'
});

RoomPasswordHistoryInstance.belongsTo(Admin, {
  foreignKey: 'adminId',
  as: 'admin'
});
Admin.hasMany(RoomPasswordHistoryInstance, {
  foreignKey: 'adminId',
  as: 'passwordChanges'
});

// RoomStatusHistory 관계 설정
RoomStatusHistoryInstance.belongsTo(Room, {
  foreignKey: 'roomId',
  as: 'room'
});
Room.hasMany(RoomStatusHistoryInstance, {
  foreignKey: 'roomId',
  as: 'statusHistories'
});

RoomStatusHistoryInstance.belongsTo(Admin, {
  foreignKey: 'adminId',
  as: 'admin'
});
Admin.hasMany(RoomStatusHistoryInstance, {
  foreignKey: 'adminId',
  as: 'statusChanges'
});

// RefundPolicyType과 RefundPolicyRule 관계 설정
RefundPolicyType.hasMany(RefundPolicyRule, {
  foreignKey: 'policyType',
  sourceKey: 'policyType',
  as: 'rules'
});
RefundPolicyRule.belongsTo(RefundPolicyType, {
  foreignKey: 'policyType',
  targetKey: 'policyType',
  as: 'policy'
});

// Room과 RefundPolicyType 관계 설정 (선택 사항 - FK 제약 조건 미사용)
Room.belongsTo(RefundPolicyType, {
  foreignKey: 'refundPolicy',
  targetKey: 'policyType',
  as: 'refundPolicyDetails',
  constraints: false // 기존 데이터 호환성을 위해 제약 조건 미적용
});
RefundPolicyType.hasMany(Room, {
  foreignKey: 'refundPolicy',
  sourceKey: 'policyType',
  as: 'rooms',
  constraints: false
});

// Contract와 Refund 관계 설정
Contract.hasMany(Refund, {
  foreignKey: 'contractId',
  as: 'refunds'
});
Refund.belongsTo(Contract, {
  foreignKey: 'contractId',
  as: 'contract'
});

// Refund와 RefundPolicyType 관계 설정
Refund.belongsTo(RefundPolicyType, {
  foreignKey: 'policyTypeUsed',
  targetKey: 'policyType',
  as: 'policyUsed',
  constraints: false // 정책 삭제 시 환불 이력 보존
});
RefundPolicyType.hasMany(Refund, {
  foreignKey: 'policyTypeUsed',
  sourceKey: 'policyType',
  as: 'refunds',
  constraints: false
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
  EzService,
  RoomFreeService, // DEPRECATED: EzService의 별칭, 하위 호환성 유지
  UserBankAccount,
  RentalItem,
  Contract,
  RentalItemReservation,
  ChatRoom,
  Notice,
  FAQCategory,
  FAQ,
  Inquiry,
  RoomMemo: RoomMemoInstance,
  RoomPasswordHistory: RoomPasswordHistoryInstance,
  RoomStatusHistory: RoomStatusHistoryInstance,
  RefundPolicyType,
  RefundPolicyRule,
  Refund
};