const { Room, Contract, BlockedPeriod, User } = require('../models');
const { Op } = require('sequelize');

/**
 * 통합 일정 데이터 조회
 * @param {number} roomId - 방 ID
 * @param {string} startDate - 조회 시작일 (YYYY-MM-DD)
 * @param {string} endDate - 조회 종료일 (YYYY-MM-DD)
 * @returns {Promise<Object>} 방 정보, 계약 목록, 불가 기간 목록
 */
async function getScheduleData(roomId, startDate, endDate) {
  // 날짜 기본값 설정 (오늘 ~ 오늘+12개월)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const defaultStartDate = today.toISOString().split('T')[0];

  const oneYearLater = new Date(today);
  oneYearLater.setMonth(oneYearLater.getMonth() + 12);
  const defaultEndDate = oneYearLater.toISOString().split('T')[0];

  const queryStartDate = startDate || defaultStartDate;
  const queryEndDate = endDate || defaultEndDate;

  // 병렬로 모든 데이터 조회 (Network Round-Trip 최소화)
  const [room, contracts, blockedPeriods] = await Promise.all([
    // 방 기본 정보 조회
    Room.findByPk(roomId, {
      attributes: ['id', 'roomName', 'address', 'detailAddress']
    }),

    // 계약 목록 조회 (확정된 계약만)
    Contract.findAll({
      where: {
        roomId,
        status: {
          [Op.in]: ['PAYMENT_COMPLETED', 'IN_PROGRESS']
        },
        // 조회 범위와 겹치는 계약만 조회
        [Op.and]: [
          { checkInDate: { [Op.lte]: queryEndDate } },
          { checkOutDate: { [Op.gte]: queryStartDate } }
        ]
      },
      include: [
        {
          model: User,
          as: 'guest',
          attributes: ['id', 'name']
        }
      ],
      order: [['checkInDate', 'ASC']]
    }),

    // 불가 기간 목록 조회
    BlockedPeriod.findAll({
      where: {
        roomId,
        // 조회 범위와 겹치는 불가 기간만 조회
        [Op.and]: [
          { startDate: { [Op.lte]: queryEndDate } },
          { endDate: { [Op.gte]: queryStartDate } }
        ]
      },
      order: [['startDate', 'ASC']]
    })
  ]);

  if (!room) {
    throw new Error('ROOM_NOT_FOUND');
  }

  // 응답 데이터 포맷팅
  const formattedContracts = contracts.map(contract => ({
    id: contract.orderId,
    startDate: contract.checkInDate.toISOString().split('T')[0],
    endDate: contract.checkOutDate.toISOString().split('T')[0],
    guestName: contract.guest ? contract.guest.name : '알 수 없음',
    guestId: contract.guestId,
    status: contract.status === 'PAYMENT_COMPLETED' ? 'confirmed' : 'in_progress',
    totalPrice: contract.finalTotalAmount,
    createdAt: contract.createdAt.toISOString()
  }));

  const formattedBlockedPeriods = blockedPeriods.map(blocked => ({
    id: blocked.id,
    startDate: blocked.startDate,
    endDate: blocked.endDate,
    reason: blocked.reason || '',
    createdAt: blocked.createdAt.toISOString()
  }));

  return {
    roomInfo: {
      roomId: room.id,
      propertyName: room.roomName,
      propertyAddress: room.address,
      detailAddress: room.detailAddress
    },
    contracts: formattedContracts,
    blockedPeriods: formattedBlockedPeriods,
    totalContracts: formattedContracts.length,
    totalBlockedPeriods: formattedBlockedPeriods.length
  };
}

/**
 * 계약 불가 기간 생성
 * @param {number} roomId - 방 ID
 * @param {number} hostId - 호스트 ID
 * @param {string} startDate - 시작 날짜 (YYYY-MM-DD)
 * @param {string} endDate - 종료 날짜 (YYYY-MM-DD)
 * @param {string} reason - 불가 사유 (옵션)
 * @returns {Promise<Object>} 생성된 불가 기간 정보
 */
async function createBlockedPeriod(roomId, hostId, startDate, endDate, reason) {
  // 1. 날짜 검증
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const start = new Date(startDate);
  const end = new Date(endDate);

  // 과거 날짜 체크
  if (start < today) {
    throw new Error('PAST_DATE_NOT_ALLOWED');
  }

  // 날짜 순서 체크
  if (end < start) {
    throw new Error('INVALID_DATE_RANGE');
  }

  // 2. 계약 충돌 검증 (확정된 계약과 겹치는지 확인)
  const conflictingContracts = await Contract.findAll({
    where: {
      roomId,
      status: {
        [Op.in]: ['PAYMENT_COMPLETED', 'IN_PROGRESS']
      },
      [Op.or]: [
        // 계약의 시작일이 설정 범위 내
        {
          checkInDate: {
            [Op.between]: [startDate, endDate]
          }
        },
        // 계약의 종료일이 설정 범위 내
        {
          checkOutDate: {
            [Op.between]: [startDate, endDate]
          }
        },
        // 계약이 설정 범위를 완전히 포함
        {
          [Op.and]: [
            { checkInDate: { [Op.lte]: startDate } },
            { checkOutDate: { [Op.gte]: endDate } }
          ]
        }
      ]
    },
    attributes: ['orderId', 'checkInDate', 'checkOutDate']
  });

  if (conflictingContracts.length > 0) {
    const conflictDetails = conflictingContracts.map(c => ({
      id: c.orderId,
      startDate: c.checkInDate.toISOString().split('T')[0],
      endDate: c.checkOutDate.toISOString().split('T')[0]
    }));

    const error = new Error('CONFLICT_WITH_CONTRACT');
    error.details = { conflictingContracts: conflictDetails };
    throw error;
  }

  // 3. 불가 기간 생성
  const blockedPeriod = await BlockedPeriod.create({
    roomId,
    startDate,
    endDate,
    reason: reason || null,
    createdBy: hostId
  });

  return {
    id: blockedPeriod.id,
    startDate: blockedPeriod.startDate,
    endDate: blockedPeriod.endDate,
    reason: blockedPeriod.reason || '',
    createdAt: blockedPeriod.createdAt.toISOString()
  };
}

/**
 * 계약 불가 기간 삭제
 * @param {number} blockedId - 불가 기간 ID
 * @param {number} hostId - 호스트 ID
 * @returns {Promise<number>} 삭제된 불가 기간 ID
 */
async function deleteBlockedPeriod(blockedId, hostId) {
  // 1. 불가 기간 조회
  const blockedPeriod = await BlockedPeriod.findByPk(blockedId);

  if (!blockedPeriod) {
    throw new Error('BLOCKED_PERIOD_NOT_FOUND');
  }

  // 2. 권한 검증 (생성한 호스트만 삭제 가능)
  if (blockedPeriod.createdBy !== hostId) {
    throw new Error('FORBIDDEN');
  }

  // 3. 삭제
  await blockedPeriod.destroy();

  return blockedId;
}

/**
 * 계약 불가 기간 부분 해제 (기간 분할)
 * @param {number} roomId - 방 ID
 * @param {number} hostId - 호스트 ID
 * @param {string} startDate - 해제 시작 날짜 (YYYY-MM-DD)
 * @param {string} endDate - 해제 종료 날짜 (YYYY-MM-DD)
 * @returns {Promise<Object>} 생성/삭제된 불가 기간 정보
 */
async function unblockPeriod(roomId, hostId, startDate, endDate) {
  const { sequelize } = require('../models');

  // 날짜 검증
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (end < start) {
    throw new Error('INVALID_DATE_RANGE');
  }

  // 트랜잭션으로 원자성 보장
  const transaction = await sequelize.transaction();

  try {
    // 1. 해제 범위와 겹치는 모든 불가 기간 조회
    const overlappingPeriods = await BlockedPeriod.findAll({
      where: {
        roomId,
        createdBy: hostId, // 본인이 생성한 것만
        [Op.or]: [
          // 불가 기간의 시작일이 해제 범위 내
          {
            startDate: {
              [Op.between]: [startDate, endDate]
            }
          },
          // 불가 기간의 종료일이 해제 범위 내
          {
            endDate: {
              [Op.between]: [startDate, endDate]
            }
          },
          // 불가 기간이 해제 범위를 완전히 포함
          {
            [Op.and]: [
              { startDate: { [Op.lte]: startDate } },
              { endDate: { [Op.gte]: endDate } }
            ]
          }
        ]
      },
      transaction
    });

    const deletedPeriods = [];
    const createdPeriods = [];

    // 2. 각 불가 기간 처리
    for (const period of overlappingPeriods) {
      const periodStart = new Date(period.startDate);
      const periodEnd = new Date(period.endDate);
      const unblockStart = new Date(startDate);
      const unblockEnd = new Date(endDate);

      // 원본 삭제
      await period.destroy({ transaction });
      deletedPeriods.push({
        id: period.id,
        startDate: period.startDate,
        endDate: period.endDate
      });

      // 이전 부분 생성 (불가 기간 시작 ~ 해제 시작-1일)
      if (periodStart < unblockStart) {
        const prevEnd = new Date(unblockStart);
        prevEnd.setDate(prevEnd.getDate() - 1);

        const prevPeriod = await BlockedPeriod.create({
          roomId,
          startDate: period.startDate,
          endDate: prevEnd.toISOString().split('T')[0],
          reason: period.reason,
          createdBy: hostId
        }, { transaction });

        createdPeriods.push({
          id: prevPeriod.id,
          startDate: prevPeriod.startDate,
          endDate: prevPeriod.endDate,
          reason: prevPeriod.reason || ''
        });
      }

      // 이후 부분 생성 (해제 종료+1일 ~ 불가 기간 종료)
      if (periodEnd > unblockEnd) {
        const nextStart = new Date(unblockEnd);
        nextStart.setDate(nextStart.getDate() + 1);

        const nextPeriod = await BlockedPeriod.create({
          roomId,
          startDate: nextStart.toISOString().split('T')[0],
          endDate: period.endDate,
          reason: period.reason,
          createdBy: hostId
        }, { transaction });

        createdPeriods.push({
          id: nextPeriod.id,
          startDate: nextPeriod.startDate,
          endDate: nextPeriod.endDate,
          reason: nextPeriod.reason || ''
        });
      }
    }

    await transaction.commit();

    return {
      unlockedPeriod: {
        startDate,
        endDate
      },
      deletedPeriods,
      createdPeriods,
      totalDeleted: deletedPeriods.length,
      totalCreated: createdPeriods.length
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

/**
 * 방의 계약 목록 조회
 * @param {number} roomId - 방 ID
 * @param {string} startDate - 조회 시작일 (YYYY-MM-DD, 옵션)
 * @param {string} endDate - 조회 종료일 (YYYY-MM-DD, 옵션)
 * @returns {Promise<Object>} 계약 목록
 */
async function getContracts(roomId, startDate, endDate) {
  const whereClause = {
    roomId,
    status: {
      [Op.in]: ['PAYMENT_COMPLETED', 'IN_PROGRESS']
    }
  };

  // 날짜 필터가 있으면 적용
  if (startDate && endDate) {
    whereClause[Op.and] = [
      { checkInDate: { [Op.lte]: endDate } },
      { checkOutDate: { [Op.gte]: startDate } }
    ];
  }

  const contracts = await Contract.findAll({
    where: whereClause,
    include: [
      {
        model: User,
        as: 'guest',
        attributes: ['id', 'name']
      }
    ],
    order: [['checkInDate', 'ASC']]
  });

  const formattedContracts = contracts.map(contract => ({
    contractId: contract.orderId,
    guestName: contract.guest ? contract.guest.name : '알 수 없음',
    checkInDate: contract.checkInDate.toISOString().split('T')[0],
    checkOutDate: contract.checkOutDate.toISOString().split('T')[0],
    status: contract.status,
    totalAmount: contract.finalTotalAmount,
    createdAt: contract.createdAt.toISOString()
  }));

  return {
    contracts: formattedContracts,
    totalCount: formattedContracts.length
  };
}

/**
 * 방의 계약 불가 기간 목록 조회
 * @param {number} roomId - 방 ID
 * @param {string} startDate - 조회 시작일 (YYYY-MM-DD, 옵션)
 * @param {string} endDate - 조회 종료일 (YYYY-MM-DD, 옵션)
 * @returns {Promise<Object>} 불가 기간 목록
 */
async function getBlockedPeriods(roomId, startDate, endDate) {
  const whereClause = { roomId };

  // 날짜 필터가 있으면 적용
  if (startDate && endDate) {
    whereClause[Op.and] = [
      { startDate: { [Op.lte]: endDate } },
      { endDate: { [Op.gte]: startDate } }
    ];
  }

  const blockedPeriods = await BlockedPeriod.findAll({
    where: whereClause,
    order: [['startDate', 'ASC']]
  });

  const formattedPeriods = blockedPeriods.map(blocked => ({
    blockedPeriodId: blocked.id,
    startDate: blocked.startDate,
    endDate: blocked.endDate,
    reason: blocked.reason || '',
    createdAt: blocked.createdAt.toISOString()
  }));

  return {
    blockedPeriods: formattedPeriods,
    totalCount: formattedPeriods.length
  };
}

/**
 * 방 기본 정보 조회
 * @param {number} roomId - 방 ID
 * @returns {Promise<Object>} 방 기본 정보
 */
async function getRoomScheduleInfo(roomId) {
  const room = await Room.findByPk(roomId, {
    attributes: ['id', 'roomName', 'address']
  });

  if (!room) {
    throw new Error('ROOM_NOT_FOUND');
  }

  return {
    roomId: room.id,
    propertyName: room.roomName,
    propertyAddress: room.address
  };
}

module.exports = {
  getScheduleData,
  createBlockedPeriod,
  deleteBlockedPeriod,
  unblockPeriod,
  getContracts,
  getBlockedPeriods,
  getRoomScheduleInfo
};
