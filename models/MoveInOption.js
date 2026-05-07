const { DataTypes } = require('sequelize');

/**
 * MoveInOption 모델
 * 임차인용 입주 준비 옵션 카탈로그 (관리자 CRUD)
 *
 * - 기존 RentalItem(내부 계약 옵션)과 별도 도메인 (PRD 14.7: 두 흐름 독립)
 * - PURCHASE: 재고 차감만 (구매)
 * - RENTAL: 케이스 기간 동안 점유 (대여)
 * - 비활성화는 Soft (is_active=false), 기존 주문은 items_snapshot 으로 보존되므로 영향 없음
 */
module.exports = (sequelize) => {
  const MoveInOption = sequelize.define('MoveInOption', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },

    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: '옵션명'
    },

    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: '옵션 설명'
    },

    optionType: {
      type: DataTypes.ENUM('PURCHASE', 'RENTAL'),
      allowNull: false,
      field: 'option_type',
      comment: 'PURCHASE=구매(재고 차감), RENTAL=대여(기간 점유)'
    },

    category: {
      type: DataTypes.ENUM('AMENITY_KIT', 'BEDDING_SET', 'HAIR_DRYER', 'TOWEL_SET', 'OTHER'),
      allowNull: false,
      defaultValue: 'OTHER',
      comment: '카테고리'
    },

    price: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: '가격 (원, 부가세 포함)',
      validate: { min: 0 }
    },

    totalStock: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'total_stock',
      comment: '총 재고 (PURCHASE/RENTAL 공통)',
      validate: { min: 0 }
    },

    imageUrl: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'image_url',
      comment: '이미지 URL'
    },

    displayOrder: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'display_order',
      comment: '노출 정렬 순서 (오름차순)'
    },

    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: 'is_active',
      comment: '활성화 여부'
    }
  }, {
    tableName: 'move_in_options',
    timestamps: true,
    underscored: true
  });

  /**
   * 카테고리 한글 라벨
   */
  MoveInOption.CATEGORY_LABELS = {
    AMENITY_KIT: '어메니티 키트',
    BEDDING_SET: '침구 세트',
    HAIR_DRYER:  '헤어드라이어',
    TOWEL_SET:   '수건 세트',
    OTHER:       '기타'
  };

  /**
   * 옵션 유형 한글 라벨
   */
  MoveInOption.OPTION_TYPE_LABELS = {
    PURCHASE: '구매',
    RENTAL:   '대여'
  };

  return MoveInOption;
};
