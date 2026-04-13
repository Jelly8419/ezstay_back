/**
 * seed-perf.js
 * 지도 검색 성능 테스트용 대량 시드 데이터 생성 스크립트
 *
 * 사용법:
 *   node scripts/seed-perf.js          # 기본 10,000개
 *   node scripts/seed-perf.js 50000    # 50,000개
 *   node scripts/seed-perf.js --clean  # 시드 데이터 삭제
 *
 * 주의: 실 DB에 직접 삽입합니다. 필요하면 .env의 DB_NAME을 변경하세요.
 */

'use strict';

require('dotenv').config();
const { sequelize, User, LocalUser, UserBankAccount, Room, RoomPhoto, EzService, RefundPolicyType, RefundPolicyRule } = require('../models');
const bcrypt = require('bcryptjs');

// ── 설정 ──────────────────────────────────────────────────────
const SEED_TAG = 'PERF_SEED';           // 식별 태그 (정리 시 사용)
const BATCH_SIZE = 500;                  // 한 번에 INSERT할 행 수

// 한국 주요 지역 위경도 박스 (서울 중심 + 주변)
const AREAS = [
  { name: '서울_강남',   latMin: 37.487, latMax: 37.532, lngMin: 127.010, lngMax: 127.090 },
  { name: '서울_마포',   latMin: 37.535, latMax: 37.565, lngMin: 126.895, lngMax: 126.955 },
  { name: '서울_홍대',   latMin: 37.545, latMax: 37.570, lngMin: 126.915, lngMax: 126.945 },
  { name: '서울_종로',   latMin: 37.565, latMax: 37.600, lngMin: 126.970, lngMax: 127.020 },
  { name: '서울_송파',   latMin: 37.490, latMax: 37.525, lngMin: 127.080, lngMax: 127.140 },
  { name: '서울_노원',   latMin: 37.625, latMax: 37.670, lngMin: 127.055, lngMax: 127.100 },
  { name: '서울_관악',   latMin: 37.455, latMax: 37.490, lngMin: 126.925, lngMax: 126.985 },
  { name: '서울_성동',   latMin: 37.540, latMax: 37.570, lngMin: 127.025, lngMax: 127.065 },
];

const BUILDING_TYPES = ['아파트', '오피스텔', '빌라', '원룸', '투룸'];
const FLOORS = ['1층', '2층', '3층', '4층', '5층', '6층', '7층', '8층', '고층', '반지하'];

// ── 유틸 ──────────────────────────────────────────────────────
const rand = (min, max) => Math.random() * (max - min) + min;
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── 메인 ──────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--clean')) {
    await cleanSeedData();
    return;
  }

  const totalRooms = parseInt(args[0]) || 10000;
  await seedAll(totalRooms);
}

async function seedAll(totalRooms) {
  console.log(`\n🚀 성능 테스트 시드 데이터 생성 시작`);
  console.log(`   대상 DB : ${process.env.DB_NAME || 'ezstay'} @ ${process.env.DB_HOST || 'localhost'}`);
  console.log(`   방 수   : ${totalRooms.toLocaleString()}개\n`);

  await sequelize.authenticate();
  console.log('✅ DB 연결 성공\n');

  // 1. 환불 정책 (없으면 생성)
  const refundPolicy = await ensureRefundPolicy();

  // 2. 호스트 유저 생성 (방 100개당 1명, 최대 50명)
  const hostCount = Math.min(Math.ceil(totalRooms / 100), 50);
  console.log(`👤 호스트 생성: ${hostCount}명`);
  const hostIds = await seedHosts(hostCount);
  console.log(`✅ 호스트 생성 완료: ${hostIds.length}명\n`);

  // 3. 방 대량 생성
  console.log(`🏠 방 생성: ${totalRooms.toLocaleString()}개 (배치: ${BATCH_SIZE}개씩)`);
  const roomCount = await seedRooms(hostIds, totalRooms, refundPolicy.policyType);
  console.log(`✅ 방 생성 완료: ${roomCount.toLocaleString()}개\n`);

  // 4. 결과 요약
  await printSummary();
}

// ── 환불 정책 ────────────────────────────────────────────────
async function ensureRefundPolicy() {
  const POLICY_TYPE = 'PERF_POLICY';
  let policy = await RefundPolicyType.findOne({ where: { policyType: POLICY_TYPE } });
  if (policy) return policy;

  policy = await RefundPolicyType.create({
    policyType: POLICY_TYPE,
    displayName: '성능테스트용 환불정책',
    description: SEED_TAG,
    specialRules: {},
  });
  await RefundPolicyRule.bulkCreate([
    { policyType: POLICY_TYPE, daysBeforeMin: 7, daysBeforeMax: null, refundRate: 100 },
    { policyType: POLICY_TYPE, daysBeforeMin: 3, daysBeforeMax: 6,    refundRate: 50 },
    { policyType: POLICY_TYPE, daysBeforeMin: 0, daysBeforeMax: 2,    refundRate: 0 },
  ]);
  console.log(`✅ 환불 정책 생성: ${POLICY_TYPE}`);
  return policy;
}

// ── 호스트 생성 ──────────────────────────────────────────────
async function seedHosts(count) {
  const hashedPassword = await bcrypt.hash('Test1234!', 10);
  const hostIds = [];

  for (let i = 0; i < count; i++) {
    const tag = `${SEED_TAG}_HOST_${i}_${Date.now()}`;
    const user = await User.create({
      email: `perf_host_${i}_${Date.now()}@seed.test`,
      name: `성능호스트${i}`,
      nickname: tag.slice(0, 30),
      phoneNumber: `010${String(10000000 + i).slice(1)}`,
      phoneVerified: true,
      userType: 'local',
      accountStatus: 'active',
      isActive: true,
      serviceTermsAgreed: true,
      privacyPolicyAgreed: true,
      ageConfirmed: true,
    });
    await LocalUser.create({ userId: user.id, password: hashedPassword, emailVerified: true }).catch(() => {});
    await UserBankAccount.create({
      userId: user.id, bankCode: '004', bankName: '국민은행',
      accountNumber: String(100000000000 + i), accountHolder: user.name,
      isDefault: true, isVerified: true,
    }).catch(() => {});
    hostIds.push(user.id);
  }
  return hostIds;
}

// ── 방 대량 생성 ─────────────────────────────────────────────
async function seedRooms(hostIds, total, policyType) {
  let created = 0;
  const startTime = Date.now();

  for (let offset = 0; offset < total; offset += BATCH_SIZE) {
    const batchSize = Math.min(BATCH_SIZE, total - offset);
    const batch = buildRoomBatch(hostIds, policyType, batchSize, offset);

    const rooms = await Room.bulkCreate(batch, { returning: true });

    // 사진·EzService는 별도 bulkCreate (Room ID 필요)
    const photos = rooms.map(r => ({ roomId: r.id, url: 'https://seed.test/photo.jpg', order: 1 }));
    const services = rooms.map(r => ({ roomId: r.id, cleaningService: false }));
    await Promise.all([
      RoomPhoto.bulkCreate(photos, { ignoreDuplicates: true }),
      EzService.bulkCreate(services, { ignoreDuplicates: true }),
    ]);

    created += rooms.length;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const pct = ((created / total) * 100).toFixed(1);
    process.stdout.write(`\r   진행: ${created.toLocaleString()} / ${total.toLocaleString()} (${pct}%) - ${elapsed}s 경과`);
  }

  console.log('');
  return created;
}

function buildRoomBatch(hostIds, policyType, size, offset) {
  const rows = [];
  for (let i = 0; i < size; i++) {
    const area = AREAS[(offset + i) % AREAS.length];
    const dailyRent = randInt(30, 150) * 1000;

    rows.push({
      hostId: hostIds[(offset + i) % hostIds.length],
      roomName: `${SEED_TAG}_${offset + i}`,   // 정리용 태그 포함
      description: `성능 테스트용 방입니다. 깨끗하고 편안한 공간입니다. 테스트 목적으로 생성된 데이터입니다. (${offset + i})`,
      address: `서울시 ${area.name.replace('서울_', '')}구 테스트로 ${randInt(1, 500)}`,
      detailAddress: `${randInt(1, 20)}층 ${randInt(101, 999)}호`,
      latitude: parseFloat(rand(area.latMin, area.latMax).toFixed(8)),
      longitude: parseFloat(rand(area.lngMin, area.lngMax).toFixed(8)),
      area: randInt(15, 60),
      floor: pick(FLOORS),
      buildingType: pick(BUILDING_TYPES),
      roomCount: randInt(1, 3),
      bathroomCount: 1,
      isDuplex: false,
      parkingAvailable: Math.random() < 0.3,
      elevatorAvailable: Math.random() < 0.7,
      maxGuests: randInt(1, 4),
      dailyRent,
      dailyMaintenanceFee: randInt(0, 5) * 1000,
      cleaningFee: randInt(2, 5) * 10000,
      minContractDays: pick([7, 14, 30]),
      checkInTime: 14,
      checkOutTime: 11,
      // 할인 설정 (일부 방만 적용)
      quickMoveIn: Math.random() < 0.3 ? randInt(3, 14) : null,
      quickMoveInDiscount: Math.random() < 0.3 ? randInt(1, 5) * 5000 : null,
      longTermWeeks: Math.random() < 0.4 ? pick([4, 8, 12]) : null,
      longTermDiscount: Math.random() < 0.4 ? pick([5, 10, 15]) : null,
      status: 'published',
      isActive: true,
      refundPolicy: policyType,
    });
  }
  return rows;
}

// ── 정리 ─────────────────────────────────────────────────────
async function cleanSeedData() {
  await sequelize.authenticate();
  console.log('\n🧹 시드 데이터 정리 시작...\n');

  // 방 찾기 (roomName에 SEED_TAG 포함)
  const { Op } = require('sequelize');
  const rooms = await Room.findAll({
    attributes: ['id'],
    where: { roomName: { [Op.like]: `${SEED_TAG}%` } },
    paranoid: false,
  });
  const roomIds = rooms.map(r => r.id);
  console.log(`🏠 시드 방 ${roomIds.length}개 발견`);

  if (roomIds.length > 0) {
    await RoomPhoto.destroy({ where: { roomId: roomIds } });
    await EzService.destroy({ where: { roomId: roomIds } });
    // Room은 paranoid(soft delete)라 force: true
    await Room.destroy({ where: { id: roomIds }, force: true });
    console.log(`✅ 방 ${roomIds.length}개 삭제 완료`);
  }

  // 호스트 유저 정리
  const hosts = await User.findAll({
    attributes: ['id'],
    where: { email: { [Op.like]: `perf_host_%@seed.test` } },
    paranoid: false,
  });
  const hostIds = hosts.map(h => h.id);
  console.log(`👤 시드 호스트 ${hostIds.length}명 발견`);

  if (hostIds.length > 0) {
    await UserBankAccount.destroy({ where: { userId: hostIds } }).catch(() => {});
    await LocalUser.destroy({ where: { userId: hostIds } });
    await User.destroy({ where: { id: hostIds }, force: true });
    console.log(`✅ 호스트 ${hostIds.length}명 삭제 완료`);
  }

  // 환불 정책 정리
  await RefundPolicyRule.destroy({ where: { policyType: 'PERF_POLICY' } }).catch(() => {});
  await RefundPolicyType.destroy({ where: { policyType: 'PERF_POLICY' } }).catch(() => {});
  console.log('✅ 환불 정책 삭제 완료');

  console.log('\n🏁 정리 완료\n');
  await sequelize.close();
}

// ── 요약 출력 ────────────────────────────────────────────────
async function printSummary() {
  const { Op } = require('sequelize');
  const roomCount = await Room.count({ where: { status: 'published' }, paranoid: false });
  const seedCount = await Room.count({
    where: { roomName: { [Op.like]: `${SEED_TAG}%` } },
    paranoid: false,
  });

  console.log('─'.repeat(50));
  console.log('📊 현재 DB 현황');
  console.log(`   전체 published 방 : ${roomCount.toLocaleString()}개`);
  console.log(`   이번 시드 방       : ${seedCount.toLocaleString()}개`);
  console.log('─'.repeat(50));
  console.log('');
  console.log('다음 단계:');
  console.log('  1. 서버 실행        : npm run dev');
  console.log('  2. 성능 측정        : node scripts/bench-map.js');
  console.log('  3. 시드 데이터 정리 : node scripts/seed-perf.js --clean');
  console.log('');

  await sequelize.close();
}

main().catch(async (err) => {
  console.error('\n❌ 오류 발생:', err.message);
  console.error(err.stack);
  await sequelize.close().catch(() => {});
  process.exit(1);
});
