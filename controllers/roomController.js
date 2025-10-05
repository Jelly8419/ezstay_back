const { Room } = require('../models');
const { ErrorCodes, success, error, created } = require('../utils/responseHelper');

const createRoom = async (req, res) => {
  try {
    const {
      roomName,
      address,
      detailAddress,
      area,
      buildingType,
      parkingAvailable,
      elevatorAvailable,
      roomCount,
      bathroomCount,
      livingRoomCount,
      kitchenCount,
      isDuplex,
      hostId
    } = req.body;

    const savedRoom = await Room.create({
      roomName,
      address,
      detailAddress,
      area,
      buildingType,
      parkingAvailable,
      elevatorAvailable,
      roomCount,
      bathroomCount,
      livingRoomCount,
      kitchenCount,
      isDuplex,
      hostId
    });

    return created(res, savedRoom, '방이 성공적으로 등록되었습니다.');
  } catch (err) {
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

const getRooms = async (req, res) => {
  try {
    const rooms = await Room.findAll({
      where: { status: 'published' }, // 게시된 방만 조회
      attributes: {
        exclude: ['entrancePassword', 'hostId', 'detailAddress', 'status'] // 민감정보 제외
      }
    });
    return success(res, rooms);
  } catch (err) {
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

const getRoomById = async (req, res) => {
  try {
    const room = await Room.findOne({
      where: {
        id: req.params.id,
        status: 'published' // 게시된 방만 조회
      },
      attributes: {
        exclude: ['entrancePassword', 'hostId', 'detailAddress', 'status'] // 민감정보 제외
      }
    });
    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }
    return success(res, room);
  } catch (err) {
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

module.exports = {
  createRoom,
  getRooms,
  getRoomById
};