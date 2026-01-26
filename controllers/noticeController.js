const { success, error, created, updated, deleted, ErrorCodes } = require('../utils/responseHelper');
const { Notice, Admin } = require('../models');
const { Op } = require('sequelize');

/**
 * 공지사항 목록 조회 (사용자용)
 * GET /api/support/notices
 */
const getNotices = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, userType } = req.query;
    const offset = (page - 1) * limit;
    const now = new Date();

    // 검색 조건
    const whereCondition = {
      status: 'published',
      [Op.or]: [
        { publishedAt: { [Op.lte]: now } },
        { publishedAt: null }
      ],
      [Op.and]: [
        {
          [Op.or]: [
            { expiresAt: { [Op.gte]: now } },
            { expiresAt: null }
          ]
        }
      ]
    };

    // userType 필터 (all은 모든 사용자에게 보임)
    if (userType && ['host', 'guest'].includes(userType)) {
      whereCondition.userType = { [Op.in]: ['all', userType] };
    }

    // 검색어가 있는 경우
    if (search) {
      whereCondition[Op.and].push({
        [Op.or]: [
          { title: { [Op.like]: `%${search}%` } },
          { content: { [Op.like]: `%${search}%` } }
        ]
      });
    }

    const { count, rows } = await Notice.findAndCountAll({
      where: whereCondition,
      attributes: ['id', 'title', 'isImportant', 'viewCount', 'userType', 'publishedAt', 'createdAt'],
      order: [
        ['isImportant', 'DESC'],
        ['publishedAt', 'DESC'],
        ['createdAt', 'DESC']
      ],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    return success(res, {
      notices: rows,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      }
    }, '공지사항 목록을 조회했습니다.');
  } catch (err) {
    console.error('공지사항 목록 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 공지사항 상세 조회 (사용자용)
 * GET /api/support/notices/:id
 */
const getNoticeById = async (req, res) => {
  try {
    const { id } = req.params;

    const notice = await Notice.findOne({
      where: {
        id,
        status: 'published'
      },
      attributes: ['id', 'title', 'content', 'isImportant', 'viewCount', 'userType', 'publishedAt', 'createdAt']
    });

    if (!notice) {
      return error(res, ErrorCodes.NOTICE_NOT_FOUND, 404);
    }

    // 조회수 증가
    await notice.increment('viewCount');

    return success(res, notice, '공지사항을 조회했습니다.');
  } catch (err) {
    console.error('공지사항 상세 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 공지사항 목록 조회 (관리자용)
 * GET /api/admin/support/notices
 */
const getNoticesAdmin = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, userType, search } = req.query;
    const offset = (page - 1) * limit;

    const whereCondition = {};

    // 상태 필터
    if (status) {
      whereCondition.status = status;
    }

    // userType 필터 (관리자는 특정 타입만 필터링)
    if (userType && ['all', 'host', 'guest'].includes(userType)) {
      whereCondition.userType = userType;
    }

    // 검색어가 있는 경우
    if (search) {
      whereCondition[Op.or] = [
        { title: { [Op.like]: `%${search}%` } },
        { content: { [Op.like]: `%${search}%` } }
      ];
    }

    const { count, rows } = await Notice.findAndCountAll({
      where: whereCondition,
      include: [
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
        ['isImportant', 'DESC'],
        ['createdAt', 'DESC']
      ],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    return success(res, {
      notices: rows,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      }
    }, '공지사항 목록을 조회했습니다.');
  } catch (err) {
    console.error('관리자 공지사항 목록 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 공지사항 상세 조회 (관리자용)
 * GET /api/admin/support/notices/:id
 */
const getNoticeByIdAdmin = async (req, res) => {
  try {
    const { id } = req.params;

    const notice = await Notice.findByPk(id, {
      include: [
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

    if (!notice) {
      return error(res, ErrorCodes.NOTICE_NOT_FOUND, 404);
    }

    return success(res, notice, '공지사항을 조회했습니다.');
  } catch (err) {
    console.error('관리자 공지사항 상세 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 공지사항 생성 (관리자)
 * POST /api/admin/support/notices
 */
const createNotice = async (req, res) => {
  try {
    const { title, content, isImportant, userType, publishedAt, expiresAt, status } = req.body;
    const adminId = req.admin.id;

    // 필수 필드 검증
    if (!title || !content) {
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
    }

    // 상태값 검증
    const validStatuses = ['draft', 'published', 'archived'];
    if (status && !validStatuses.includes(status)) {
      return error(res, ErrorCodes.INVALID_STATUS, 400);
    }

    // userType 검증
    const validUserTypes = ['all', 'host', 'guest'];
    if (userType && !validUserTypes.includes(userType)) {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, { field: 'userType' });
    }

    const notice = await Notice.create({
      title,
      content,
      isImportant: isImportant || false,
      userType: userType || 'all',
      publishedAt: publishedAt || null,
      expiresAt: expiresAt || null,
      status: status || 'draft',
      createdBy: adminId
    });

    return created(res, notice, '공지사항이 생성되었습니다.');
  } catch (err) {
    console.error('공지사항 생성 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 공지사항 수정 (관리자)
 * PATCH /api/admin/support/notices/:id
 */
const updateNotice = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, isImportant, userType, publishedAt, expiresAt, status } = req.body;
    const adminId = req.admin.id;

    const notice = await Notice.findByPk(id);

    if (!notice) {
      return error(res, ErrorCodes.NOTICE_NOT_FOUND, 404);
    }

    // 상태값 검증
    const validStatuses = ['draft', 'published', 'archived'];
    if (status && !validStatuses.includes(status)) {
      return error(res, ErrorCodes.INVALID_STATUS, 400);
    }

    // userType 검증
    const validUserTypes = ['all', 'host', 'guest'];
    if (userType && !validUserTypes.includes(userType)) {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, { field: 'userType' });
    }

    // 업데이트할 필드만 설정
    const updateData = { updatedBy: adminId };

    if (title !== undefined) updateData.title = title;
    if (content !== undefined) updateData.content = content;
    if (isImportant !== undefined) updateData.isImportant = isImportant;
    if (userType !== undefined) updateData.userType = userType;
    if (publishedAt !== undefined) updateData.publishedAt = publishedAt;
    if (expiresAt !== undefined) updateData.expiresAt = expiresAt;
    if (status !== undefined) updateData.status = status;

    await notice.update(updateData);

    return updated(res, notice, '공지사항이 수정되었습니다.');
  } catch (err) {
    console.error('공지사항 수정 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 공지사항 삭제 (관리자)
 * DELETE /api/admin/support/notices/:id
 */
const deleteNotice = async (req, res) => {
  try {
    const { id } = req.params;

    const notice = await Notice.findByPk(id);

    if (!notice) {
      return error(res, ErrorCodes.NOTICE_NOT_FOUND, 404);
    }

    await notice.destroy();

    return deleted(res, '공지사항이 삭제되었습니다.');
  } catch (err) {
    console.error('공지사항 삭제 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 공지사항 게시 상태 변경 (관리자)
 * PATCH /api/admin/support/notices/:id/publish
 */
const publishNotice = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.admin.id;

    const notice = await Notice.findByPk(id);

    if (!notice) {
      return error(res, ErrorCodes.NOTICE_NOT_FOUND, 404);
    }

    await notice.update({
      status: 'published',
      publishedAt: notice.publishedAt || new Date(),
      updatedBy: adminId
    });

    return updated(res, notice, '공지사항이 게시되었습니다.');
  } catch (err) {
    console.error('공지사항 게시 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

module.exports = {
  // 사용자용
  getNotices,
  getNoticeById,

  // 관리자용
  getNoticesAdmin,
  getNoticeByIdAdmin,
  createNotice,
  updateNotice,
  deleteNotice,
  publishNotice
};
