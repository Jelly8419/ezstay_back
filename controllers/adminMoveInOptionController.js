/**
 * adminMoveInOptionController.js
 * 관리자 — 입주 준비 서비스 임차인 옵션 카탈로그 CRUD
 *
 * Routes: /api/admin/move-in/options
 * Auth:   authenticateAdmin
 *
 * 검증 정책:
 *   - 신규: name / optionType / price / totalStock 필수
 *   - optionType ∈ {PURCHASE, RENTAL}, RENTAL 은 totalStock > 0 필수
 *   - category ∈ {AMENITY_KIT, BEDDING_SET, HAIR_DRYER, TOWEL_SET, OTHER} (기본 OTHER)
 *   - price >= 0, totalStock >= 0
 *   - DELETE 는 Soft (is_active=false)
 *     · 활성 주문(라인 status=ACTIVE)이 있어도 비활성화는 허용 — 기존 주문은 items_snapshot 으로 보존
 *     · 단, "사용 중" 카운트를 응답에 포함하여 관리자에게 정보 제공
 */

const { Op } = require('sequelize');
const {
  MoveInOption,
  MoveInGuestOrderItem
} = require('../models');
const {
  ErrorCodes,
  success,
  error,
  created,
  updated
} = require('../utils/responseHelper');
const { toKSTString } = require('../utils/dateHelper');

const VALID_OPTION_TYPES = ['PURCHASE', 'RENTAL'];
const VALID_CATEGORIES = ['AMENITY_KIT', 'BEDDING_SET', 'HAIR_DRYER', 'TOWEL_SET', 'OTHER'];

/**
 * 옵션 인스턴스 → 응답 포맷
 */
function serializeAdminOption(option) {
  const o = typeof option.get === 'function' ? option.get({ plain: true }) : option;
  return {
    id: o.id,
    name: o.name,
    description: o.description ?? null,
    optionType: o.optionType ?? o.option_type,
    optionTypeLabel: MoveInOption.OPTION_TYPE_LABELS[o.optionType ?? o.option_type] || null,
    category: o.category,
    categoryLabel: MoveInOption.CATEGORY_LABELS[o.category] || null,
    price: o.price,
    totalStock: o.totalStock ?? o.total_stock,
    imageUrl: o.imageUrl ?? o.image_url ?? null,
    displayOrder: o.displayOrder ?? o.display_order,
    isActive: !!(o.isActive ?? o.is_active),
    createdAt: toKSTString(o.createdAt ?? o.created_at),
    updatedAt: toKSTString(o.updatedAt ?? o.updated_at)
  };
}

/**
 * GET /api/admin/move-in/options
 * Query: category, optionType, isActive, page, limit
 */
const listOptions = async (req, res) => {
  try {
    const {
      category,
      optionType,
      isActive,
      page = 1,
      limit = 50
    } = req.query;

    const where = {};
    if (category) {
      if (!VALID_CATEGORIES.includes(category)) {
        return error(res, ErrorCodes.VALIDATION_ERROR, 400, `category는 ${VALID_CATEGORIES.join('|')} 중 하나여야 합니다.`);
      }
      where.category = category;
    }
    if (optionType) {
      if (!VALID_OPTION_TYPES.includes(optionType)) {
        return error(res, ErrorCodes.VALIDATION_ERROR, 400, `optionType은 ${VALID_OPTION_TYPES.join('|')} 중 하나여야 합니다.`);
      }
      where.optionType = optionType;
    }
    if (isActive !== undefined) {
      where.isActive = String(isActive) === 'true';
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    const { rows, count } = await MoveInOption.findAndCountAll({
      where,
      order: [['displayOrder', 'ASC'], ['id', 'ASC']],
      limit: limitNum,
      offset
    });

    return success(res, {
      items: rows.map(serializeAdminOption),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count,
        totalPages: Math.ceil(count / limitNum)
      }
    }, '옵션 카탈로그를 조회했습니다.');
  } catch (err) {
    console.error('[adminMoveInOption.list] error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * GET /api/admin/move-in/options/:optionId
 */
const getOption = async (req, res) => {
  try {
    const option = await MoveInOption.findByPk(req.params.optionId);
    if (!option) {
      return error(res, ErrorCodes.MOVE_IN_GUEST_OPTION_NOT_FOUND, 404);
    }

    // 사용 중인 활성 주문 라인 수
    const activeUsageCount = await MoveInGuestOrderItem.count({
      where: { optionId: option.id, status: 'ACTIVE' }
    });

    return success(res, {
      ...serializeAdminOption(option),
      activeUsageCount
    }, '옵션 정보를 조회했습니다.');
  } catch (err) {
    console.error('[adminMoveInOption.get] error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * POST /api/admin/move-in/options
 * Body: name, optionType, category?, price, totalStock, description?, imageUrl?, displayOrder?, isActive?
 */
const createOption = async (req, res) => {
  try {
    const {
      name,
      description,
      optionType,
      category = 'OTHER',
      price,
      totalStock,
      imageUrl,
      displayOrder = 0,
      isActive = true
    } = req.body || {};

    // 필수 필드
    if (!name || !optionType || price === undefined || totalStock === undefined) {
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400, {
        required: ['name', 'optionType', 'price', 'totalStock']
      });
    }

    // ENUM 검증
    if (!VALID_OPTION_TYPES.includes(optionType)) {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, `optionType은 ${VALID_OPTION_TYPES.join('|')} 중 하나여야 합니다.`);
    }
    if (!VALID_CATEGORIES.includes(category)) {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, `category는 ${VALID_CATEGORIES.join('|')} 중 하나여야 합니다.`);
    }

    // 숫자 범위
    const priceNum = Number(price);
    const stockNum = Number(totalStock);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, '가격은 0 이상의 숫자여야 합니다.');
    }
    if (!Number.isFinite(stockNum) || stockNum < 0) {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, '재고는 0 이상의 숫자여야 합니다.');
    }

    // RENTAL 은 재고 1 이상
    if (optionType === 'RENTAL' && stockNum < 1) {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, 'RENTAL 옵션은 재고가 1 이상이어야 합니다.');
    }

    // 이름 길이 (스키마 100자)
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > 100) {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, '옵션명은 1~100자 사이여야 합니다.');
    }

    const option = await MoveInOption.create({
      name: name.trim(),
      description: description ?? null,
      optionType,
      category,
      price: priceNum,
      totalStock: stockNum,
      imageUrl: imageUrl ?? null,
      displayOrder: Number(displayOrder) || 0,
      isActive: !!isActive
    });

    return created(res, serializeAdminOption(option), '옵션이 등록되었습니다.');
  } catch (err) {
    console.error('[adminMoveInOption.create] error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * PATCH /api/admin/move-in/options/:optionId
 */
const updateOption = async (req, res) => {
  try {
    const option = await MoveInOption.findByPk(req.params.optionId);
    if (!option) {
      return error(res, ErrorCodes.MOVE_IN_GUEST_OPTION_NOT_FOUND, 404);
    }

    const {
      name,
      description,
      optionType,
      category,
      price,
      totalStock,
      imageUrl,
      displayOrder,
      isActive
    } = req.body || {};

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0 || name.length > 100) {
        return error(res, ErrorCodes.VALIDATION_ERROR, 400, '옵션명은 1~100자 사이여야 합니다.');
      }
      option.name = name.trim();
    }

    if (description !== undefined) {
      option.description = description;
    }

    if (optionType !== undefined) {
      if (!VALID_OPTION_TYPES.includes(optionType)) {
        return error(res, ErrorCodes.VALIDATION_ERROR, 400, `optionType은 ${VALID_OPTION_TYPES.join('|')} 중 하나여야 합니다.`);
      }
      option.optionType = optionType;
    }

    if (category !== undefined) {
      if (!VALID_CATEGORIES.includes(category)) {
        return error(res, ErrorCodes.VALIDATION_ERROR, 400, `category는 ${VALID_CATEGORIES.join('|')} 중 하나여야 합니다.`);
      }
      option.category = category;
    }

    if (price !== undefined) {
      const priceNum = Number(price);
      if (!Number.isFinite(priceNum) || priceNum < 0) {
        return error(res, ErrorCodes.VALIDATION_ERROR, 400, '가격은 0 이상의 숫자여야 합니다.');
      }
      option.price = priceNum;
    }

    if (totalStock !== undefined) {
      const stockNum = Number(totalStock);
      if (!Number.isFinite(stockNum) || stockNum < 0) {
        return error(res, ErrorCodes.VALIDATION_ERROR, 400, '재고는 0 이상의 숫자여야 합니다.');
      }
      option.totalStock = stockNum;
    }

    // RENTAL 인 경우 (변경 후 기준) 재고 1 이상 확인
    const finalType = optionType !== undefined ? optionType : option.optionType;
    if (finalType === 'RENTAL' && option.totalStock < 1) {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, 'RENTAL 옵션은 재고가 1 이상이어야 합니다.');
    }

    if (imageUrl !== undefined) option.imageUrl = imageUrl;
    if (displayOrder !== undefined) option.displayOrder = Number(displayOrder) || 0;
    if (isActive !== undefined) option.isActive = !!isActive;

    await option.save();

    return updated(res, serializeAdminOption(option), '옵션 정보가 수정되었습니다.');
  } catch (err) {
    console.error('[adminMoveInOption.update] error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * DELETE /api/admin/move-in/options/:optionId  (Soft delete)
 *
 * 정책:
 *   - is_active=false 처리만 함 (실제 row 삭제 X)
 *   - 활성 주문 라인이 있어도 비활성화는 허용 (기존 주문은 items_snapshot 으로 보존)
 *   - 활성 라인 수를 응답에 포함하여 관리자에게 정보 제공
 */
const deactivateOption = async (req, res) => {
  try {
    const option = await MoveInOption.findByPk(req.params.optionId);
    if (!option) {
      return error(res, ErrorCodes.MOVE_IN_GUEST_OPTION_NOT_FOUND, 404);
    }

    if (!option.isActive) {
      return success(res, serializeAdminOption(option), '이미 비활성화된 옵션입니다.');
    }

    const activeUsageCount = await MoveInGuestOrderItem.count({
      where: { optionId: option.id, status: 'ACTIVE' }
    });

    option.isActive = false;
    await option.save();

    return success(res, {
      ...serializeAdminOption(option),
      activeUsageCount
    }, '옵션이 비활성화되었습니다.');
  } catch (err) {
    console.error('[adminMoveInOption.deactivate] error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

module.exports = {
  listOptions,
  getOption,
  createOption,
  updateOption,
  deactivateOption
};
