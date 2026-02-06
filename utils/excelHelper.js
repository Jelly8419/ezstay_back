/**
 * Excel Helper
 * 엑셀 파일 생성 유틸리티
 */
const ExcelJS = require('exceljs');

/**
 * 정산 내역 엑셀 파일 생성
 * @param {Array} data - 정산 데이터 배열
 * @returns {Promise<Buffer>} 엑셀 파일 버퍼
 */
const createSettlementExcel = async (data) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Ezstay';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('정산 내역', {
    properties: { tabColor: { argb: '4B89DC' } }
  });

  // 컬럼 정의
  worksheet.columns = [
    { header: '계약번호', key: 'contractNumber', width: 18 },
    { header: '방 이름', key: 'roomTitle', width: 25 },
    { header: '게스트명', key: 'guestName', width: 12 },
    { header: '입실일', key: 'checkInDate', width: 12 },
    { header: '퇴실일', key: 'checkOutDate', width: 12 },
    { header: '이용일수', key: 'rentalDays', width: 10 },
    { header: '임대료', key: 'rentalFee', width: 15 },
    { header: '관리비', key: 'maintenanceFee', width: 12 },
    { header: '청소비', key: 'cleaningFee', width: 12 },
    { header: '소계', key: 'subtotal', width: 15 },
    { header: '플랫폼 수수료', key: 'platformFee', width: 14 },
    { header: '환불금액', key: 'refundAmount', width: 12 },
    { header: '정산금액', key: 'settlementAmount', width: 15 },
    { header: '정산예정일', key: 'settlementDate', width: 12 },
    { header: '상태', key: 'status', width: 10 }
  ];

  // 헤더 스타일
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: '4B89DC' }
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 25;

  // 데이터 추가
  data.forEach((item, index) => {
    const row = worksheet.addRow({
      contractNumber: item.contractNumber,
      roomTitle: item.roomTitle,
      guestName: item.guestName,
      checkInDate: formatDate(item.checkInDate),
      checkOutDate: formatDate(item.checkOutDate),
      rentalDays: item.rentalDays,
      rentalFee: item.rentalFee,
      maintenanceFee: item.maintenanceFee,
      cleaningFee: item.cleaningFee,
      subtotal: item.subtotal,
      platformFee: item.platformFee,
      refundAmount: item.refundAmount,
      settlementAmount: item.settlementAmount,
      settlementDate: item.settlementDate,
      status: item.status
    });

    // 행 스타일
    row.alignment = { vertical: 'middle' };

    // 짝수 행 배경색
    if (index % 2 === 1) {
      row.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'F5F5F5' }
      };
    }
  });

  // 금액 컬럼 포맷 (천단위 구분)
  const currencyColumns = ['rentalFee', 'maintenanceFee', 'cleaningFee', 'subtotal', 'platformFee', 'refundAmount', 'settlementAmount'];
  currencyColumns.forEach(colKey => {
    const col = worksheet.getColumn(colKey);
    col.numFmt = '#,##0';
    col.alignment = { horizontal: 'right' };
  });

  // 날짜/숫자 컬럼 정렬
  worksheet.getColumn('rentalDays').alignment = { horizontal: 'center' };
  worksheet.getColumn('checkInDate').alignment = { horizontal: 'center' };
  worksheet.getColumn('checkOutDate').alignment = { horizontal: 'center' };
  worksheet.getColumn('settlementDate').alignment = { horizontal: 'center' };
  worksheet.getColumn('status').alignment = { horizontal: 'center' };

  // 테두리 추가
  worksheet.eachRow((row, rowNumber) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'DDDDDD' } },
        left: { style: 'thin', color: { argb: 'DDDDDD' } },
        bottom: { style: 'thin', color: { argb: 'DDDDDD' } },
        right: { style: 'thin', color: { argb: 'DDDDDD' } }
      };
    });
  });

  // 합계 행 추가
  if (data.length > 0) {
    const totalRow = worksheet.addRow({
      contractNumber: '합계',
      rentalFee: data.reduce((sum, item) => sum + (item.rentalFee || 0), 0),
      maintenanceFee: data.reduce((sum, item) => sum + (item.maintenanceFee || 0), 0),
      cleaningFee: data.reduce((sum, item) => sum + (item.cleaningFee || 0), 0),
      subtotal: data.reduce((sum, item) => sum + (item.subtotal || 0), 0),
      platformFee: data.reduce((sum, item) => sum + (item.platformFee || 0), 0),
      refundAmount: data.reduce((sum, item) => sum + (item.refundAmount || 0), 0),
      settlementAmount: data.reduce((sum, item) => sum + (item.settlementAmount || 0), 0)
    });

    totalRow.font = { bold: true };
    totalRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'E8F4FD' }
    };
    totalRow.eachCell((cell) => {
      cell.border = {
        top: { style: 'medium', color: { argb: '4B89DC' } },
        left: { style: 'thin', color: { argb: 'DDDDDD' } },
        bottom: { style: 'medium', color: { argb: '4B89DC' } },
        right: { style: 'thin', color: { argb: 'DDDDDD' } }
      };
    });
  }

  // 버퍼로 반환
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
};

/**
 * 날짜 포맷팅 (YYYY-MM-DD)
 * @param {Date|string} date
 * @returns {string}
 */
const formatDate = (date) => {
  if (!date) return '';
  const d = new Date(date);
  return d.toISOString().split('T')[0];
};

module.exports = {
  createSettlementExcel
};
