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

    // 1. 오늘 날짜의 시퀀스 레코드 조회 (FOR UPDATE로 락 획득)
    let sequence = await ContractSequence.findOne({
      where: { dateKey },
      lock: t.LOCK.UPDATE, // Row Lock (동시성 제어)
      transaction: t
    });

    let currentNumber;

    // 2. 없으면 생성 (첫 번째 주문)
    if (!sequence) {
      sequence = await ContractSequence.create(
        {
          dateKey,
          lastNumber: 1
        },
        { transaction: t }
      );
      currentNumber = 1;
    } else {
      // 3. 있으면 증가 (원자적 연산으로 안전하게 처리)
      const [updatedRows] = await ContractSequence.update(
        {
          lastNumber: sequelize.literal('last_number + 1')
        },
        {
          where: { dateKey },
          transaction: t
        }
      );

      // 업데이트된 값을 다시 조회 (FOR UPDATE 락 유지)
      await sequence.reload({
        lock: t.LOCK.UPDATE,
        transaction: t
      });

      currentNumber = sequence.lastNumber;
    }

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
