require('dotenv').config();
const { sequelize, User, LocalUser, Room, RoomPhoto, RoomAmenity, RoomFreeService } = require('../models');

async function checkStats() {
  try {
    await sequelize.authenticate();
    console.log('✅ DB 연결 성공\n');

    // 통계 조회
    const userCount = await User.count();
    const localUserCount = await LocalUser.count();
    const roomCount = await Room.count();
    const publishedRoomCount = await Room.count({ where: { status: 'published' } });
    const photoCount = await RoomPhoto.count();
    const amenityCount = await RoomAmenity.count();
    const serviceCount = await RoomFreeService.count();

    console.log('📊 데이터베이스 통계:');
    console.log(`  - 전체 유저: ${userCount}명`);
    console.log(`  - 로컬 유저: ${localUserCount}명`);
    console.log(`  - 전체 방: ${roomCount}개`);
    console.log(`  - Published 방: ${publishedRoomCount}개`);
    console.log(`  - 방 사진: ${photoCount}장`);
    console.log(`  - 편의시설: ${amenityCount}개`);
    console.log(`  - 무료 부가서비스: ${serviceCount}개`);

    // 샘플 방 조회 (좌표 있는 것)
    const sampleRooms = await Room.findAll({
      where: {
        status: 'published',
        latitude: { [sequelize.Sequelize.Op.ne]: null },
        longitude: { [sequelize.Sequelize.Op.ne]: null }
      },
      limit: 5,
      order: [['id', 'ASC']],
      attributes: ['id', 'roomName', 'address', 'latitude', 'longitude', 'weeklyRent', 'status']
    });

    console.log('\n📍 샘플 방 데이터 (좌표 포함):');
    sampleRooms.forEach(room => {
      console.log(`  - ID: ${room.id}`);
      console.log(`    이름: ${room.roomName}`);
      console.log(`    주소: ${room.address}`);
      console.log(`    좌표: ${room.latitude}, ${room.longitude}`);
      console.log(`    주간 렌트: ${room.weeklyRent.toLocaleString()}원`);
      console.log(`    상태: ${room.status}`);
      console.log('');
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ 에러:', error);
    process.exit(1);
  }
}

checkStats();
