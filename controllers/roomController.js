const { Room } = require('../models');

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

    res.status(201).json({
      success: true,
      message: '방이 성공적으로 등록되었습니다.',
      data: savedRoom
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: '방 등록 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

const getRooms = async (req, res) => {
  try {
    const rooms = await Room.findAll();
    res.status(200).json({
      success: true,
      data: rooms
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '방 목록을 가져오는 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

const getRoomById = async (req, res) => {
  try {
    const room = await Room.findByPk(req.params.id);
    if (!room) {
      return res.status(404).json({
        success: false,
        message: '방을 찾을 수 없습니다.'
      });
    }
    res.status(200).json({
      success: true,
      data: room
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '방 정보를 가져오는 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

module.exports = {
  createRoom,
  getRooms,
  getRoomById
};