import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  listDevices,
  getDeviceById,
  createDevice,
  updateDeviceRoom,
  updateDeviceLabel,
  updateDeviceFirmware,
  softDeleteDevice,
  updateRoom,
  softDeleteRoom,
  listRooms,
  getRoomById,
  createRoom,
} from '../services/bleService';
import { ValidationError } from '../utils/errors';

// --- Rooms ---

export async function getRooms(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const rooms = await listRooms();
    res.json({ rooms });
  } catch (err) {
    next(err);
  }
}

export async function getRoom(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const room = await getRoomById(req.params.id as string);
    res.json({ room });
  } catch (err) {
    next(err);
  }
}

export async function postRoom(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, building, floor, description } = req.body;
    if (!name) throw new ValidationError('name is required');
    const room = await createRoom({ name, building, floor, description });
    res.status(201).json({ room });
  } catch (err) {
    next(err);
  }
}

export async function patchRoom(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, building, floor, description } = req.body;
    const room = await updateRoom(req.params.id as string, { name, building, floor, description });
    res.json({ room });
  } catch (err) {
    next(err);
  }
}

export async function deleteRoom(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await softDeleteRoom(req.params.id as string);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// --- Devices ---

export async function getDevices(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const devices = await listDevices();
    res.json({ devices });
  } catch (err) {
    next(err);
  }
}

export async function getDevice(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const device = await getDeviceById(req.params.id as string);
    res.json({ device });
  } catch (err) {
    next(err);
  }
}

export async function postDevice(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // Accept frontend field names: device_id -> device_code, name -> label
    const device_code = req.body.device_id ?? req.body.device_code;
    const label = req.body.name ?? req.body.label;
    const { room_id, firmware_version } = req.body;
    if (!device_code) throw new ValidationError('device_id or device_code is required');
    const device = await createDevice({ device_code, room_id, label, firmware_version });
    res.status(201).json({ device });
  } catch (err) {
    next(err);
  }
}

export async function patchDevice(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // Accept frontend field names: name -> label, room_id -> room_id
    const label = req.body.name ?? req.body.label;
    const room_id = req.body.room_id;
    const firmware_version = req.body.firmware_version;
    const deviceId = req.params.id as string;

    if (label !== undefined) {
      await updateDeviceLabel(deviceId, label);
    }
    if (room_id !== undefined) {
      await updateDeviceRoom(deviceId, room_id || null);
    }
    if (firmware_version !== undefined) {
      await updateDeviceFirmware(deviceId, firmware_version);
    }

    const device = await getDeviceById(deviceId);
    res.json({ device });
  } catch (err) {
    next(err);
  }
}

export async function putDeviceRoom(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { room_id } = req.body;
    const device = await updateDeviceRoom(req.params.id as string, room_id ?? null);
    res.json({ device });
  } catch (err) {
    next(err);
  }
}

export async function putDeviceLabel(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { label } = req.body;
    if (label === undefined) throw new ValidationError('label is required');
    const device = await updateDeviceLabel(req.params.id as string, label);
    res.json({ device });
  } catch (err) {
    next(err);
  }
}

export async function deleteDevice(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await softDeleteDevice(req.params.id as string);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
