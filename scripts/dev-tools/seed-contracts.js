#!/usr/bin/env node

/**
 * 계약 테스트 데이터 시더 (개발/테스트 환경 전용)
 *
 * 다양한 계약 상태별 시나리오를 한 번에 생성하며,
 * 각 상태에 필요한 관련 데이터(Payment, StatusLog, RentalOrder 등)를
 * 정합성 있게 함께 생성합니다.
 *
 * 사용법:
 *   npm run dev:seed-contracts                                    # 모든 시나리오 1개씩
 *   npm run dev:seed-contracts -- --scenario in_progress          # 특정 시나리오만
 *   npm run dev:seed-contracts -- --count 3                       # 시나리오당 3개씩
 *   npm run dev:seed-contracts -- --host 1708 --guest 1805        # 호스트/게스트 지정
 *   npm run dev:seed-contracts -- --host 1708 --guest 1805 --room 42
 *   npm run dev:seed-contracts -- --list                          # 시나리오 목록
 *   npm run dev:seed-contracts -- --clean                         # 시드 데이터 정리
 *   npm run dev:seed-contracts -- --dry-run                       # 미리보기
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// 프로덕션 환경 보호
if (process.env.NODE_ENV === 'production') {
  console.error('❌ 에러: 개발 도구는 프로덕션 환경에서 사용할 수 없습니다.');
  process.exit(1);
}

const {
  sequelize,
  User,
  Room,
  Contract,
  ContractStatusLog,
  Payment,
  Refund,
  RentalItem,
  RentalOrder,
  RentalOrderItem,
  RentalOrderLog,
  RentalItemReservation,
  RentalPayment,
  RefundPolicyType,
  RefundPolicyRule,
  ChatRoom,
  Settlement,
  DepositAgreement,
} = require('../../models');

const { Op } = require('sequelize');
const { createChatRoomMetadata } = require('../../config/firebaseAdmin');

// =====================================================
// 상수 & 유틸리티
// =====================================================

const SEED_PREFIX = 'SEED';

/** 날짜 헬퍼: 기준일에서 N일 후 */
function daysAfter(base, n) {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

/** 날짜 헬퍼: 기준일에서 N시간 후 */
function hoursAfter(base, n) {
  const d = new Date(base);
  d.setHours(d.getHours() + n);
  return d;
}

/** 랜덤 정수 */
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 시나리오별 현실적인 baseDate 생성
 *
 * buildContractData 기준:
 *   checkIn  = baseDate + 7일
 *   checkOut = baseDate + 37일 (30일 계약)
 *
 * 따라서:
 *   - 체크인 전 상태: baseDate를 미래로 → checkIn이 미래
 *   - 임대중 상태: checkIn < 오늘 < checkOut → baseDate = 오늘 - 20일 정도
 *   - 완료 상태: checkOut < 오늘 → baseDate를 충분히 과거로
 */
function getBaseDateForScenario(scenarioKey) {
  const now = new Date();
  switch (scenarioKey) {
    // 체크인 전 상태: checkIn이 미래여야 함
    case 'pending_approval':
      return daysAfter(now, randomInt(3, 14));       // 체크인: 10~21일 후
    case 'approved':
      return daysAfter(now, randomInt(1, 10));        // 체크인: 8~17일 후
    case 'payment_completed':
      return daysAfter(now, randomInt(-2, 7));        // 체크인: 5~14일 후
    case 'rejected':
      return daysAfter(now, randomInt(-3, 7));        // 거절은 시점 무관

    // 임대중: checkIn < 오늘 < checkOut
    case 'in_progress':
      return daysAfter(now, -randomInt(10, 25));      // 체크인: 3~18일 전, 체크아웃: 12~27일 후
    case 'in_progress_with_rental':
      return daysAfter(now, -randomInt(10, 25));      // 동일

    // 완료/취소: checkOut < 오늘
    case 'completed':
      return daysAfter(now, -38);                     // 체크아웃(baseDate+37): 어제
    case 'completed_with_full_rental':
      return daysAfter(now, -38);                     // 동일
    case 'cancelled_with_refund':
      return daysAfter(now, -randomInt(10, 40));      // 취소는 결제 후 발생

    default:
      return daysAfter(now, -(30 + randomInt(0, 60)));
  }
}

/** SEED orderId 생성 (Contract: STRING(11) → S + YYMMDD + 4자리 = 11자) */
function makeSeedOrderId(index) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const seq = String(index).padStart(4, '0');
  return `S${yy}${mm}${dd}${seq}`;
}

/** SEED 렌탈 orderId 생성 (RentalOrder: STRING(15) → S + YYMMDD + R + 4자리 = 13자) */
function makeSeedRentalOrderId(index) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const seq = String(index).padStart(4, '0');
  return `S${yy}${mm}${dd}R${seq}`;
}

/** mock 토스 paymentKey 생성 */
function mockPaymentKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = 'seed_mock_';
  for (let i = 0; i < 20; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// =====================================================
// 렌탈 아이템 & 환불정책 마스터 데이터
// =====================================================

const RENTAL_ITEMS_SEED = [
  { itemType: 'hair_dryer', name: '프리미엄 헤어드라이어', description: '다이슨 에어랩 스타일', price: 15000, totalStock: 50, availableStock: 50 },
  { itemType: 'bedding_set', name: '호텔급 침구 세트', description: '이집트산 면 600TC', price: 30000, totalStock: 100, availableStock: 100 },
  { itemType: 'amenity_kit', name: '프리미엄 어메니티 키트', description: '로레알 & 록시땅', price: 10000, totalStock: 200, availableStock: 200 },
  { itemType: 'towel_set', name: '수건 세트 (대+소)', description: '면 100% 호텔 타월', price: 8000, totalStock: 150, availableStock: 150 },
  { itemType: 'other', name: '블루투스 스피커', description: 'JBL 포터블 스피커', price: 5000, totalStock: 30, availableStock: 30 },
];

const REFUND_POLICIES_SEED = [
  {
    policyType: 'flexible',
    displayName: '유연한 환불 정책',
    description: '체크인 1일 전까지 전액 환불',
    isActive: true,
    rules: [
      { daysBeforeMin: 1, daysBeforeMax: null, refundRate: 100, description: '1일 전 이상: 100% 환불' },
      { daysBeforeMin: 0, daysBeforeMax: 0, refundRate: 50, isSameDayCancellation: true, description: '당일 취소: 50% 환불' },
    ]
  },
  {
    policyType: 'moderate',
    displayName: '보통 환불 정책',
    description: '체크인 7일 전까지 전액 환불',
    isActive: true,
    rules: [
      { daysBeforeMin: 7, daysBeforeMax: null, refundRate: 100, description: '7일 전 이상: 100% 환불' },
      { daysBeforeMin: 3, daysBeforeMax: 6, refundRate: 50, description: '3~6일 전: 50% 환불' },
      { daysBeforeMin: 0, daysBeforeMax: 2, refundRate: 0, description: '2일 이내: 환불 불가' },
    ]
  },
  {
    policyType: 'strict',
    displayName: '엄격한 환불 정책',
    description: '체크인 14일 전까지 전액 환불',
    isActive: true,
    rules: [
      { daysBeforeMin: 14, daysBeforeMax: null, refundRate: 100, description: '14일 전 이상: 100% 환불' },
      { daysBeforeMin: 7, daysBeforeMax: 13, refundRate: 50, description: '7~13일 전: 50% 환불' },
      { daysBeforeMin: 0, daysBeforeMax: 6, refundRate: 0, description: '6일 이내: 환불 불가' },
    ]
  },
];

async function ensureMasterData(transaction) {
  // 렌탈 아이템
  const existingItems = await RentalItem.count();
  let rentalItems;
  if (existingItems === 0) {
    rentalItems = await RentalItem.bulkCreate(RENTAL_ITEMS_SEED, { transaction });
    console.log(`  ✅ RentalItem ${rentalItems.length}건 생성`);
  } else {
    rentalItems = await RentalItem.findAll({ where: { isActive: true }, limit: 5 });
    console.log(`  ✅ RentalItem ${existingItems}건 (기존 존재)`);
  }

  // 환불정책
  const existingPolicies = await RefundPolicyType.count();
  if (existingPolicies === 0) {
    for (const policy of REFUND_POLICIES_SEED) {
      const { rules, ...policyData } = policy;
      await RefundPolicyType.create(policyData, { transaction });
      for (const rule of rules) {
        await RefundPolicyRule.create({
          policyType: policy.policyType,
          ...rule,
          isSameDayCancellation: rule.isSameDayCancellation || false,
        }, { transaction });
      }
    }
    console.log(`  ✅ RefundPolicy 3종 생성`);
  } else {
    console.log(`  ✅ RefundPolicy ${existingPolicies}종 (기존 존재)`);
  }

  return rentalItems;
}

// =====================================================
// 시나리오 정의
// =====================================================

/**
 * 공통 Contract 데이터 생성
 */
function buildContractData(orderId, hostId, guestId, roomId, baseDate, overrides = {}) {
  const checkIn = daysAfter(baseDate, 7);
  const checkOut = daysAfter(baseDate, 37); // 30일 계약
  const totalDays = 30;
  const totalWeeks = 4;

  const rentalFee = 900000;       // 임대료
  const maintenanceFee = 150000;  // 관리비
  const cleaningFee = 50000;      // 청소비
  const rentalItemsFee = overrides.rentalItemsFee || 0;
  const platformFee = 50000;      // 수수료
  const discountAmount = 0;

  // subtotal, totalUsageFee는 Contract 모델 VIRTUAL getter가 자동 계산
  const deposit = 500000;
  const finalTotalAmount =
    (rentalFee + maintenanceFee + cleaningFee + rentalItemsFee) - discountAmount + platformFee + deposit;

  return {
    orderId,
    roomId,
    hostId,
    guestId,
    checkInDate: checkIn,
    checkOutDate: checkOut,
    totalDays,
    totalWeeks,
    rentalFee,
    maintenanceFee,
    cleaningFee,
    rentalItemsFee,
    platformFee,
    discountAmount,
    discountType: 'NONE',
    deposit,
    finalTotalAmount,
    paymentMethod: 'CREDIT_CARD',
    installmentMonths: 0,
    guestMessage: `[SEED] 테스트 계약 데이터`,
    termsAgreed: JSON.stringify({ service: true, privacy: true, refund: true }),
    specialRequests: JSON.stringify({ earlyCheckin: false, lateCheckout: false }),
    pricingSnapshot: JSON.stringify({ weeklyRent: 225000, dailyMaintenance: 5000, cleaningFee: 50000 }),
    refundPolicyType: 'flexible',
    refundPolicySnapshot: JSON.stringify(REFUND_POLICIES_SEED[0]),
    status: 'PENDING_APPROVAL',
    ...overrides,
  };
}

/**
 * ContractStatusLog 생성 헬퍼
 */
async function createStatusLog(contractId, fromStatus, toStatus, changedBy, changedByUserId, createdAt, transaction, extra = {}) {
  return await ContractStatusLog.create({
    contractId,
    fromStatus,
    toStatus,
    changedBy,
    changedByUserId,
    reason: extra.reason || null,
    metadata: extra.metadata || null,
    ipAddress: '127.0.0.1',
    userAgent: 'seed-contracts-cli/1.0',
    createdAt,
  }, { transaction });
}

/**
 * ChatRoom 생성 헬퍼 (승인된 계약에 채팅방 추가)
 */
async function createChatRoom(contractId, hostId, guestId, roomId, createdAt, isActive, transaction) {
  const firebaseChatRoomId = `contract_${contractId}`;

  await ChatRoom.create({
    contractId,
    firebaseChatRoomId,
    hostId,
    guestId,
    roomId,
    isActive,
    lastMessageAt: createdAt,
    createdAt,
  }, { transaction });

  // Firestore 메타데이터 생성 (트랜잭션 외부에서 실행)
  try {
    const [host, guest, room] = await Promise.all([
      User.findByPk(hostId, { attributes: ['id', 'name', 'nickname', 'profileImageUrl'] }),
      User.findByPk(guestId, { attributes: ['id', 'name', 'nickname', 'profileImageUrl'] }),
      Room.findByPk(roomId, { attributes: ['roomName', 'address'] }),
    ]);

    await createChatRoomMetadata(firebaseChatRoomId, {
      contractId,
      hostId,
      guestId,
      roomId,
      roomInfo: { name: room?.roomName || '', address: room?.address || '' },
      hostInfo: { id: host?.id, name: host?.name, nickname: host?.nickname, profileImageUrl: host?.profileImageUrl || null },
      guestInfo: { id: guest?.id, name: guest?.name, nickname: guest?.nickname, profileImageUrl: guest?.profileImageUrl || null },
      isActive,
    });
  } catch (err) {
    console.warn(`⚠️ Firestore 채팅방 메타데이터 생성 실패 (contract_${contractId}):`, err.message);
  }
}

/**
 * Payment 생성 헬퍼
 */
async function createPayment(contractId, orderId, totalAmount, requestedAt, approvedAt, status, transaction) {
  const suppliedAmount = Math.round(totalAmount / 1.1);
  const vat = totalAmount - suppliedAmount;
  return await Payment.create({
    contractId,
    paymentKey: mockPaymentKey(),
    orderId,
    method: 'CARD',
    status,
    requestedAt,
    approvedAt: status === 'DONE' ? approvedAt : null,
    totalAmount,
    balanceAmount: status === 'DONE' ? totalAmount : (status === 'CANCELED' ? 0 : totalAmount),
    suppliedAmount,
    vat,
    taxFreeAmount: 0,
    currency: 'KRW',
    receiptUrl: `https://mock-receipt.toss.im/${orderId}`,
    paymentResponse: { mock: true, status },
  }, { transaction });
}

// =====================================================
// 시나리오 구현
// =====================================================

const SCENARIOS = {
  /**
   * 1. 승인 대기
   */
  pending_approval: {
    label: '승인 대기 (PENDING_APPROVAL)',
    description: 'Contract만 생성, 로그 1건',
    needsRental: false,
    async create(ctx) {
      const { orderId, hostId, guestId, roomId, baseDate, transaction } = ctx;
      const contract = await Contract.create(
        buildContractData(orderId, hostId, guestId, roomId, baseDate),
        { transaction }
      );
      await createStatusLog(contract.id, null, 'PENDING_APPROVAL', 'GUEST', guestId, baseDate, transaction);
      return { contract, logs: 1 };
    }
  },

  /**
   * 2. 승인됨 (결제 대기)
   */
  approved: {
    label: '승인됨 (APPROVED)',
    description: 'Contract + StatusLog 2건',
    needsRental: false,
    async create(ctx) {
      const { orderId, hostId, guestId, roomId, baseDate, transaction } = ctx;
      const approvedAt = daysAfter(baseDate, 1);
      const contract = await Contract.create(
        buildContractData(orderId, hostId, guestId, roomId, baseDate, {
          status: 'APPROVED',
          approvedAt,
        }),
        { transaction }
      );
      await createStatusLog(contract.id, null, 'PENDING_APPROVAL', 'GUEST', guestId, baseDate, transaction);
      await createStatusLog(contract.id, 'PENDING_APPROVAL', 'APPROVED', 'HOST', hostId, approvedAt, transaction);
      await createChatRoom(contract.id, hostId, guestId, roomId, approvedAt, true, transaction);
      return { contract, logs: 2, chatRooms: 1 };
    }
  },

  /**
   * 3. 결제 완료
   */
  payment_completed: {
    label: '결제 완료 (PAYMENT_COMPLETED)',
    description: 'Contract + Payment(DONE) + StatusLog 3건',
    needsRental: false,
    async create(ctx) {
      const { orderId, hostId, guestId, roomId, baseDate, transaction } = ctx;
      const approvedAt = daysAfter(baseDate, 1);
      const paidAt = daysAfter(baseDate, 2);

      const contractData = buildContractData(orderId, hostId, guestId, roomId, baseDate, {
        status: 'PAYMENT_COMPLETED',
        approvedAt,
        paidAt,
      });
      const contract = await Contract.create(contractData, { transaction });

      await createStatusLog(contract.id, null, 'PENDING_APPROVAL', 'GUEST', guestId, baseDate, transaction);
      await createStatusLog(contract.id, 'PENDING_APPROVAL', 'APPROVED', 'HOST', hostId, approvedAt, transaction);
      await createStatusLog(contract.id, 'APPROVED', 'PAYMENT_COMPLETED', 'SYSTEM', null, paidAt, transaction);

      await createPayment(contract.id, orderId, contractData.finalTotalAmount, approvedAt, paidAt, 'DONE', transaction);
      await createChatRoom(contract.id, hostId, guestId, roomId, approvedAt, true, transaction);

      return { contract, logs: 3, payments: 1, chatRooms: 1 };
    }
  },

  /**
   * 4. 임대중 (IN_PROGRESS)
   */
  in_progress: {
    label: '임대중 (IN_PROGRESS)',
    description: 'Contract + Payment(DONE) + StatusLog 4건',
    needsRental: false,
    async create(ctx) {
      const { orderId, hostId, guestId, roomId, baseDate, transaction } = ctx;
      const approvedAt = daysAfter(baseDate, 1);
      const paidAt = daysAfter(baseDate, 2);
      const checkedInAt = daysAfter(baseDate, 7);

      const contractData = buildContractData(orderId, hostId, guestId, roomId, baseDate, {
        status: 'IN_PROGRESS',
        approvedAt,
        paidAt,
        checkedInAt,
      });
      const contract = await Contract.create(contractData, { transaction });

      await createStatusLog(contract.id, null, 'PENDING_APPROVAL', 'GUEST', guestId, baseDate, transaction);
      await createStatusLog(contract.id, 'PENDING_APPROVAL', 'APPROVED', 'HOST', hostId, approvedAt, transaction);
      await createStatusLog(contract.id, 'APPROVED', 'PAYMENT_COMPLETED', 'SYSTEM', null, paidAt, transaction);
      await createStatusLog(contract.id, 'PAYMENT_COMPLETED', 'IN_PROGRESS', 'SYSTEM', null, checkedInAt, transaction);

      await createPayment(contract.id, orderId, contractData.finalTotalAmount, approvedAt, paidAt, 'DONE', transaction);
      await createChatRoom(contract.id, hostId, guestId, roomId, approvedAt, true, transaction);

      return { contract, logs: 4, payments: 1, chatRooms: 1 };
    }
  },

  /**
   * 5. 계약 완료 (COMPLETED)
   */
  completed: {
    label: '계약 완료 (COMPLETED)',
    description: 'Contract + Payment(DONE) + StatusLog 5건',
    needsRental: false,
    async create(ctx) {
      const { orderId, hostId, guestId, roomId, baseDate, transaction } = ctx;
      const approvedAt = daysAfter(baseDate, 1);
      const paidAt = daysAfter(baseDate, 2);
      const checkedInAt = daysAfter(baseDate, 7);
      const checkedOutAt = daysAfter(baseDate, 37);

      const contractData = buildContractData(orderId, hostId, guestId, roomId, baseDate, {
        status: 'COMPLETED',
        approvedAt,
        paidAt,
        checkedInAt,
        checkedOutAt,
      });
      const contract = await Contract.create(contractData, { transaction });

      await createStatusLog(contract.id, null, 'PENDING_APPROVAL', 'GUEST', guestId, baseDate, transaction);
      await createStatusLog(contract.id, 'PENDING_APPROVAL', 'APPROVED', 'HOST', hostId, approvedAt, transaction);
      await createStatusLog(contract.id, 'APPROVED', 'PAYMENT_COMPLETED', 'SYSTEM', null, paidAt, transaction);
      await createStatusLog(contract.id, 'PAYMENT_COMPLETED', 'IN_PROGRESS', 'SYSTEM', null, checkedInAt, transaction);
      await createStatusLog(contract.id, 'IN_PROGRESS', 'COMPLETED', 'SYSTEM', null, checkedOutAt, transaction);

      await createPayment(contract.id, orderId, contractData.finalTotalAmount, approvedAt, paidAt, 'DONE', transaction);
      await createChatRoom(contract.id, hostId, guestId, roomId, approvedAt, false, transaction);

      return { contract, logs: 5, payments: 1, chatRooms: 1 };
    }
  },

  /**
   * 6. 거절됨 (REJECTED)
   */
  rejected: {
    label: '거절됨 (REJECTED)',
    description: 'Contract + StatusLog 2건',
    needsRental: false,
    async create(ctx) {
      const { orderId, hostId, guestId, roomId, baseDate, transaction } = ctx;
      const rejectedAt = daysAfter(baseDate, 1);

      const contract = await Contract.create(
        buildContractData(orderId, hostId, guestId, roomId, baseDate, {
          status: 'REJECTED',
          rejectedAt,
          hostMessage: '죄송합니다. 해당 기간에 이미 예약이 있습니다.',
          cancellationReason: '기간 중복',
        }),
        { transaction }
      );

      await createStatusLog(contract.id, null, 'PENDING_APPROVAL', 'GUEST', guestId, baseDate, transaction);
      await createStatusLog(contract.id, 'PENDING_APPROVAL', 'REJECTED', 'HOST', hostId, rejectedAt, transaction, {
        reason: '기간 중복',
      });

      return { contract, logs: 2 };
    }
  },

  /**
   * 7. 게스트 취소 + 환불 완료
   */
  cancelled_with_refund: {
    label: '게스트 취소 + 환불 (CANCELLED_BY_GUEST)',
    description: 'Contract + Payment(CANCELED) + Refund(COMPLETED) + StatusLog 5건',
    needsRental: false,
    async create(ctx) {
      const { orderId, hostId, guestId, roomId, baseDate, transaction } = ctx;
      const approvedAt = daysAfter(baseDate, 1);
      const paidAt = daysAfter(baseDate, 2);
      const cancelledAt = daysAfter(baseDate, 3);

      const contractData = buildContractData(orderId, hostId, guestId, roomId, baseDate, {
        status: 'CANCELLED_BY_GUEST',
        approvedAt,
        paidAt,
        cancelledAt,
        cancellationType: 'AFTER_PAYMENT',
        cancellationReason: '개인 사정으로 취소합니다.',
      });
      const contract = await Contract.create(contractData, { transaction });

      // StatusLogs
      await createStatusLog(contract.id, null, 'PENDING_APPROVAL', 'GUEST', guestId, baseDate, transaction);
      await createStatusLog(contract.id, 'PENDING_APPROVAL', 'APPROVED', 'HOST', hostId, approvedAt, transaction);
      await createStatusLog(contract.id, 'APPROVED', 'PAYMENT_COMPLETED', 'SYSTEM', null, paidAt, transaction);
      await createStatusLog(contract.id, 'PAYMENT_COMPLETED', 'CANCELLED_BY_GUEST', 'GUEST', guestId, cancelledAt, transaction, {
        reason: '개인 사정으로 취소합니다.',
      });
      await createStatusLog(contract.id, 'CANCELLED_BY_GUEST', 'REFUNDED', 'SYSTEM', null, hoursAfter(cancelledAt, 1), transaction);

      // Payment (취소됨)
      await createPayment(contract.id, orderId, contractData.finalTotalAmount, approvedAt, paidAt, 'CANCELED', transaction);

      // Refund (완료)
      const daysBeforeCheckin = 4; // 체크인 7일 전 기준, 취소일 D+3이면 4일 전
      const refundRate = 100; // flexible 정책: 1일 전 이상 100%
      const rentalFeeRefund = Math.round(contractData.rentalFee * refundRate / 100);
      const totalRefund = rentalFeeRefund + contractData.cleaningFee + contractData.maintenanceFee;
      const finalRefund = totalRefund - contractData.platformFee;

      await Refund.create({
        contractId: contract.id,
        refundStatus: 'COMPLETED',
        policyTypeUsed: 'flexible',
        cancellationDate: cancelledAt,
        checkInDate: contractData.checkInDate,
        daysBeforeCheckin,
        originalRentalFee: contractData.rentalFee,
        originalCleaningFee: contractData.cleaningFee,
        originalMaintenanceFee: contractData.maintenanceFee,
        originalTotalAmount: contractData.finalTotalAmount,
        rentalFeeRefundRate: refundRate,
        rentalFeeRefundAmount: rentalFeeRefund,
        cleaningFeeRefundAmount: contractData.cleaningFee,
        maintenanceFeeRefundAmount: contractData.maintenanceFee,
        totalRefundAmount: totalRefund,
        platformFeeDeducted: contractData.platformFee,
        penaltyAmount: 0,
        finalRefundAmount: finalRefund,
        refundMethod: 'ORIGINAL_PAYMENT',
        cancellationReason: '개인 사정으로 취소합니다.',
        requestedAt: cancelledAt,
        approvedAt: hoursAfter(cancelledAt, 1),
        completedAt: hoursAfter(cancelledAt, 1),
      }, { transaction });

      // 최종 상태를 REFUNDED로 업데이트
      await contract.update({ status: 'REFUNDED' }, { transaction });

      // ChatRoom (취소됨 → 비활성)
      await createChatRoom(contract.id, hostId, guestId, roomId, approvedAt, false, transaction);

      return { contract, logs: 5, payments: 1, refunds: 1, chatRooms: 1 };
    }
  },

  /**
   * 8. 임대중 + 렌탈 아이템 주문 (INITIAL)
   */
  in_progress_with_rental: {
    label: '임대중 + 렌탈 주문 (IN_PROGRESS + RentalOrder)',
    description: 'Contract + Payment + RentalOrder(PAID) + Items + Reservation + RentalPayment + Logs',
    needsRental: true,
    async create(ctx) {
      const { orderId, hostId, guestId, roomId, baseDate, transaction, rentalItems, rentalOrderSeq } = ctx;
      const approvedAt = daysAfter(baseDate, 1);
      const paidAt = daysAfter(baseDate, 2);
      const checkedInAt = daysAfter(baseDate, 7);

      // 렌탈 아이템 2개 선택
      const selectedItems = rentalItems.slice(0, 2);
      const rentalItemsFee = selectedItems.reduce((sum, item) => sum + Number(item.price), 0);

      const contractData = buildContractData(orderId, hostId, guestId, roomId, baseDate, {
        status: 'IN_PROGRESS',
        approvedAt,
        paidAt,
        checkedInAt,
        rentalItemsFee,
        rentalItems: JSON.stringify(selectedItems.map(i => ({ id: i.id, name: i.name, price: Number(i.price), quantity: 1 }))),
      });
      // finalTotalAmount 재계산 (subtotal/totalUsageFee는 VIRTUAL)
      contractData.rentalItemsFee = rentalItemsFee;
      contractData.finalTotalAmount =
        (contractData.rentalFee + contractData.maintenanceFee + contractData.cleaningFee + rentalItemsFee)
        - contractData.discountAmount + contractData.platformFee + contractData.deposit;

      const contract = await Contract.create(contractData, { transaction });

      // StatusLogs
      await createStatusLog(contract.id, null, 'PENDING_APPROVAL', 'GUEST', guestId, baseDate, transaction);
      await createStatusLog(contract.id, 'PENDING_APPROVAL', 'APPROVED', 'HOST', hostId, approvedAt, transaction);
      await createStatusLog(contract.id, 'APPROVED', 'PAYMENT_COMPLETED', 'SYSTEM', null, paidAt, transaction);
      await createStatusLog(contract.id, 'PAYMENT_COMPLETED', 'IN_PROGRESS', 'SYSTEM', null, checkedInAt, transaction);

      // 계약 결제
      await createPayment(contract.id, orderId, contractData.finalTotalAmount, approvedAt, paidAt, 'DONE', transaction);

      // 렌탈 주문
      const rentalOrderId = makeSeedRentalOrderId(rentalOrderSeq);
      const rentalTotalAmount = rentalItemsFee;
      const checkIn = contractData.checkInDate;
      const modifiableUntil = new Date(checkIn);
      modifiableUntil.setDate(modifiableUntil.getDate() - 5);
      modifiableUntil.setHours(23, 59, 59, 999);

      const rentalOrder = await RentalOrder.create({
        contractId: contract.id,
        orderId: rentalOrderId,
        orderType: 'INITIAL',
        totalAmount: rentalTotalAmount,
        paidAmount: rentalTotalAmount,
        refundedAmount: 0,
        status: 'PAID',
        paymentKey: mockPaymentKey(),
        paymentMethod: 'CARD',
        paidAt,
        modifiableUntil,
        itemsSnapshot: selectedItems.map(i => ({ id: i.id, name: i.name, price: Number(i.price), quantity: 1 })),
      }, { transaction });

      // RentalOrderItems
      const orderItems = [];
      for (const item of selectedItems) {
        const orderItem = await RentalOrderItem.create({
          rentalOrderId: rentalOrder.id,
          rentalItemId: item.id,
          quantity: 1,
          pricePerItem: Number(item.price),
          totalPrice: Number(item.price),
          status: 'ACTIVE',
        }, { transaction });
        orderItems.push(orderItem);
      }

      // RentalItemReservations
      for (let i = 0; i < selectedItems.length; i++) {
        await RentalItemReservation.create({
          contractId: contract.id,
          rentalOrderId: rentalOrder.id,
          rentalOrderItemId: orderItems[i].id,
          rentalItemId: selectedItems[i].id,
          quantity: 1,
          pricePerItem: Number(selectedItems[i].price),
          totalPrice: Number(selectedItems[i].price),
          reservedFrom: contractData.checkInDate,
          reservedUntil: contractData.checkOutDate,
          status: 'CONFIRMED',
        }, { transaction });
      }

      // RentalPayment
      await RentalPayment.create({
        rentalOrderId: rentalOrder.id,
        contractId: contract.id,
        paymentKey: mockPaymentKey(),
        orderId: rentalOrderId,
        method: 'CARD',
        status: 'DONE',
        requestedAt: paidAt,
        approvedAt: paidAt,
        totalAmount: rentalTotalAmount,
        balanceAmount: rentalTotalAmount,
        suppliedAmount: Math.round(rentalTotalAmount / 1.1),
        vat: rentalTotalAmount - Math.round(rentalTotalAmount / 1.1),
        taxFreeAmount: 0,
        currency: 'KRW',
        paymentResponse: { mock: true, status: 'DONE' },
      }, { transaction });

      // RentalOrderLogs
      await RentalOrderLog.create({
        contractId: contract.id,
        rentalOrderId: rentalOrder.id,
        action: 'ORDER_CREATED',
        actor: 'GUEST',
        actorId: guestId,
        amountChange: 0,
        balanceAfter: 0,
        description: '렌탈 주문 생성',
        ipAddress: '127.0.0.1',
        createdAt: paidAt,
      }, { transaction });

      await RentalOrderLog.create({
        contractId: contract.id,
        rentalOrderId: rentalOrder.id,
        action: 'PAYMENT_COMPLETED',
        actor: 'SYSTEM',
        amountChange: rentalTotalAmount,
        balanceAfter: rentalTotalAmount,
        description: '렌탈 결제 완료',
        ipAddress: '127.0.0.1',
        createdAt: paidAt,
      }, { transaction });

      // ChatRoom (임대중 → 활성)
      await createChatRoom(contract.id, hostId, guestId, roomId, approvedAt, true, transaction);

      return {
        contract, logs: 4, payments: 1, chatRooms: 1,
        rentalOrders: 1, rentalOrderItems: selectedItems.length,
        rentalReservations: selectedItems.length, rentalPayments: 1, rentalLogs: 2,
      };
    }
  },

  /**
   * 9. 완료 + 렌탈 INITIAL + ADDITIONAL (부분환불 포함)
   */
  completed_with_full_rental: {
    label: '완료 + 렌탈 2건 (COMPLETED + INITIAL + ADDITIONAL)',
    description: 'Contract + Payment + RentalOrder x2 + 부분환불 이력 포함',
    needsRental: true,
    async create(ctx) {
      const { orderId, hostId, guestId, roomId, baseDate, transaction, rentalItems, rentalOrderSeq } = ctx;
      const approvedAt = daysAfter(baseDate, 1);
      const paidAt = daysAfter(baseDate, 2);
      const checkedInAt = daysAfter(baseDate, 7);
      const checkedOutAt = daysAfter(baseDate, 37);
      const additionalOrderDate = daysAfter(baseDate, 15);

      // 초기 렌탈: 2개 아이템
      const initialItems = rentalItems.slice(0, 2);
      const initialRentalFee = initialItems.reduce((sum, item) => sum + Number(item.price), 0);

      // 추가 렌탈: 1개 아이템 (나중에 부분취소됨)
      const additionalItems = rentalItems.slice(2, 4);
      const additionalRentalFee = additionalItems.reduce((sum, item) => sum + Number(item.price), 0);
      const cancelledItem = additionalItems[1]; // 마지막 아이템 취소
      const cancelledAmount = cancelledItem ? Number(cancelledItem.price) : 0;

      const totalRentalFee = initialRentalFee + additionalRentalFee - cancelledAmount;

      const contractData = buildContractData(orderId, hostId, guestId, roomId, baseDate, {
        status: 'COMPLETED',
        approvedAt,
        paidAt,
        checkedInAt,
        checkedOutAt,
        rentalItemsFee: totalRentalFee,
      });
      // finalTotalAmount 재계산 (subtotal/totalUsageFee는 VIRTUAL)
      contractData.rentalItemsFee = totalRentalFee;
      contractData.finalTotalAmount =
        (contractData.rentalFee + contractData.maintenanceFee + contractData.cleaningFee + totalRentalFee)
        - contractData.discountAmount + contractData.platformFee + contractData.deposit;

      const contract = await Contract.create(contractData, { transaction });

      // StatusLogs (5건)
      await createStatusLog(contract.id, null, 'PENDING_APPROVAL', 'GUEST', guestId, baseDate, transaction);
      await createStatusLog(contract.id, 'PENDING_APPROVAL', 'APPROVED', 'HOST', hostId, approvedAt, transaction);
      await createStatusLog(contract.id, 'APPROVED', 'PAYMENT_COMPLETED', 'SYSTEM', null, paidAt, transaction);
      await createStatusLog(contract.id, 'PAYMENT_COMPLETED', 'IN_PROGRESS', 'SYSTEM', null, checkedInAt, transaction);
      await createStatusLog(contract.id, 'IN_PROGRESS', 'COMPLETED', 'SYSTEM', null, checkedOutAt, transaction);

      // 계약 결제
      await createPayment(contract.id, orderId, contractData.finalTotalAmount, approvedAt, paidAt, 'DONE', transaction);

      const checkIn = contractData.checkInDate;
      const modifiableUntil = new Date(checkIn);
      modifiableUntil.setDate(modifiableUntil.getDate() - 5);
      modifiableUntil.setHours(23, 59, 59, 999);

      // --- INITIAL 렌탈 주문 ---
      const initialOrderId = makeSeedRentalOrderId(rentalOrderSeq);
      const initialOrder = await RentalOrder.create({
        contractId: contract.id,
        orderId: initialOrderId,
        orderType: 'INITIAL',
        totalAmount: initialRentalFee,
        paidAmount: initialRentalFee,
        refundedAmount: 0,
        status: 'PAID',
        paymentKey: mockPaymentKey(),
        paymentMethod: 'CARD',
        paidAt,
        modifiableUntil,
        itemsSnapshot: initialItems.map(i => ({ id: i.id, name: i.name, price: Number(i.price), quantity: 1 })),
      }, { transaction });

      const initialOrderItems = [];
      for (const item of initialItems) {
        const oi = await RentalOrderItem.create({
          rentalOrderId: initialOrder.id,
          rentalItemId: item.id,
          quantity: 1,
          pricePerItem: Number(item.price),
          totalPrice: Number(item.price),
          status: 'ACTIVE',
        }, { transaction });
        initialOrderItems.push(oi);
      }

      for (let i = 0; i < initialItems.length; i++) {
        await RentalItemReservation.create({
          contractId: contract.id,
          rentalOrderId: initialOrder.id,
          rentalOrderItemId: initialOrderItems[i].id,
          rentalItemId: initialItems[i].id,
          quantity: 1,
          pricePerItem: Number(initialItems[i].price),
          totalPrice: Number(initialItems[i].price),
          reservedFrom: contractData.checkInDate,
          reservedUntil: contractData.checkOutDate,
          status: 'COMPLETED',
        }, { transaction });
      }

      await RentalPayment.create({
        rentalOrderId: initialOrder.id,
        contractId: contract.id,
        paymentKey: mockPaymentKey(),
        orderId: initialOrderId,
        method: 'CARD',
        status: 'DONE',
        requestedAt: paidAt,
        approvedAt: paidAt,
        totalAmount: initialRentalFee,
        balanceAmount: initialRentalFee,
        suppliedAmount: Math.round(initialRentalFee / 1.1),
        vat: initialRentalFee - Math.round(initialRentalFee / 1.1),
        taxFreeAmount: 0,
        currency: 'KRW',
        paymentResponse: { mock: true, status: 'DONE' },
      }, { transaction });

      // INITIAL 로그
      await RentalOrderLog.create({
        contractId: contract.id, rentalOrderId: initialOrder.id,
        action: 'ORDER_CREATED', actor: 'GUEST', actorId: guestId,
        amountChange: 0, balanceAfter: 0, description: '초기 렌탈 주문 생성',
        ipAddress: '127.0.0.1', createdAt: paidAt,
      }, { transaction });
      await RentalOrderLog.create({
        contractId: contract.id, rentalOrderId: initialOrder.id,
        action: 'PAYMENT_COMPLETED', actor: 'SYSTEM',
        amountChange: initialRentalFee, balanceAfter: initialRentalFee, description: '초기 렌탈 결제 완료',
        ipAddress: '127.0.0.1', createdAt: paidAt,
      }, { transaction });

      // --- ADDITIONAL 렌탈 주문 (부분환불 포함) ---
      const additionalOrderId = makeSeedRentalOrderId(rentalOrderSeq + 1);
      const additionalPaidAt = additionalOrderDate;

      const additionalOrder = await RentalOrder.create({
        contractId: contract.id,
        orderId: additionalOrderId,
        orderType: 'ADDITIONAL',
        totalAmount: additionalRentalFee,
        paidAmount: additionalRentalFee,
        refundedAmount: cancelledAmount,
        status: cancelledAmount > 0 ? 'PARTIAL_REFUND' : 'PAID',
        paymentKey: mockPaymentKey(),
        paymentMethod: 'CARD',
        paidAt: additionalPaidAt,
        modifiableUntil, // 이미 지남
        itemsSnapshot: additionalItems.map(i => ({ id: i.id, name: i.name, price: Number(i.price), quantity: 1 })),
      }, { transaction });

      const additionalOrderItems = [];
      for (let i = 0; i < additionalItems.length; i++) {
        const item = additionalItems[i];
        const isCancelled = cancelledItem && item.id === cancelledItem.id;
        const oi = await RentalOrderItem.create({
          rentalOrderId: additionalOrder.id,
          rentalItemId: item.id,
          quantity: 1,
          pricePerItem: Number(item.price),
          totalPrice: Number(item.price),
          status: isCancelled ? 'CANCELLED' : 'ACTIVE',
          cancelledAt: isCancelled ? daysAfter(additionalPaidAt, 2) : null,
          refundAmount: isCancelled ? Number(item.price) : null,
          cancelReason: isCancelled ? '필요 없어졌습니다' : null,
        }, { transaction });
        additionalOrderItems.push(oi);
      }

      for (let i = 0; i < additionalItems.length; i++) {
        const item = additionalItems[i];
        const isCancelled = cancelledItem && item.id === cancelledItem.id;
        await RentalItemReservation.create({
          contractId: contract.id,
          rentalOrderId: additionalOrder.id,
          rentalOrderItemId: additionalOrderItems[i].id,
          rentalItemId: item.id,
          quantity: 1,
          pricePerItem: Number(item.price),
          totalPrice: Number(item.price),
          reservedFrom: additionalPaidAt,
          reservedUntil: contractData.checkOutDate,
          status: isCancelled ? 'CANCELLED' : 'COMPLETED',
        }, { transaction });
      }

      await RentalPayment.create({
        rentalOrderId: additionalOrder.id,
        contractId: contract.id,
        paymentKey: mockPaymentKey(),
        orderId: additionalOrderId,
        method: 'CARD',
        status: cancelledAmount > 0 ? 'PARTIAL_CANCELED' : 'DONE',
        requestedAt: additionalPaidAt,
        approvedAt: additionalPaidAt,
        totalAmount: additionalRentalFee,
        balanceAmount: additionalRentalFee - cancelledAmount,
        suppliedAmount: Math.round(additionalRentalFee / 1.1),
        vat: additionalRentalFee - Math.round(additionalRentalFee / 1.1),
        taxFreeAmount: 0,
        currency: 'KRW',
        paymentResponse: { mock: true, status: cancelledAmount > 0 ? 'PARTIAL_CANCELED' : 'DONE' },
      }, { transaction });

      // ADDITIONAL 로그들
      await RentalOrderLog.create({
        contractId: contract.id, rentalOrderId: additionalOrder.id,
        action: 'ORDER_CREATED', actor: 'GUEST', actorId: guestId,
        amountChange: 0, balanceAfter: initialRentalFee, description: '추가 렌탈 주문 생성',
        ipAddress: '127.0.0.1', createdAt: additionalPaidAt,
      }, { transaction });
      await RentalOrderLog.create({
        contractId: contract.id, rentalOrderId: additionalOrder.id,
        action: 'PAYMENT_COMPLETED', actor: 'SYSTEM',
        amountChange: additionalRentalFee, balanceAfter: initialRentalFee + additionalRentalFee,
        description: '추가 렌탈 결제 완료',
        ipAddress: '127.0.0.1', createdAt: additionalPaidAt,
      }, { transaction });

      if (cancelledAmount > 0) {
        await RentalOrderLog.create({
          contractId: contract.id, rentalOrderId: additionalOrder.id,
          rentalOrderItemId: additionalOrderItems[additionalOrderItems.length - 1].id,
          action: 'ITEM_CANCELLED', actor: 'GUEST', actorId: guestId,
          amountChange: -cancelledAmount, balanceAfter: initialRentalFee + additionalRentalFee - cancelledAmount,
          description: `아이템 취소: ${cancelledItem.name}`,
          ipAddress: '127.0.0.1', createdAt: daysAfter(additionalPaidAt, 2),
        }, { transaction });
        await RentalOrderLog.create({
          contractId: contract.id, rentalOrderId: additionalOrder.id,
          action: 'REFUND_COMPLETED', actor: 'SYSTEM',
          amountChange: -cancelledAmount, balanceAfter: initialRentalFee + additionalRentalFee - cancelledAmount,
          description: `부분 환불 완료: ${cancelledAmount}원`,
          ipAddress: '127.0.0.1', createdAt: daysAfter(additionalPaidAt, 2),
        }, { transaction });
      }

      const totalRentalLogs = cancelledAmount > 0 ? 6 : 4;

      // ChatRoom (완료 → 비활성)
      await createChatRoom(contract.id, hostId, guestId, roomId, approvedAt, false, transaction);

      return {
        contract, logs: 5, payments: 1, chatRooms: 1,
        rentalOrders: 2,
        rentalOrderItems: initialItems.length + additionalItems.length,
        rentalReservations: initialItems.length + additionalItems.length,
        rentalPayments: 2,
        rentalLogs: totalRentalLogs,
      };
    }
  },
};

// =====================================================
// CLI 파싱
// =====================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    command: 'seed',
    scenario: null,
    count: 1,
    hostId: null,
    guestId: null,
    roomId: null,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === 'seed') opts.command = 'seed';
    else if (arg === 'clean') opts.command = 'clean';
    else if (arg === '--list') opts.command = 'list';
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--help' || arg === '-h') opts.command = 'help';
    else if (arg === '--scenario' && args[i + 1]) opts.scenario = args[++i];
    else if (arg === '--count' && args[i + 1]) opts.count = parseInt(args[++i]);
    else if (arg === '--host' && args[i + 1]) opts.hostId = parseInt(args[++i]);
    else if (arg === '--guest' && args[i + 1]) opts.guestId = parseInt(args[++i]);
    else if (arg === '--room' && args[i + 1]) opts.roomId = parseInt(args[++i]);
  }

  return opts;
}

// =====================================================
// 사용자/방 검증 및 자동 선택
// =====================================================

async function resolveHostGuestRoom(opts) {
  let hostId = opts.hostId;
  let guestId = opts.guestId;
  let roomId = opts.roomId;
  let hostUser, guestUser, room;

  // 호스트 검증/선택
  if (hostId) {
    hostUser = await User.findByPk(hostId);
    if (!hostUser) {
      console.error(`❌ 호스트 ID ${hostId}을(를) 찾을 수 없습니다.`);
      process.exit(1);
    }
    const hostRooms = await Room.findAll({ where: { hostId, status: 'published' }, limit: 1 });
    if (hostRooms.length === 0) {
      console.error(`❌ 호스트 #${hostId}에게 published 상태의 방이 없습니다.`);
      process.exit(1);
    }
    if (!roomId) {
      room = hostRooms[0];
      roomId = room.id;
    }
  } else {
    // 방이 있는 유저 중 랜덤 선택
    const roomWithHost = await Room.findOne({
      where: { status: 'published' },
      include: [{ model: User, as: 'host', attributes: ['id', 'name', 'email'] }],
      order: sequelize.random(),
    });
    if (!roomWithHost) {
      console.error('❌ published 상태의 방이 없습니다. seedDummyData.js를 먼저 실행하세요.');
      process.exit(1);
    }
    hostUser = roomWithHost.host;
    hostId = hostUser.id;
    room = roomWithHost;
    roomId = room.id;
  }

  // 방 검증
  if (opts.roomId) {
    room = await Room.findByPk(opts.roomId);
    if (!room) {
      console.error(`❌ 방 ID ${opts.roomId}을(를) 찾을 수 없습니다.`);
      process.exit(1);
    }
    if (room.hostId !== hostId) {
      console.error(`❌ 방 #${opts.roomId}은(는) 호스트 #${hostId}의 소유가 아닙니다. (실제 소유자: #${room.hostId})`);
      process.exit(1);
    }
    roomId = room.id;
  }

  // 게스트 검증/선택
  if (guestId) {
    guestUser = await User.findByPk(guestId);
    if (!guestUser) {
      console.error(`❌ 게스트 ID ${guestId}을(를) 찾을 수 없습니다.`);
      process.exit(1);
    }
    if (guestId === hostId) {
      console.error(`❌ 호스트와 게스트가 같을 수 없습니다. (ID: ${hostId})`);
      process.exit(1);
    }
  } else {
    guestUser = await User.findOne({
      where: { id: { [Op.ne]: hostId }, isActive: true },
      order: sequelize.random(),
    });
    if (!guestUser) {
      console.error('❌ 게스트로 사용할 수 있는 유저가 없습니다.');
      process.exit(1);
    }
    guestId = guestUser.id;
  }

  // 방 객체가 없으면 조회
  if (!room) {
    room = await Room.findByPk(roomId);
  }
  if (!hostUser) {
    hostUser = await User.findByPk(hostId);
  }

  return { hostId, guestId, roomId, hostUser, guestUser, room };
}

// =====================================================
// 메인 커맨드들
// =====================================================

async function seedCommand(opts) {
  console.log('\n🌱 계약 테스트 데이터 시더');
  console.log('=============================\n');

  const { hostId, guestId, roomId, hostUser, guestUser, room } = await resolveHostGuestRoom(opts);

  console.log(`👤 호스트: #${hostId} (${hostUser.name}, ${hostUser.email})`);
  console.log(`👤 게스트: #${guestId} (${guestUser.name}, ${guestUser.email})`);
  console.log(`🏠 방: #${roomId} (${room.roomName})\n`);

  // 실행할 시나리오 결정
  let scenarioKeys;
  if (opts.scenario) {
    if (!SCENARIOS[opts.scenario]) {
      console.error(`❌ 알 수 없는 시나리오: ${opts.scenario}`);
      console.log(`사용 가능한 시나리오: ${Object.keys(SCENARIOS).join(', ')}`);
      process.exit(1);
    }
    scenarioKeys = [opts.scenario];
  } else {
    scenarioKeys = Object.keys(SCENARIOS);
  }

  if (opts.dryRun) {
    console.log('🔍 [DRY RUN] 실제 DB 변경 없이 미리보기\n');
    for (const key of scenarioKeys) {
      const s = SCENARIOS[key];
      console.log(`  📦 ${key} (x${opts.count})`);
      console.log(`     ${s.label}`);
      console.log(`     ${s.description}`);
      if (s.needsRental) console.log('     렌탈 아이템 데이터 포함');
      console.log('');
    }
    console.log(`총 ${scenarioKeys.length * opts.count}개 계약이 생성될 예정입니다.`);
    return;
  }

  // 트랜잭션 시작
  const transaction = await sequelize.transaction();

  try {
    // 마스터 데이터 확인/생성
    console.log('📋 마스터 데이터 확인...');
    const rentalItems = await ensureMasterData(transaction);
    console.log('');

    // 기존 SEED orderId 중 최대값 조회해서 시퀀스 설정
    const existingSeed = await Contract.findOne({
      where: { orderId: { [Op.like]: 'S2%' } },
      order: [['orderId', 'DESC']],
      transaction,
    });
    let orderSeq = 1;
    if (existingSeed) {
      // S2602050001 → 마지막 4자리가 시퀀스
      const match = existingSeed.orderId.match(/(\d{4})$/);
      if (match) orderSeq = parseInt(match[1]) + 1;
    }

    // 렌탈 주문 시퀀스도 동일하게
    const existingRentalSeed = await RentalOrder.findOne({
      where: { orderId: { [Op.like]: 'S2%' } },
      order: [['orderId', 'DESC']],
      transaction,
    });
    let rentalOrderSeq = 1;
    if (existingRentalSeed) {
      const match = existingRentalSeed.orderId.match(/R(\d{4})$/);
      if (match) rentalOrderSeq = parseInt(match[1]) + 1;
    }

    console.log('📦 시나리오별 생성 시작...\n');

    let totalContracts = 0;
    const summary = {};

    for (let round = 0; round < opts.count; round++) {
      for (const key of scenarioKeys) {
        const scenario = SCENARIOS[key];
        const baseDate = getBaseDateForScenario(key);
        const orderId = makeSeedOrderId(orderSeq++);

        const result = await scenario.create({
          orderId,
          hostId,
          guestId,
          roomId,
          baseDate,
          transaction,
          rentalItems,
          rentalOrderSeq,
        });

        // 렌탈 주문이 있으면 시퀀스 증가
        if (result.rentalOrders) rentalOrderSeq += result.rentalOrders;

        totalContracts++;

        // 출력
        const idx = `${round * scenarioKeys.length + scenarioKeys.indexOf(key) + 1}/${scenarioKeys.length * opts.count}`;
        console.log(`  ${idx} ${key}`);
        console.log(`      ✅ Contract ${orderId} (${scenario.label.split('(')[1]?.replace(')', '') || result.contract.status})`);
        console.log(`      ✅ ContractStatusLog ${result.logs}건`);
        if (result.payments) console.log(`      ✅ Payment ${result.payments}건`);
        if (result.chatRooms) console.log(`      ✅ ChatRoom ${result.chatRooms}건`);
        if (result.refunds) console.log(`      ✅ Refund ${result.refunds}건`);
        if (result.rentalOrders) {
          console.log(`      ✅ RentalOrder ${result.rentalOrders}건`);
          console.log(`      ✅ RentalOrderItem ${result.rentalOrderItems}건`);
          console.log(`      ✅ RentalItemReservation ${result.rentalReservations}건`);
          console.log(`      ✅ RentalPayment ${result.rentalPayments}건`);
          console.log(`      ✅ RentalOrderLog ${result.rentalLogs}건`);
        }
        console.log('');

        // 요약 집계
        if (!summary[key]) summary[key] = 0;
        summary[key]++;
      }
    }

    await transaction.commit();

    console.log('=============================');
    console.log(`✅ 완료! 총 ${totalContracts}개 계약 + 관련 데이터 생성`);
    console.log('');
    console.log('📊 시나리오별 생성 요약:');
    for (const [key, count] of Object.entries(summary)) {
      console.log(`   ${SCENARIOS[key].label}: ${count}건`);
    }
    console.log('');
  } catch (error) {
    await transaction.rollback();
    console.error('❌ 에러 발생, 롤백 완료:', error.message);
    if (error.errors) {
      for (const e of error.errors) {
        console.error(`   - ${e.message}`);
      }
    }
    process.exit(1);
  }
}

async function cleanCommand() {
  console.log('\n🧹 시드 데이터 정리');
  console.log('=============================\n');

  // SEED orderId로 시작하는 계약 조회
  const seedContracts = await Contract.findAll({
    where: { orderId: { [Op.like]: 'S2%' } },
    attributes: ['id', 'orderId'],
  });

  if (seedContracts.length === 0) {
    console.log('✅ 정리할 시드 데이터가 없습니다.');
    return;
  }

  console.log(`📋 ${seedContracts.length}건의 시드 계약 발견\n`);

  const contractIds = seedContracts.map(c => c.id);

  const transaction = await sequelize.transaction();
  try {
    // 렌탈 관련 (orderId 기준 + contractId 기준 모두 조회)
    const rentalOrderWhereCond = { [Op.or]: [{ orderId: { [Op.like]: 'S2%' } }] };
    if (contractIds.length > 0) {
      rentalOrderWhereCond[Op.or].push({ contractId: { [Op.in]: contractIds } });
    }
    const seedRentalOrders = await RentalOrder.findAll({
      where: rentalOrderWhereCond,
      attributes: ['id'],
      transaction,
    });
    const rentalOrderIds = seedRentalOrders.map(r => r.id);

    // 순서 중요: 자식 → 부모
    if (rentalOrderIds.length > 0) {
      const delRentalPayments = await RentalPayment.destroy({ where: { rentalOrderId: { [Op.in]: rentalOrderIds } }, transaction });
      const delRentalOrderItems = await RentalOrderItem.destroy({ where: { rentalOrderId: { [Op.in]: rentalOrderIds } }, transaction });
      console.log(`  🗑️ RentalPayment ${delRentalPayments}건 삭제`);
      console.log(`  🗑️ RentalOrderItem ${delRentalOrderItems}건 삭제`);
    }

    const delRentalLogs = await RentalOrderLog.destroy({ where: { contractId: { [Op.in]: contractIds } }, transaction });
    console.log(`  🗑️ RentalOrderLog ${delRentalLogs}건 삭제`);

    const delReservations = await RentalItemReservation.destroy({ where: { contractId: { [Op.in]: contractIds } }, transaction });
    console.log(`  🗑️ RentalItemReservation ${delReservations}건 삭제`);

    // RentalOrder: orderId 기준 + contractId 기준 모두 삭제
    const rentalOrderWhere = [];
    if (rentalOrderIds.length > 0) {
      rentalOrderWhere.push({ id: { [Op.in]: rentalOrderIds } });
    }
    if (contractIds.length > 0) {
      rentalOrderWhere.push({ contractId: { [Op.in]: contractIds } });
    }
    if (rentalOrderWhere.length > 0) {
      const delRentalOrders = await RentalOrder.destroy({ where: { [Op.or]: rentalOrderWhere }, transaction });
      console.log(`  🗑️ RentalOrder ${delRentalOrders}건 삭제`);
    }

    const delRefunds = await Refund.destroy({ where: { contractId: { [Op.in]: contractIds } }, transaction });
    console.log(`  🗑️ Refund ${delRefunds}건 삭제`);

    const delPayments = await Payment.destroy({ where: { contractId: { [Op.in]: contractIds } }, transaction });
    console.log(`  🗑️ Payment ${delPayments}건 삭제`);

    const delChatRooms = await ChatRoom.destroy({ where: { contractId: { [Op.in]: contractIds } }, transaction });
    console.log(`  🗑️ ChatRoom ${delChatRooms}건 삭제`);

    const delLogs = await ContractStatusLog.destroy({ where: { contractId: { [Op.in]: contractIds } }, transaction });
    console.log(`  🗑️ ContractStatusLog ${delLogs}건 삭제`);

    const delSettlements = await Settlement.destroy({ where: { contractId: { [Op.in]: contractIds } }, transaction });
    console.log(`  🗑️ Settlement ${delSettlements}건 삭제`);

    const delAgreements = await DepositAgreement.destroy({ where: { contractId: { [Op.in]: contractIds } }, transaction });
    console.log(`  🗑️ DepositAgreement ${delAgreements}건 삭제`);

    const delContracts = await Contract.destroy({ where: { id: { [Op.in]: contractIds } }, transaction });
    console.log(`  🗑️ Contract ${delContracts}건 삭제`);

    await transaction.commit();

    console.log('\n=============================');
    console.log(`✅ 시드 데이터 정리 완료!`);
    console.log('');
  } catch (error) {
    await transaction.rollback();
    console.error('❌ 정리 중 에러 발생, 롤백 완료:', error.message);
    process.exit(1);
  }
}

function listCommand() {
  console.log('\n📋 사용 가능한 시나리오');
  console.log('=============================\n');

  for (const [key, scenario] of Object.entries(SCENARIOS)) {
    console.log(`  📦 ${key}`);
    console.log(`     ${scenario.label}`);
    console.log(`     ${scenario.description}`);
    if (scenario.needsRental) console.log('     🏷️  렌탈 아이템 데이터 포함');
    console.log('');
  }

  console.log('사용법:');
  console.log('  npm run dev:seed-contracts                                   # 모든 시나리오 1개씩');
  console.log('  npm run dev:seed-contracts -- --scenario in_progress         # 특정 시나리오만');
  console.log('  npm run dev:seed-contracts -- --count 3                      # 시나리오당 3개씩');
  console.log('  npm run dev:seed-contracts -- --host 1708 --guest 1805       # 호스트/게스트 지정');
  console.log('  npm run dev:seed-contracts -- --host 1708 --room 42          # 방도 지정');
  console.log('  npm run dev:seed-contracts -- --clean                        # 시드 데이터 정리');
  console.log('  npm run dev:seed-contracts -- --dry-run                      # 미리보기');
  console.log('');
}

function helpCommand() {
  console.log(`
📖 계약 테스트 데이터 시더 (개발/테스트용)

계약의 다양한 상태별 시나리오를 한 번에 생성합니다.
각 상태에 필요한 Payment, StatusLog, RentalOrder 등 관련 데이터를
정합성 있게 함께 생성합니다.

사용법:
  npm run dev:seed-contracts                                    # 모든 시나리오 1개씩
  npm run dev:seed-contracts -- --scenario <name>               # 특정 시나리오만
  npm run dev:seed-contracts -- --count <n>                     # 시나리오당 N개씩
  npm run dev:seed-contracts -- --host <userId>                 # 호스트 지정
  npm run dev:seed-contracts -- --guest <userId>                # 게스트 지정
  npm run dev:seed-contracts -- --room <roomId>                 # 방 지정
  npm run dev:seed-contracts -- --dry-run                       # 미리보기
  npm run dev:seed-contracts -- --list                          # 시나리오 목록
  npm run dev:seed-clean                                        # 시드 데이터 정리

예시:
  npm run dev:seed-contracts -- --host 1708 --guest 1805 --scenario in_progress_with_rental
  npm run dev:seed-contracts -- --count 3 --host 1708
  npm run dev:seed-clean

⚠️  주의: 이 도구는 개발/테스트 환경에서만 사용하세요.
         프로덕션 환경에서는 자동으로 차단됩니다.
`);
}

// =====================================================
// 메인 실행
// =====================================================

async function main() {
  const opts = parseArgs();

  switch (opts.command) {
    case 'seed':
      await seedCommand(opts);
      break;
    case 'clean':
      await cleanCommand();
      break;
    case 'list':
      listCommand();
      break;
    case 'help':
      helpCommand();
      break;
    default:
      helpCommand();
      break;
  }

  process.exit(0);
}

main().catch(error => {
  console.error('❌ 치명적 에러:', error);
  process.exit(1);
});
