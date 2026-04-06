/**
 * 일회성 마이그레이션
 *
 * refund_policy_snapshot이 null인 계약에 환불정책 스냅샷 소급 적용
 *
 * 배경:
 *   - 초기 계약 생성 시 refundPolicySnapshot 저장 로직이 없었거나
 *     정책 조회 실패로 null이 저장된 계약이 존재함
 *
 * 케이스:
 *   1. refundPolicyType 있음 + refundPolicySnapshot null
 *      → 현재 DB의 해당 정책으로 스냅샷 구성 (정책이 변경됐을 수 있으나 없는 것보다 나음)
 *   2. refundPolicyType 없음 + snapshot.refundPolicy 있음
 *      → snapshot에 저장된 정책 타입으로 스냅샷 구성
 *   3. refundPolicyType도 없고 snapshot.refundPolicy도 없음
 *      → 스킵 (정책 정보 없음)
 *   4. 정책 타입은 있으나 DB에서 해당 정책을 찾을 수 없음 (비활성 포함)
 *      → 스킵 + 경고 로그
 *
 * 실행: node scripts/migrate-refund-policy-snapshot.js
 */

require('dotenv').config();

const { Contract, RefundPolicyType, RefundPolicyRule, sequelize } = require('../models');
const { Op } = require('sequelize');

async function migrate() {
  console.log('=== refund_policy_snapshot 마이그레이션 시작 ===\n');

  // refund_policy_snapshot이 null인 계약만 대상
  const contracts = await Contract.findAll({
    where: { refundPolicySnapshot: null },
    attributes: ['id', 'refundPolicyType', 'snapshot']
  });

  console.log(`대상 계약: ${contracts.length}건\n`);

  if (contracts.length === 0) {
    console.log('마이그레이션 대상 없음. 종료.');
    process.exit(0);
  }

  // 필요한 policyType 목록 수집 (중복 제거)
  const policyTypes = [...new Set(
    contracts
      .map(c => c.refundPolicyType || c.snapshot?.refundPolicy)
      .filter(Boolean)
  )];

  console.log(`조회할 정책 타입: ${policyTypes.join(', ')}\n`);

  // 정책 타입별 스냅샷 일괄 구성 (isActive 무관하게 조회 — 비활성 정책도 복원 대상)
  const policies = await RefundPolicyType.findAll({
    where: { policyType: { [Op.in]: policyTypes } }
  });

  const rules = await RefundPolicyRule.findAll({
    where: { policyType: { [Op.in]: policyTypes } },
    order: [['daysBeforeMin', 'DESC']]
  });

  // policyType → 스냅샷 객체 맵
  const snapshotMap = new Map();
  for (const policy of policies) {
    const policyRules = rules.filter(r => r.policyType === policy.policyType);
    snapshotMap.set(policy.policyType, {
      policyType: policy.policyType,
      displayName: policy.displayName,
      description: policy.description,
      specialRules: policy.specialRules,
      rules: policyRules.map(rule => ({
        daysBeforeMin: rule.daysBeforeMin,
        daysBeforeMax: rule.daysBeforeMax,
        refundRate: parseFloat(rule.refundRate),
        isSameDayCancellation: rule.isSameDayCancellation,
        description: rule.description
      })),
      capturedAt: new Date().toISOString(),
      migratedAt: new Date().toISOString()
    });
  }

  let successCount = 0;
  let skippedNoPolicy = 0;
  let skippedNoPolicyType = 0;
  let fail = 0;

  for (const contract of contracts) {
    // 적용할 policyType 결정 (컬럼 우선, 없으면 snapshot.refundPolicy fallback)
    const policyType = contract.refundPolicyType || contract.snapshot?.refundPolicy || null;

    if (!policyType) {
      console.log(`⚠️  계약 ${contract.id}: policyType 정보 없음 → 스킵`);
      skippedNoPolicyType++;
      continue;
    }

    const snapshot = snapshotMap.get(policyType);
    if (!snapshot) {
      console.log(`⚠️  계약 ${contract.id}: policyType(${policyType}) DB에 없음 → 스킵`);
      skippedNoPolicy++;
      continue;
    }

    // refundPolicyType 컬럼도 null이었다면 함께 채움
    const updateData = { refundPolicySnapshot: snapshot };
    if (!contract.refundPolicyType && policyType) {
      updateData.refundPolicyType = policyType;
    }

    try {
      await Contract.update(updateData, { where: { id: contract.id } });
      const source = contract.refundPolicyType ? 'refundPolicyType' : 'snapshot.refundPolicy';
      console.log(`✅ 계약 ${contract.id}: policyType(${policyType}) 소급 완료 [출처: ${source}]`);
      successCount++;
    } catch (err) {
      console.error(`❌ 계약 ${contract.id} 업데이트 실패:`, err.message);
      fail++;
    }
  }

  console.log('\n=== 마이그레이션 완료 ===');
  console.log(`성공: ${successCount}건`);
  console.log(`스킵 (policyType 정보 없음): ${skippedNoPolicyType}건`);
  console.log(`스킵 (DB에 정책 없음): ${skippedNoPolicy}건`);
  console.log(`실패: ${fail}건`);

  process.exit(fail > 0 ? 1 : 0);
}

migrate().catch(err => {
  console.error('마이그레이션 오류:', err);
  process.exit(1);
});
