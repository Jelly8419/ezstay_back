const { HostReceiptSetting, User, Admin, sequelize } = require('../models');
const { ErrorCodes, success, error, updated } = require('../utils/responseHelper');
const { Op } = require('sequelize');

/**
 * 영수증 신청 목록 조회
 * GET /api/admin/receipts
 */
const getReceiptList = async (req, res) => {
  try {
    const {
      status,       // issue_status 필터: none, requested, issued, rejected
      type,         // receipt_type 필터: personal, business, tax_invoice
      search,       // 호스트 이름 or 번호 검색
      page = 1,
      limit = 20
    } = req.query;

    const where = {
      receiptRequired: 'yes'  // 신청한 건만 조회
    };

    if (status) {
      where.issueStatus = status;
    }

    if (type) {
      where.receiptType = type;
    }

    // 호스트 정보 검색 조건
    const userWhere = {};
    if (search && search.trim()) {
      userWhere[Op.or] = [
        { name: { [Op.like]: `%${search.trim()}%` } },
        { phoneNumber: { [Op.like]: `%${search.trim()}%` } }
      ];
    }

    const offset = (page - 1) * limit;

    const { count, rows } = await HostReceiptSetting.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: 'host',
          attributes: ['id', 'name', 'phoneNumber', 'email'],
          where: Object.keys(userWhere).length > 0 ? userWhere : undefined
        },
        {
          model: Admin,
          as: 'issuedByAdmin',
          attributes: ['id', 'name'],
          required: false
        }
      ],
      order: [
        // requested 먼저, 최신 순
        [sequelize.literal(`FIELD(issue_status, 'requested', 'rejected', 'none', 'issued')`), 'ASC'],
        ['updatedAt', 'DESC']
      ],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    const receipts = rows.map(r => ({
      id: r.id,
      hostId: r.host?.id,
      hostName: r.host?.name,
      hostPhone: r.host?.phoneNumber,
      hostEmail: r.host?.email,
      receiptRequired: r.receiptRequired,
      receiptType: r.receiptType,
      receiptNumber: r.receiptNumber,
      businessName: r.businessName,
      repName: r.repName,
      email: r.email,
      issueStatus: r.issueStatus,
      issuedAt: r.issuedAt,
      issuedByAdmin: r.issuedByAdmin ? {
        id: r.issuedByAdmin.id,
        name: r.issuedByAdmin.name
      } : null,
      issueNote: r.issueNote,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    }));

    return success(res, {
      receipts,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalCount: count,
        limit: parseInt(limit)
      }
    });
  } catch (err) {
    console.error('Admin get receipt list error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 영수증 발급 완료 처리
 * PATCH /api/admin/receipts/:id/issue
 */
const issueReceipt = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.admin.id;
    const { note } = req.body;

    const setting = await HostReceiptSetting.findByPk(id);
    if (!setting) {
      return error(res, ErrorCodes.RECEIPT_NOT_FOUND, 404);
    }

    if (setting.issueStatus === 'issued') {
      return error(res, ErrorCodes.RECEIPT_ALREADY_ISSUED, 400);
    }

    await setting.update({
      issueStatus: 'issued',
      issuedAt: new Date(),
      issuedBy: adminId,
      issueNote: note || null
    });

    return updated(res, {
      id: setting.id,
      issueStatus: setting.issueStatus,
      issuedAt: setting.issuedAt,
      issuedBy: adminId,
      issueNote: setting.issueNote
    }, '영수증이 발급 처리되었습니다.');
  } catch (err) {
    console.error('Admin issue receipt error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 영수증 반려 처리
 * PATCH /api/admin/receipts/:id/reject
 */
const rejectReceipt = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.admin.id;
    const { note } = req.body;

    const setting = await HostReceiptSetting.findByPk(id);
    if (!setting) {
      return error(res, ErrorCodes.RECEIPT_NOT_FOUND, 404);
    }

    if (setting.issueStatus === 'issued') {
      return error(res, ErrorCodes.RECEIPT_ALREADY_ISSUED, 400);
    }

    await setting.update({
      issueStatus: 'rejected',
      issuedBy: adminId,
      issueNote: note || null
    });

    return updated(res, {
      id: setting.id,
      issueStatus: setting.issueStatus,
      issuedBy: adminId,
      issueNote: setting.issueNote
    }, '영수증 신청이 반려되었습니다.');
  } catch (err) {
    console.error('Admin reject receipt error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

module.exports = {
  getReceiptList,
  issueReceipt,
  rejectReceipt
};
