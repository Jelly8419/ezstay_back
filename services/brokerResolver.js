/**
 * brokerResolver.js — 결제 시점 기준 중개인 귀속/요율 판정
 *
 * 목적:
 *  - payments.approvedAt 시점에 호스트가 어느 중개인에 귀속되고 어떤 요율이 적용되는지 결정
 *  - 결과를 Contract 에 스냅샷(broker_id_snapshot / rate / type) 으로 박는다
 *  - 이후 매핑/요율 변경은 과거 계약에 영향 없음 (스냅샷 불변식)
 *
 * 판정 순서 (모두 AND, 하나라도 실패 → null):
 *   1) BrokerHostMapping: host_id = X, start_date ≤ approvedAt, (end_date IS NULL OR end_date > approvedAt)
 *   2) Broker:  status = 'active', start_date ≤ DATE(approvedAt) ≤ end_date
 *   3) BrokerRate: broker_id = Y, effective_from ≤ approvedAt, (effective_to IS NULL OR effective_to > approvedAt)
 *
 * 미귀속 케이스 (null 반환):
 *  - 호스트에 대한 활성 매핑 없음
 *  - 매핑은 있으나 broker 비활성 / 활동기간 밖
 *  - broker 는 유효하나 해당 시점 요율 row 없음 (설정 누락)
 *
 * 여러 매핑/요율이 동시에 유효한 비정상 케이스:
 *  - 가장 최근(start_date/effective_from DESC) row 채택
 *  - 앱 로직에서 생성 시 중복 방지하지만 데이터 정합성 안전망
 */

'use strict';

const { Op } = require('sequelize');
const { BrokerHostMapping, Broker, BrokerRate } = require('../models');

/**
 * 특정 시점에 호스트가 귀속된 중개인과 적용 요율/타입을 결정.
 *
 * @param {Object} params
 * @param {number} params.hostId     호스트 userId
 * @param {Date}   params.approvedAt 결제 승인 시각 (필수)
 * @param {import('sequelize').Transaction} [params.transaction]
 * @returns {Promise<null | { brokerId: number, rate: number, brokerType: 'individual'|'business' }>}
 */
async function resolveBrokerForHostAt({ hostId, approvedAt, transaction } = {}) {
  if (!hostId || !approvedAt) return null;
  if (!(approvedAt instanceof Date) || Number.isNaN(approvedAt.getTime())) return null;

  // 1) 호스트의 해당 시점 활성 매핑
  const mapping = await BrokerHostMapping.findOne({
    where: {
      hostId,
      startDate: { [Op.lte]: approvedAt },
      [Op.or]: [
        { endDate: null },
        { endDate: { [Op.gt]: approvedAt } },
      ],
    },
    order: [['startDate', 'DESC']],
    transaction,
  });
  if (!mapping) return null;

  // 2) broker 활성 + 활동기간 검증
  //    start_date/end_date 는 DATEONLY 이므로 YYYY-MM-DD 비교 (KST 환경 TZ=Asia/Seoul 기반)
  const approvedDateOnly = toDateOnlyKST(approvedAt);
  const broker = await Broker.findOne({
    where: {
      id: mapping.brokerId,
      status: 'active',
      startDate: { [Op.lte]: approvedDateOnly },
      endDate: { [Op.gte]: approvedDateOnly },
    },
    transaction,
  });
  if (!broker) return null;

  // 3) 해당 시점 유효한 요율
  const rateRow = await BrokerRate.findOne({
    where: {
      brokerId: broker.id,
      effectiveFrom: { [Op.lte]: approvedAt },
      [Op.or]: [
        { effectiveTo: null },
        { effectiveTo: { [Op.gt]: approvedAt } },
      ],
    },
    order: [['effectiveFrom', 'DESC']],
    transaction,
  });
  if (!rateRow) return null;

  const rate = parseFloat(rateRow.rate);
  if (!Number.isFinite(rate) || rate <= 0) return null;

  return {
    brokerId: broker.id,
    rate,
    brokerType: broker.brokerType,
  };
}

/**
 * Date → 'YYYY-MM-DD' (프로세스 TZ=Asia/Seoul 기반 로컬 날짜).
 * CLAUDE.md 규칙: process.env.TZ = 'Asia/Seoul' 전제로 Date 로컬 메서드 사용.
 */
function toDateOnlyKST(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

module.exports = {
  resolveBrokerForHostAt,
};
