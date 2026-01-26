const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Inquiry = sequelize.define('Inquiry', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: '문의 작성자 ID (User.id)'
      // references 옵션 제거 - models/index.js에서 belongsTo로 관계 설정
    },
    categoryType: {
      type: DataTypes.ENUM('general', 'reservation', 'payment', 'room', 'account', 'other'),
      allowNull: false,
      comment: '문의 카테고리'
    },
    userType: {
      type: DataTypes.ENUM('host', 'guest'),
      allowNull: false,
      comment: '문의자 사용자 타입 (host: 호스트, guest: 게스트)'
    },
    title: {
      type: DataTypes.STRING(200),
      allowNull: false,
      comment: '문의 제목'
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: '문의 내용'
    },
    status: {
      type: DataTypes.ENUM('pending', 'answered', 'closed'),
      defaultValue: 'pending',
      comment: 'pending: 확인중, answered: 답변완료, closed: 종료'
    },
    answer: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: '관리자 답변'
    },
    answeredBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: '답변한 관리자 ID'
      // references 옵션 제거 - models/index.js에서 belongsTo로 관계 설정
    },
    answeredAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: '답변 작성 시각'
    }
  }, {
    tableName: 'inquiries',
    timestamps: true,
    indexes: [
      {
        fields: ['userId', 'status', 'createdAt'],
        name: 'idx_inquiries_user'
      },
      {
        fields: ['status', 'createdAt'],
        name: 'idx_inquiries_status'
      },
      {
        fields: ['answeredBy'],
        name: 'idx_inquiries_answered_by'
      },
      {
        fields: ['categoryType'],
        name: 'idx_inquiries_category_type'
      },
      {
        fields: ['userType', 'status', 'createdAt'],
        name: 'idx_inquiries_user_type'
      }
    ]
  });

  return Inquiry;
};
