const { RentalItem } = require('../models');
const { Op } = require('sequelize');
const { ErrorCodes, success, error, created, updated, deleted } = require('../utils/responseHelper');

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

    return success(res, items, '대여 물품 목록을 조회했습니다.');
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

    return success(res, item, '대여 물품 정보를 조회했습니다.');
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
      name,
      description,
      price,
      totalStock,
      imageUrl,
      isActive
    } = req.body;

    // 필수 필드 검증
    if (!itemType || !name || price === undefined || totalStock === undefined) {
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400, {
        required: ['itemType', 'name', 'price', 'totalStock']
      });
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
      name,
      description,
      price,
      totalStock,
      availableStock: totalStock, // 초기 생성 시 전체 재고가 이용 가능
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
      name,
      description,
      price,
      totalStock,
      imageUrl,
      isActive
    } = req.body;

    // totalStock 업데이트는 별도 메서드 사용
    if (totalStock !== undefined && totalStock !== item.totalStock) {
      try {
        await item.updateTotalStock(totalStock);
      } catch (stockError) {
        return error(res, {
          code: 4006,
          message: stockError.message
        }, 400);
      }
    }

    // 나머지 필드 업데이트
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

    // 대여 중인 물품이 있는지 확인
    const reservedQuantity = item.totalStock - item.availableStock;
    if (reservedQuantity > 0) {
      return error(res, {
        code: 4007,
        message: `현재 대여 중인 물품(${reservedQuantity}개)이 있어 삭제할 수 없습니다. 비활성화를 권장합니다.`
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
 * 대여 물품 재고 수동 조정 (관리자용)
 * @route PATCH /api/admin/rental-items/:id/stock
 * @body {number} availableStock - 새로운 이용 가능 수량
 */
const adjustStock = async (req, res) => {
  try {
    const item = await RentalItem.findByPk(req.params.id);

    if (!item) {
      return error(res, {
        code: 3010,
        message: '대여 물품을 찾을 수 없습니다.'
      }, 404);
    }

    const { availableStock } = req.body;

    if (availableStock === undefined || availableStock < 0) {
      return error(res, {
        code: 4008,
        message: '이용 가능한 재고는 0 이상이어야 합니다.'
      }, 400);
    }

    if (availableStock > item.totalStock) {
      return error(res, {
        code: 4009,
        message: `이용 가능한 재고는 총 재고(${item.totalStock}개)를 초과할 수 없습니다.`
      }, 400);
    }

    item.availableStock = availableStock;
    await item.save();

    return updated(res, item, '재고가 조정되었습니다.');
  } catch (err) {
    console.error('adjustStock Error:', err);
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
        [require('sequelize').fn('COUNT', require('sequelize').col('id')), 'itemCount'],
        [require('sequelize').fn('SUM', require('sequelize').col('total_stock')), 'totalStock'],
        [require('sequelize').fn('SUM', require('sequelize').col('available_stock')), 'availableStock']
      ],
      group: ['itemType']
    });

    const formattedStats = stats.map(stat => ({
      itemType: stat.itemType,
      itemTypeLabel: RentalItem.ITEM_TYPE_LABELS[stat.itemType] || stat.itemType,
      itemCount: parseInt(stat.dataValues.itemCount),
      totalStock: parseInt(stat.dataValues.totalStock) || 0,
      availableStock: parseInt(stat.dataValues.availableStock) || 0,
      rentedStock: (parseInt(stat.dataValues.totalStock) || 0) - (parseInt(stat.dataValues.availableStock) || 0)
    }));

    return success(res, formattedStats, '대여 물품 통계를 조회했습니다.');
  } catch (err) {
    console.error('getRentalItemStats Error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

module.exports = {
  getAllRentalItems,
  getRentalItemById,
  createRentalItem,
  updateRentalItem,
  deleteRentalItem,
  adjustStock,
  getRentalItemStats
};
