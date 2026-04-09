/**
 * roomFactory.js
 * 테스트용 방 생성 헬퍼
 */

'use strict';

let counter = 0;
const uid = () => `${Date.now()}_${++counter}`;

/**
 * 테스트용 방 생성
 * @param {number} hostId - 호스트 유저 ID
 * @param {object} overrides - 필드 오버라이드
 */
async function createRoom(hostId, overrides = {}) {
  const { Room, RoomPhoto, RoomAmenity, EzService, RefundPolicyType, RefundPolicyRule } = require('../../../models');

  // 환불 정책 생성 (없으면)
  let refundPolicy = await RefundPolicyType.findOne({ where: { policyType: 'TEST_POLICY' } });
  if (!refundPolicy) {
    refundPolicy = await RefundPolicyType.create({
      policyType: 'TEST_POLICY',
      displayName: '테스트 환불 정책',
      description: '테스트용',
      specialRules: {},
    });

    // 환불 규칙: 7일 전까지 100%, 3일 전까지 50%, 그 외 0%
    await RefundPolicyRule.bulkCreate([
      { policyType: 'TEST_POLICY', daysBeforeMin: 7, daysBeforeMax: null, refundRate: 100 },
      { policyType: 'TEST_POLICY', daysBeforeMin: 3, daysBeforeMax: 6,    refundRate: 50  },
      { policyType: 'TEST_POLICY', daysBeforeMin: 0, daysBeforeMax: 2,    refundRate: 0   },
    ]);
  }

  const room = await Room.create({
    hostId,
    roomName: overrides.roomName || `테스트 방 ${uid()}`,
    description: overrides.description || '테스트용 방입니다. 깨끗하고 편안한 공간입니다. 10자 이상 500자 이하로 작성합니다.',
    address: overrides.address || '서울시 강남구 테스트로 123',
    detailAddress: overrides.detailAddress || '101호',
    latitude: overrides.latitude || 37.5665,
    longitude: overrides.longitude || 126.9780,
    area: overrides.area || 20,
    floor: overrides.floor || '1층',
    buildingType: overrides.buildingType || '아파트',
    roomCount: overrides.roomCount || 1,
    bathroomCount: overrides.bathroomCount || 1,
    isDuplex: overrides.isDuplex ?? false,
    parkingAvailable: overrides.parkingAvailable ?? false,
    elevatorAvailable: overrides.elevatorAvailable ?? false,
    maxGuests: overrides.maxGuests || 2,
    dailyRent: overrides.dailyRent || 50000,
    dailyMaintenanceFee: overrides.dailyMaintenanceFee || 5000,
    cleaningFee: overrides.cleaningFee || 30000,
    minContractDays: overrides.minContractDays || 7,
    checkInTime: overrides.checkInTime || 14,
    checkOutTime: overrides.checkOutTime || 11,
    status: overrides.status || 'published',
    refundPolicy: overrides.refundPolicy || 'TEST_POLICY',
  });

  // 기본 사진 1장
  await RoomPhoto.create({
    roomId: room.id,
    url: 'https://test.com/photo.jpg',
    order: 1,
  }).catch(() => {});

  // EzService
  await EzService.create({
    roomId: room.id,
    cleaningService: overrides.cleaningService ?? false,
  }).catch(() => {});

  return { room, refundPolicy };
}

/**
 * 테스트 데이터 정리
 */
async function cleanupRooms(roomIds) {
  if (!roomIds || roomIds.length === 0) return;
  const { Room, RoomPhoto, EzService } = require('../../../models');
  await RoomPhoto.destroy({ where: { roomId: roomIds } }).catch(() => {});
  await EzService.destroy({ where: { roomId: roomIds } }).catch(() => {});
  await Room.destroy({ where: { id: roomIds } });
}

module.exports = { createRoom, cleanupRooms };
