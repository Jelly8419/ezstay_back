const { AdminActionLog, Admin, sequelize } = require('../models');
const { Op } = require('sequelize');
const { success, error, ErrorCodes } = require('../utils/responseHelper');

/**
 * 액션 로그 목록 조회
 * GET /api/admin/action-logs
 */
exports.getActionLogs = async (req, res) => {
  try {
    const {
      adminId,
      actionType,
      resourceType,
      startDate,
      endDate,
      page = 1,
      limit = 50
    } = req.query;

    const offset = (page - 1) * limit;

    // 필터 조건 구성
    const where = {};

    if (adminId) {
      where.adminId = parseInt(adminId);
    }

    if (actionType) {
      where.actionType = actionType;
    }

    if (resourceType) {
      where.resourceType = resourceType;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt[Op.gte] = new Date(startDate + 'T00:00:00+09:00');
      }
      if (endDate) {
        where.createdAt[Op.lte] = new Date(endDate + 'T23:59:59+09:00');
      }
    }

    const { count, rows } = await AdminActionLog.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: offset,
      include: [
        {
          model: Admin,
          as: 'admin',
          attributes: ['id', 'username', 'name', 'role']
        }
      ]
    });

    return success(res, {
      logs: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        totalPages: Math.ceil(count / limit)
      }
    }, '액션 로그 조회 성공');

  } catch (err) {
    console.error('액션 로그 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 특정 액션 로그 상세 조회
 * GET /api/admin/action-logs/:id
 */
exports.getActionLogById = async (req, res) => {
  try {
    const { id } = req.params;

    const log = await AdminActionLog.findByPk(id, {
      include: [
        {
          model: Admin,
          as: 'admin',
          attributes: ['id', 'username', 'name', 'role']
        }
      ]
    });

    if (!log) {
      return error(res, {
        code: 3001,
        message: '액션 로그를 찾을 수 없습니다.'
      }, 404);
    }

    return success(res, log, '액션 로그 상세 조회 성공');

  } catch (err) {
    console.error('액션 로그 상세 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 액션 로그 통계
 * GET /api/admin/action-logs/stats
 */
exports.getActionLogStats = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const where = {};

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt[Op.gte] = new Date(startDate + 'T00:00:00+09:00');
      }
      if (endDate) {
        where.createdAt[Op.lte] = new Date(endDate + 'T23:59:59+09:00');
      }
    }

    // 액션 타입별 통계
    const actionTypeStats = await AdminActionLog.findAll({
      where,
      attributes: [
        'actionType',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: ['actionType'],
      raw: true
    });

    // 리소스 타입별 통계
    const resourceTypeStats = await AdminActionLog.findAll({
      where,
      attributes: [
        'resourceType',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: ['resourceType'],
      raw: true
    });

    // 관리자별 활동 통계 (상위 10명)
    const adminActivityStats = await AdminActionLog.findAll({
      where,
      attributes: [
        'adminId',
        'adminName',
        'adminEmail',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: ['adminId', 'adminName', 'adminEmail'],
      order: [[sequelize.fn('COUNT', sequelize.col('id')), 'DESC']],
      limit: 10,
      raw: true
    });

    // 전체 통계
    const totalLogs = await AdminActionLog.count({ where });

    return success(res, {
      totalLogs,
      actionTypeStats,
      resourceTypeStats,
      adminActivityStats
    }, '액션 로그 통계 조회 성공');

  } catch (err) {
    console.error('액션 로그 통계 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};
