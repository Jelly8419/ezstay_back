/**
 * 일회성 마이그레이션
 *
 * roomSnapshot에 photos/thumbnailUrl이 없는 기존 계약에 사진 정보를 소급 적용
 * roomSnapshot 자체가 null인 계약은 현재 방 정보로 스냅샷을 새로 구성
 *
 * 배경:
 *   - 계약 생성 시 roomSnapshot에 방 기본 정보만 저장했고 photos/thumbnailUrl은 저장하지 않았음
 *   - 시드 데이터 등 roomSnapshot 자체가 null인 계약도 존재
 *   - 이후 목록/상세 API가 Room JOIN 없이 roomSnapshot만 참조하도록 변경됨
 *   - 기존 계약에 photos가 없으면 엑박이 표시되므로 현재 방 사진으로 소급 저장
 *
 * 케이스:
 *   1. roomSnapshot 있음 + photos 없음 → photos/thumbnailUrl 추가
 *   2. roomSnapshot 자체가 null      → 현재 방 정보로 스냅샷 전체 구성
 *   3. 방이 삭제된 경우              → photos: [], thumbnailUrl: null
 *
 * 실행: node scripts/migrate-contract-room-snapshot-photos.js
 */

require('dotenv').config();

const { Contract, Room, RoomPhoto, EzService, sequelize } = require('../models');
const { Op } = require('sequelize');

async function migrate() {
  console.log('=== roomSnapshot photos 마이그레이션 시작 ===\n');

  // photos 필드가 없는 계약 (roomSnapshot null 포함)
  const contracts = await Contract.findAll({
    where: sequelize.where(
      sequelize.fn('JSON_EXTRACT', sequelize.col('room_snapshot'), '$.photos'),
      { [Op.is]: null }
    ),
    attributes: ['id', 'roomId', 'roomSnapshot']
  });

  console.log(`대상 계약: ${contracts.length}건\n`);

  if (contracts.length === 0) {
    console.log('마이그레이션 대상 없음. 종료.');
    process.exit(0);
  }

  // 필요한 roomId 목록 수집 (중복 제거)
  // roomSnapshot.roomId 또는 contract.roomId 둘 다 활용
  const roomIds = [...new Set(
    contracts
      .map(c => c.roomSnapshot?.roomId || c.roomId)
      .filter(Boolean)
  )];

  // 해당 방들의 현재 정보 + 사진 일괄 조회
  const rooms = await Room.findAll({
    where: { id: { [Op.in]: roomIds } },
    include: [
      {
        model: RoomPhoto,
        as: 'photos',
        attributes: ['url', 'order'],
        order: [['order', 'ASC']]
      },
      {
        model: EzService,
        as: 'ezService'
      }
    ]
  });

  // roomId → room 맵
  const roomMap = new Map(rooms.map(r => [r.id, r]));

  let success = 0;
  let skippedNoRoom = 0;
  let fail = 0;

  for (const contract of contracts) {
    const roomId = contract.roomSnapshot?.roomId || contract.roomId;
    const room = roomMap.get(roomId);

    if (!room) {
      console.log(`⚠️  계약 ${contract.id}: roomId(${roomId}) 방 없음 → 스킵`);
      skippedNoRoom++;
      continue;
    }

    const photos = room.photos.map(p => ({ url: p.url, order: p.order }));
    const thumbnailUrl = photos[0]?.url || null;

    let updatedSnapshot;

    if (contract.roomSnapshot) {
      // 케이스 1: 기존 스냅샷에 photos/thumbnailUrl만 추가
      updatedSnapshot = {
        ...contract.roomSnapshot,
        photos,
        thumbnailUrl
      };
    } else {
      // 케이스 2: roomSnapshot 자체가 null → 현재 방 정보로 전체 구성
      updatedSnapshot = {
        roomId: room.id,
        roomName: room.roomName,
        address: room.address,
        detailAddress: room.detailAddress,
        buildingType: room.buildingType,
        floor: room.floor,
        area: room.area,
        roomCount: room.roomCount,
        bathroomCount: room.bathroomCount,
        isDuplex: room.isDuplex,
        elevatorAvailable: room.elevatorAvailable,
        parkingAvailable: room.parkingAvailable,
        parkingInfo: room.parkingInfo,
        maxGuests: room.maxGuests,
        description: room.description,
        dailyRent: room.dailyRent,
        dailyMaintenanceFee: room.dailyMaintenanceFee,
        maintenanceDetail: room.maintenanceDetail,
        includeElectricity: room.includeElectricity,
        includeWater: room.includeWater,
        includeGas: room.includeGas,
        includeInternet: room.includeInternet,
        cleaningFee: room.cleaningFee,
        longTermWeeks: room.longTermWeeks,
        longTermDiscount: room.longTermDiscount,
        quickMoveIn: room.quickMoveIn,
        quickMoveInDiscount: room.quickMoveInDiscount,
        minContractDays: room.minContractDays,
        refundPolicy: room.refundPolicy,
        checkInTime: room.checkInTime,
        checkOutTime: room.checkOutTime,
        ezService: room.ezService ? { cleaningService: room.ezService.cleaningService } : null,
        photos,
        thumbnailUrl,
        capturedAt: room.createdAt?.toISOString() || new Date().toISOString()
      };
    }

    try {
      await Contract.update(
        { roomSnapshot: updatedSnapshot },
        { where: { id: contract.id } }
      );
      const label = contract.roomSnapshot ? 'photos 추가' : '스냅샷 전체 구성';
      console.log(`✅ 계약 ${contract.id}: ${label} (photos ${photos.length}장)`);
      success++;
    } catch (err) {
      console.error(`❌ 계약 ${contract.id} 업데이트 실패:`, err.message);
      fail++;
    }
  }

  console.log('\n=== 마이그레이션 완료 ===');
  console.log(`성공: ${success}건`);
  console.log(`스킵 (방 없음): ${skippedNoRoom}건`);
  console.log(`실패: ${fail}건`);

  process.exit(fail > 0 ? 1 : 0);
}

migrate().catch(err => {
  console.error('마이그레이션 오류:', err);
  process.exit(1);
});
