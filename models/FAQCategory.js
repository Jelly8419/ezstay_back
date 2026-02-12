const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const FAQCategory = sequelize.define('FAQCategory', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: '카테고리 이름 (예: 전체, 방 등록, 예약/결제 등)'
    },
    userType: {
      type: DataTypes.ENUM('all', 'host', 'guest'),
      defaultValue: 'all',
      comment: '대상 사용자 타입'
    },
    displayOrder: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: '표시 순서 (낮을수록 상단)'
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      comment: '활성화 여부'
    }
  }, {
    tableName: 'faqcategories',
    timestamps: true,
    indexes: [
      {
        fields: ['userType', 'isActive', 'displayOrder'],
        name: 'idx_faq_categories_user_type'
      },
      {
        unique: true,
        fields: ['name', 'userType'],
        name: 'faq_category_name_user_type_unique'
      }
    ]
  });

  return FAQCategory;
};
