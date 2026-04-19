const { RegionAlert } = require('../models');
const { success, created, ErrorCodes, error } = require('../utils/responseHelper');
const { toKSTString } = require('../utils/dateHelper');

const registerRegionAlert = async (req, res) => {
  try {
    const userId = req.user.id;

    const existing = await RegionAlert.findOne({ where: { userId } });

    if (existing) {
      return success(res, {
        alreadyRegistered: true,
        alertedAt: toKSTString(existing.alertedAt)
      });
    }

    const now = new Date();
    const alert = await RegionAlert.create({
      userId,
      alertedAt: now
    });

    return created(res, {
      alreadyRegistered: false,
      alertedAt: toKSTString(alert.alertedAt)
    });
  } catch (err) {
    console.error('Register region alert error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

module.exports = { registerRegionAlert };
