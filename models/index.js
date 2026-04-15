const { sequelize } = require('./db');
const UserModel = require('./User');
const LocalUserModel = require('./LocalUser');
const SocialUserModel = require('./SocialUser');
const EmailVerificationCodeModel = require('./EmailVerificationCode');
const AdminModel = require('./Admin');
const AdminActionLogModel = require('./AdminActionLog');
const { Room } = require('./Room');
const { RoomPhoto } = require('./RoomPhoto');
const { RoomAmenity } = require('./RoomAmenity');
const { EzService } = require('./EzService');
const UserBankAccountModel = require('./UserBankAccount');
const RentalItem = require('./RentalItem');
const Contract = require('./Contract');
const ContractSequenceModel = require('./ContractSequence');
const RentalItemReservation = require('./RentalItemReservation');
const ChatRoom = require('./ChatRoom');
const NoticeModel = require('./Notice');
const FAQCategoryModel = require('./FAQCategory');
const FAQModel = require('./FAQ');
const InquiryModel = require('./Inquiry');
const RefundPolicyType = require('./RefundPolicyType');
const RefundPolicyRule = require('./RefundPolicyRule');
const Refund = require('./Refund');
const ContractStatusLog = require('./ContractStatusLog');
const PaymentModel = require('./Payment');
const PaymentFailureLogModel = require('./PaymentFailureLog');
const BlockedPeriod = require('./BlockedPeriod');
const AutoMessageTemplate = require('./AutoMessageTemplate');
const NotificationLog = require('./NotificationLog');
const Notification = require('./Notification');
const RentalOrder = require('./RentalOrder');
const RentalOrderItem = require('./RentalOrderItem');
const RentalOrderLog = require('./RentalOrderLog');
const RentalPaymentModel = require('./RentalPayment');
const RentalPaymentFailureLogModel = require('./RentalPaymentFailureLog');
const Settlement = require('./Settlement');
const PayoutModel = require('./Payout');
const PayoutLogModel = require('./PayoutLog');
const DepositAgreement = require('./DepositAgreement');
const GuestRefundAccount = require('./GuestRefundAccount');
const AlimtalkLog = require('./AlimtalkLog');
const { ReceiptSetting } = require('./ReceiptSetting');
const Receipt = require('./Receipt');
const UserSessionModel = require('./UserSession');
const AdminRefund = require('./AdminRefund');
const RentalOrderRefundRequest = require('./RentalOrderRefundRequest');
const ServiceTaskModel = require('./ServiceTask');
const ServiceTaskLogModel = require('./ServiceTaskLog');
const ContractCancelRequestModel = require('./ContractCancelRequest');
const KmcVerificationModel = require('./KmcVerification');

// 핵심 유저 모델 초기화
const User = UserModel(sequelize);
const LocalUser = LocalUserModel(sequelize);
const SocialUser = SocialUserModel(sequelize);
const EmailVerificationCode = EmailVerificationCodeModel(sequelize);
const UserBankAccount = UserBankAccountModel(sequelize);

// 세션 모델 초기화
const UserSession = UserSessionModel(sequelize);

// Admin 모델 초기화
const Admin = AdminModel(sequelize);
const AdminActionLog = AdminActionLogModel(sequelize);

// 고객센터 모델 초기화
const Notice = NoticeModel(sequelize);
const FAQCategory = FAQCategoryModel(sequelize);
const FAQ = FAQModel(sequelize);
const Inquiry = InquiryModel(sequelize);

// 계약 관련 모델 초기화
const ContractSequence = ContractSequenceModel(sequelize);

// 결제 관련 모델 초기화
const Payment = PaymentModel(sequelize);
const PaymentFailureLog = PaymentFailureLogModel(sequelize);
const Payout = PayoutModel(sequelize);
const PayoutLog = PayoutLogModel(sequelize);
const RentalPayment = RentalPaymentModel(sequelize);
const RentalPaymentFailureLog = RentalPaymentFailureLogModel(sequelize);

// 서비스 태스크 모델 초기화
const ServiceTask = ServiceTaskModel(sequelize);
const ServiceTaskLog = ServiceTaskLogModel(sequelize);
const ContractCancelRequest = ContractCancelRequestModel(sequelize);
const KmcVerification = KmcVerificationModel(sequelize);

// 방 관리 모델 초기화
const RoomMemoModel = require('./RoomMemo');
const RoomPasswordHistoryModel = require('./RoomPasswordHistory');
const RoomStatusHistoryModel = require('./RoomStatusHistory');
const RoomMemoInstance = RoomMemoModel(sequelize);
const RoomPasswordHistoryInstance = RoomPasswordHistoryModel(sequelize);
const RoomStatusHistoryInstance = RoomStatusHistoryModel(sequelize);

// UserSession 관계 설정 (User/Admin 공용, constraints: false로 다형성 처리)
User.hasMany(UserSession, {
  foreignKey: 'userId',
  as: 'sessions',
  constraints: false
});
UserSession.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user',
  constraints: false
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
  as: 'rooms',
  onDelete: 'NO ACTION', // 사용자 삭제 시 방 데이터 보존 (법적 요구사항)
  onUpdate: 'CASCADE'
});
Room.belongsTo(User, {
  foreignKey: 'hostId',
  as: 'host',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
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

// BlockedPeriod (계약 불가 기간) 관계 설정
Room.hasMany(BlockedPeriod, {
  foreignKey: 'roomId',
  as: 'blockedPeriods',
  onDelete: 'CASCADE', // 방 삭제 시 불가 기간도 함께 삭제
  onUpdate: 'CASCADE'
});
BlockedPeriod.belongsTo(Room, {
  foreignKey: 'roomId',
  as: 'room',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});

BlockedPeriod.belongsTo(User, {
  foreignKey: 'createdBy',
  as: 'host',
  onDelete: 'NO ACTION', // 호스트 삭제 시 불가 기간 보존
  onUpdate: 'CASCADE'
});
User.hasMany(BlockedPeriod, {
  foreignKey: 'createdBy',
  as: 'blockedPeriods',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});

User.hasMany(UserBankAccount, {
  foreignKey: 'userId',
  as: 'bankAccounts',
  onDelete: 'NO ACTION', // 계좌 정보 보존 (금융 거래 이력)
  onUpdate: 'CASCADE'
});
UserBankAccount.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
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
  as: 'host',
  onDelete: 'NO ACTION', // 계약 데이터 보존 (법적 요구사항)
  onUpdate: 'CASCADE'
});
User.hasMany(Contract, {
  foreignKey: 'hostId',
  as: 'hostedContracts',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});

Contract.belongsTo(User, {
  foreignKey: 'guestId',
  as: 'guest',
  onDelete: 'NO ACTION', // 계약 데이터 보존 (법적 요구사항)
  onUpdate: 'CASCADE'
});
User.hasMany(Contract, {
  foreignKey: 'guestId',
  as: 'guestContracts',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
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
  as: 'host',
  onDelete: 'NO ACTION', // 채팅 이력 보존
  onUpdate: 'CASCADE'
});

ChatRoom.belongsTo(User, {
  foreignKey: 'guestId',
  as: 'guest',
  onDelete: 'NO ACTION', // 채팅 이력 보존
  onUpdate: 'CASCADE'
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
  as: 'user',
  onDelete: 'NO ACTION', // 문의 이력 보존 (고객 서비스)
  onUpdate: 'CASCADE'
});
User.hasMany(Inquiry, {
  foreignKey: 'userId',
  as: 'inquiries',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
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

// Contract와 AdminRefund 관계 설정
Contract.hasMany(AdminRefund, {
  foreignKey: 'contractId',
  as: 'adminRefunds',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});
AdminRefund.belongsTo(Contract, {
  foreignKey: 'contractId',
  as: 'contract',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});

AdminRefund.belongsTo(Admin, {
  foreignKey: 'adminId',
  as: 'admin',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});
Admin.hasMany(AdminRefund, {
  foreignKey: 'adminId',
  as: 'adminRefunds',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});

// ContractStatusLog 관계 설정
Contract.hasMany(ContractStatusLog, {
  foreignKey: 'contractId',
  as: 'statusLogs'
});
ContractStatusLog.belongsTo(Contract, {
  foreignKey: 'contractId',
  as: 'contract'
});

// Payment 관계 설정
Contract.hasOne(Payment, {
  foreignKey: 'contractId',
  as: 'payment'
});
// 계약당 복수 결제 조회용 (CONTRACT + HOST_BURDEN)
Contract.hasMany(Payment, {
  foreignKey: 'contractId',
  as: 'payments'
});
Payment.belongsTo(Contract, {
  foreignKey: 'contractId',
  as: 'contract'
});

// PaymentFailureLog 관계 설정
Contract.hasMany(PaymentFailureLog, {
  foreignKey: 'contractId',
  as: 'paymentFailureLogs'
});
PaymentFailureLog.belongsTo(Contract, {
  foreignKey: 'contractId',
  as: 'contract'
});

// Contract와 Admin 관계 설정 (관리자 취소 시)
Contract.belongsTo(Admin, {
  foreignKey: 'cancelledByAdminId',
  as: 'cancelledByAdmin'
});
Admin.hasMany(Contract, {
  foreignKey: 'cancelledByAdminId',
  as: 'cancelledContracts'
});

// 보증금 보류 승인 관리자
Contract.belongsTo(Admin, {
  foreignKey: 'holdApprovedByAdminId',
  as: 'holdApprovedByAdmin'
});
Admin.hasMany(Contract, {
  foreignKey: 'holdApprovedByAdminId',
  as: 'holdApprovedContracts'
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

// AutoMessageTemplate 관계 설정
AutoMessageTemplate.belongsTo(User, {
  foreignKey: 'hostId',
  as: 'host'
});
User.hasMany(AutoMessageTemplate, {
  foreignKey: 'hostId',
  as: 'autoMessageTemplates'
});

AutoMessageTemplate.belongsTo(Room, {
  foreignKey: 'roomId',
  as: 'room'
});
Room.hasMany(AutoMessageTemplate, {
  foreignKey: 'roomId',
  as: 'autoMessageTemplates'
});

// =====================================================
// RentalOrder 관계 설정 (렌탈 주문 시스템)
// =====================================================

// Contract ↔ RentalOrder
Contract.hasMany(RentalOrder, {
  foreignKey: 'contractId',
  as: 'rentalOrders',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});
RentalOrder.belongsTo(Contract, {
  foreignKey: 'contractId',
  as: 'contract',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});

// RentalOrder ↔ RentalOrderItem
RentalOrder.hasMany(RentalOrderItem, {
  foreignKey: 'rentalOrderId',
  as: 'items',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
RentalOrderItem.belongsTo(RentalOrder, {
  foreignKey: 'rentalOrderId',
  as: 'order',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});

// RentalOrderItem ↔ RentalItem
RentalOrderItem.belongsTo(RentalItem, {
  foreignKey: 'rentalItemId',
  as: 'rentalItem',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});
RentalItem.hasMany(RentalOrderItem, {
  foreignKey: 'rentalItemId',
  as: 'orderItems',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});

// RentalOrder ↔ RentalOrderLog
RentalOrder.hasMany(RentalOrderLog, {
  foreignKey: 'rentalOrderId',
  as: 'logs',
  onDelete: 'SET NULL',
  onUpdate: 'CASCADE'
});
RentalOrderLog.belongsTo(RentalOrder, {
  foreignKey: 'rentalOrderId',
  as: 'order',
  onDelete: 'SET NULL',
  onUpdate: 'CASCADE'
});

// Contract ↔ RentalOrderLog (빠른 조회용)
Contract.hasMany(RentalOrderLog, {
  foreignKey: 'contractId',
  as: 'rentalLogs',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});
RentalOrderLog.belongsTo(Contract, {
  foreignKey: 'contractId',
  as: 'contract',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});

// RentalOrder ↔ RentalOrderRefundRequest
RentalOrder.hasMany(RentalOrderRefundRequest, {
  foreignKey: 'rentalOrderId',
  as: 'refundRequests',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});
RentalOrderRefundRequest.belongsTo(RentalOrder, {
  foreignKey: 'rentalOrderId',
  as: 'rentalOrder',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});

// Contract ↔ RentalOrderRefundRequest
Contract.hasMany(RentalOrderRefundRequest, {
  foreignKey: 'contractId',
  as: 'rentalRefundRequests',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});
RentalOrderRefundRequest.belongsTo(Contract, {
  foreignKey: 'contractId',
  as: 'contract',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});

// RentalItemReservation ↔ RentalOrder
RentalItemReservation.belongsTo(RentalOrder, {
  foreignKey: 'rentalOrderId',
  as: 'rentalOrder',
  onDelete: 'SET NULL',
  onUpdate: 'CASCADE'
});
RentalOrder.hasMany(RentalItemReservation, {
  foreignKey: 'rentalOrderId',
  as: 'reservations',
  onDelete: 'SET NULL',
  onUpdate: 'CASCADE'
});

// =====================================================
// RentalPayment 관계 설정 (렌탈 결제)
// =====================================================

// RentalOrder ↔ RentalPayment
RentalOrder.hasOne(RentalPayment, {
  foreignKey: 'rentalOrderId',
  as: 'payment',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});
RentalPayment.belongsTo(RentalOrder, {
  foreignKey: 'rentalOrderId',
  as: 'rentalOrder',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});

// Contract ↔ RentalPayment (조회 편의용)
Contract.hasMany(RentalPayment, {
  foreignKey: 'contractId',
  as: 'rentalPayments',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});
RentalPayment.belongsTo(Contract, {
  foreignKey: 'contractId',
  as: 'contract',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});

// RentalOrder ↔ RentalPaymentFailureLog
RentalOrder.hasMany(RentalPaymentFailureLog, {
  foreignKey: 'rentalOrderId',
  as: 'paymentFailureLogs',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});
RentalPaymentFailureLog.belongsTo(RentalOrder, {
  foreignKey: 'rentalOrderId',
  as: 'rentalOrder',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});

// Contract ↔ RentalPaymentFailureLog (조회 편의용)
Contract.hasMany(RentalPaymentFailureLog, {
  foreignKey: 'contractId',
  as: 'rentalPaymentFailureLogs',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});
RentalPaymentFailureLog.belongsTo(Contract, {
  foreignKey: 'contractId',
  as: 'contract',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});

// =====================================================
// Settlement 관계 설정 (정산)
// =====================================================
Contract.hasOne(Settlement, {
  foreignKey: 'contractId',
  as: 'settlement',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});
Settlement.belongsTo(Contract, {
  foreignKey: 'contractId',
  as: 'contract',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});

User.hasMany(Settlement, {
  foreignKey: 'hostId',
  as: 'settlements',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});
Settlement.belongsTo(User, {
  foreignKey: 'hostId',
  as: 'host',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});

// =====================================================
// Payout 관계 설정 (지급 관리)
// =====================================================
Contract.hasMany(Payout, {
  foreignKey: 'contractId',
  as: 'payouts',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});
Payout.belongsTo(Contract, {
  foreignKey: 'contractId',
  as: 'contract',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});

Settlement.hasMany(Payout, {
  foreignKey: 'settlementId',
  as: 'payouts',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});
Payout.belongsTo(Settlement, {
  foreignKey: 'settlementId',
  as: 'settlement',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});

Refund.hasMany(Payout, {
  foreignKey: 'refundId',
  as: 'payouts',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});
Payout.belongsTo(Refund, {
  foreignKey: 'refundId',
  as: 'refund',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});

User.hasMany(Payout, {
  foreignKey: 'recipientId',
  as: 'payouts',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});
Payout.belongsTo(User, {
  foreignKey: 'recipientId',
  as: 'recipient',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});

Admin.hasMany(Payout, {
  foreignKey: 'adminId',
  as: 'processedPayouts',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});
Payout.belongsTo(Admin, {
  foreignKey: 'adminId',
  as: 'processedByAdmin',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});

// PayoutLog 관계 설정
Payout.hasMany(PayoutLog, {
  foreignKey: 'payoutId',
  as: 'logs',
  onDelete: 'CASCADE'
});
PayoutLog.belongsTo(Payout, {
  foreignKey: 'payoutId',
  as: 'payout'
});
PayoutLog.belongsTo(Admin, {
  foreignKey: 'adminId',
  as: 'admin',
  onDelete: 'SET NULL'
});

// =====================================================
// DepositAgreement 관계 설정 (보증금 보류/합의 이력, 1:N)
// =====================================================
Contract.hasMany(DepositAgreement, {
  foreignKey: 'contractId',
  as: 'depositAgreements',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});
DepositAgreement.belongsTo(Contract, {
  foreignKey: 'contractId',
  as: 'contract',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});

// =====================================================
// GuestRefundAccount 관계 설정 (게스트 환급 계좌)
// =====================================================
User.hasOne(GuestRefundAccount, {
  foreignKey: 'userId',
  as: 'refundAccount',
  onDelete: 'NO ACTION', // 금융 정보 보존
  onUpdate: 'CASCADE'
});
GuestRefundAccount.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});

// =====================================================
// AlimtalkLog 관계 설정 (카카오 알림톡 발송 이력)
// =====================================================
User.hasMany(AlimtalkLog, {
  foreignKey: 'receiverId',
  as: 'alimtalkLogs',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});
AlimtalkLog.belongsTo(User, {
  foreignKey: 'receiverId',
  as: 'receiver',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});

// =====================================================
// Notification 관계 설정 (사용자 알림)
// =====================================================

// User ↔ Notification (Soft Reference - FK 제약 없음)
User.hasMany(Notification, {
  foreignKey: 'userId',
  as: 'notifications',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});
Notification.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});

// =====================================================
// ReceiptSetting 관계 설정 (사용자 영수증 발급 정보 설정)
// =====================================================
User.hasOne(ReceiptSetting, {
  foreignKey: 'userId',
  as: 'receiptSetting',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});
ReceiptSetting.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});

// =====================================================
// Receipt 관계 설정 (영수증 발급 건 관리)
// =====================================================
User.hasMany(Receipt, {
  foreignKey: 'userId',
  as: 'receipts',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});
Receipt.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});

Contract.hasMany(Receipt, {
  foreignKey: 'contractId',
  as: 'receipts',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});
Receipt.belongsTo(Contract, {
  foreignKey: 'contractId',
  as: 'contract',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});

Settlement.hasMany(Receipt, {
  foreignKey: 'settlementId',
  as: 'receipts',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});
Receipt.belongsTo(Settlement, {
  foreignKey: 'settlementId',
  as: 'settlement',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});

Receipt.belongsTo(Admin, {
  foreignKey: 'issuedBy',
  as: 'issuedByAdmin',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});
Admin.hasMany(Receipt, {
  foreignKey: 'issuedBy',
  as: 'issuedReceipts',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});

// =====================================================
// ContractCancelRequest 관계 설정 (임대중 취소요청)
// =====================================================
Contract.hasMany(ContractCancelRequest, {
  foreignKey: 'contractId',
  as: 'cancelRequests',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});
ContractCancelRequest.belongsTo(Contract, {
  foreignKey: 'contractId',
  as: 'contract',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});
ContractCancelRequest.belongsTo(User, {
  foreignKey: 'requesterUserId',
  as: 'requester',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});
ContractCancelRequest.belongsTo(Admin, {
  foreignKey: 'adminId',
  as: 'admin',
  onDelete: 'NO ACTION',
  onUpdate: 'CASCADE'
});

// =====================================================
// ServiceTask 관계 설정 (청소·침구류 예약 관리)
// =====================================================
Contract.hasMany(ServiceTask, {
  foreignKey: 'contractId',
  as: 'serviceTasks',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
ServiceTask.belongsTo(Contract, {
  foreignKey: 'contractId',
  as: 'contract',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
ServiceTask.hasMany(ServiceTaskLog, {
  foreignKey: 'serviceTaskId',
  as: 'logs',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
ServiceTaskLog.belongsTo(ServiceTask, {
  foreignKey: 'serviceTaskId',
  as: 'serviceTask'
});

module.exports = {
  sequelize,
  User,
  LocalUser,
  SocialUser,
  EmailVerificationCode,
  Admin,
  AdminActionLog,
  Room,
  RoomPhoto,
  RoomAmenity,
  EzService,
  UserBankAccount,
  RentalItem,
  Contract,
  ContractSequence,
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
  Refund,
  ContractStatusLog,
  Payment,
  PaymentFailureLog,
  BlockedPeriod,
  AutoMessageTemplate,
  NotificationLog,
  Notification,
  RentalOrder,
  RentalOrderItem,
  RentalOrderLog,
  RentalPayment,
  RentalPaymentFailureLog,
  Settlement,
  Payout,
  PayoutLog,
  DepositAgreement,
  GuestRefundAccount,
  AlimtalkLog,
  ReceiptSetting,
  Receipt,
  UserSession,
  AdminRefund,
  RentalOrderRefundRequest,
  ServiceTask,
  ServiceTaskLog,
  ContractCancelRequest,
  KmcVerification
};