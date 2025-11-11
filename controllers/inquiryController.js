const { success, error, created, updated, deleted, ErrorCodes } = require('../utils/responseHelper');
const { Inquiry, User, Admin } = require('../models');
const { Op } = require('sequelize');

/**
 * 내 문의 목록 조회 (사용자용)
 * GET /api/support/inquiries
 */
const getMyInquiries = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10, status, categoryType } = req.query;
    const offset = (page - 1) * limit;

    const whereCondition = { userId };

    // 상태 필터
    if (status) {
      whereCondition.status = status;
    }

    // 카테고리 필터
    if (categoryType) {
      whereCondition.categoryType = categoryType;
    }

    const { count, rows } = await Inquiry.findAndCountAll({
      where: whereCondition,
      attributes: ['id', 'categoryType', 'title', 'content', 'status', 'answer', 'answeredAt', 'createdAt'],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    return success(res, {
      inquiries: rows,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      }
    }, '문의 목록을 조회했습니다.');
  } catch (err) {
    console.error('문의 목록 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 문의 상세 조회 (사용자용)
 * GET /api/support/inquiries/:id
 */
const getMyInquiryById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const inquiry = await Inquiry.findOne({
      where: {
        id,
        userId
      },
      attributes: ['id', 'categoryType', 'title', 'content', 'status', 'answer', 'answeredAt', 'createdAt', 'updatedAt']
    });

    if (!inquiry) {
      return error(res, ErrorCodes.INQUIRY_NOT_FOUND, 404);
    }

    return success(res, inquiry, '문의를 조회했습니다.');
  } catch (err) {
    console.error('문의 상세 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 문의 등록 (사용자)
 * POST /api/support/inquiries
 */
const createInquiry = async (req, res) => {
  try {
    const { categoryType, title, content } = req.body;
    const userId = req.user.id;

    // 필수 필드 검증
    if (!categoryType || !title || !content) {
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
    }

    // 카테고리 타입 검증
    const validCategories = ['general', 'reservation', 'payment', 'room', 'account', 'other'];
    if (!validCategories.includes(categoryType)) {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400);
    }

    const inquiry = await Inquiry.create({
      userId,
      categoryType,
      title,
      content,
      status: 'pending'
    });

    return created(res, inquiry, '문의가 등록되었습니다.');
  } catch (err) {
    console.error('문의 등록 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 문의 수정 (사용자) - 답변 전에만 가능
 * PATCH /api/support/inquiries/:id
 */
const updateInquiry = async (req, res) => {
  try {
    const { id } = req.params;
    const { categoryType, title, content } = req.body;
    const userId = req.user.id;

    const inquiry = await Inquiry.findOne({
      where: {
        id,
        userId
      }
    });

    if (!inquiry) {
      return error(res, ErrorCodes.INQUIRY_NOT_FOUND, 404);
    }

    // 답변이 완료된 문의는 수정 불가
    if (inquiry.status !== 'pending') {
      return error(res, ErrorCodes.ANSWER_ALREADY_EXISTS, 400);
    }

    // 카테고리 타입 검증
    if (categoryType) {
      const validCategories = ['general', 'reservation', 'payment', 'room', 'account', 'other'];
      if (!validCategories.includes(categoryType)) {
        return error(res, ErrorCodes.VALIDATION_ERROR, 400);
      }
    }

    const updateData = {};
    if (categoryType !== undefined) updateData.categoryType = categoryType;
    if (title !== undefined) updateData.title = title;
    if (content !== undefined) updateData.content = content;

    await inquiry.update(updateData);

    return updated(res, inquiry, '문의가 수정되었습니다.');
  } catch (err) {
    console.error('문의 수정 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 문의 삭제 (사용자) - 답변 전에만 가능
 * DELETE /api/support/inquiries/:id
 */
const deleteInquiry = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const inquiry = await Inquiry.findOne({
      where: {
        id,
        userId
      }
    });

    if (!inquiry) {
      return error(res, ErrorCodes.INQUIRY_NOT_FOUND, 404);
    }

    // 답변이 완료된 문의는 삭제 불가
    if (inquiry.status !== 'pending') {
      return error(res, ErrorCodes.ANSWER_ALREADY_EXISTS, 400);
    }

    await inquiry.destroy();

    return deleted(res, '문의가 삭제되었습니다.');
  } catch (err) {
    console.error('문의 삭제 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 문의 목록 조회 (관리자용)
 * GET /api/admin/support/inquiries
 */
const getInquiriesAdmin = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, categoryType, search } = req.query;
    const offset = (page - 1) * limit;

    const whereCondition = {};

    // 상태 필터
    if (status) {
      whereCondition.status = status;
    }

    // 카테고리 필터
    if (categoryType) {
      whereCondition.categoryType = categoryType;
    }

    // 검색어 (제목 또는 내용)
    if (search) {
      whereCondition[Op.or] = [
        { title: { [Op.like]: `%${search}%` } },
        { content: { [Op.like]: `%${search}%` } }
      ];
    }

    const { count, rows } = await Inquiry.findAndCountAll({
      where: whereCondition,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'email', 'phoneNumber']
        },
        {
          model: Admin,
          as: 'admin',
          attributes: ['id', 'username', 'name'],
          required: false
        }
      ],
      order: [
        ['status', 'ASC'], // pending 먼저
        ['createdAt', 'DESC']
      ],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    return success(res, {
      inquiries: rows,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      }
    }, '문의 목록을 조회했습니다.');
  } catch (err) {
    console.error('관리자 문의 목록 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 문의 상세 조회 (관리자용)
 * GET /api/admin/support/inquiries/:id
 */
const getInquiryByIdAdmin = async (req, res) => {
  try {
    const { id } = req.params;

    const inquiry = await Inquiry.findByPk(id, {
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'email', 'phoneNumber']
        },
        {
          model: Admin,
          as: 'admin',
          attributes: ['id', 'username', 'name'],
          required: false
        }
      ]
    });

    if (!inquiry) {
      return error(res, ErrorCodes.INQUIRY_NOT_FOUND, 404);
    }

    return success(res, inquiry, '문의를 조회했습니다.');
  } catch (err) {
    console.error('관리자 문의 상세 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 문의 답변 등록 (관리자)
 * POST /api/admin/support/inquiries/:id/answer
 */
const answerInquiry = async (req, res) => {
  try {
    const { id } = req.params;
    const { answer } = req.body;
    const adminId = req.admin.id;

    // 필수 필드 검증
    if (!answer) {
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
    }

    const inquiry = await Inquiry.findByPk(id);

    if (!inquiry) {
      return error(res, ErrorCodes.INQUIRY_NOT_FOUND, 404);
    }

    // 이미 답변된 문의는 재답변 가능 (수정)
    await inquiry.update({
      answer,
      answeredBy: adminId,
      answeredAt: new Date(),
      status: 'answered'
    });

    return updated(res, inquiry, '답변이 등록되었습니다.');
  } catch (err) {
    console.error('문의 답변 등록 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 문의 상태 변경 (관리자)
 * PATCH /api/admin/support/inquiries/:id/status
 */
const updateInquiryStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // 상태값 검증
    const validStatuses = ['pending', 'answered', 'closed'];
    if (!status || !validStatuses.includes(status)) {
      return error(res, ErrorCodes.INVALID_STATUS, 400);
    }

    const inquiry = await Inquiry.findByPk(id);

    if (!inquiry) {
      return error(res, ErrorCodes.INQUIRY_NOT_FOUND, 404);
    }

    await inquiry.update({ status });

    return updated(res, inquiry, '문의 상태가 변경되었습니다.');
  } catch (err) {
    console.error('문의 상태 변경 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 문의 삭제 (관리자)
 * DELETE /api/admin/support/inquiries/:id
 */
const deleteInquiryAdmin = async (req, res) => {
  try {
    const { id } = req.params;

    const inquiry = await Inquiry.findByPk(id);

    if (!inquiry) {
      return error(res, ErrorCodes.INQUIRY_NOT_FOUND, 404);
    }

    await inquiry.destroy();

    return deleted(res, '문의가 삭제되었습니다.');
  } catch (err) {
    console.error('관리자 문의 삭제 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

module.exports = {
  // 사용자용
  getMyInquiries,
  getMyInquiryById,
  createInquiry,
  updateInquiry,
  deleteInquiry,

  // 관리자용
  getInquiriesAdmin,
  getInquiryByIdAdmin,
  answerInquiry,
  updateInquiryStatus,
  deleteInquiryAdmin
};
