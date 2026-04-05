/**
 * 일회성 마이그레이션
 *
 * snapshot에 누락된 필드를 기존 계약에 소급 적용
 * snapshot 자체가 null인 계약은 현재 방 정보로 스냅샷을 새로 구성
 *
 * 배경:
 *   - 초기: snapshot에 방 기본 정보만 저장 (photos/thumbnailUrl 없음)
 *   - 1차 추가: photos, thumbnailUrl 소급
 *   - 2차 추가: latitude, longitude, amenity, host 소급
 *   - 3차 추가: guest 소급
 *
 * 케이스:
 *   1. snapshot 있음 + 누락 필드 있음 → 해당 필드만 추가
 *   2. snapshot 자체가 null           → 현재 방 정보로 스냅샷 전체 구성
 *   3. 방이 삭제된 경우                   → 누락 필드를 null/[]로 채움
 *
 * 실행: node scripts/migrate-contract-room-snapshot-photos.js
 */

require('dotenv').config();

const { Contract, Room, RoomPhoto, RoomAmenity, EzService, User, sequelize } = require('../models');
const { Op } = require('sequelize');

// snapshot에서 소급이 필요한 필드 목록
const REQUIRED_FIELDS = ['photos', 'latitude', 'longitude', 'amenity', 'host', 'guest'];

async function migrate() {
  console.log('=== snapshot 마이그레이션 시작 ===\n');
  console.log(`소급 대상 필드: ${REQUIRED_FIELDS.join(', ')}\n`);

  // snapshot이 null이거나 필수 필드 중 하나라도 없는 계약 조회
  // JSON_EXTRACT로 각 필드 존재 여부 체크 (literal 사용 - sequelize.fn이 $를 이스케이프하는 문제 방지)
  const contracts = await Contract.findAll({
    where: {
      [Op.or]: [
        { snapshot: null },
        sequelize.literal("JSON_EXTRACT(`snapshot`, '$.photos') IS NULL"),
        sequelize.literal("JSON_EXTRACT(`snapshot`, '$.latitude') IS NULL"),
        sequelize.literal("JSON_EXTRACT(`snapshot`, '$.host') IS NULL"),
        sequelize.literal("JSON_EXTRACT(`snapshot`, '$.guest') IS NULL"),
      ]
    },
    attributes: ['id', 'roomId', 'guestId', 'snapshot']
  });

  console.log(`대상 계약: ${contracts.length}건\n`);

  if (contracts.length === 0) {
    console.log('마이그레이션 대상 없음. 종료.');
    process.exit(0);
  }

  // 필요한 roomId / guestId 목록 수집 (중복 제거)
  const roomIds = [...new Set(
    contracts.map(c => c.snapshot?.roomId || c.roomId).filter(Boolean)
  )];
  const guestIds = [...new Set(
    contracts.map(c => c.guestId).filter(Boolean)
  )];

  // 해당 방 + 게스트 현재 정보 일괄 조회
  const [rooms, guests] = await Promise.all([
    Room.findAll({
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
        },
        {
          model: RoomAmenity,
          as: 'amenity',
          required: false
        },
        {
          model: User,
          as: 'host',
          attributes: ['id', 'name', 'nickname', 'profileImageUrl', 'phoneVerified'],
          required: false
        }
      ]
    }),
    User.findAll({
      where: { id: { [Op.in]: guestIds } },
      attributes: ['id', 'name', 'nickname', 'profileImageUrl', 'phoneVerified']
    })
  ]);

  const roomMap = new Map(rooms.map(r => [r.id, r]));
  const guestMap = new Map(guests.map(g => [g.id, g]));

  let successCount = 0;
  let skippedNoRoom = 0;
  let fail = 0;

  for (const contract of contracts) {
    const roomId = contract.snapshot?.roomId || contract.roomId;
    const room = roomMap.get(roomId);

    const photos = room ? room.photos.map(p => ({ url: p.url, order: p.order })) : [];
    const thumbnailUrl = photos[0]?.url || null;
    const amenity = room?.amenity ? {
      basicOptions: room.amenity.basicOptions,
      additionalOptions: room.amenity.additionalOptions,
      convenienceOptions: room.amenity.convenienceOptions,
      petsAllowed: room.amenity.petsAllowed,
    } : null;
    const host = room?.host ? {
      id: room.host.id,
      name: room.host.name,
      nickname: room.host.nickname,
      profileImageUrl: room.host.profileImageUrl,
      phoneVerified: room.host.phoneVerified,
    } : null;
    const guestUser = guestMap.get(contract.guestId);
    const guest = guestUser ? {
      id: guestUser.id,
      name: guestUser.name,
      nickname: guestUser.nickname,
      profileImageUrl: guestUser.profileImageUrl,
      phoneVerified: guestUser.phoneVerified,
    } : null;

    if (!room) {
      console.log(`⚠️  계약 ${contract.id}: roomId(${roomId}) 방 없음 → 누락 필드 null로 채움`);
      skippedNoRoom++;
    }

    let updatedSnapshot;

    if (contract.snapshot) {
      // 케이스 1: 기존 스냅샷에 누락 필드만 추가
      updatedSnapshot = {
        ...contract.snapshot,
        photos,
        thumbnailUrl,
        latitude: contract.snapshot.latitude ?? (room?.latitude || null),
        longitude: contract.snapshot.longitude ?? (room?.longitude || null),
        amenity: contract.snapshot.amenity ?? amenity,
        host: contract.snapshot.host ?? host,
        guest: contract.snapshot.guest ?? guest,
      };
    } else {
      // 케이스 2: snapshot 자체가 null → 현재 방 정보로 전체 구성
      if (!room) {
        console.log(`❌ 계약 ${contract.id}: snapshot null이고 방도 없음 → 스킵`);
        fail++;
        continue;
      }
      updatedSnapshot = {
        roomId: room.id,
        roomName: room.roomName,
        address: room.address,
        detailAddress: room.detailAddress,
        latitude: room.latitude,
        longitude: room.longitude,
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
        amenity,
        photos,
        thumbnailUrl,
        host,
        guest,
        capturedAt: room.createdAt?.toISOString() || new Date().toISOString()
      };
    }

    try {
      await Contract.update(
        { snapshot: updatedSnapshot },
        { where: { id: contract.id } }
      );
      const added = REQUIRED_FIELDS.filter(f => !(contract.snapshot && f in contract.snapshot));
      const label = contract.snapshot
        ? `필드 추가: ${added.join(', ')}`
        : '스냅샷 전체 구성';
      console.log(`✅ 계약 ${contract.id}: ${label}`);
      successCount++;
    } catch (err) {
      console.error(`❌ 계약 ${contract.id} 업데이트 실패:`, err.message);
      fail++;
    }
  }

  console.log('\n=== 마이그레이션 완료 ===');
  console.log(`성공: ${successCount}건`);
  console.log(`스킵 (방 없음): ${skippedNoRoom}건`);
  console.log(`실패: ${fail}건`);

  process.exit(fail > 0 ? 1 : 0);
}

migrate().catch(err => {
  console.error('마이그레이션 오류:', err);
  process.exit(1);
});
