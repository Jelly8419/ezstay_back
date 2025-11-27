const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ContractSequence = sequelize.define('ContractSequence', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    dateKey: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      unique: true,
      field: 'date_key',
      comment: '날짜 (YYYY-MM-DD)'
    },
    lastNumber: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'last_number',
      comment: '마지막 순번'
    }
  }, {
    tableName: 'contract_sequences',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['date_key'],
        name: 'uk_date'
      }
    ],
    comment: '계약 주문번호 시퀀스 관리'
  });

  return ContractSequence;
};
