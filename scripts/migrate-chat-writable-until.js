/**
 * 일회성 마이그레이션
 *
 * 1. 기존 Firestore 채팅방 문서의 hostId/guestId를 string으로 변환
 *    (Rules에서 request.auth.uid(string) == hostId 비교를 위해)
 *
 * 2. 종료된 채팅방에 chatWritableUntil 소급 적용
 *    - depositStatus = 'RETURNED' → updatedAt + 24H (즉시 쓰기 차단)
 *    - 취소된 계약 → cancelledAt + 24H (즉시 쓰기 차단)
 *
 * 실행: node scripts/migrate-chat-writable-until.js
 */

require('dotenv').config();

const { Contract, ChatRoom } = require('../models');
const { setChatWritableUntil, initializeFirebase, getFirestore } = require('../config/firebaseAdmin');
const { Op } = require('sequelize');
const admin = require('firebase-admin');

const CANCELLED_STATUSES = [
  'CANCELLED_BY_GUEST',
  'CANCELLED_BY_HOST',
  'CANCELLED_BY_ADMIN_WITH_REFUND',
  'CANCELLED_BY_ADMIN_NO_REFUND',
  'PAYMENT_EXPIRED',
  'APPROVAL_EXPIRED'
];

/**
 * Step 1: 기존 Firestore 문서의 hostId/guestId를 string으로 변환
 */
async function migrateHostGuestIdToString() {
  console.log('[Step 1] hostId/guestId string 변환 시작...\n');

  const db = getFirestore();
  const snapshot = await db.collection('chatRooms').get();

  if (snapshot.empty) {
    console.log('Firestore 채팅방 없음, 스킵\n');
    return;
  }

  let success = 0;
  let skip = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const hostId = data.hostId;
    const guestId = data.guestId;

    // 이미 string이면 스킵
    if (typeof hostId === 'string' && typeof guestId === 'string') {
      skip++;
      continue;
    }

    try {
      await doc.ref.update({
        hostId: String(hostId),
        guestId: String(guestId),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      console.log(`✅ ${doc.id}: hostId(${typeof hostId}) → string, guestId(${typeof guestId}) → string`);
      success++;
    } catch (err) {
      console.error(`❌ ${doc.id} 변환 실패:`, err.message);
    }
  }

  console.log(`\n[Step 1] 완료: 변환 ${success}건, 스킵(이미 string) ${skip}건\n`);
}

/**
 * Step 2: 종료된 채팅방 chatWritableUntil 소급 적용
 */
async function migrateWritableUntil() {
  console.log('[Step 2] chatWritableUntil 소급 적용 시작...\n');

  const returnedContracts = await Contract.findAll({
    where: { depositStatus: 'RETURNED' },
    attributes: ['id', 'updatedAt'],
    include: [{ model: ChatRoom, as: 'chatRoom', attributes: ['id', 'firebaseChatRoomId'] }]
  });

  const cancelledContracts = await Contract.findAll({
    where: { status: { [Op.in]: CANCELLED_STATUSES } },
    attributes: ['id', 'cancelledAt', 'updatedAt'],
    include: [{ model: ChatRoom, as: 'chatRoom', attributes: ['id', 'firebaseChatRoomId'] }]
  });

  const targets = [
    ...returnedContracts.map(c => ({
      contractId: c.id,
      chatRoom: c.chatRoom,
      baseTime: new Date(c.updatedAt),
      reason: 'RETURNED'
    })),
    ...cancelledContracts.map(c => ({
      contractId: c.id,
      chatRoom: c.chatRoom,
      baseTime: new Date(c.cancelledAt || c.updatedAt),
      reason: 'CANCELLED'
    }))
  ].filter(t => t.chatRoom);

  console.log(`대상: ${targets.length}건 (RETURNED: ${returnedContracts.filter(c => c.chatRoom).length}건, CANCELLED: ${cancelledContracts.filter(c => c.chatRoom).length}건)\n`);

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

  console.log(`\n[Step 2] 완료: 성공 ${success}건 / 실패 ${fail}건`);
}

async function migrate() {
  initializeFirebase();

  console.log('=== 채팅방 마이그레이션 시작 ===\n');

  await migrateHostGuestIdToString();
  await migrateWritableUntil();

  console.log('\n=== 마이그레이션 전체 완료 ===');
  process.exit(0);
}

migrate().catch(err => {
  console.error('마이그레이션 오류:', err);
  process.exit(1);
});
