/**
 * brokerIncentiveAggregator.js — 중개인 월별 인센티브 집계
 *
 * 목적:
 *   - 특정 월(settlement_month = YYYY-MM) 의 BrokerIncentive 행들을
 *     broker 별로 SUM 하여 BrokerIncentivePayout 에 upsert
 *   - Admin 이 월별 리스트를 조회할 때 온디맨드 호출 (스케줄러 부담 없음)
 *
 * 호출 흐름:
 *   1) Admin GET /broker-incentives/monthly?month=2026-05
 *      → aggregateMonth('2026-05') 호출 → payout 행 갱신 → 목록 반환
 *   2) 지급완료된 payout 은 재집계 대상 제외 (status=PAID 건드리지 않음)
 *
 * 집계 대상 BrokerIncentive:
 *   - status IN ('PENDING', 'AGGREGATED')
 *   - ON_HOLD/CANCELLED 은 제외 (취소된 계약 인센티브는 지급하지 않음)
 *
 * 상태 전환:
 *   - 집계 후 BrokerIncentive.status = 'AGGREGATED' + payout_id 세팅
 *   - (이후 ON_HOLD 전환이 와도 AGGREGATED 는 안 건드려지도록 하려면
 *      컨트롤러의 ON_HOLD 쿼리를 status=PENDING 만 대상으로 유지 — 이미 그렇게 구현됨)
 */

'use strict';

const { Op } = require('sequelize');
const { sequelize, BrokerIncentive, BrokerIncentivePayout } = require('../models');

/**
 * 특정 월의 모든 broker 별 인센티브를 집계하여 BrokerIncentivePayout 을 upsert.
 *
 * @param {string} month - 'YYYY-MM'
 * @param {object} [options]
 * @param {import('sequelize').Transaction} [options.transaction]
 * @returns {Promise<{ aggregatedCount: number, affectedBrokers: number[] }>}
 */
async function aggregateMonth(month, options = {}) {
  validateMonth(month);
  const { transaction } = options;

  // 해당 월의 집계 대상 인센티브를 broker 별로 GROUP BY
  const grouped = await BrokerIncentive.findAll({
    attributes: [
      'brokerId',
      [sequelize.fn('COUNT', sequelize.col('id')), 'contractCount'],
      [sequelize.fn('SUM', sequelize.col('gross_amount')),       'totalGross'],
      [sequelize.fn('SUM', sequelize.col('withholding_amount')), 'totalWithholding'],
      [sequelize.fn('SUM', sequelize.col('supply_amount')),      'totalSupply'],
      [sequelize.fn('SUM', sequelize.col('vat_amount')),         'totalVat'],
      [sequelize.fn('SUM', sequelize.col('net_amount')),         'totalNet'],
    ],
    where: {
      settlementMonth: month,
      status: { [Op.in]: ['PENDING', 'AGGREGATED'] },
    },
    group: ['brokerId'],
    raw: true,
    transaction,
  });

  const affectedBrokers = [];

  for (const row of grouped) {
    const brokerId = Number(row.brokerId);
    const sums = {
      contractCount:    Number(row.contractCount) || 0,
      totalGross:       Number(row.totalGross) || 0,
      totalWithholding: Number(row.totalWithholding) || 0,
      totalSupply:      Number(row.totalSupply) || 0,
      totalVat:         Number(row.totalVat) || 0,
      totalNet:         Number(row.totalNet) || 0,
    };

    const payout = await upsertPayoutForBroker(brokerId, month, sums, transaction);
    if (!payout) continue; // 지급완료된 경우는 재집계 생략
    affectedBrokers.push(brokerId);

    // 해당 broker × month 의 인센티브 행들을 AGGREGATED 로 전환 + payout_id 연결
    // (PENDING 또는 기존 AGGREGATED 모두 갱신 — payout_id 가 바뀔 수 있음)
    await BrokerIncentive.update(
      { status: 'AGGREGATED', payoutId: payout.id },
      {
        where: {
          brokerId,
          settlementMonth: month,
          status: { [Op.in]: ['PENDING', 'AGGREGATED'] },
        },
        transaction,
      }
    );
  }

  return {
    aggregatedCount: grouped.length,
    affectedBrokers,
  };
}

/**
 * broker × month 의 payout 행을 upsert. 이미 PAID 상태면 건드리지 않고 null 반환.
 */
async function upsertPayoutForBroker(brokerId, month, sums, transaction) {
  const existing = await BrokerIncentivePayout.findOne({
    where: { brokerId, settlementMonth: month },
    transaction,
  });

  if (existing) {
    if (existing.status === 'PAID') {
      // 지급완료 건은 재계산 금지
      return null;
    }
    await existing.update({
      contractCount:    sums.contractCount,
      totalGross:       sums.totalGross,
      totalWithholding: sums.totalWithholding,
      totalSupply:      sums.totalSupply,
      totalVat:         sums.totalVat,
      totalNet:         sums.totalNet,
    }, { transaction });
    return existing;
  }

  return BrokerIncentivePayout.create({
    brokerId,
    settlementMonth: month,
    contractCount:    sums.contractCount,
    totalGross:       sums.totalGross,
    totalWithholding: sums.totalWithholding,
    totalSupply:      sums.totalSupply,
    totalVat:         sums.totalVat,
    totalNet:         sums.totalNet,
    status: 'PENDING',
  }, { transaction });
}

/**
 * YYYY-MM 형식 검증.
 */
function validateMonth(month) {
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error(`Invalid month format: ${month} (expected YYYY-MM)`);
  }
}

module.exports = {
  aggregateMonth,
  validateMonth,
};
