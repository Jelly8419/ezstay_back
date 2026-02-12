#!/usr/bin/env node

/**
 * 개발/테스트 환경용 계약 관리 CLI 도구
 *
 * 용도: 로컬 개발 시 계약 승인/거절을 간편하게 처리
 *
 * 사용법:
 *   npm run dev:approve-all              # 모든 대기중인 계약 승인
 *   npm run dev:approve <contractId>     # 특정 계약 승인
 *   npm run dev:reject <contractId>      # 특정 계약 거절
 *   npm run dev:contract-status          # 계약 상태 조회
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// 프로덕션 환경 보호
if (process.env.NODE_ENV === 'production') {
  console.error('❌ 에러: 개발 도구는 프로덕션 환경에서 사용할 수 없습니다.');
  process.exit(1);
}

const { Contract, User, Room } = require('../../models');
const { Op } = require('sequelize');

// 커맨드 파싱
const command = process.argv[2];
const arg = process.argv[3];

/**
 * 모든 PENDING_APPROVAL 계약 자동 승인
 */
async function approveAll() {
  try {
    const pendingContracts = await Contract.findAll({
      where: { status: 'PENDING_APPROVAL' },
      include: [
        {
          model: User,
          as: 'host',
          attributes: ['id', 'name', 'email']
        },
        {
          model: User,
          as: 'guest',
          attributes: ['id', 'name', 'email']
        },
        {
          model: Room,
          as: 'room',
          attributes: ['id', 'roomName']
        }
      ]
    });

    if (pendingContracts.length === 0) {
      console.log('✅ 승인 대기중인 계약이 없습니다.');
      return;
    }

    console.log(`\n📋 총 ${pendingContracts.length}건의 계약을 승인합니다...\n`);

    for (const contract of pendingContracts) {
      await contract.update({
        status: 'APPROVED',
        approvedAt: new Date()
      });

      console.log(`✅ 계약 #${contract.id} (주문번호: ${contract.orderId}) 승인 완료`);
      console.log(`   호스트: ${contract.host.name} → 게스트: ${contract.guest.name}`);
      console.log(`   방: ${contract.room.roomName}`);
      console.log('');
    }

    console.log(`🎉 ${pendingContracts.length}건의 계약이 모두 승인되었습니다.`);
  } catch (error) {
    console.error('❌ 에러 발생:', error.message);
    process.exit(1);
  }
}

/**
 * 특정 계약 승인
 */
async function approveOne(contractId) {
  try {
    const contract = await Contract.findByPk(contractId, {
      include: [
        {
          model: User,
          as: 'host',
          attributes: ['id', 'name', 'email']
        },
        {
          model: User,
          as: 'guest',
          attributes: ['id', 'name', 'email']
        },
        {
          model: Room,
          as: 'room',
          attributes: ['id', 'roomName']
        }
      ]
    });

    if (!contract) {
      console.error(`❌ 계약 ID ${contractId}를 찾을 수 없습니다.`);
      process.exit(1);
    }

    if (contract.status !== 'PENDING_APPROVAL') {
      console.error(`❌ 계약 상태가 PENDING_APPROVAL이 아닙니다. (현재: ${contract.status})`);
      process.exit(1);
    }

    await contract.update({
      status: 'APPROVED',
      approvedAt: new Date()
    });

    console.log(`\n✅ 계약 #${contract.id} (주문번호: ${contract.orderId}) 승인 완료`);
    console.log(`   호스트: ${contract.host.name} → 게스트: ${contract.guest.name}`);
    console.log(`   방: ${contract.room.roomName}`);
    console.log(`   체크인: ${contract.checkInDate.toLocaleDateString()}`);
    console.log(`   체크아웃: ${contract.checkOutDate.toLocaleDateString()}\n`);
  } catch (error) {
    console.error('❌ 에러 발생:', error.message);
    process.exit(1);
  }
}

/**
 * 특정 계약 거절
 */
async function rejectOne(contractId) {
  try {
    const contract = await Contract.findByPk(contractId, {
      include: [
        {
          model: User,
          as: 'host',
          attributes: ['id', 'name', 'email']
        },
        {
          model: User,
          as: 'guest',
          attributes: ['id', 'name', 'email']
        }
      ]
    });

    if (!contract) {
      console.error(`❌ 계약 ID ${contractId}를 찾을 수 없습니다.`);
      process.exit(1);
    }

    if (contract.status !== 'PENDING_APPROVAL') {
      console.error(`❌ 계약 상태가 PENDING_APPROVAL이 아닙니다. (현재: ${contract.status})`);
      process.exit(1);
    }

    await contract.update({
      status: 'REJECTED',
      rejectedAt: new Date(),
      cancellationReason: '[테스트] 개발 도구에서 거절됨'
    });

    console.log(`\n❌ 계약 #${contract.id} (주문번호: ${contract.orderId}) 거절 완료`);
    console.log(`   호스트: ${contract.host.name} → 게스트: ${contract.guest.name}\n`);
  } catch (error) {
    console.error('❌ 에러 발생:', error.message);
    process.exit(1);
  }
}

/**
 * 계약 상태 조회
 */
async function showStatus() {
  try {
    const statusCounts = await Contract.findAll({
      attributes: [
        'status',
        [Contract.sequelize.fn('COUNT', Contract.sequelize.col('id')), 'count']
      ],
      group: ['status']
    });

    console.log('\n📊 계약 상태 현황\n');
    console.log('상태                              건수');
    console.log('─'.repeat(50));

    const statusMap = {
      'PENDING_APPROVAL': '승인 대기',
      'APPROVED': '승인됨 (결제 대기)',
      'REJECTED': '거절됨',
      'PAYMENT_COMPLETED': '결제 완료',
      'IN_PROGRESS': '진행중',
      'COMPLETED': '완료',
      'CANCELLED_BY_GUEST': '게스트 취소',
      'CANCELLED_BY_HOST': '호스트 취소',
      'REFUNDED': '환불 완료'
    };

    let total = 0;
    for (const row of statusCounts) {
      const count = parseInt(row.get('count'));
      const statusName = statusMap[row.status] || row.status;
      console.log(`${statusName.padEnd(30)} ${count}건`);
      total += count;
    }

    console.log('─'.repeat(50));
    console.log(`총계                              ${total}건\n`);

    // PENDING_APPROVAL 상세 정보
    const pending = await Contract.findAll({
      where: { status: 'PENDING_APPROVAL' },
      include: [
        {
          model: User,
          as: 'host',
          attributes: ['id', 'name']
        },
        {
          model: User,
          as: 'guest',
          attributes: ['id', 'name']
        },
        {
          model: Room,
          as: 'room',
          attributes: ['id', 'roomName']
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: 10
    });

    if (pending.length > 0) {
      console.log('📋 최근 승인 대기 계약 (최대 10건)\n');
      for (const contract of pending) {
        console.log(`#${contract.id} | ${contract.orderId}`);
        console.log(`   방: ${contract.room.roomName}`);
        console.log(`   호스트: ${contract.host.name} → 게스트: ${contract.guest.name}`);
        console.log(`   체크인: ${contract.checkInDate.toLocaleDateString()}`);
        console.log(`   생성: ${contract.createdAt.toLocaleString()}`);
        console.log('');
      }
    }
  } catch (error) {
    console.error('❌ 에러 발생:', error.message);
    process.exit(1);
  }
}

/**
 * 도움말 표시
 */
function showHelp() {
  console.log(`
📖 계약 관리 CLI 도구 (개발/테스트용)

사용법:
  npm run dev:approve-all              # 모든 대기중인 계약 승인
  npm run dev:approve <contractId>     # 특정 계약 승인
  npm run dev:reject <contractId>      # 특정 계약 거절
  npm run dev:contract-status          # 계약 상태 조회

예시:
  npm run dev:approve-all
  npm run dev:approve 123
  npm run dev:reject 456
  npm run dev:contract-status

⚠️  주의: 이 도구는 개발/테스트 환경에서만 사용하세요.
         프로덕션 환경에서는 자동으로 차단됩니다.
`);
}

// 메인 실행
async function main() {
  console.log('\n🔧 계약 관리 CLI 도구 (개발 환경)\n');

  switch (command) {
    case 'approve-all':
      await approveAll();
      break;
    case 'approve':
      if (!arg) {
        console.error('❌ 에러: 계약 ID를 입력하세요.');
        console.log('사용법: npm run dev:approve <contractId>');
        process.exit(1);
      }
      await approveOne(parseInt(arg));
      break;
    case 'reject':
      if (!arg) {
        console.error('❌ 에러: 계약 ID를 입력하세요.');
        console.log('사용법: npm run dev:reject <contractId>');
        process.exit(1);
      }
      await rejectOne(parseInt(arg));
      break;
    case 'status':
      await showStatus();
      break;
    case 'help':
    case '--help':
    case '-h':
      showHelp();
      break;
    default:
      console.error('❌ 에러: 알 수 없는 명령입니다.');
      showHelp();
      process.exit(1);
  }

  process.exit(0);
}

// 실행
main().catch(error => {
  console.error('❌ 치명적 에러:', error);
  process.exit(1);
});
