const { HostBenefit, ContractBenefit, Contract } = require('../models');
const { success, ErrorCodes, error } = require('../utils/responseHelper');

const getBenefitStatus = async (req, res) => {
  try {
    const hostId = req.user.id;

    const totalCount = await HostBenefit.count();
    const eventActive = totalCount < 100;

    const myBenefit = await HostBenefit.findOne({ where: { hostId } });
    const isEligible = !!myBenefit;

    let benefitUsed = false;
    if (isEligible) {
      const myContractIds = await Contract.findAll({
        where: { hostId },
        attributes: ['id']
      }).then(rows => rows.map(r => r.id));

      if (myContractIds.length > 0) {
        const used = await ContractBenefit.findOne({
          where: {
            contractId: myContractIds,
            benefitType: 'HOST_FEE_WAIVER'
          }
        });
        benefitUsed = !!used;
      }
    }

    return success(res, { eventActive, isEligible, benefitUsed });
  } catch (err) {
    console.error('Get benefit status error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

module.exports = { getBenefitStatus };
