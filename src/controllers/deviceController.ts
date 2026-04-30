import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  listDevices,
  getDeviceById,
  createDevice,
  updateDeviceRoom,
  updateDeviceLabel,
  updateDeviceName,
  updateDeviceRssiRange,
  softDeleteDevice,
  updateRoom,
  softDeleteRoom,
  listRooms,
  getRoomById,
  createRoom,
} from '../services/bleService';
import { processBleScan, recordDeviceHeartbeat } from '../services/bleService';
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
    // Accept frontend field names: device_id -> device_code, name -> name/label
    const device_code = req.body.device_id ?? req.body.device_code;
    const name = req.body.name ?? req.body.name;
    const label = req.body.label ?? req.body.name;
    const { room_id, rssi_range } = req.body;
    if (!device_code) throw new ValidationError('device_id or device_code is required');
    const device = await createDevice({ device_code, room_id, name, label, rssi_range });
    res.status(201).json({ device });
  } catch (err) {
    next(err);
  }
}

export async function patchDevice(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // Accept frontend field names: name -> name/label, room_id -> room_id
    const name = req.body.name;
    const label = req.body.label ?? req.body.name;
    const room_id = req.body.room_id;
    const rssi_range = req.body.rssi_range;
    const deviceId = req.params.id as string;

    if (name !== undefined) {
      await updateDeviceName(deviceId, name);
    }
    if (label !== undefined && name === undefined) {
      await updateDeviceLabel(deviceId, label);
    }
    if (room_id !== undefined) {
      await updateDeviceRoom(deviceId, room_id || null);
    }
    if (rssi_range !== undefined) {
      await updateDeviceRssiRange(deviceId, Number(rssi_range));
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

// --- REST Ingestion (mirror of MQTT handlers) ---

export async function postDeviceEvent(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { device_code, tag_code, rssi } = req.body;
    if (!device_code || !tag_code || typeof rssi !== 'number') {
      throw new ValidationError('device_code, tag_code, and rssi are required');
    }
    await processBleScan({ device_code, tag_code, rssi });
    res.status(202).json({ message: 'Event accepted' });
  } catch (err) {
    next(err);
  }
}

export async function postDeviceHeartbeat(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { device_code } = req.body;
    if (!device_code) {
      throw new ValidationError('device_code is required');
    }
    await recordDeviceHeartbeat(device_code);
    res.status(202).json({ message: 'Heartbeat accepted' });
  } catch (err) {
    next(err);
  }
}
