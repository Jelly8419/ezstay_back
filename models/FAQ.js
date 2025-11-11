const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const FAQ = sequelize.define('FAQ', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    categoryId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: 'FAQ 카테고리 ID'
      // references 옵션 제거 - models/index.js에서 belongsTo로 관계 설정
    },
    question: {
      type: DataTypes.STRING(300),
      allowNull: false,
      comment: '질문'
    },
    answer: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: '답변 (HTML 포함 가능)'
    },
    displayOrder: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: '카테고리 내 표시 순서'
    },
    viewCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: '조회수'
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      comment: '활성화 여부'
    },
    createdBy: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: '작성한 관리자 ID'
      // references 옵션 제거 - models/index.js에서 belongsTo로 관계 설정
    },
    updatedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: '마지막 수정한 관리자 ID'
      // references 옵션 제거 - models/index.js에서 belongsTo로 관계 설정
    }
  }, {
    tableName: 'faqs',
    timestamps: true,
    indexes: [
      {
        fields: ['categoryId', 'isActive', 'displayOrder'],
        name: 'idx_faqs_category'
      },
      {
        fields: ['createdBy'],
        name: 'idx_faqs_created_by'
      }
    ]
  });

  return FAQ;
};
