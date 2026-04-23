/**
 * Admin Broker Incentive Controller
 * 중개인 월별 인센티브 조회 / 지급완료 처리 / CSV 다운로드
 *
 * 라우트 prefix: /api/admin/broker-incentives
 *
 * 핵심 흐름:
 *   1) 월별 리스트 조회 (GET /monthly?month=YYYY-MM) 시
 *      aggregateMonth() 호출 → broker×month 의 payout 행 upsert
 *   2) 지급완료 처리 (PATCH /monthly/:payoutId/pay) 는 idempotent 보장
 *      - 이미 PAID 면 4917 반환
 *      - 지급 후에는 재집계 안 됨 (aggregator 에서 skip)
 */

'use strict';

const { Op } = require('sequelize');
const {
  sequelize,
  Broker, BrokerIncentive, BrokerIncentivePayout,
  Contract, User, Settlement,
} = require('../models');
const { success, error, updated, ErrorCodes } = require('../utils/responseHelper');
const { toKSTString } = require('../utils/dateHelper');
const { aggregateMonth, validateMonth } = require('../services/brokerIncentiveAggregator');

// ─── 헬퍼 ──────────────────────────────────────────────────────────

function formatPayoutRow(payout, broker) {
  return {
    payoutId: payout.id,
    brokerId: payout.brokerId,
    brokerName: broker?.name,
    brokerPhone: broker?.phone,
    brokerType: broker?.brokerType,
    settlementMonth: payout.settlementMonth,
    contractCount: payout.contractCount,
    totalGross: payout.totalGross,
    totalWithholding: payout.totalWithholding,
    totalSupply: payout.totalSupply,
    totalVat: payout.totalVat,
    totalNet: payout.totalNet,
    status: payout.status,
    paidAt: payout.paidAt ? toKSTString(payout.paidAt) : null,
    paidByAdminId: payout.paidByAdminId,
    memo: payout.memo,
    createdAt: toKSTString(payout.createdAt),
    updatedAt: toKSTString(payout.updatedAt),
  };
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ─── 월별 리스트 ───────────────────────────────────────────────────

/**
 * 월별 중개인 인센티브 목록
 * GET /api/admin/broker-incentives/monthly?month=YYYY-MM&status=PENDING|PAID
 *
 * 호출 시 aggregateMonth 를 돌려 payout 행 upsert 한 뒤 조회.
 */
exports.listMonthlyPayouts = async (req, res) => {
  try {
    const { month, status } = req.query;

    try {
      validateMonth(month);
    } catch {
      return error(res, ErrorCodes.BROKER_MONTH_INVALID, 400);
    }

    // upsert: payout 행을 최신 상태로 갱신 (지급완료 건은 skip)
    const transaction = await sequelize.transaction();
    try {
      await aggregateMonth(month, { transaction });
      await transaction.commit();
    } catch (e) {
      await transaction.rollback();
      throw e;
    }

    const where = { settlementMonth: month };
    if (status) where.status = status;

    const payouts = await BrokerIncentivePayout.findAll({
      where,
      include: [{ model: Broker, as: 'broker', attributes: ['id', 'name', 'phone', 'brokerType'] }],
      order: [['brokerId', 'ASC']],
    });

    // 요약
    const summary = {
      totalBrokers: payouts.length,
      totalContracts: payouts.reduce((s, p) => s + p.contractCount, 0),
      totalGross: payouts.reduce((s, p) => s + p.totalGross, 0),
      totalNet: payouts.reduce((s, p) => s + p.totalNet, 0),
      pendingCount: payouts.filter((p) => p.status === 'PENDING').length,
      paidCount: payouts.filter((p) => p.status === 'PAID').length,
    };

    return success(res, {
      month,
      payouts: payouts.map((p) => formatPayoutRow(p, p.broker)),
      summary,
    }, '월별 인센티브 목록을 조회했습니다.');
  } catch (err) {
    console.error('[adminBrokerIncentive.listMonthlyPayouts]', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 월별 지급 상세 (계약 리스트 포함)
 * GET /api/admin/broker-incentives/monthly/:payoutId
 */
exports.getMonthlyPayoutDetail = async (req, res) => {
  try {
    const payoutId = parseInt(req.params.payoutId);
    const payout = await BrokerIncentivePayout.findByPk(payoutId, {
      include: [{ model: Broker, as: 'broker' }],
    });
    if (!payout) return error(res, ErrorCodes.BROKER_INCENTIVE_PAYOUT_NOT_FOUND, 404);

    // 이 payout 에 집계된 인센티브 + 계약 정보
    const incentives = await BrokerIncentive.findAll({
      where: { payoutId: payout.id },
      include: [
        {
          model: Contract,
          as: 'contract',
          attributes: ['id', 'orderId', 'checkInDate', 'checkOutDate', 'hostId', 'paidAt'],
          include: [{ model: User, as: 'host', attributes: ['id', 'name', 'nickname'] }],
        },
        {
          model: Settlement,
          as: 'settlement',
          attributes: ['id', 'expectedDate', 'hostPlatformFee', 'status'],
        },
      ],
      order: [['createdAt', 'ASC']],
    });

    return success(res, {
      payout: formatPayoutRow(payout, payout.broker),
      incentives: incentives.map((inc) => ({
        id: inc.id,
        contractId: inc.contractId,
        orderId: inc.contract?.orderId,
        hostId: inc.contract?.hostId,
        hostName: inc.contract?.host?.name,
        hostNickname: inc.contract?.host?.nickname,
        checkInDate: inc.contract?.checkInDate,
        paidAt: inc.contract?.paidAt ? toKSTString(inc.contract.paidAt) : null,
        settlementExpectedDate: inc.settlement?.expectedDate,
        settlementStatus: inc.settlement?.status,
        baseFee: inc.baseFee,
        appliedRate: Number(inc.appliedRate),
        brokerType: inc.brokerType,
        grossAmount: inc.grossAmount,
        withholdingAmount: inc.withholdingAmount,
        supplyAmount: inc.supplyAmount,
        vatAmount: inc.vatAmount,
        netAmount: inc.netAmount,
        status: inc.status,
      })),
    }, '월별 지급 상세를 조회했습니다.');
  } catch (err) {
    console.error('[adminBrokerIncentive.getMonthlyPayoutDetail]', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 월별 지급 완료 처리
 * PATCH /api/admin/broker-incentives/monthly/:payoutId/pay
 * Body: { memo? }
 */
exports.markPayoutPaid = async (req, res) => {
  try {
    const payoutId = parseInt(req.params.payoutId);
    const payout = await BrokerIncentivePayout.findByPk(payoutId);
    if (!payout) return error(res, ErrorCodes.BROKER_INCENTIVE_PAYOUT_NOT_FOUND, 404);
    if (payout.status === 'PAID') {
      return error(res, ErrorCodes.BROKER_INCENTIVE_ALREADY_PAID, 400);
    }

    await payout.update({
      status: 'PAID',
      paidAt: new Date(),
      paidByAdminId: req.admin?.id || null,
      memo: req.body?.memo ?? payout.memo,
    });

    return updated(res, { payoutId }, '지급 완료 처리되었습니다.');
  } catch (err) {
    console.error('[adminBrokerIncentive.markPayoutPaid]', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 월별 지급 CSV 다운로드
 * GET /api/admin/broker-incentives/monthly/:payoutId/csv
 *
 * 이 payout 에 포함된 계약별 인센티브 행들을 CSV 로 반환.
 */
exports.downloadPayoutCsv = async (req, res) => {
  try {
    const payoutId = parseInt(req.params.payoutId);
    const payout = await BrokerIncentivePayout.findByPk(payoutId, {
      include: [{ model: Broker, as: 'broker', attributes: ['name', 'phone', 'brokerType', 'taxId'] }],
    });
    if (!payout) return error(res, ErrorCodes.BROKER_INCENTIVE_PAYOUT_NOT_FOUND, 404);

    const incentives = await BrokerIncentive.findAll({
      where: { payoutId: payout.id },
      include: [
        {
          model: Contract,
          as: 'contract',
          attributes: ['id', 'orderId', 'checkInDate', 'paidAt', 'hostId'],
          include: [{ model: User, as: 'host', attributes: ['name'] }],
        },
        {
          model: Settlement,
          as: 'settlement',
          attributes: ['expectedDate', 'hostPlatformFee'],
        },
      ],
      order: [['createdAt', 'ASC']],
    });

    const headers = [
      '계약번호', '주문번호', '임대인', '결제일', '정산예정일',
      '호스트수수료(base)', '적용률', '지급대상(gross)',
      '원천징수', '공급가액', '부가세', '실지급액', '상태',
    ];
    const lines = [headers.join(',')];

    for (const inc of incentives) {
      lines.push([
        inc.contractId,
        inc.contract?.orderId,
        inc.contract?.host?.name,
        inc.contract?.paidAt ? toKSTString(inc.contract.paidAt) : '',
        inc.settlement?.expectedDate || '',
        inc.baseFee,
        Number(inc.appliedRate),
        inc.grossAmount,
        inc.withholdingAmount,
        inc.supplyAmount,
        inc.vatAmount,
        inc.netAmount,
        inc.status,
      ].map(csvEscape).join(','));
    }

    // 합계 행
    lines.push([
      '합계', '', '', '', '', '', '',
      payout.totalGross,
      payout.totalWithholding,
      payout.totalSupply,
      payout.totalVat,
      payout.totalNet,
      '',
    ].map(csvEscape).join(','));

    const csv = lines.join('\n');
    const bom = '﻿'; // Excel UTF-8 인식용 BOM
    const filename = `broker-incentive-${payout.broker?.name || 'unknown'}-${payout.settlementMonth}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    return res.send(bom + csv);
  } catch (err) {
    console.error('[adminBrokerIncentive.downloadPayoutCsv]', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 월별 리스트 CSV 다운로드 (전체 broker 합계)
 * GET /api/admin/broker-incentives/monthly/csv?month=YYYY-MM
 */
exports.downloadMonthlyCsv = async (req, res) => {
  try {
    const { month } = req.query;
    try {
      validateMonth(month);
    } catch {
      return error(res, ErrorCodes.BROKER_MONTH_INVALID, 400);
    }

    // 집계 최신화
    const transaction = await sequelize.transaction();
    try {
      await aggregateMonth(month, { transaction });
      await transaction.commit();
    } catch (e) {
      await transaction.rollback();
      throw e;
    }

    const payouts = await BrokerIncentivePayout.findAll({
      where: { settlementMonth: month },
      include: [{ model: Broker, as: 'broker', attributes: ['name', 'phone', 'brokerType', 'taxId'] }],
      order: [['brokerId', 'ASC']],
    });

    const headers = [
      '정산월', '중개인', '연락처', '타입', '사업자번호',
      '계약수', '지급대상', '원천징수', '공급가액', '부가세', '실지급액',
      '상태', '지급일',
    ];
    const lines = [headers.join(',')];

    for (const p of payouts) {
      lines.push([
        p.settlementMonth,
        p.broker?.name,
        p.broker?.phone,
        p.broker?.brokerType,
        p.broker?.taxId,
        p.contractCount,
        p.totalGross,
        p.totalWithholding,
        p.totalSupply,
        p.totalVat,
        p.totalNet,
        p.status,
        p.paidAt ? toKSTString(p.paidAt) : '',
      ].map(csvEscape).join(','));
    }

    const csv = lines.join('\n');
    const bom = '﻿';
    const filename = `broker-incentive-monthly-${month}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    return res.send(bom + csv);
  } catch (err) {
    console.error('[adminBrokerIncentive.downloadMonthlyCsv]', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};
