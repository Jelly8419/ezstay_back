require('dotenv').config();
const bcrypt = require('bcryptjs');
const { sequelize, User, LocalUser, Room, RoomPhoto, RoomAmenity, EzService } = require('../models');

// 서울 주요 지역 좌표 (위도, 경도)
const seoulLocations = [
  { name: '강남구', lat: 37.4979, lng: 127.0276 },
  { name: '서초구', lat: 37.4836, lng: 127.0327 },
  { name: '송파구', lat: 37.5145, lng: 127.1059 },
  { name: '강동구', lat: 37.5301, lng: 127.1238 },
  { name: '마포구', lat: 37.5663, lng: 126.9019 },
  { name: '용산구', lat: 37.5326, lng: 126.9903 },
  { name: '중구', lat: 37.5640, lng: 126.9970 },
  { name: '종로구', lat: 37.5735, lng: 126.9788 },
  { name: '성북구', lat: 37.5894, lng: 127.0167 },
  { name: '동대문구', lat: 37.5744, lng: 127.0396 },
  { name: '광진구', lat: 37.5384, lng: 127.0822 },
  { name: '성동구', lat: 37.5634, lng: 127.0368 },
  { name: '영등포구', lat: 37.5264, lng: 126.8963 },
  { name: '강서구', lat: 37.5509, lng: 126.8495 },
  { name: '구로구', lat: 37.4954, lng: 126.8874 },
  { name: '은평구', lat: 37.6027, lng: 126.9291 },
  { name: '서대문구', lat: 37.5791, lng: 126.9368 },
  { name: '노원구', lat: 37.6542, lng: 127.0568 },
  { name: '도봉구', lat: 37.6688, lng: 127.0471 },
  { name: '강북구', lat: 37.6398, lng: 127.0257 }
];

const roomTypes = ['entire_place', 'private_room', 'shared_room'];
const propertyTypes = ['아파트', '빌라', '오피스텔', '단독주택', '타운하우스', '펜트하우스'];
const amenitiesOptions = {
  wifi: [true, false],
  tv: [true, false],
  kitchen: [true, false],
  airConditioner: [true, false],
  heater: [true, false],
  washingMachine: [true, false],
  parking: [true, false],
  elevator: [true, false]
};

const freeServicesOptions = {
  breakfast: [true, false],
  gym: [true, false],
  pool: [true, false],
  bbq: [true, false],
  netflix: [true, false],
  workspace: [true, false]
};

// 랜덤 값 생성 헬퍼
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min, max, decimals = 4) {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

function randomChoice(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function randomBoolean() {
  return Math.random() > 0.5;
}

// 좌표에 약간의 랜덤 오프셋 추가 (같은 지역 내 분산)
function addRandomOffset(lat, lng) {
  return {
    lat: parseFloat((lat + randomFloat(-0.02, 0.02)).toFixed(6)),
    lng: parseFloat((lng + randomFloat(-0.02, 0.02)).toFixed(6))
  };
}

async function seedDummyData() {
  const transaction = await sequelize.transaction();

  try {
    console.log('🚀 더미데이터 생성 시작...\n');

    // 1. 유저 1000명 생성
    console.log('👥 유저 1000명 생성 중...');
    const users = [];
    const hashedPassword = await bcrypt.hash('Test1234!', 10);

    for (let i = 1; i <= 1000; i++) {
      const user = await User.create({
        name: `테스트유저${i}`,
        email: `testuser${i}@livemoment.com`,
        phoneNumber: `010${String(10000000 + i).slice(0, 8)}`,
        phoneVerified: true,
        profileImageUrl: null,
        userType: 'local',
        isActive: true,
        serviceTermsAgreed: true,
        privacyPolicyAgreed: true,
        marketingConsent: false,
        ageConfirmed: true,
        termsAgreedAt: new Date()
      }, { transaction });

      await LocalUser.create({
        userId: user.id,
        password: hashedPassword,
        emailVerified: true,
        failedLoginAttempts: 0
      }, { transaction });

      users.push(user);

      if (i % 100 === 0) {
        console.log(`  ✓ ${i}/1000 유저 생성 완료`);
      }
    }
    console.log('✅ 유저 1000명 생성 완료!\n');

    // 2. 방 1000개 생성
    console.log('🏠 방 1000개 생성 중...');
    const rooms = [];

    for (let i = 1; i <= 1000; i++) {
      const location = randomChoice(seoulLocations);
      const coords = addRandomOffset(location.lat, location.lng);
      const buildingType = randomChoice(propertyTypes);
      const area = randomFloat(20, 100, 2);
      const roomCount = randomInt(1, 4);
      const bathroomCount = randomInt(1, 2);
      const livingRoomCount = randomInt(1, 2);
      const kitchenCount = randomInt(1, 2);
      const weeklyRent = randomInt(300000, 1500000);

      const room = await Room.create({
        hostId: users[i - 1].id, // 각 유저당 1개씩

        // 기본 정보
        roomName: `${location.name} ${buildingType} ${i}`,
        address: `서울특별시 ${location.name} 테스트로 ${i}`,
        detailAddress: `${randomInt(1, 20)}층 ${randomInt(101, 1005)}호`,

        // 좌표 (WGS84)
        latitude: coords.lat,
        longitude: coords.lng,

        // 면적 및 구조
        area: area,
        floor: `${randomInt(1, 20)}`,
        buildingType: buildingType,
        parkingAvailable: randomBoolean(),
        parkingInfo: randomBoolean() ? '건물 내 주차장 이용 가능' : null,
        elevatorAvailable: randomBoolean(),

        // 방 구성
        roomCount: roomCount,
        bathroomCount: bathroomCount,
        livingRoomCount: livingRoomCount,
        kitchenCount: kitchenCount,
        isDuplex: randomBoolean(),

        // 출입 정보
        entrancePassword: String(randomInt(1000, 9999)),

        // 요금 정보
        weeklyRent: weeklyRent,
        longTermWeeks: randomInt(12, 52),
        longTermDiscount: randomInt(5, 20),
        quickMoveInDiscount: randomInt(0, 10),
        maintenanceFee: randomInt(50000, 200000),
        maintenanceDetail: '전기, 수도, 가스, 인터넷 포함',
        includeElectricity: randomBoolean(),
        includeWater: randomBoolean(),
        includeGas: randomBoolean(),
        includeInternet: randomBoolean(),
        cleaningFee: randomInt(30000, 100000),
        minContractDays: randomInt(7, 90),
        refundPolicy: randomChoice(['flexible', 'moderate', 'strict']),

        // 방 소개
        description: `${location.name}에 위치한 아늑하고 편안한 ${buildingType}입니다. 주변에 편의시설이 잘 갖춰져 있으며, 교통이 편리합니다. 면적 ${area}㎡, ${roomCount}룸 구조로 쾌적한 생활이 가능합니다.`,
        maxGuests: randomInt(2, 6),

        // 상태
        status: 'published', // 지도 조회 테스트를 위해 모두 published
        submittedAt: new Date(),
        approvedAt: new Date(),
        publishedAt: new Date(),

        createdAt: new Date(),
        updatedAt: new Date()
      }, { transaction });

      // 사진 6장 추가 (최소 요구사항)
      for (let j = 1; j <= 6; j++) {
        await RoomPhoto.create({
          roomId: room.id,
          url: `/uploads/dummy/room${i}_photo${j}.jpg`,
          order: j
        }, { transaction });
      }

      // 편의시설 추가
      await RoomAmenity.create({
        roomId: room.id,
        basicOptions: {
          wifi: randomBoolean(),
          tv: randomBoolean(),
          airConditioner: randomBoolean(),
          heater: randomBoolean()
        },
        additionalOptions: {
          washer: randomBoolean(),
          dryer: randomBoolean(),
          iron: randomBoolean()
        },
        convenienceOptions: {
          microwave: randomBoolean(),
          refrigerator: randomBoolean(),
          dishwasher: randomBoolean()
        },
        petsAllowed: randomBoolean()
      }, { transaction });

      // 무료 부가서비스 추가
      await EzService.create({
        roomId: room.id,
        cleaningService: randomBoolean(),
        roomPassword: String(randomInt(1000, 9999))
      }, { transaction });

      rooms.push(room);

      if (i % 100 === 0) {
        console.log(`  ✓ ${i}/1000 방 생성 완료`);
      }
    }
    console.log('✅ 방 1000개 생성 완료!\n');

    await transaction.commit();

    // 통계 출력
    console.log('📊 생성 통계:');
    console.log(`  - 유저: ${users.length}명`);
    console.log(`  - 방: ${rooms.length}개`);
    console.log(`  - 방 사진: ${rooms.length * 6}장`);
    console.log(`  - 편의시설: ${rooms.length}개`);
    console.log(`  - 무료 부가서비스: ${rooms.length}개`);
    console.log('\n✅ 더미데이터 생성 완료!');

    // 샘플 데이터 출력
    console.log('\n📍 샘플 방 데이터:');
    const sampleRoom = rooms[0];
    console.log(`  - ID: ${sampleRoom.id}`);
    console.log(`  - 제목: ${sampleRoom.title}`);
    console.log(`  - 위치: ${sampleRoom.roadAddress}`);
    console.log(`  - 좌표: ${sampleRoom.latitude}, ${sampleRoom.longitude}`);
    console.log(`  - 가격: ${sampleRoom.pricePerNight.toLocaleString()}원/박`);
    console.log(`  - 상태: ${sampleRoom.status}`);

  } catch (error) {
    await transaction.rollback();
    console.error('❌ 더미데이터 생성 실패:', error);
    throw error;
  }
}

// 스크립트 실행
if (require.main === module) {
  seedDummyData()
    .then(() => {
      console.log('\n🎉 작업 완료!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 작업 실패:', error);
      process.exit(1);
    });
}

module.exports = seedDummyData;
