const { RentalItem } = require('../models');
const { Op } = require('sequelize');
const { ErrorCodes, success, error, created, updated, deleted } = require('../utils/responseHelper');
const { RENTAL_BUFFER_DAYS } = require('../utils/rentalOrderHelper');
const { toKSTString } = require('../utils/dateHelper');

// ============================================
// 게스트용 공개 API (인증 불필요)
// ============================================

/**
 * 활성화된 렌탈 아이템 목록 조회 (게스트용)
 * @route GET /api/rental-items
 * @query {string} itemType - 물품 카테고리 필터 (선택)
 * @query {boolean} inStock - 재고 있는 것만 조회 (선택, 기본 true)
 */
const getPublicRentalItems = async (req, res) => {
  try {
    const { itemType } = req.query;
    const where = {
      isActive: true
    };

    if (itemType) {
      where.itemType = itemType;
    }

    const items = await RentalItem.findAll({
      where,
      attributes: ['id', 'itemType', 'name', 'description', 'price', 'totalStock', 'imageUrl'],
      order: [
        ['itemType', 'ASC'],
        ['price', 'ASC']
      ]
    });

    // 카테고리 한글명 추가
    const itemsWithLabels = items.map(item => ({
      ...item.toJSON(),
      itemTypeLabel: RentalItem.ITEM_TYPE_LABELS[item.itemType] || item.itemType
    }));

    return success(res, itemsWithLabels, '대여 물품 목록을 조회했습니다.');
  } catch (err) {
    console.error('getPublicRentalItems Error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 특정 렌탈 아이템 상세 조회 (게스트용)
 * @route GET /api/rental-items/:id
 */
const getPublicRentalItemById = async (req, res) => {
  try {
    const item = await RentalItem.findOne({
      where: {
        id: req.params.id,
        isActive: true
      },
      attributes: ['id', 'itemType', 'name', 'description', 'price', 'totalStock', 'imageUrl']
    });

    if (!item) {
      return error(res, {
        code: 3010,
        message: '대여 물품을 찾을 수 없습니다.'
      }, 404);
    }

    const itemWithLabel = {
      ...item.toJSON(),
      itemTypeLabel: RentalItem.ITEM_TYPE_LABELS[item.itemType] || item.itemType
    };

    return success(res, itemWithLabel, '대여 물품 정보를 조회했습니다.');
  } catch (err) {
    console.error('getPublicRentalItemById Error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 카테고리별 렌탈 아이템 조회 (게스트용)
 * @route GET /api/rental-items/type/:itemType
 */
const getPublicRentalItemsByType = async (req, res) => {
  try {
    const { itemType } = req.params;

    // 유효한 카테고리인지 검증
    const validTypes = ['hair_dryer', 'bedding_set', 'amenity_kit', 'towel_set', 'other'];
    if (!validTypes.includes(itemType)) {
      return error(res, {
        code: 4010,
        message: `유효하지 않은 물품 카테고리입니다. (${validTypes.join(', ')})`
      }, 400);
    }

    const items = await RentalItem.getAvailableItemsByType(itemType);

    const itemsWithLabels = items.map(item => ({
      ...item.toJSON(),
      itemTypeLabel: RentalItem.ITEM_TYPE_LABELS[item.itemType] || item.itemType
    }));

    return success(res, {
      itemType,
      itemTypeLabel: RentalItem.ITEM_TYPE_LABELS[itemType],
      items: itemsWithLabels
    }, '카테고리별 대여 물품을 조회했습니다.');
  } catch (err) {
    console.error('getPublicRentalItemsByType Error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 물품 카테고리 목록 조회 (게스트용)
 * @route GET /api/rental-items/categories
 */
const getRentalCategories = async (req, res) => {
  try {
    const categories = Object.entries(RentalItem.ITEM_TYPE_LABELS).map(([key, label]) => ({
      value: key,
      label
    }));

    return success(res, categories, '대여 물품 카테고리 목록을 조회했습니다.');
  } catch (err) {
    console.error('getRentalCategories Error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

// ============================================
// 관리자용 API (인증 필요)
// ============================================

/**
 * 모든 대여 물품 조회 (관리자용)
 * @route GET /api/admin/rental-items
 * @query {string} itemType - 물품 카테고리 필터 (선택)
 * @query {boolean} isActive - 활성화 상태 필터 (선택)
 */
const getAllRentalItems = async (req, res) => {
  try {
    const { itemType, isActive } = req.query;
    const where = {};

    if (itemType) {
      where.itemType = itemType;
    }

    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    }

    const items = await RentalItem.findAll({
      where,
      order: [
        ['item_type', 'ASC'],
        ['price', 'ASC']
      ]
    });

    const itemsWithMeta = items.map(item => {
      const itemData = item.toJSON();
      return {
        ...itemData,
        salesTypeLabel: RentalItem.SALES_TYPE_LABELS[item.salesType] || item.salesType,
        itemTypeLabel: RentalItem.ITEM_TYPE_LABELS[item.itemType] || item.itemType,
        createdAt: toKSTString(itemData.createdAt),
        updatedAt: toKSTString(itemData.updatedAt)
      };
    });

    return success(res, itemsWithMeta, '대여 물품 목록을 조회했습니다.');
  } catch (err) {
    console.error('getAllRentalItems Error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 특정 대여 물품 조회
 * @route GET /api/admin/rental-items/:id
 */
const getRentalItemById = async (req, res) => {
  try {
    const item = await RentalItem.findByPk(req.params.id);

    if (!item) {
      return error(res, {
        code: 3010,
        message: '대여 물품을 찾을 수 없습니다.'
      }, 404);
    }

    const itemData = item.toJSON();
    const itemWithMeta = {
      ...itemData,
      salesTypeLabel: RentalItem.SALES_TYPE_LABELS[item.salesType] || item.salesType,
      itemTypeLabel: RentalItem.ITEM_TYPE_LABELS[item.itemType] || item.itemType,
      createdAt: toKSTString(itemData.createdAt),
      updatedAt: toKSTString(itemData.updatedAt)
    };

    return success(res, itemWithMeta, '대여 물품 정보를 조회했습니다.');
  } catch (err) {
    console.error('getRentalItemById Error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 새 대여 물품 등록 (관리자용)
 * @route POST /api/admin/rental-items
 */
const createRentalItem = async (req, res) => {
  try {
    const {
      itemType,
      salesType,
      name,
      description,
      price,
      totalStock,
      imageUrl,
      isActive
    } = req.body;

    // 필수 필드 검증
    if (!itemType || !salesType || !name || price === undefined || totalStock === undefined) {
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400, {
        required: ['itemType', 'salesType', 'name', 'price', 'totalStock']
      });
    }

    // salesType 유효성 검증
    if (!['SALE', 'RENTAL'].includes(salesType)) {
      return error(res, {
        code: 4010,
        message: 'salesType은 SALE 또는 RENTAL이어야 합니다.'
      }, 400);
    }

    // 가격과 재고는 음수 불가
    if (price < 0 || totalStock < 0) {
      return error(res, {
        code: 4005,
        message: '가격과 재고는 0 이상이어야 합니다.'
      }, 400);
    }

    const newItem = await RentalItem.create({
      itemType,
      salesType,
      name,
      description,
      price,
      totalStock,
      imageUrl,
      isActive: isActive !== undefined ? isActive : true
    });

    return created(res, newItem, '대여 물품이 등록되었습니다.');
  } catch (err) {
    console.error('createRentalItem Error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 대여 물품 정보 수정 (관리자용)
 * @route PATCH /api/admin/rental-items/:id
 */
const updateRentalItem = async (req, res) => {
  try {
    const item = await RentalItem.findByPk(req.params.id);

    if (!item) {
      return error(res, {
        code: 3010,
        message: '대여 물품을 찾을 수 없습니다.'
      }, 404);
    }

    const {
      salesType,
      name,
      description,
      price,
      totalStock,
      imageUrl,
      isActive
    } = req.body;

    // salesType 유효성 검증
    if (salesType !== undefined && !['SALE', 'RENTAL'].includes(salesType)) {
      return error(res, {
        code: 4010,
        message: 'salesType은 SALE 또는 RENTAL이어야 합니다.'
      }, 400);
    }

    if (totalStock !== undefined) {
      if (totalStock < 0) {
        return error(res, { code: 4006, message: '총 재고는 0 이상이어야 합니다.' }, 400);
      }
      item.totalStock = totalStock;
    }

    // 나머지 필드 업데이트
    if (salesType !== undefined) item.salesType = salesType;
    if (name !== undefined) item.name = name;
    if (description !== undefined) item.description = description;
    if (price !== undefined) {
      if (price < 0) {
        return error(res, {
          code: 4005,
          message: '가격은 0 이상이어야 합니다.'
        }, 400);
      }
      item.price = price;
    }
    if (imageUrl !== undefined) item.imageUrl = imageUrl;
    if (isActive !== undefined) item.isActive = isActive;

    await item.save();

    return updated(res, item, '대여 물품 정보가 수정되었습니다.');
  } catch (err) {
    console.error('updateRentalItem Error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 대여 물품 삭제 (관리자용)
 * @route DELETE /api/admin/rental-items/:id
 */
const deleteRentalItem = async (req, res) => {
  try {
    const item = await RentalItem.findByPk(req.params.id);

    if (!item) {
      return error(res, {
        code: 3010,
        message: '대여 물품을 찾을 수 없습니다.'
      }, 404);
    }

    const { RentalItemReservation } = require('../models');
    const { Op } = require('sequelize');
    const activeReservations = await RentalItemReservation.count({
      where: {
        rentalItemId: item.id,
        status: { [Op.in]: ['RESERVED', 'CONFIRMED'] }
      }
    });
    if (activeReservations > 0) {
      return error(res, {
        code: 4007,
        message: `활성 예약(${activeReservations}건)이 있어 삭제할 수 없습니다. 비활성화를 권장합니다.`
      }, 400);
    }

    await item.destroy();

    return deleted(res, '대여 물품이 삭제되었습니다.');
  } catch (err) {
    console.error('deleteRentalItem Error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 렌탈 아이템 전체 월별 캘린더 일괄 조회 (관리자용)
 * salesType = RENTAL인 모든 아이템의 날짜별 예약 현황을 한 번에 반환
 * @route GET /api/admin/rental-items/calendar
 * @query {number} year - 연도 (필수)
 * @query {number} month - 월 1-12 (필수)
 */
const getAllRentalItemsCalendar = async (req, res) => {
  try {
    const { year, month } = req.query;

    const yearNum = parseInt(year);
    const monthNum = parseInt(month);
    if (!year || !month || isNaN(yearNum) || isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
      return error(res, {
        code: 4001,
        message: 'year와 month는 필수이며 유효한 숫자여야 합니다. (month: 1-12)'
      }, 400);
    }

    // RENTAL 타입 활성 아이템 전체 조회
    const items = await RentalItem.findAll({
      where: { salesType: 'RENTAL', isActive: true },
      attributes: ['id', 'name', 'itemType', 'totalStock'],
      order: [['item_type', 'ASC'], ['id', 'ASC']]
    });

    if (items.length === 0) {
      return success(res, { year: yearNum, month: monthNum, items: [] }, '렌탈 아이템 캘린더를 조회했습니다.');
    }

    // 월 범위 (KST 기준)
    const monthStart = new Date(`${yearNum}-${String(monthNum).padStart(2, '0')}-01T00:00:00`);
    const lastDay = new Date(yearNum, monthNum, 0).getDate();
    const monthEnd = new Date(`${yearNum}-${String(monthNum).padStart(2, '0')}-${lastDay}T23:59:59`);
    const itemIds = items.map(i => i.id);

    const { RentalItemReservation } = require('../models');
    const reservations = await RentalItemReservation.findAll({
      where: {
        rentalItemId: { [Op.in]: itemIds },
        status: { [Op.in]: ['RESERVED', 'CONFIRMED'] },
        [Op.or]: [
          { reservedFrom: { [Op.between]: [monthStart, monthEnd] } },
          { reservedUntil: { [Op.between]: [monthStart, monthEnd] } },
          {
            reservedFrom: { [Op.lte]: monthStart },
            reservedUntil: { [Op.gte]: monthEnd }
          }
        ]
      },
      attributes: ['rentalItemId', 'reservedFrom', 'reservedUntil', 'quantity']
    });

    // 아이템별로 예약 분류
    const reservationsByItem = {};
    for (const itemId of itemIds) reservationsByItem[itemId] = [];
    for (const r of reservations) reservationsByItem[r.rentalItemId].push(r);

    // 아이템별 날짜별 집계
    const result = items.map(item => {
      const itemReservations = reservationsByItem[item.id];
      const calendar = {};

      const bufferMs = RENTAL_BUFFER_DAYS * 24 * 60 * 60 * 1000;

      for (let d = 1; d <= lastDay; d++) {
        const dateStr = `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const dayStart = new Date(`${dateStr}T00:00:00`);
        const dayEnd = new Date(`${dateStr}T23:59:59`);

        const reservedQuantity = itemReservations.reduce((sum, r) => {
          const bufferedFrom = new Date(r.reservedFrom.getTime() - bufferMs);
          const bufferedUntil = new Date(r.reservedUntil.getTime() + bufferMs);
          if (bufferedFrom <= dayEnd && bufferedUntil >= dayStart) {
            return sum + r.quantity;
          }
          return sum;
        }, 0);

        calendar[dateStr] = {
          reservedQuantity,
          availableQuantity: item.totalStock - reservedQuantity
        };
      }

      return {
        rentalItemId: item.id,
        name: item.name,
        itemType: item.itemType,
        itemTypeLabel: RentalItem.ITEM_TYPE_LABELS[item.itemType] || item.itemType,
        totalStock: item.totalStock,
        calendar
      };
    });

    return success(res, {
      year: yearNum,
      month: monthNum,
      items: result
    }, '렌탈 아이템 캘린더를 조회했습니다.');
  } catch (err) {
    console.error('getAllRentalItemsCalendar Error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 렌탈 아이템 월별 캘린더 조회 (관리자용)
 * salesType이 RENTAL인 아이템만 조회 가능
 * @route GET /api/admin/rental-items/:id/calendar
 * @query {number} year - 연도 (필수)
 * @query {number} month - 월 1-12 (필수)
 */
const getRentalItemCalendar = async (req, res) => {
  try {
    const { id } = req.params;
    const { year, month } = req.query;

    // 파라미터 검증
    const yearNum = parseInt(year);
    const monthNum = parseInt(month);
    if (!year || !month || isNaN(yearNum) || isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
      return error(res, {
        code: 4001,
        message: 'year와 month는 필수이며 유효한 숫자여야 합니다. (month: 1-12)'
      }, 400);
    }

    const item = await RentalItem.findByPk(id);
    if (!item) {
      return error(res, {
        code: 3010,
        message: '대여 물품을 찾을 수 없습니다.'
      }, 404);
    }

    if (item.salesType !== 'RENTAL') {
      return error(res, {
        code: 4010,
        message: '판매형(SALE) 물품은 캘린더 조회를 지원하지 않습니다.'
      }, 400);
    }

    // 해당 월 범위 (KST 기준)
    const monthStart = new Date(`${yearNum}-${String(monthNum).padStart(2, '0')}-01T00:00:00`);
    const lastDay = new Date(yearNum, monthNum, 0).getDate();
    const monthEnd = new Date(`${yearNum}-${String(monthNum).padStart(2, '0')}-${lastDay}T23:59:59`);

    const { RentalItemReservation } = require('../models');
    const reservations = await RentalItemReservation.findAll({
      where: {
        rentalItemId: id,
        status: { [Op.in]: ['RESERVED', 'CONFIRMED'] },
        [Op.or]: [
          { reservedFrom: { [Op.between]: [monthStart, monthEnd] } },
          { reservedUntil: { [Op.between]: [monthStart, monthEnd] } },
          {
            reservedFrom: { [Op.lte]: monthStart },
            reservedUntil: { [Op.gte]: monthEnd }
          }
        ]
      },
      attributes: ['reservedFrom', 'reservedUntil', 'quantity']
    });

    // 날짜별 예약 수량 집계
    const bufferMs = RENTAL_BUFFER_DAYS * 24 * 60 * 60 * 1000;
    const calendar = {};
    for (let d = 1; d <= lastDay; d++) {
      const dateStr = `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayStart = new Date(`${dateStr}T00:00:00`);
      const dayEnd = new Date(`${dateStr}T23:59:59`);

      const reservedQuantity = reservations.reduce((sum, r) => {
        const bufferedFrom = new Date(r.reservedFrom.getTime() - bufferMs);
        const bufferedUntil = new Date(r.reservedUntil.getTime() + bufferMs);
        if (bufferedFrom <= dayEnd && bufferedUntil >= dayStart) {
          return sum + r.quantity;
        }
        return sum;
      }, 0);

      calendar[dateStr] = {
        reservedQuantity,
        availableQuantity: item.totalStock - reservedQuantity
      };
    }

    return success(res, {
      rentalItemId: item.id,
      name: item.name,
      totalStock: item.totalStock,
      year: yearNum,
      month: monthNum,
      calendar
    }, '렌탈 아이템 캘린더를 조회했습니다.');
  } catch (err) {
    console.error('getRentalItemCalendar Error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 물품 카테고리별 통계 조회 (관리자용)
 * @route GET /api/admin/rental-items/stats
 */
const getRentalItemStats = async (req, res) => {
  try {
    const stats = await RentalItem.findAll({
      attributes: [
        'itemType',
        'salesType',
        [require('sequelize').fn('COUNT', require('sequelize').col('id')), 'itemCount'],
        [require('sequelize').fn('SUM', require('sequelize').col('total_stock')), 'totalStock']
      ],
      group: ['itemType', 'salesType']
    });

    const formattedStats = stats.map(stat => ({
      itemType: stat.itemType,
      itemTypeLabel: RentalItem.ITEM_TYPE_LABELS[stat.itemType] || stat.itemType,
      salesType: stat.salesType,
      salesTypeLabel: RentalItem.SALES_TYPE_LABELS[stat.salesType] || stat.salesType,
      itemCount: parseInt(stat.dataValues.itemCount),
      totalStock: parseInt(stat.dataValues.totalStock) || 0
    }));

    return success(res, formattedStats, '대여 물품 통계를 조회했습니다.');
  } catch (err) {
    console.error('getRentalItemStats Error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

module.exports = {
  // 게스트용 공개 API
  getPublicRentalItems,
  getPublicRentalItemById,
  getPublicRentalItemsByType,
  getRentalCategories,
  // 관리자용 API
  getAllRentalItems,
  getRentalItemById,
  createRentalItem,
  updateRentalItem,
  deleteRentalItem,
  getRentalItemStats,
  getAllRentalItemsCalendar,
  getRentalItemCalendar
};
