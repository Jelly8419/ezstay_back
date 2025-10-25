const { sequelize, RentalItem, RentalItemReservation } = require('../models');
const { Op } = require('sequelize');

/**
 * 렌탈 아이템 비용 계산
 * @param {Object} rentalItems - 렌탈 아이템 정보 {hairDryerId, beddingSetId, beddingSetQuantity, ...}
 * @param {number} totalDays - 총 숙박 일수
 * @returns {Promise<number>} 총 렌탈 비용
 */
async function calculateRentalItemsFee(rentalItems, totalDays) {
  if (!rentalItems || Object.keys(rentalItems).length === 0) {
    return 0;
  }

  let totalFee = 0;
  const itemsToCheck = [];

  // 각 렌탈 아이템 타입별로 처리
  if (rentalItems.hairDryerId) {
    itemsToCheck.push({ id: rentalItems.hairDryerId, quantity: 1 });
  }
  if (rentalItems.beddingSetId && rentalItems.beddingSetQuantity) {
    itemsToCheck.push({
      id: rentalItems.beddingSetId,
      quantity: rentalItems.beddingSetQuantity
    });
  }
  if (rentalItems.amenityKitId && rentalItems.amenityKitQuantity) {
    itemsToCheck.push({
      id: rentalItems.amenityKitId,
      quantity: rentalItems.amenityKitQuantity
    });
  }
  if (rentalItems.towelSetId && rentalItems.towelSetQuantity) {
    itemsToCheck.push({
      id: rentalItems.towelSetId,
      quantity: rentalItems.towelSetQuantity
    });
  }

  // 각 아이템의 가격 조회
  for (const item of itemsToCheck) {
    const rentalItem = await RentalItem.findByPk(item.id);
    if (!rentalItem) {
      throw new Error(`렌탈 아이템을 찾을 수 없습니다. (ID: ${item.id})`);
    }
    if (!rentalItem.isActive) {
      throw new Error(`${rentalItem.name}은(는) 현재 대여 불가능합니다.`);
    }
    totalFee += parseFloat(rentalItem.price) * item.quantity;
  }

  return Math.round(totalFee);
}

/**
 * 할인 금액 계산
 * @param {string} discountCode - 할인 코드 (쿠폰 등)
 * @param {number} subtotal - 할인 전 소계
 * @param {number} totalDays - 총 숙박 일수
 * @param {Object} room - 방 정보 (장기 할인 정보 포함)
 * @returns {Promise<Object>} { discountAmount, discountType }
 */
async function calculateDiscount(discountCode, subtotal, totalDays, room) {
  let discountAmount = 0;
  let discountType = 'NONE';

  // 1. 쿠폰 코드 할인 (우선순위 가장 높음)
  if (discountCode) {
    // TODO: 실제 쿠폰 시스템 구현 시 쿠폰 테이블에서 조회
    // 현재는 임시로 하드코딩
    discountType = 'COUPON';
    discountAmount = 0; // 쿠폰 로직 구현 필요
    return { discountAmount, discountType };
  }

  // 2. 장기 할인 (총 주수 기준)
  const totalWeeks = Math.floor(totalDays / 7);
  if (room.longTermWeeks && room.longTermDiscount && totalWeeks >= room.longTermWeeks) {
    discountType = 'LONG_TERM_DISCOUNT';
    discountAmount = Math.round(subtotal * (room.longTermDiscount / 100));
    return { discountAmount, discountType };
  }

  // 3. 빠른 입주 할인
  if (room.quickMoveInDiscount && room.quickMoveIn) {
    const now = new Date();
    const moveInDate = new Date(room.quickMoveIn);
    if (moveInDate >= now) {
      discountType = 'QUICK_MOVE_IN';
      discountAmount = Math.round(subtotal * (room.quickMoveInDiscount / 100));
      return { discountAmount, discountType };
    }
  }

  return { discountAmount: 0, discountType: 'NONE' };
}

/**
 * 렌탈 아이템 재고 검증
 * @param {number} roomId - 방 ID
 * @param {Object} rentalItems - 렌탈 아이템 정보
 * @param {Date} checkInDate - 체크인 날짜
 * @param {Date} checkOutDate - 체크아웃 날짜
 * @param {Transaction} transaction - Sequelize 트랜잭션
 * @returns {Promise<Object>} { available, unavailableItems }
 */
async function validateRentalItemsStock(roomId, rentalItems, checkInDate, checkOutDate, transaction) {
  if (!rentalItems || Object.keys(rentalItems).length === 0) {
    return { available: true, unavailableItems: [] };
  }

  const itemsToCheck = [];
  const unavailableItems = [];

  // 체크할 아이템 목록 구성
  if (rentalItems.hairDryerId) {
    itemsToCheck.push({ id: rentalItems.hairDryerId, quantity: 1, name: '헤어드라이어' });
  }
  if (rentalItems.beddingSetId && rentalItems.beddingSetQuantity) {
    itemsToCheck.push({
      id: rentalItems.beddingSetId,
      quantity: rentalItems.beddingSetQuantity,
      name: '침구 세트'
    });
  }
  if (rentalItems.amenityKitId && rentalItems.amenityKitQuantity) {
    itemsToCheck.push({
      id: rentalItems.amenityKitId,
      quantity: rentalItems.amenityKitQuantity,
      name: '어메니티 키트'
    });
  }
  if (rentalItems.towelSetId && rentalItems.towelSetQuantity) {
    itemsToCheck.push({
      id: rentalItems.towelSetId,
      quantity: rentalItems.towelSetQuantity,
      name: '수건 세트'
    });
  }

  // 각 아이템의 재고 확인
  for (const item of itemsToCheck) {
    const rentalItem = await RentalItem.findByPk(item.id, { transaction });

    if (!rentalItem) {
      unavailableItems.push({
        itemId: item.id,
        itemName: item.name,
        reason: '아이템을 찾을 수 없습니다'
      });
      continue;
    }

    if (!rentalItem.isActive) {
      unavailableItems.push({
        itemId: item.id,
        itemName: rentalItem.name,
        reason: '현재 대여 불가능한 아이템입니다'
      });
      continue;
    }

    // 해당 기간에 이미 예약된 수량 조회
    const reservedQuantity = await RentalItemReservation.sum('quantity', {
      where: {
        rentalItemId: item.id,
        status: {
          [Op.in]: ['RESERVED', 'CONFIRMED']
        },
        [Op.or]: [
          {
            // 새 예약의 시작일이 기존 예약 기간 내
            reservedFrom: {
              [Op.between]: [checkInDate, checkOutDate]
            }
          },
          {
            // 새 예약의 종료일이 기존 예약 기간 내
            reservedUntil: {
              [Op.between]: [checkInDate, checkOutDate]
            }
          },
          {
            // 새 예약이 기존 예약을 완전히 포함
            [Op.and]: [
              { reservedFrom: { [Op.lte]: checkInDate } },
              { reservedUntil: { [Op.gte]: checkOutDate } }
            ]
          }
        ]
      },
      transaction
    }) || 0;

    const availableQuantity = rentalItem.availableStock - reservedQuantity;

    if (availableQuantity < item.quantity) {
      unavailableItems.push({
        itemId: item.id,
        itemName: rentalItem.name,
        requestedQuantity: item.quantity,
        availableQuantity: Math.max(0, availableQuantity),
        reason: '재고가 부족합니다'
      });
    }
  }

  return {
    available: unavailableItems.length === 0,
    unavailableItems
  };
}

/**
 * 렌탈 아이템 예약 생성 (재고 차감)
 * @param {number} contractId - 계약 ID
 * @param {Object} rentalItems - 렌탈 아이템 정보
 * @param {Date} checkInDate - 체크인 날짜
 * @param {Date} checkOutDate - 체크아웃 날짜
 * @param {Transaction} transaction - Sequelize 트랜잭션
 * @returns {Promise<Array>} 생성된 예약 목록
 */
async function reserveRentalItems(contractId, rentalItems, checkInDate, checkOutDate, transaction) {
  if (!rentalItems || Object.keys(rentalItems).length === 0) {
    return [];
  }

  const itemsToReserve = [];

  // 예약할 아이템 목록 구성
  if (rentalItems.hairDryerId) {
    itemsToReserve.push({ id: rentalItems.hairDryerId, quantity: 1 });
  }
  if (rentalItems.beddingSetId && rentalItems.beddingSetQuantity) {
    itemsToReserve.push({
      id: rentalItems.beddingSetId,
      quantity: rentalItems.beddingSetQuantity
    });
  }
  if (rentalItems.amenityKitId && rentalItems.amenityKitQuantity) {
    itemsToReserve.push({
      id: rentalItems.amenityKitId,
      quantity: rentalItems.amenityKitQuantity
    });
  }
  if (rentalItems.towelSetId && rentalItems.towelSetQuantity) {
    itemsToReserve.push({
      id: rentalItems.towelSetId,
      quantity: rentalItems.towelSetQuantity
    });
  }

  const reservations = [];

  // 각 아이템의 예약 생성
  for (const item of itemsToReserve) {
    const rentalItem = await RentalItem.findByPk(item.id, { transaction });

    if (!rentalItem) {
      throw new Error(`렌탈 아이템을 찾을 수 없습니다. (ID: ${item.id})`);
    }

    // 예약 레코드 생성
    const reservation = await RentalItemReservation.create({
      contractId,
      rentalItemId: item.id,
      quantity: item.quantity,
      pricePerItem: rentalItem.price,
      totalPrice: parseFloat(rentalItem.price) * item.quantity,
      reservedFrom: checkInDate,
      reservedUntil: checkOutDate,
      status: 'RESERVED'
    }, { transaction });

    reservations.push(reservation);
  }

  return reservations;
}

/**
 * 렌탈 아이템 예약 취소 (재고 복구)
 * @param {number} contractId - 계약 ID
 * @param {Transaction} transaction - Sequelize 트랜잭션
 * @returns {Promise<boolean>} 성공 여부
 */
async function cancelRentalItemReservations(contractId, transaction) {
  const reservations = await RentalItemReservation.findAll({
    where: {
      contractId,
      status: {
        [Op.in]: ['RESERVED', 'CONFIRMED']
      }
    },
    transaction
  });

  for (const reservation of reservations) {
    reservation.status = 'CANCELLED';
    await reservation.save({ transaction });
  }

  return true;
}

/**
 * 날짜 검증
 * @param {Date} checkInDate - 체크인 날짜
 * @param {Date} checkOutDate - 체크아웃 날짜
 * @returns {Object} { valid, message, calculatedDays }
 */
function validateDates(checkInDate, checkOutDate) {
  const checkIn = new Date(checkInDate);
  const checkOut = new Date(checkOutDate);

  // 과거 날짜 체크 (당일은 허용, 어제 이전만 거부)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const checkInDateOnly = new Date(checkIn);
  checkInDateOnly.setHours(0, 0, 0, 0);

  if (checkInDateOnly < today) {
    return {
      valid: false,
      message: '과거 날짜는 선택할 수 없습니다'
    };
  }

  // 체크인이 체크아웃보다 늦은지 체크
  if (checkIn >= checkOut) {
    return {
      valid: false,
      message: '체크아웃 날짜는 체크인 날짜보다 늦어야 합니다'
    };
  }

  // 숙박 일수 계산
  const calculatedDays = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));

  // 최소 숙박 일수 체크 (1일 이상)
  if (calculatedDays < 1) {
    return {
      valid: false,
      message: '최소 1일 이상 예약해야 합니다'
    };
  }

  return {
    valid: true,
    message: 'OK',
    calculatedDays
  };
}

module.exports = {
  calculateRentalItemsFee,
  calculateDiscount,
  validateRentalItemsStock,
  reserveRentalItems,
  cancelRentalItemReservations,
  validateDates
};
