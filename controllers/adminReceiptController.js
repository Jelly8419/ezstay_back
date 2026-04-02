const { Receipt, User, Admin, Contract, Settlement, sequelize } = require('../models');
const { ErrorCodes, success, error, updated } = require('../utils/responseHelper');
const { Op } = require('sequelize');
const { todayKST } = require('../utils/dateHelper');

/**
 * 영수증 발급 대기/완료 리스트 조회
 * GET /api/admin/receipts
 */
const getReceiptList = async (req, res) => {
  try {
    const {
      status,         // PENDING, ISSUED
      userType,       // HOST, GUEST
      receiptType,    // personal, business, tax_invoice
      targetType,     // CONTRACT_FEE, HOST_CANCEL_FEE, GUEST_CANCEL_FEE, OPTION_SALE
      search,         // 사용자 이름 or 번호 검색
      startDate,      // 기간 필터 시작일
      endDate,        // 기간 필터 종료일
      page = 1,
      limit = 20
    } = req.query;

    const where = {};

    if (status) {
      where.status = status;
    }

    if (userType) {
      where.userType = userType;
    }

    if (receiptType) {
      where.receiptType = receiptType;
    }

    if (targetType) {
      where.targetType = targetType;
    }

    // 기간 필터
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date[Op.gte] = startDate;
      if (endDate) where.date[Op.lte] = endDate;
    }

    // 사용자 검색 조건
    const userWhere = {};
    if (search && search.trim()) {
      userWhere[Op.or] = [
        { name: { [Op.like]: `%${search.trim()}%` } },
        { phoneNumber: { [Op.like]: `%${search.trim()}%` } }
      ];
    }

    const offset = (page - 1) * limit;

    const { count, rows } = await Receipt.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'phoneNumber', 'email'],
          where: Object.keys(userWhere).length > 0 ? userWhere : undefined
        },
        {
          model: Admin,
          as: 'issuedByAdmin',
          attributes: ['id', 'name'],
          required: false
        },
        {
          model: Contract,
          as: 'contract',
          attributes: ['id', 'orderId'],
          required: false
        }
      ],
      order: [
        // PENDING 먼저, 최신 순
        [sequelize.literal(`FIELD(\`Receipt\`.\`status\`, 'PENDING', 'ISSUED')`), 'ASC'],
        ['date', 'DESC'],
        ['createdAt', 'DESC']
      ],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    const receipts = rows.map(r => ({
      id: r.id,
      userType: r.userType,
      userId: r.user?.id,
      userName: r.user?.name,
      orderId: r.contract?.orderId || null,
      receiptType: r.receiptType,
      targetType: r.targetType,
      amount: r.amount,
      date: r.date,
      status: r.status,
      issuedAt: r.issuedAt,
      createdAt: r.createdAt
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
 * 영수증 상세 조회
 * GET /api/admin/receipts/:id
 */
const getReceiptDetail = async (req, res) => {
  try {
    const { id } = req.params;

    const receipt = await Receipt.findByPk(id, {
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'phoneNumber', 'email']
        },
        {
          model: Admin,
          as: 'issuedByAdmin',
          attributes: ['id', 'name'],
          required: false
        },
        {
          model: Contract,
          as: 'contract',
          attributes: ['id', 'orderId'],
          required: false
        },
        {
          model: Settlement,
          as: 'settlement',
          attributes: ['id', 'status', 'netAmount', 'expectedDate', 'completedAt'],
          required: false
        }
      ]
    });

    if (!receipt) {
      return error(res, ErrorCodes.RECEIPT_NOT_FOUND, 404);
    }

    return success(res, {
      id: receipt.id,
      userType: receipt.userType,
      userId: receipt.user?.id,
      userName: receipt.user?.name,
      userPhone: receipt.user?.phoneNumber,
      userEmail: receipt.user?.email,
      orderId: receipt.contract?.orderId || null,
      contractId: receipt.contractId,
      settlementId: receipt.settlementId,
      receiptType: receipt.receiptType,
      targetType: receipt.targetType,
      amount: receipt.amount,
      date: receipt.date,
      status: receipt.status,
      issuedAt: receipt.issuedAt,
      issuedByAdmin: receipt.issuedByAdmin ? {
        id: receipt.issuedByAdmin.id,
        name: receipt.issuedByAdmin.name
      } : null,
      issueNote: receipt.issueNote,
      // 발급 정보 (스냅샷)
      receiptNumber: receipt.receiptNumber,
      businessName: receipt.businessName,
      repName: receipt.repName,
      email: receipt.email,
      // 정산 정보
      settlement: receipt.settlement ? {
        id: receipt.settlement.id,
        status: receipt.settlement.status,
        netAmount: receipt.settlement.netAmount,
        expectedDate: receipt.settlement.expectedDate,
        completedAt: receipt.settlement.completedAt
      } : null,
      createdAt: receipt.createdAt,
      updatedAt: receipt.updatedAt
    });
  } catch (err) {
    console.error('Admin get receipt detail error:', err);
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

    const receipt = await Receipt.findByPk(id);
    if (!receipt) {
      return error(res, ErrorCodes.RECEIPT_NOT_FOUND, 404);
    }

    if (receipt.status === 'ISSUED') {
      return error(res, ErrorCodes.RECEIPT_ALREADY_ISSUED, 400);
    }

    await receipt.update({
      status: 'ISSUED',
      issuedAt: new Date(),
      issuedBy: adminId,
      issueNote: note || null
    });

    return updated(res, {
      id: receipt.id,
      status: receipt.status,
      issuedAt: receipt.issuedAt,
      issuedBy: adminId,
      issueNote: receipt.issueNote
    }, '영수증이 발급 처리되었습니다.');
  } catch (err) {
    console.error('Admin issue receipt error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 영수증 발급 이력 조회 (발급 완료 건)
 * GET /api/admin/receipts/history
 */
const getReceiptHistory = async (req, res) => {
  try {
    const {
      userType,
      receiptType,
      targetType,
      search,
      startDate,
      endDate,
      page = 1,
      limit = 20
    } = req.query;

    const where = { status: 'ISSUED' };

    if (userType) where.userType = userType;
    if (receiptType) where.receiptType = receiptType;
    if (targetType) where.targetType = targetType;

    if (startDate || endDate) {
      where.issuedAt = {};
      if (startDate) where.issuedAt[Op.gte] = startDate;
      if (endDate) where.issuedAt[Op.lte] = endDate + ' 23:59:59';
    }

    const userWhere = {};
    if (search && search.trim()) {
      userWhere[Op.or] = [
        { name: { [Op.like]: `%${search.trim()}%` } },
        { phoneNumber: { [Op.like]: `%${search.trim()}%` } }
      ];
    }

    const offset = (page - 1) * limit;

    const { count, rows } = await Receipt.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'phoneNumber', 'email'],
          where: Object.keys(userWhere).length > 0 ? userWhere : undefined
        },
        {
          model: Admin,
          as: 'issuedByAdmin',
          attributes: ['id', 'name'],
          required: false
        },
        {
          model: Contract,
          as: 'contract',
          attributes: ['id', 'orderId'],
          required: false
        }
      ],
      order: [['issuedAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    const receipts = rows.map(r => ({
      id: r.id,
      userType: r.userType,
      userId: r.user?.id,
      userName: r.user?.name,
      orderId: r.contract?.orderId || null,
      receiptType: r.receiptType,
      targetType: r.targetType,
      amount: r.amount,
      date: r.date,
      status: r.status,
      issuedAt: r.issuedAt,
      issuedByAdmin: r.issuedByAdmin ? {
        id: r.issuedByAdmin.id,
        name: r.issuedByAdmin.name
      } : null
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
    console.error('Admin get receipt history error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 영수증 CSV 다운로드
 * GET /api/admin/receipts/export
 */
const exportReceiptsCsv = async (req, res) => {
  try {
    const {
      status,
      userType,
      receiptType,
      targetType,
      search,
      startDate,
      endDate
    } = req.query;

    const where = {};

    if (status) where.status = status;
    if (userType) where.userType = userType;
    if (receiptType) where.receiptType = receiptType;
    if (targetType) where.targetType = targetType;

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date[Op.gte] = startDate;
      if (endDate) where.date[Op.lte] = endDate;
    }

    const userWhere = {};
    if (search && search.trim()) {
      userWhere[Op.or] = [
        { name: { [Op.like]: `%${search.trim()}%` } },
        { phoneNumber: { [Op.like]: `%${search.trim()}%` } }
      ];
    }

    const rows = await Receipt.findAll({
      where,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name'],
          where: Object.keys(userWhere).length > 0 ? userWhere : undefined
        },
        {
          model: Contract,
          as: 'contract',
          attributes: ['id', 'orderId'],
          required: false
        }
      ],
      order: [['date', 'DESC'], ['createdAt', 'DESC']]
    });

    // targetType 한글 매핑
    const targetTypeLabels = {
      CONTRACT_FEE: '플랫폼 서비스 수수료',
      HOST_CANCEL_FEE: '호스트 취소 수수료',
      GUEST_CANCEL_FEE: '게스트 취소 위약금 (플랫폼 귀속)',
      OPTION_SALE: '옵션 상품 이용료'
    };

    // receiptType 한글 매핑
    const receiptTypeLabels = {
      personal: '개인소득공제용',
      business: '사업자증빙용',
      tax_invoice: '전자세금계산서'
    };

    // statusLabels 한글 매핑
    const statusLabels = {
      PENDING: '발급 대기',
      ISSUED: '발급 완료'
    };

    // CSV 헤더
    const csvHeader = '영수증ID,사용자유형,사용자ID,사용자명,주문번호,영수증유형,발급유형,금액,날짜,발급상태,발급완료시각\n';

    // BOM + 헤더 + 데이터
    const bom = '\uFEFF';
    const csvRows = rows.map(r => {
      return [
        r.id,
        r.userType === 'HOST' ? '호스트' : '게스트',
        r.user?.id || '',
        r.user?.name || '',
        r.contract?.orderId || '',
        receiptTypeLabels[r.receiptType] || r.receiptType,
        targetTypeLabels[r.targetType] || r.targetType,
        r.amount,
        r.date,
        statusLabels[r.status] || r.status,
        r.issuedAt ? new Date(r.issuedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }).replace(/\. /g, '-').replace('.', '') : ''
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
    }).join('\n');

    const csv = bom + csvHeader + csvRows;

    const filename = `receipts_${todayKST()}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch (err) {
    console.error('Admin export receipts CSV error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

module.exports = {
  getReceiptList,
  getReceiptDetail,
  issueReceipt,
  getReceiptHistory,
  exportReceiptsCsv
};
