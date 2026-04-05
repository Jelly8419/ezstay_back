const { DataTypes, Sequelize } = require('sequelize');

const sequelize = new Sequelize('ezstay', process.env.DB_USER || 'root', process.env.DB_PASSWORD || '', {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  dialect: 'mysql',
  timezone: '+09:00',
  dialectOptions: {
    timezone: '+09:00'
  },
  logging: false
});

/**
 * RentalItem 모델 - 대여 물품 카탈로그
 * 전체 서비스에서 공용으로 관리하는 대여 물품 정보 (헤어드라이어, 침구류, 어메니티키트 등)
 */
const RentalItem = sequelize.define('RentalItem', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  itemType: {
    type: DataTypes.ENUM('hair_dryer', 'bedding_set', 'amenity_kit', 'towel_set', 'other'),
    allowNull: false,
    field: 'item_type',
    comment: '물품 카테고리'
  },
  salesType: {
    type: DataTypes.ENUM('SALE', 'RENTAL'),
    allowNull: false,
    defaultValue: 'SALE',
    field: 'sales_type',
    comment: '판매 유형 (SALE: 판매형 - 반품 시 재고 미복구, RENTAL: 대여형 - 반품 시 재고 복구)'
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: '물품명 (예: 프리미엄 어메니티 키트)'
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '물품 설명'
  },
  price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0,
    comment: '대여 가격 (1회당)',
    validate: {
      min: 0
    }
  },
  totalStock: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'total_stock',
    comment: '총 재고 수량',
    validate: {
      min: 0
    }
  },
  imageUrl: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'image_url',
    comment: '물품 이미지 URL'
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    field: 'is_active',
    comment: '활성화 여부 (비활성화시 선택 불가)'
  },
  createdAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'created_at'
  },
  updatedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'updated_at'
  }
}, {
  tableName: 'rental_items',
  timestamps: true,
  underscored: false,
  indexes: [
    {
      fields: ['item_type'],
      name: 'idx_item_type'
    },
    {
      fields: ['is_active'],
      name: 'idx_is_active'
    },
  ]
});

/**
 * 판매 유형 한글명 매핑
 */
RentalItem.SALES_TYPE_LABELS = {
  SALE: '판매형',
  RENTAL: '대여형'
};

/**
 * 물품 카테고리 한글명 매핑
 */
RentalItem.ITEM_TYPE_LABELS = {
  hair_dryer: '헤어드라이어',
  bedding_set: '침구 세트',
  amenity_kit: '어메니티 키트',
  towel_set: '수건 세트',
  other: '기타'
};

/**
 * RoomFreeService 필드명과 물품 카테고리 매핑
 * 방 조회 시 어떤 카테고리의 물품을 보여줄지 결정
 */
RentalItem.FREE_SERVICE_MAPPING = {
  hair_dryer_rental: 'hair_dryer',
  bedding_service: 'bedding_set',
  amenity_kit: 'amenity_kit',
  towel_set_rental: 'towel_set'
};


/**
 * 특정 카테고리의 활성화된 물품 목록 조회
 * @param {string} itemType - 물품 카테고리
 * @returns {Array} 물품 목록
 */
RentalItem.getAvailableItemsByType = async function(itemType) {
  return await RentalItem.findAll({
    where: {
      itemType,
      isActive: true
    },
    order: [['price', 'ASC']]
  });
};

module.exports = RentalItem;
