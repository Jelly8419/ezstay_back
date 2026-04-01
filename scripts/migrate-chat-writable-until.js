/**
 * 일회성 마이그레이션: 기존 종료된 채팅방에 chatWritableUntil 소급 적용
 *
 * 대상:
 *   - depositStatus = 'RETURNED' → updatedAt + 24H (이미 지난 시각이므로 즉시 쓰기 차단)
 *   - 취소된 계약 (CANCELLED_*, PAYMENT_EXPIRED 등) → 과거 시각으로 설정 (즉시 쓰기 차단)
 *
 * 실행: node scripts/migrate-chat-writable-until.js
 */

require('dotenv').config();

const { Contract, ChatRoom } = require('../models');
const { setChatWritableUntil } = require('../config/firebaseAdmin');
const { initializeFirebase } = require('../config/firebaseAdmin');
const { Op } = require('sequelize');

const CANCELLED_STATUSES = [
  'CANCELLED_BY_GUEST',
  'CANCELLED_BY_HOST',
  'CANCELLED_BY_ADMIN_WITH_REFUND',
  'CANCELLED_BY_ADMIN_NO_REFUND',
  'PAYMENT_EXPIRED',
  'APPROVAL_EXPIRED'
];

async function migrate() {
  initializeFirebase();

  console.log('=== 채팅방 chatWritableUntil 마이그레이션 시작 ===\n');

  // 1. depositStatus = RETURNED인 계약
  const returnedContracts = await Contract.findAll({
    where: { depositStatus: 'RETURNED' },
    attributes: ['id', 'updatedAt'],
    include: [{ model: ChatRoom, as: 'chatRoom', attributes: ['id', 'firebaseChatRoomId'] }]
  });

  // 2. 취소된 계약
  const cancelledContracts = await Contract.findAll({
    where: { status: { [Op.in]: CANCELLED_STATUSES } },
    attributes: ['id', 'cancelledAt', 'updatedAt'],
    include: [{ model: ChatRoom, as: 'chatRoom', attributes: ['id', 'firebaseChatRoomId'] }]
  });

  const targets = [
    // RETURNED: updatedAt이 반환 완료 시점 (이미 지난 시각 → +24H도 과거 → 즉시 차단)
    ...returnedContracts.map(c => ({
      contractId: c.id,
      chatRoom: c.chatRoom,
      baseTime: new Date(c.updatedAt),
      reason: 'RETURNED'
    })),
    // 취소: 과거 시각 기준 → 즉시 차단
    ...cancelledContracts.map(c => ({
      contractId: c.id,
      chatRoom: c.chatRoom,
      baseTime: new Date(c.cancelledAt || c.updatedAt),
      reason: 'CANCELLED'
    }))
  ].filter(t => t.chatRoom); // 채팅방이 없는 계약 제외

  console.log(`대상 채팅방: ${targets.length}건 (RETURNED: ${returnedContracts.filter(c => c.chatRoom).length}건, CANCELLED: ${cancelledContracts.filter(c => c.chatRoom).length}건)\n`);

  let success = 0;
  let fail = 0;

  for (const target of targets) {
    try {
      await setChatWritableUntil(target.chatRoom.firebaseChatRoomId, target.baseTime);
      console.log(`✅ [${target.reason}] 계약 ${target.contractId} → ${target.chatRoom.firebaseChatRoomId}`);
      success++;
    } catch (err) {
      console.error(`❌ [${target.reason}] 계약 ${target.contractId} 실패:`, err.message);
      fail++;
    }
  }

  console.log(`\n=== 마이그레이션 완료: 성공 ${success}건 / 실패 ${fail}건 ===`);
  process.exit(0);
}

migrate().catch(err => {
  console.error('마이그레이션 오류:', err);
  process.exit(1);
});
