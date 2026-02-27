const { sequelize, RentalItem, RentalItemReservation } = require('../models');
const { Op } = require('sequelize');

/**
 * 렌탈 아이템 비용 계산
 * @param {Array} rentalItems - 렌탈 아이템 배열 [{ itemId, quantity }]
 * @param {number} totalDays - 총 숙박 일수
 * @returns {Promise<number>} 총 렌탈 비용
 */
async function calculateRentalItemsFee(rentalItems, totalDays) {
  // 배열 형식 체크
  if (!rentalItems || !Array.isArray(rentalItems) || rentalItems.length === 0) {
    return 0;
  }

  let totalFee = 0;

  // 각 아이템의 가격 조회
  for (const item of rentalItems) {
    const rentalItem = await RentalItem.findByPk(item.itemId);
    if (!rentalItem) {
      throw new Error(`렌탈 아이템을 찾을 수 없습니다. (ID: ${item.itemId})`);
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
 *
 * 할인 적용 순서 (PRICING_CALC.md 참조):
 * 1. 빠른 입주 할인 (고정 금액) - 먼저 적용
 * 2. 장기계약 할인 (%) - 빠른 입주 할인 적용 후 남은 임대료에 적용
 *
 * @param {string} discountCode - 할인 코드 (쿠폰 등)
 * @param {number} baseRent - 기본 임대료 (일 임대료 × 일수)
 * @param {number} totalDays - 총 숙박 일수
 * @param {Date|string} checkInDate - 체크인 날짜
 * @param {Object} room - 방 정보 (할인 정보 포함)
 * @returns {Promise<Object>} { discountAmount, discountType, quickMoveInDiscount, longTermDiscount }
 */
async function calculateDiscount(discountCode, baseRent, totalDays, checkInDate, room) {
  let quickMoveInDiscount = 0;
  let longTermDiscount = 0;
  let discountType = 'NONE';

  // 1. 쿠폰 코드 할인 (최우선)
  if (discountCode) {
    // TODO: 실제 쿠폰 시스템 구현 시 쿠폰 테이블에서 조회
    discountType = 'COUPON';
    return {
      discountAmount: 0,
      discountType,
      quickMoveInDiscount: 0,
      longTermDiscount: 0
    };
  }

  // 2. 빠른 입주 할인 (고정 금액) - 먼저 적용
  // 조건: 체크인 날짜가 오늘로부터 quickMoveIn일 이내
  if (room.quickMoveIn && room.quickMoveInDiscount) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const checkIn = new Date(checkInDate);
    checkIn.setHours(0, 0, 0, 0);

    const daysUntilCheckIn = Math.ceil((checkIn - today) / (1000 * 60 * 60 * 24));

    if (daysUntilCheckIn >= 0 && daysUntilCheckIn <= room.quickMoveIn) {
      // quickMoveInDiscount는 고정 금액 (원)
      quickMoveInDiscount = room.quickMoveInDiscount;
    }
  }

  // 3. 장기계약 할인 (%) - 빠른 입주 할인 적용 후 계산
  // 조건: 선택 기간이 longTermWeeks주 이상
  const totalWeeks = Math.floor(totalDays / 7);
  if (room.longTermWeeks && room.longTermDiscount && totalWeeks >= room.longTermWeeks) {
    // 빠른 입주 할인 적용 후 남은 임대료에 장기계약 할인율 적용
    const adjustedRent = baseRent - quickMoveInDiscount;
    longTermDiscount = Math.floor(adjustedRent * (room.longTermDiscount / 100));
  }

  // 총 할인액 (두 할인 모두 적용 가능)
  const totalDiscount = quickMoveInDiscount + longTermDiscount;

  // discountType 결정 (DB에 저장할 대표 타입)
  if (quickMoveInDiscount > 0 && longTermDiscount > 0) {
    // 둘 다 적용된 경우 금액이 더 큰 것을 대표 타입으로
    discountType = longTermDiscount >= quickMoveInDiscount
      ? 'LONG_TERM_DISCOUNT'
      : 'QUICK_MOVE_IN';
  } else if (longTermDiscount > 0) {
    discountType = 'LONG_TERM_DISCOUNT';
  } else if (quickMoveInDiscount > 0) {
    discountType = 'QUICK_MOVE_IN';
  }

  return {
    discountAmount: totalDiscount,
    discountType,
    quickMoveInDiscount,
    longTermDiscount
  };
}

/**
 * 렌탈 아이템 재고 검증
 * @param {number} roomId - 방 ID
 * @param {Array} rentalItems - 렌탈 아이템 배열 [{ itemId, quantity }]
 * @param {Date} checkInDate - 체크인 날짜
 * @param {Date} checkOutDate - 체크아웃 날짜
 * @param {Transaction} transaction - Sequelize 트랜잭션
 * @returns {Promise<Object>} { available, unavailableItems }
 */
async function validateRentalItemsStock(roomId, rentalItems, checkInDate, checkOutDate, transaction) {
  // 배열 형식 체크
  if (!rentalItems || !Array.isArray(rentalItems) || rentalItems.length === 0) {
    return { available: true, unavailableItems: [] };
  }

  const unavailableItems = [];

  // 각 아이템의 재고 확인
  for (const item of rentalItems) {
    const rentalItem = await RentalItem.findByPk(item.itemId, { transaction });

    if (!rentalItem) {
      unavailableItems.push({
        itemId: item.itemId,
        itemName: '알 수 없음',
        reason: '아이템을 찾을 수 없습니다'
      });
      continue;
    }

    if (!rentalItem.isActive) {
      unavailableItems.push({
        itemId: item.itemId,
        itemName: rentalItem.name,
        reason: '현재 대여 불가능한 아이템입니다'
      });
      continue;
    }

    // 해당 기간에 이미 예약된 수량 조회
    const reservedQuantity = await RentalItemReservation.sum('quantity', {
      where: {
        rentalItemId: item.itemId,
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
        itemId: item.itemId,
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
 * @param {Array} rentalItems - 렌탈 아이템 배열 [{ itemId, quantity }]
 * @param {Date} checkInDate - 체크인 날짜
 * @param {Date} checkOutDate - 체크아웃 날짜
 * @param {Transaction} transaction - Sequelize 트랜잭션
 * @returns {Promise<Array>} 생성된 예약 목록
 */
async function reserveRentalItems(contractId, rentalItems, checkInDate, checkOutDate, transaction) {
  // 배열 형식 체크
  if (!rentalItems || !Array.isArray(rentalItems) || rentalItems.length === 0) {
    return [];
  }

  const reservations = [];

  // 각 아이템의 예약 생성
  for (const item of rentalItems) {
    const rentalItem = await RentalItem.findByPk(item.itemId, { transaction });

    if (!rentalItem) {
      throw new Error(`렌탈 아이템을 찾을 수 없습니다. (ID: ${item.itemId})`);
    }

    // 예약 레코드 생성
    const reservation = await RentalItemReservation.create({
      contractId,
      rentalItemId: item.itemId,
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
 * EZ청소서비스 청소비 계산
 * - 기본금: 50,000원
 * - 10평 초과 시: 10평당 20,000원 추가
 *
 * @param {Object} room - 방 정보 (area, cleaningFee, ezService 포함)
 * @returns {number} 청소비
 *
 * @example
 * // area 1~10평: 50,000원
 * // area 11~20평: 50,000 + 20,000 = 70,000원
 * // area 21~30평: 50,000 + 40,000 = 90,000원
 */
function calculateCleaningFee(room) {
  const EZ_CLEANING_BASE_FEE = 50000;        // 기본금 5만원
  const EZ_CLEANING_EXTRA_PER_10_PYEONG = 20000;  // 10평당 추가 2만원
  const EZ_CLEANING_BASE_AREA = 10;          // 기준 면적 10평

  // EZ청소서비스 사용 여부 확인
  const usesEzCleaningService = room.ezService?.cleaningService || false;

  if (!usesEzCleaningService) {
    // EZ청소서비스 미사용 시 기존 cleaningFee 사용
    return room.cleaningFee || 0;
  }

  // EZ청소서비스 사용 시 면적 기반 계산
  const area = room.area || 0;

  if (area <= EZ_CLEANING_BASE_AREA) {
    // 10평 이하: 기본금만
    return EZ_CLEANING_BASE_FEE;
  }

  // 10평 초과: 기본금 + 초과분 계산 (올림)
  // 11~20평: 1단위(+2만원), 21~30평: 2단위(+4만원)
  const extraPyeong = area - EZ_CLEANING_BASE_AREA;
  const extraUnits = Math.ceil(extraPyeong / 10);  // 10평 단위로 계산 (올림)

  return EZ_CLEANING_BASE_FEE + (extraUnits * EZ_CLEANING_EXTRA_PER_10_PYEONG);
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

  // 임대기간 검증 (플랫폼 정책: 7~90일)
  if (calculatedDays < 7) {
    return {
      valid: false,
      message: '최소 7일 이상 예약해야 합니다'
    };
  }

  if (calculatedDays > 90) {
    return {
      valid: false,
      message: '최대 90일까지 예약 가능합니다'
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
  calculateCleaningFee,
  validateRentalItemsStock,
  reserveRentalItems,
  cancelRentalItemReservations,
  validateDates
};
