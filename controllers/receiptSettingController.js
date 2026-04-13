const { ReceiptSetting } = require('../models');
const { ErrorCodes, success, updated, deleted, error } = require('../utils/responseHelper');
const { checkBusinessStatus } = require('../utils/ntsClient');

/**
 * 영수증 설정 조회
 * GET /api/host/receipt  (호스트)
 * GET /api/user/receipt  (게스트)
 */
const getReceiptSetting = async (req, res) => {
  try {
    const userId = req.user.id;

    const setting = await ReceiptSetting.findOne({
      where: { userId },
      attributes: { exclude: ['userId'] }
    });

    return success(res, setting || null);
  } catch (err) {
    console.error('Get receipt setting error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 영수증 설정 저장/수정 (upsert)
 * PUT /api/host/receipt  (호스트)
 * PUT /api/user/receipt  (게스트)
 */
const upsertReceiptSetting = async (req, res) => {
  try {
    const userId = req.user.id;
    const { type, number, businessName, repName, email } = req.body;

    // 1. type 검증 (현재는 tax_invoice만 지원)
    if (type !== 'tax_invoice') {
      return error(res, ErrorCodes.INVALID_RECEIPT_TYPE, 400);
    }

    // 2. number 검증
    const { validateReceiptNumber } = require('../utils/validator');
    const numberValidation = validateReceiptNumber(number, type);
    if (!numberValidation.valid) {
      return error(res, ErrorCodes.INVALID_RECEIPT_NUMBER, 400, { message: numberValidation.message });
    }

    // 3. tax_invoice 추가 필드 검증
    if (type === 'tax_invoice') {
      if (!businessName || !businessName.trim()) {
        return error(res, ErrorCodes.RECEIPT_BUSINESS_NAME_REQUIRED, 400);
      }
      if (!repName || !repName.trim()) {
        return error(res, ErrorCodes.RECEIPT_REP_NAME_REQUIRED, 400);
      }
      // email은 선택이지만, 입력 시 형식 검증
      if (email && email.trim()) {
        const { validateEmail } = require('../utils/validator');
        const emailValidation = validateEmail(email);
        if (!emailValidation.valid) {
          return error(res, ErrorCodes.INVALID_EMAIL, 400);
        }
      }
    }

    // 숫자만 추출하여 저장
    const cleanedNumber = number.replace(/[^0-9]/g, '');

    // 4. 국세청 사업자 상태 조회 (tax_invoice는 사업자등록번호 필수)
    let businessWarning = null;
    try {
      const { status } = await checkBusinessStatus(cleanedNumber);
      if (status === 'closed') {
        return error(res, ErrorCodes.BUSINESS_CLOSED, 400);
      }
      if (status === 'not_found') {
        return error(res, ErrorCodes.BUSINESS_NOT_FOUND, 400);
      }
      if (status === 'suspended') {
        businessWarning = '휴업 상태의 사업자입니다.';
      }
    } catch (ntsErr) {
      console.error('[receiptSettingController] 국세청 API 오류:', ntsErr.message);
      return error(res, ErrorCodes.BUSINESS_STATUS_CHECK_FAILED, 503);
    }

    const updateData = {
      userId,
      receiptType: type,
      receiptNumber: cleanedNumber,
      businessName: type === 'tax_invoice' ? businessName.trim() : null,
      repName: type === 'tax_invoice' ? repName.trim() : null,
      email: type === 'tax_invoice' && email ? email.trim() : null
    };

    const existing = await ReceiptSetting.findOne({ where: { userId } });

    let setting;
    if (existing) {
      await existing.update(updateData);
      setting = existing;
    } else {
      setting = await ReceiptSetting.create(updateData);
    }

    const responseData = setting.toJSON();
    delete responseData.userId;
    if (businessWarning) responseData.warning = businessWarning;

    return updated(res, responseData, '영수증 정보가 저장되었습니다.');
  } catch (err) {
    console.error('Upsert receipt setting error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 영수증 설정 삭제
 * DELETE /api/host/receipt  (호스트)
 * DELETE /api/user/receipt  (게스트)
 */
const deleteReceiptSetting = async (req, res) => {
  try {
    const userId = req.user.id;

    const existing = await ReceiptSetting.findOne({ where: { userId } });
    if (!existing) {
      return error(res, ErrorCodes.RECEIPT_NOT_FOUND, 404);
    }

    await existing.destroy();
    return deleted(res, '영수증 설정이 삭제되었습니다.');
  } catch (err) {
    console.error('Delete receipt setting error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

module.exports = {
  getReceiptSetting,
  upsertReceiptSetting,
  deleteReceiptSetting
};
