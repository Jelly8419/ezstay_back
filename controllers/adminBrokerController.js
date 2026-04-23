/**
 * Admin Broker Controller
 * 중개인 마스터 / 적용률 / 임대인 귀속 관리
 *
 * 라우트 prefix: /api/admin/brokers
 * 월별 인센티브 / 지급 처리: adminBrokerIncentiveController 참조
 */

'use strict';

const { Op } = require('sequelize');
const {
  sequelize,
  Broker, BrokerRate, BrokerHostMapping,
  User,
} = require('../models');
const { success, error, created, updated, ErrorCodes } = require('../utils/responseHelper');
const { toKSTString } = require('../utils/dateHelper');

// ─── 유틸 ──────────────────────────────────────────────────────────

function isValidRate(rate) {
  const n = Number(rate);
  return Number.isFinite(n) && n > 0 && n <= 1;
}

function isValidDateRange(startDate, endDate) {
  return new Date(startDate) <= new Date(endDate);
}

/**
 * 특정 broker 의 "현재 유효한" rate row 를 찾는다.
 * effective_to IS NULL 인 가장 최근 row.
 */
async function findActiveRate(brokerId, transaction) {
  return BrokerRate.findOne({
    where: { brokerId, effectiveTo: null },
    order: [['effectiveFrom', 'DESC']],
    transaction,
  });
}

/**
 * 특정 host 의 "현재 유효한" mapping (end_date IS NULL) 조회.
 */
async function findActiveMappingForHost(hostId, transaction) {
  return BrokerHostMapping.findOne({
    where: { hostId, endDate: null },
    transaction,
  });
}

// ─── 포맷터 ────────────────────────────────────────────────────────

function formatBrokerRow(broker, activeRate, hostCount) {
  return {
    id: broker.id,
    name: broker.name,
    phone: broker.phone,
    brokerType: broker.brokerType,
    taxId: broker.taxId,
    bankName: broker.bankName,
    bankAccount: broker.bankAccount,
    bankHolder: broker.bankHolder,
    startDate: broker.startDate,
    endDate: broker.endDate,
    status: broker.status,
    currentRate: activeRate ? Number(activeRate.rate) : null,
    hostCount: hostCount ?? 0,
    memo: broker.memo,
    createdAt: toKSTString(broker.createdAt),
    updatedAt: toKSTString(broker.updatedAt),
  };
}

// ─── 중개인 CRUD ────────────────────────────────────────────────────

/**
 * 중개인 목록
 * GET /api/admin/brokers
 * Query: page, limit, status, search (이름/연락처)
 */
exports.listBrokers = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status) where.status = status;
    if (search) {
      where[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { phone: { [Op.like]: `%${search}%` } },
      ];
    }

    const { count, rows } = await Broker.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset,
    });

    // 각 broker 의 현재 요율 + 귀속 host 수를 병렬 조회
    const enriched = await Promise.all(rows.map(async (b) => {
      const [activeRate, hostCount] = await Promise.all([
        findActiveRate(b.id),
        BrokerHostMapping.count({ where: { brokerId: b.id, endDate: null } }),
      ]);
      return formatBrokerRow(b, activeRate, hostCount);
    }));

    return success(res, {
      brokers: enriched,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / parseInt(limit)),
      },
    }, '중개인 목록을 조회했습니다.');
  } catch (err) {
    console.error('[adminBroker.listBrokers]', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 중개인 상세 (요율 이력 + 귀속 호스트 포함)
 * GET /api/admin/brokers/:brokerId
 */
exports.getBrokerDetail = async (req, res) => {
  try {
    const brokerId = parseInt(req.params.brokerId);
    const broker = await Broker.findByPk(brokerId);
    if (!broker) return error(res, ErrorCodes.BROKER_NOT_FOUND, 404);

    const [rates, mappings, activeRate, hostCount] = await Promise.all([
      BrokerRate.findAll({ where: { brokerId }, order: [['effectiveFrom', 'DESC']] }),
      BrokerHostMapping.findAll({
        where: { brokerId },
        include: [{ model: User, as: 'host', attributes: ['id', 'name', 'nickname', 'phoneNumber'] }],
        order: [['startDate', 'DESC']],
      }),
      findActiveRate(brokerId),
      BrokerHostMapping.count({ where: { brokerId, endDate: null } }),
    ]);

    return success(res, {
      broker: formatBrokerRow(broker, activeRate, hostCount),
      rates: rates.map((r) => ({
        id: r.id,
        rate: Number(r.rate),
        effectiveFrom: toKSTString(r.effectiveFrom),
        effectiveTo: r.effectiveTo ? toKSTString(r.effectiveTo) : null,
        createdAt: toKSTString(r.createdAt),
      })),
      hostMappings: mappings.map((m) => ({
        id: m.id,
        hostId: m.hostId,
        hostName: m.host?.name,
        hostNickname: m.host?.nickname,
        hostPhone: m.host?.phoneNumber,
        startDate: toKSTString(m.startDate),
        endDate: m.endDate ? toKSTString(m.endDate) : null,
        isActive: m.endDate === null,
      })),
    }, '중개인 상세를 조회했습니다.');
  } catch (err) {
    console.error('[adminBroker.getBrokerDetail]', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 중개인 생성
 * POST /api/admin/brokers
 * Body: { name, phone, brokerType, taxId?, bankName?, bankAccount?, bankHolder?,
 *         startDate, endDate, status?, memo?, initialRate? }
 *
 * initialRate 가 있으면 BrokerRate 도 동시 생성 (effectiveFrom=now, effectiveTo=null).
 */
exports.createBroker = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const {
      name, phone, brokerType, taxId,
      bankName, bankAccount, bankHolder,
      startDate, endDate,
      status = 'active', memo,
      initialRate,
    } = req.body;

    if (!name || !phone || !brokerType || !startDate || !endDate) {
      await transaction.rollback();
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
    }
    if (brokerType === 'business' && !taxId) {
      await transaction.rollback();
      return error(res, ErrorCodes.BROKER_TAX_ID_REQUIRED, 400);
    }
    if (!isValidDateRange(startDate, endDate)) {
      await transaction.rollback();
      return error(res, ErrorCodes.BROKER_INVALID_DATE_RANGE, 400);
    }
    if (initialRate !== undefined && !isValidRate(initialRate)) {
      await transaction.rollback();
      return error(res, ErrorCodes.BROKER_RATE_INVALID, 400);
    }

    const broker = await Broker.create({
      name, phone, brokerType, taxId,
      bankName, bankAccount, bankHolder,
      startDate, endDate, status, memo,
    }, { transaction });

    if (initialRate !== undefined) {
      await BrokerRate.create({
        brokerId: broker.id,
        rate: initialRate,
        effectiveFrom: new Date(),
        effectiveTo: null,
      }, { transaction });
    }

    await transaction.commit();
    return created(res, { brokerId: broker.id }, '중개인이 생성되었습니다.');
  } catch (err) {
    await transaction.rollback();
    console.error('[adminBroker.createBroker]', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 중개인 수정
 * PATCH /api/admin/brokers/:brokerId
 * 수정 가능: name, phone, brokerType, taxId, bank*, startDate, endDate, status, memo
 * 요율은 별도 엔드포인트 (addBrokerRate) 사용.
 */
exports.updateBroker = async (req, res) => {
  try {
    const brokerId = parseInt(req.params.brokerId);
    const broker = await Broker.findByPk(brokerId);
    if (!broker) return error(res, ErrorCodes.BROKER_NOT_FOUND, 404);

    const allowedFields = [
      'name', 'phone', 'brokerType', 'taxId',
      'bankName', 'bankAccount', 'bankHolder',
      'startDate', 'endDate', 'status', 'memo',
    ];
    const patch = {};
    for (const k of allowedFields) {
      if (k in req.body) patch[k] = req.body[k];
    }

    const merged = { ...broker.toJSON(), ...patch };
    if (merged.brokerType === 'business' && !merged.taxId) {
      return error(res, ErrorCodes.BROKER_TAX_ID_REQUIRED, 400);
    }
    if (!isValidDateRange(merged.startDate, merged.endDate)) {
      return error(res, ErrorCodes.BROKER_INVALID_DATE_RANGE, 400);
    }

    await broker.update(patch);
    return updated(res, { brokerId }, '중개인 정보가 수정되었습니다.');
  } catch (err) {
    console.error('[adminBroker.updateBroker]', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

// ─── 적용률 (시간 구간) ────────────────────────────────────────────

/**
 * 적용률 이력 조회
 * GET /api/admin/brokers/:brokerId/rates
 */
exports.listBrokerRates = async (req, res) => {
  try {
    const brokerId = parseInt(req.params.brokerId);
    const broker = await Broker.findByPk(brokerId);
    if (!broker) return error(res, ErrorCodes.BROKER_NOT_FOUND, 404);

    const rates = await BrokerRate.findAll({
      where: { brokerId },
      order: [['effectiveFrom', 'DESC']],
    });

    return success(res, {
      rates: rates.map((r) => ({
        id: r.id,
        rate: Number(r.rate),
        effectiveFrom: toKSTString(r.effectiveFrom),
        effectiveTo: r.effectiveTo ? toKSTString(r.effectiveTo) : null,
      })),
    }, '요율 이력을 조회했습니다.');
  } catch (err) {
    console.error('[adminBroker.listBrokerRates]', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 새 적용률 추가
 * POST /api/admin/brokers/:brokerId/rates
 * Body: { rate, effectiveFrom? }
 *
 * 동작:
 *  - effectiveFrom 미지정 시 현재 시각 사용
 *  - 기존 활성 rate(effective_to=NULL) 의 effective_to 를 effectiveFrom 으로 마감
 *  - 새 rate 는 effectiveTo=NULL 로 생성
 */
exports.addBrokerRate = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const brokerId = parseInt(req.params.brokerId);
    const { rate, effectiveFrom } = req.body;

    const broker = await Broker.findByPk(brokerId, { transaction });
    if (!broker) {
      await transaction.rollback();
      return error(res, ErrorCodes.BROKER_NOT_FOUND, 404);
    }
    if (!isValidRate(rate)) {
      await transaction.rollback();
      return error(res, ErrorCodes.BROKER_RATE_INVALID, 400);
    }

    const appliedFrom = effectiveFrom ? new Date(effectiveFrom) : new Date();

    // 기존 활성 rate 마감
    const prev = await findActiveRate(brokerId, transaction);
    if (prev) {
      await prev.update({ effectiveTo: appliedFrom }, { transaction });
    }

    const row = await BrokerRate.create({
      brokerId,
      rate,
      effectiveFrom: appliedFrom,
      effectiveTo: null,
    }, { transaction });

    await transaction.commit();
    return created(res, { rateId: row.id }, '새 적용률이 등록되었습니다.');
  } catch (err) {
    await transaction.rollback();
    console.error('[adminBroker.addBrokerRate]', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

// ─── 임대인 귀속 ───────────────────────────────────────────────────

/**
 * 특정 중개인에 귀속된 임대인 목록
 * GET /api/admin/brokers/:brokerId/hosts
 */
exports.listBrokerHosts = async (req, res) => {
  try {
    const brokerId = parseInt(req.params.brokerId);
    const broker = await Broker.findByPk(brokerId);
    if (!broker) return error(res, ErrorCodes.BROKER_NOT_FOUND, 404);

    const mappings = await BrokerHostMapping.findAll({
      where: { brokerId },
      include: [{ model: User, as: 'host', attributes: ['id', 'name', 'nickname', 'phoneNumber', 'email'] }],
      order: [['startDate', 'DESC']],
    });

    return success(res, {
      mappings: mappings.map((m) => ({
        id: m.id,
        hostId: m.hostId,
        hostName: m.host?.name,
        hostNickname: m.host?.nickname,
        hostPhone: m.host?.phoneNumber,
        hostEmail: m.host?.email,
        startDate: toKSTString(m.startDate),
        endDate: m.endDate ? toKSTString(m.endDate) : null,
        isActive: m.endDate === null,
      })),
    }, '귀속 임대인 목록을 조회했습니다.');
  } catch (err) {
    console.error('[adminBroker.listBrokerHosts]', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 중개인에 임대인 귀속 추가
 * POST /api/admin/brokers/:brokerId/hosts
 * Body: { hostId, startDate? }
 *
 * 검증: 해당 host 에 이미 활성 매핑(end_date=NULL) 존재 시 거부 (동일 시점 중복 금지).
 */
exports.addBrokerHostMapping = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const brokerId = parseInt(req.params.brokerId);
    const { hostId, startDate } = req.body;

    if (!hostId) {
      await transaction.rollback();
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
    }

    const broker = await Broker.findByPk(brokerId, { transaction });
    if (!broker) {
      await transaction.rollback();
      return error(res, ErrorCodes.BROKER_NOT_FOUND, 404);
    }

    const host = await User.findByPk(hostId, { transaction });
    if (!host) {
      await transaction.rollback();
      return error(res, ErrorCodes.BROKER_HOST_NOT_FOUND, 404);
    }

    const existing = await findActiveMappingForHost(hostId, transaction);
    if (existing) {
      await transaction.rollback();
      return error(res, ErrorCodes.BROKER_HOST_ALREADY_MAPPED, 409, {
        existingBrokerId: existing.brokerId,
      });
    }

    const mapping = await BrokerHostMapping.create({
      brokerId,
      hostId,
      startDate: startDate ? new Date(startDate) : new Date(),
      endDate: null,
      createdByAdminId: req.admin?.id || null,
    }, { transaction });

    await transaction.commit();
    return created(res, { mappingId: mapping.id }, '임대인 귀속이 추가되었습니다.');
  } catch (err) {
    await transaction.rollback();
    console.error('[adminBroker.addBrokerHostMapping]', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 중개인 임대인 귀속 해제
 * DELETE /api/admin/brokers/:brokerId/hosts/:hostId
 *
 * 동작: 활성 매핑의 endDate 를 현재 시각으로 세팅 (soft end).
 */
exports.removeBrokerHostMapping = async (req, res) => {
  try {
    const brokerId = parseInt(req.params.brokerId);
    const hostId = parseInt(req.params.hostId);

    const mapping = await BrokerHostMapping.findOne({
      where: { brokerId, hostId, endDate: null },
    });
    if (!mapping) return error(res, ErrorCodes.BROKER_HOST_MAPPING_NOT_FOUND, 404);

    await mapping.update({ endDate: new Date() });
    return updated(res, { mappingId: mapping.id }, '임대인 귀속이 해제되었습니다.');
  } catch (err) {
    console.error('[adminBroker.removeBrokerHostMapping]', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};
