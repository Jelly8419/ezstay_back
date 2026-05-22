/**
 * adminMoveInServiceTaskController.js
 * 관리자용 입주 준비 서비스 태스크 관리
 *
 * 기존 ServiceTask 관리 화면(/api/admin/service-tasks)과 통합:
 *  - source=internal | move_in | all 쿼리로 분기
 *  - 두 도메인을 동일 응답 포맷으로 직렬화 (id 충돌 방지를 위해 source 명시)
 *
 * 단건/상태변경은 source 파라미터로 분기 (라우트 레벨에서 처리)
 */
const { Op } = require('sequelize');
const {
  MoveInServiceTask,
  MoveInServiceTaskLog,
  MoveInCase
} = require('../models');
const { ErrorCodes, success, error, updated } = require('../utils/responseHelper');
const cryptoHelper = require('../utils/cryptoHelper');
const { toKSTString } = require('../utils/dateHelper');

const VALID_TASK_STATUSES = ['PENDING', 'RESERVED', 'COMPLETED', 'ISSUE'];
const TASK_TRANSITIONS = {
  PENDING:   ['RESERVED', 'COMPLETED', 'ISSUE'],
  RESERVED:  ['COMPLETED', 'ISSUE'],
  ISSUE:     ['RESERVED', 'COMPLETED'],
  COMPLETED: ['PENDING', 'RESERVED', 'ISSUE']
};

/**
 * MoveInServiceTask + Case 조회 결과를 응답 포맷으로 직렬화
 * - 기존 service_tasks 응답 스키마와 호환 (source 필드만 추가)
 */
function serializeTask(task, { decryptPasswords = false } = {}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const refDate = new Date(task.referenceDate);
  refDate.setHours(0, 0, 0, 0);
  const dDay = Math.ceil((refDate - today) / (1000 * 60 * 60 * 24));

  const snapshot = task.case?.roomSnapshot || {};
  const passwords = decryptPasswords
    ? {
        commonEntrancePassword: cryptoHelper.decrypt(snapshot.commonEntrancePassword),
        doorLockPassword: cryptoHelper.decrypt(snapshot.doorLockPassword)
      }
    : {};

  return {
    source: 'move_in',
    id: task.id,
    caseId: task.caseId,
    contractId: null, // 기존 응답 호환용
    roomName: snapshot.roomName || snapshot.address || null,
    address: snapshot.address || null,
    detailAddress: snapshot.detailAddress || null,
    areaPyeong: snapshot.areaPyeong ?? null,
    cleaningSuppliesLocation: snapshot.cleaningSuppliesLocation || null,
    taskType: task.taskType,
    referenceDate: task.referenceDate,
    dDay,
    quantity: task.quantity,
    status: task.status,
    vendorName: task.vendorName,
    vendorContact: task.vendorContact,
    vendorRefNo: task.vendorRefNo,
    reservedAmount: task.reservedAmount,
    actualAmount: task.actualAmount,
    issueNote: task.issueNote,
    guestName: task.case?.guestName ?? null,
    guestPhone: task.case?.guestPhone ?? null,
    checkInDate: task.case?.checkInDate ?? null,
    checkOutDate: task.case?.checkOutDate ?? null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...passwords
  };
}

/**
 * 목록 조회 (외부에서 source=move_in|all 일 때 호출)
 *
 * @param {Object} query - { tab, task_type, status, date_from, date_to, page, limit }
 * @returns {Promise<{ total: number, items: any[] }>}
 */
async function listMoveInServiceTasks(query) {
  const {
    tab,
    task_type,
    status: statusFilter,
    date_from,
    date_to,
    page = 1,
    limit = 20
  } = query;

  const where = {};
  if (tab === 'pending') {
    where.status = 'PENDING';
  } else if (statusFilter) {
    where.status = statusFilter;
  }
  if (task_type) where.taskType = task_type;
  if (date_from || date_to) {
    where.referenceDate = {};
    if (date_from) where.referenceDate[Op.gte] = date_from;
    if (date_to)   where.referenceDate[Op.lte] = date_to;
  }

  const offset = (parseInt(page) - 1) * parseInt(limit);

  const { count, rows } = await MoveInServiceTask.findAndCountAll({
    where,
    include: [
      {
        model: MoveInCase,
        as: 'case',
        attributes: ['id', 'checkInDate', 'checkOutDate', 'guestName', 'guestPhone', 'roomSnapshot']
      }
    ],
    order: [['referenceDate', 'ASC']],
    limit: parseInt(limit),
    offset
  });

  return {
    total: count,
    items: rows.map(t => serializeTask(t))
  };
}

/**
 * GET /api/admin/move-in/service-tasks
 * (라우트가 별도로 분리되어 있을 때 사용)
 */
const getMoveInServiceTasks = async (req, res) => {
  try {
    const { total, items } = await listMoveInServiceTasks(req.query);
    return success(res, {
      total,
      page: parseInt(req.query.page || 1),
      limit: parseInt(req.query.limit || 20),
      items
    });
  } catch (err) {
    console.error('MoveInServiceTask 목록 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * GET /api/admin/service-tasks/:id?source=move_in
 * 단건 조회 (변경 이력 + 비밀번호 복호화 포함)
 */
const getMoveInServiceTask = async (req, res) => {
  try {
    const { id } = req.params;

    const task = await MoveInServiceTask.findByPk(id, {
      include: [
        {
          model: MoveInCase,
          as: 'case',
          attributes: ['id', 'checkInDate', 'checkOutDate', 'guestName', 'guestPhone', 'roomSnapshot']
        },
        {
          model: MoveInServiceTaskLog,
          as: 'logs'
        }
      ],
      order: [[{ model: MoveInServiceTaskLog, as: 'logs' }, 'createdAt', 'DESC']]
    });

    if (!task) {
      return error(res, ErrorCodes.NOT_FOUND, 404, '서비스 태스크를 찾을 수 없습니다.');
    }

    return success(res, {
      ...serializeTask(task, { decryptPasswords: true }),
      checkInDate: toKSTString(task.case?.checkInDate),
      checkOutDate: toKSTString(task.case?.checkOutDate),
      logs: (task.logs || []).map(log => ({
        id: log.id,
        fromStatus: log.fromStatus,
        toStatus: log.toStatus,
        changedBy: log.changedBy,
        adminId: log.adminId,
        adminName: log.adminName,
        clearedVendorName: log.clearedVendorName,
        clearedVendorContact: log.clearedVendorContact,
        clearedVendorRefNo: log.clearedVendorRefNo,
        clearedReservedAmount: log.clearedReservedAmount,
        clearedActualAmount: log.clearedActualAmount,
        note: log.note,
        createdAt: log.createdAt
      }))
    });
  } catch (err) {
    console.error('MoveInServiceTask 단건 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * PATCH /api/admin/service-tasks/:id/status?source=move_in
 * 상태 변경 (기존 ServiceTask와 동일 전이 규칙)
 */
const updateMoveInServiceTaskStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      status: newStatus,
      vendorName, vendorContact, vendorRefNo,
      reservedAmount, actualAmount,
      issueNote,
      note
    } = req.body;

    if (!newStatus) {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, 'status는 필수입니다.');
    }
    if (!VALID_TASK_STATUSES.includes(newStatus)) {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, '유효하지 않은 status 값입니다.');
    }

    const task = await MoveInServiceTask.findByPk(id);
    if (!task) {
      return error(res, ErrorCodes.NOT_FOUND, 404, '서비스 태스크를 찾을 수 없습니다.');
    }

    if (!TASK_TRANSITIONS[task.status]?.includes(newStatus)) {
      return error(
        res,
        ErrorCodes.VALIDATION_ERROR,
        400,
        `${task.status} → ${newStatus} 전환은 허용되지 않습니다.`
      );
    }

    const prevStatus = task.status;
    const updateData = { status: newStatus };
    let clearedVendor = null;

    if (newStatus === 'RESERVED') {
      if (vendorName     !== undefined) updateData.vendorName     = vendorName;
      if (vendorContact  !== undefined) updateData.vendorContact  = vendorContact;
      if (vendorRefNo    !== undefined) updateData.vendorRefNo    = vendorRefNo;
      if (reservedAmount !== undefined) updateData.reservedAmount = reservedAmount;
    }
    if (newStatus === 'COMPLETED') {
      if (actualAmount !== undefined) updateData.actualAmount = actualAmount;
    }
    if (newStatus === 'ISSUE') {
      if (issueNote !== undefined) updateData.issueNote = issueNote;
    }
    if (newStatus === 'PENDING') {
      clearedVendor = {
        name:           task.vendorName,
        contact:        task.vendorContact,
        refNo:          task.vendorRefNo,
        reservedAmount: task.reservedAmount,
        actualAmount:   task.actualAmount
      };
      updateData.vendorName     = null;
      updateData.vendorContact  = null;
      updateData.vendorRefNo    = null;
      updateData.reservedAmount = null;
      updateData.actualAmount   = null;
      updateData.issueNote      = null;
    }

    await task.update(updateData);

    await MoveInServiceTaskLog.createLog({
      serviceTaskId: task.id,
      caseId:        task.caseId,
      fromStatus:    prevStatus,
      toStatus:      newStatus,
      adminId:       req.admin.id,
      adminName:     req.admin.name,
      clearedVendor,
      note:          newStatus === 'ISSUE' ? (issueNote ?? note ?? null) : (note ?? null),
      req
    });

    return updated(res, {
      source: 'move_in',
      id: task.id,
      status: task.status,
      vendorName: task.vendorName,
      vendorContact: task.vendorContact,
      vendorRefNo: task.vendorRefNo,
      reservedAmount: task.reservedAmount,
      actualAmount: task.actualAmount,
      issueNote: task.issueNote,
      updatedAt: task.updatedAt
    });
  } catch (err) {
    console.error('MoveInServiceTask 상태 변경 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

module.exports = {
  // 외부에서 호출 가능한 핸들러
  getMoveInServiceTasks,
  getMoveInServiceTask,
  updateMoveInServiceTaskStatus,
  // 기존 admin 컨트롤러 통합용 헬퍼
  listMoveInServiceTasks,
  serializeTask
};
