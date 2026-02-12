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
    // 모델 동적 로드 (순환 참조 방지)
    const { ContractSequence, Contract } = require('../models');

    const today = new Date();
    const dateKey = today.toISOString().split('T')[0]; // YYYY-MM-DD

    // yymmdd 형식 생성
    const yymmdd = [
      String(today.getFullYear()).slice(-2),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0')
    ].join('');

    // 1. 시퀀스 테이블에서 오늘 레코드 조회 (FOR UPDATE 락)
    let sequence = await ContractSequence.findOne({
      where: { dateKey },
      lock: t.LOCK.UPDATE,
      transaction: t
    });

    // 2. 레코드가 없거나 동기화가 필요한 경우: 실제 계약 테이블에서 최대값 조회
    const maxOrderIdResult = await Contract.findOne({
      where: sequelize.where(
        sequelize.fn('LEFT', sequelize.col('order_id'), 6),
        yymmdd
      ),
      attributes: [[sequelize.fn('MAX', sequelize.col('order_id')), 'maxOrderId']],
      transaction: t,
      raw: true
    });

    // 실제 사용된 최대 순번 계산
    let actualMaxNumber = 0;
    if (maxOrderIdResult && maxOrderIdResult.maxOrderId) {
      const maxOrderId = maxOrderIdResult.maxOrderId;
      actualMaxNumber = parseInt(maxOrderId.slice(6), 10) || 0;
    }

    // 3. 시퀀스 레코드 생성 또는 동기화
    if (!sequence) {
      // 새로 생성 (실제 최대값 기준)
      sequence = await ContractSequence.create({
        dateKey,
        lastNumber: actualMaxNumber + 1
      }, { transaction: t });
    } else {
      // 기존 레코드가 있으면 동기화 후 +1
      const nextNumber = Math.max(sequence.lastNumber, actualMaxNumber) + 1;
      await sequence.update({ lastNumber: nextNumber }, { transaction: t });
    }

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
