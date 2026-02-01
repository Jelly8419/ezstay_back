const { sequelize } = require('../models');

/**
 * 계약 주문번호 생성
 * 형식: yymmdd + 00001 (5자리)
 * 예: '25112700001', '25112700002'
 *
 * @param {Transaction} transaction - Sequelize 트랜잭션 (선택사항)
 * @returns {Promise<string>} 생성된 주문번호
 * @throws {Error} 일일 한도 초과 시 (99999건)
 */
async function generateOrderId(transaction = null) {
  const shouldCommit = !transaction;
  const t = transaction || await sequelize.transaction();

  try {
    // ContractSequence 모델 동적 로드 (순환 참조 방지)
    const ContractSequence = require('../models').ContractSequence;

    const today = new Date();
    const dateKey = today.toISOString().split('T')[0]; // YYYY-MM-DD

    // yymmdd 형식 생성
    const yymmdd = [
      String(today.getFullYear()).slice(-2),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0')
    ].join('');

    // 1. UPSERT: 레코드가 없으면 생성, 있으면 가져오기 (원자적 처리)
    const [sequence, created] = await ContractSequence.findOrCreate({
      where: { dateKey },
      defaults: { lastNumber: 0 },
      transaction: t
    });

    // 2. 원자적으로 +1 증가 (Race Condition 방지)
    await ContractSequence.increment('lastNumber', {
      by: 1,
      where: { dateKey },
      transaction: t
    });

    // 3. 증가된 값 다시 조회
    await sequence.reload({ transaction: t });
    const currentNumber = sequence.lastNumber;

    // 4. 최대값 체크 (99999 초과 방지)
    if (currentNumber > 99999) {
      throw new Error('일일 주문번호 한도 초과 (99999건)');
    }

    // 5. 주문번호 생성 (5자리 0 패딩)
    const sequenceNumber = String(currentNumber).padStart(5, '0');
    const orderId = `${yymmdd}${sequenceNumber}`;

    if (shouldCommit) {
      await t.commit();
    }

    return orderId;
  } catch (err) {
    if (shouldCommit) {
      await t.rollback();
    }
    throw err;
  }
}

module.exports = { generateOrderId };
