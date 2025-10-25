/**
 * 기존 승인된 계약들의 채팅방 일괄 생성 스크립트
 *
 * 실행 방법:
 * node scripts/createChatRoomsForExistingContracts.js
 */

require('dotenv').config();
const { Contract, ChatRoom, Room, User } = require('../models');
const { createChatRoomMetadata } = require('../config/firebaseAdmin');
const { initializeFirebase } = require('../config/firebaseAdmin');

async function createChatRoomsForExistingContracts() {
  try {
    console.log('🚀 Firebase 초기화 중...');
    initializeFirebase();

    console.log('📋 승인된 계약 조회 중...');

    // 승인된 계약 중 채팅방이 없는 계약 조회
    const validStatuses = ['APPROVED', 'PAYMENT_COMPLETED', 'IN_PROGRESS', 'COMPLETED'];

    const contracts = await Contract.findAll({
      where: {
        status: validStatuses
      },
      include: [
        {
          model: Room,
          as: 'room',
          attributes: ['id', 'roomName', 'address']
        },
        {
          model: User,
          as: 'host',
          attributes: ['id', 'name', 'profileImageUrl']
        },
        {
          model: User,
          as: 'guest',
          attributes: ['id', 'name', 'profileImageUrl']
        },
        {
          model: ChatRoom,
          as: 'chatRoom',
          required: false // LEFT JOIN
        }
      ]
    });

    console.log(`✅ 총 ${contracts.length}개의 승인된 계약 발견`);

    // 채팅방이 없는 계약 필터링
    const contractsWithoutChatRoom = contracts.filter(contract => !contract.chatRoom);
    console.log(`📌 채팅방이 없는 계약: ${contractsWithoutChatRoom.length}개`);

    if (contractsWithoutChatRoom.length === 0) {
      console.log('✨ 모든 계약에 채팅방이 이미 존재합니다.');
      return;
    }

    let successCount = 0;
    let failCount = 0;

    // 각 계약에 대해 채팅방 생성
    for (const contract of contractsWithoutChatRoom) {
      try {
        console.log(`\n📍 계약 ID ${contract.id} 처리 중...`);

        // Firebase 채팅방 ID 생성
        const firebaseChatRoomId = ChatRoom.generateFirebaseChatRoomId(contract.id);

        // MySQL에 채팅방 정보 저장
        const chatRoom = await ChatRoom.create({
          contractId: contract.id,
          firebaseChatRoomId,
          hostId: contract.hostId,
          guestId: contract.guestId,
          roomId: contract.roomId,
          isActive: contract.status !== 'COMPLETED' // 완료된 계약은 비활성
        });

        console.log(`  ✓ MySQL 채팅방 생성: ${firebaseChatRoomId}`);

        // Firestore에 채팅방 메타데이터 저장
        await createChatRoomMetadata(firebaseChatRoomId, {
          contractId: contract.id,
          hostId: contract.hostId,
          guestId: contract.guestId,
          roomId: contract.roomId,
          roomInfo: {
            name: contract.room.roomName,
            address: contract.room.address
          },
          hostInfo: {
            id: contract.host.id,
            name: contract.host.name,
            profileImageUrl: contract.host.profileImageUrl
          },
          guestInfo: {
            id: contract.guest.id,
            name: contract.guest.name,
            profileImageUrl: contract.guest.profileImageUrl
          },
          checkInDate: contract.checkInDate,
          checkOutDate: contract.checkOutDate,
          isActive: contract.status !== 'COMPLETED'
        });

        console.log(`  ✓ Firestore 메타데이터 생성 완료`);
        successCount++;

      } catch (error) {
        console.error(`  ✗ 계약 ID ${contract.id} 처리 실패:`, error.message);
        failCount++;
      }
    }

    console.log('\n' + '='.repeat(50));
    console.log(`🎉 채팅방 생성 완료!`);
    console.log(`  ✅ 성공: ${successCount}개`);
    console.log(`  ❌ 실패: ${failCount}개`);
    console.log('='.repeat(50));

  } catch (error) {
    console.error('❌ 스크립트 실행 오류:', error);
    process.exit(1);
  } finally {
    // DB 연결 종료
    process.exit(0);
  }
}

// 스크립트 실행
createChatRoomsForExistingContracts();
