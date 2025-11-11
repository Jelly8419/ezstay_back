const { success, error, created, updated, deleted, ErrorCodes } = require('../utils/responseHelper');
const { FAQ, FAQCategory, Admin } = require('../models');
const { Op } = require('sequelize');

/**
 * FAQ 카테고리 목록 조회 (사용자용)
 * GET /api/support/faq/categories
 */
const getFAQCategories = async (req, res) => {
  try {
    const { userType } = req.query; // 'all', 'host', 'guest'

    const whereCondition = {
      isActive: true
    };

    // userType 필터링 (all 또는 특정 타입)
    if (userType && userType !== 'all') {
      whereCondition[Op.or] = [
        { userType: 'all' },
        { userType }
      ];
    }

    const categories = await FAQCategory.findAll({
      where: whereCondition,
      attributes: ['id', 'name', 'userType', 'displayOrder'],
      order: [['displayOrder', 'ASC'], ['id', 'ASC']]
    });

    return success(res, categories, 'FAQ 카테고리 목록을 조회했습니다.');
  } catch (err) {
    console.error('FAQ 카테고리 목록 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * FAQ 목록 조회 (사용자용)
 * GET /api/support/faqs
 */
const getFAQs = async (req, res) => {
  try {
    const { categoryId, search, userType } = req.query;

    const whereCondition = {
      isActive: true
    };

    // 카테고리 필터
    if (categoryId) {
      whereCondition.categoryId = categoryId;
    }

    // 검색어
    if (search) {
      whereCondition[Op.or] = [
        { question: { [Op.like]: `%${search}%` } },
        { answer: { [Op.like]: `%${search}%` } }
      ];
    }

    const includeCondition = {
      model: FAQCategory,
      as: 'category',
      attributes: ['id', 'name', 'userType'],
      where: { isActive: true }
    };

    // userType 필터 (카테고리에 적용)
    if (userType && userType !== 'all') {
      includeCondition.where[Op.or] = [
        { userType: 'all' },
        { userType }
      ];
    }

    const faqs = await FAQ.findAll({
      where: whereCondition,
      include: [includeCondition],
      attributes: ['id', 'categoryId', 'question', 'answer', 'displayOrder', 'viewCount'],
      order: [
        ['categoryId', 'ASC'],
        ['displayOrder', 'ASC'],
        ['id', 'ASC']
      ]
    });

    return success(res, faqs, 'FAQ 목록을 조회했습니다.');
  } catch (err) {
    console.error('FAQ 목록 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * FAQ 상세 조회 (사용자용)
 * GET /api/support/faqs/:id
 */
const getFAQById = async (req, res) => {
  try {
    const { id } = req.params;

    const faq = await FAQ.findOne({
      where: {
        id,
        isActive: true
      },
      include: [
        {
          model: FAQCategory,
          as: 'category',
          attributes: ['id', 'name', 'userType'],
          where: { isActive: true }
        }
      ],
      attributes: ['id', 'categoryId', 'question', 'answer', 'displayOrder', 'viewCount']
    });

    if (!faq) {
      return error(res, ErrorCodes.FAQ_NOT_FOUND, 404);
    }

    // 조회수 증가
    await faq.increment('viewCount');

    return success(res, faq, 'FAQ를 조회했습니다.');
  } catch (err) {
    console.error('FAQ 상세 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * FAQ 카테고리 목록 조회 (관리자용)
 * GET /api/admin/support/faq/categories
 */
const getFAQCategoriesAdmin = async (req, res) => {
  try {
    const { userType, isActive } = req.query;

    const whereCondition = {};

    if (userType) {
      whereCondition.userType = userType;
    }

    if (isActive !== undefined) {
      whereCondition.isActive = isActive === 'true';
    }

    const categories = await FAQCategory.findAll({
      where: whereCondition,
      order: [['displayOrder', 'ASC'], ['id', 'ASC']]
    });

    return success(res, categories, 'FAQ 카테고리 목록을 조회했습니다.');
  } catch (err) {
    console.error('관리자 FAQ 카테고리 목록 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * FAQ 목록 조회 (관리자용)
 * GET /api/admin/support/faqs
 */
const getFAQsAdmin = async (req, res) => {
  try {
    const { page = 1, limit = 20, categoryId, isActive, search } = req.query;
    const offset = (page - 1) * limit;

    const whereCondition = {};

    if (categoryId) {
      whereCondition.categoryId = categoryId;
    }

    if (isActive !== undefined) {
      whereCondition.isActive = isActive === 'true';
    }

    if (search) {
      whereCondition[Op.or] = [
        { question: { [Op.like]: `%${search}%` } },
        { answer: { [Op.like]: `%${search}%` } }
      ];
    }

    const { count, rows } = await FAQ.findAndCountAll({
      where: whereCondition,
      include: [
        {
          model: FAQCategory,
          as: 'category',
          attributes: ['id', 'name', 'userType']
        },
        {
          model: Admin,
          as: 'author',
          attributes: ['id', 'username', 'name']
        },
        {
          model: Admin,
          as: 'editor',
          attributes: ['id', 'username', 'name'],
          required: false
        }
      ],
      order: [
        ['categoryId', 'ASC'],
        ['displayOrder', 'ASC'],
        ['id', 'ASC']
      ],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    return success(res, {
      faqs: rows,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      }
    }, 'FAQ 목록을 조회했습니다.');
  } catch (err) {
    console.error('관리자 FAQ 목록 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * FAQ 상세 조회 (관리자용)
 * GET /api/admin/support/faqs/:id
 */
const getFAQByIdAdmin = async (req, res) => {
  try {
    const { id } = req.params;

    const faq = await FAQ.findByPk(id, {
      include: [
        {
          model: FAQCategory,
          as: 'category',
          attributes: ['id', 'name', 'userType']
        },
        {
          model: Admin,
          as: 'author',
          attributes: ['id', 'username', 'name']
        },
        {
          model: Admin,
          as: 'editor',
          attributes: ['id', 'username', 'name'],
          required: false
        }
      ]
    });

    if (!faq) {
      return error(res, ErrorCodes.FAQ_NOT_FOUND, 404);
    }

    return success(res, faq, 'FAQ를 조회했습니다.');
  } catch (err) {
    console.error('관리자 FAQ 상세 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * FAQ 카테고리 생성 (관리자)
 * POST /api/admin/support/faq/categories
 */
const createFAQCategory = async (req, res) => {
  try {
    const { name, userType, displayOrder } = req.body;

    // 필수 필드 검증
    if (!name || !userType) {
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
    }

    // userType 검증
    const validUserTypes = ['all', 'host', 'guest'];
    if (!validUserTypes.includes(userType)) {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400);
    }

    // 중복 체크 (name + userType 조합)
    const existing = await FAQCategory.findOne({
      where: { name, userType }
    });

    if (existing) {
      return error(res, ErrorCodes.DUPLICATE_CATEGORY_NAME, 400);
    }

    const category = await FAQCategory.create({
      name,
      userType,
      displayOrder: displayOrder || 0,
      isActive: true
    });

    return created(res, category, 'FAQ 카테고리가 생성되었습니다.');
  } catch (err) {
    console.error('FAQ 카테고리 생성 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * FAQ 카테고리 수정 (관리자)
 * PATCH /api/admin/support/faq/categories/:id
 */
const updateFAQCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, userType, displayOrder, isActive } = req.body;

    const category = await FAQCategory.findByPk(id);

    if (!category) {
      return error(res, ErrorCodes.FAQ_CATEGORY_NOT_FOUND, 404);
    }

    // userType 검증
    if (userType) {
      const validUserTypes = ['all', 'host', 'guest'];
      if (!validUserTypes.includes(userType)) {
        return error(res, ErrorCodes.VALIDATION_ERROR, 400);
      }
    }

    // 중복 체크 (수정하려는 name + userType이 다른 카테고리에 이미 존재하는지)
    if (name || userType) {
      const existing = await FAQCategory.findOne({
        where: {
          name: name || category.name,
          userType: userType || category.userType,
          id: { [Op.ne]: id }
        }
      });

      if (existing) {
        return error(res, ErrorCodes.DUPLICATE_CATEGORY_NAME, 400);
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (userType !== undefined) updateData.userType = userType;
    if (displayOrder !== undefined) updateData.displayOrder = displayOrder;
    if (isActive !== undefined) updateData.isActive = isActive;

    await category.update(updateData);

    return updated(res, category, 'FAQ 카테고리가 수정되었습니다.');
  } catch (err) {
    console.error('FAQ 카테고리 수정 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * FAQ 카테고리 삭제 (관리자)
 * DELETE /api/admin/support/faq/categories/:id
 */
const deleteFAQCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const category = await FAQCategory.findByPk(id);

    if (!category) {
      return error(res, ErrorCodes.FAQ_CATEGORY_NOT_FOUND, 404);
    }

    // 해당 카테고리에 FAQ가 있는지 확인
    const faqCount = await FAQ.count({ where: { categoryId: id } });

    if (faqCount > 0) {
      return error(res, ErrorCodes.CATEGORY_IN_USE, 400);
    }

    await category.destroy();

    return deleted(res, 'FAQ 카테고리가 삭제되었습니다.');
  } catch (err) {
    console.error('FAQ 카테고리 삭제 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * FAQ 생성 (관리자)
 * POST /api/admin/support/faqs
 */
const createFAQ = async (req, res) => {
  try {
    const { categoryId, question, answer, displayOrder, isActive } = req.body;
    const adminId = req.admin.id;

    // 필수 필드 검증
    if (!categoryId || !question || !answer) {
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
    }

    // 카테고리 존재 확인
    const category = await FAQCategory.findByPk(categoryId);
    if (!category) {
      return error(res, ErrorCodes.FAQ_CATEGORY_NOT_FOUND, 404);
    }

    const faq = await FAQ.create({
      categoryId,
      question,
      answer,
      displayOrder: displayOrder || 0,
      isActive: isActive !== undefined ? isActive : true,
      createdBy: adminId
    });

    return created(res, faq, 'FAQ가 생성되었습니다.');
  } catch (err) {
    console.error('FAQ 생성 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * FAQ 수정 (관리자)
 * PATCH /api/admin/support/faqs/:id
 */
const updateFAQ = async (req, res) => {
  try {
    const { id } = req.params;
    const { categoryId, question, answer, displayOrder, isActive } = req.body;
    const adminId = req.admin.id;

    const faq = await FAQ.findByPk(id);

    if (!faq) {
      return error(res, ErrorCodes.FAQ_NOT_FOUND, 404);
    }

    // 카테고리 변경 시 존재 확인
    if (categoryId && categoryId !== faq.categoryId) {
      const category = await FAQCategory.findByPk(categoryId);
      if (!category) {
        return error(res, ErrorCodes.FAQ_CATEGORY_NOT_FOUND, 404);
      }
    }

    const updateData = { updatedBy: adminId };

    if (categoryId !== undefined) updateData.categoryId = categoryId;
    if (question !== undefined) updateData.question = question;
    if (answer !== undefined) updateData.answer = answer;
    if (displayOrder !== undefined) updateData.displayOrder = displayOrder;
    if (isActive !== undefined) updateData.isActive = isActive;

    await faq.update(updateData);

    return updated(res, faq, 'FAQ가 수정되었습니다.');
  } catch (err) {
    console.error('FAQ 수정 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * FAQ 삭제 (관리자)
 * DELETE /api/admin/support/faqs/:id
 */
const deleteFAQ = async (req, res) => {
  try {
    const { id } = req.params;

    const faq = await FAQ.findByPk(id);

    if (!faq) {
      return error(res, ErrorCodes.FAQ_NOT_FOUND, 404);
    }

    await faq.destroy();

    return deleted(res, 'FAQ가 삭제되었습니다.');
  } catch (err) {
    console.error('FAQ 삭제 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

module.exports = {
  // 사용자용
  getFAQCategories,
  getFAQs,
  getFAQById,

  // 관리자용
  getFAQCategoriesAdmin,
  getFAQsAdmin,
  getFAQByIdAdmin,
  createFAQCategory,
  updateFAQCategory,
  deleteFAQCategory,
  createFAQ,
  updateFAQ,
  deleteFAQ
};
