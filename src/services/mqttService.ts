import mqtt from 'mqtt';
import { config } from '../utils/config';
import { processBleScan, recordDeviceHeartbeat } from './bleService';
import { BleScanPayload } from '../types/ble';

let client: mqtt.MqttClient | null = null;

export function getMqttClient(): mqtt.MqttClient | null {
  return client;
}

export function initMqtt(): mqtt.MqttClient {
  if (client) return client;

  client = mqtt.connect(config.mqttUrl, {
    reconnectPeriod: 5000,
    connectTimeout: 30 * 1000,
  });

  client.on('connect', () => {
    console.log(`[MQTT] Connected to ${config.mqttUrl}`);
    client!.subscribe(config.mqttBleTopic, (err) => {
      if (err) {
        console.error('[MQTT] Subscribe error:', err);
      } else {
        console.log(`[MQTT] Subscribed to ${config.mqttBleTopic}`);
      }
    });
  });

  client.on('message', async (topic, message) => {
    try {
      const payload = JSON.parse(message.toString());
      if (topic === config.mqttBleTopic) {
        // BLE topic carries both scan events and heartbeats
        if (isHeartbeatPayload(payload)) {
          await handleDeviceHeartbeat(payload);
        } else if (isBleScanPayload(payload)) {
          const normalized = normalizeBlePayload(payload);
          await handleBleEvent(normalized);
          // Implicit heartbeat: any scan from an anchor keeps it online
          await handleDeviceHeartbeat({ device_code: normalized.device_code });
        } else {
          console.warn('[MQTT] Unrecognized payload on ble topic');
        }
      }
    } catch (err) {
      console.error('[MQTT] Message handling error:', err);
    }
  });

  client.on('error', (err) => {
    console.error('[MQTT] Client error:', err);
  });

  client.on('close', () => {
    console.log('[MQTT] Connection closed');
  });

  return client;
}

async function handleBleEvent(payload: BleScanPayload): Promise<void> {
  if (!payload.device_code || !payload.tag_code || typeof payload.rssi !== 'number') {
    console.warn('[MQTT] Invalid BLE event payload after normalization');
    return;
  }
  await processBleScan(payload);
}

async function handleDeviceHeartbeat(payload: { device_code?: string; anchor_id?: string }): Promise<void> {
  const code = payload.device_code || payload.anchor_id;
  if (!code) {
    console.warn('[MQTT] Invalid heartbeat payload: no device_code or anchor_id');
    return;
  }
  await recordDeviceHeartbeat(code);
}

function isHeartbeatPayload(obj: unknown): obj is { device_code?: string; anchor_id?: string } {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    !('rssi' in obj) &&
    !('mac' in obj) &&
    !('tag_code' in obj) &&
    (
      ('device_code' in obj && typeof (obj as any).device_code === 'string') ||
      ('anchor_id' in obj && typeof (obj as any).anchor_id === 'string')
    )
  );
}

function isBleScanPayload(obj: unknown): obj is BleScanPayload {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'rssi' in obj &&
    typeof (obj as any).rssi === 'number' &&
    (
      ('device_code' in obj && 'tag_code' in obj) ||
      ('anchor_id' in obj && 'mac' in obj)
    )
  );
}

function normalizeBlePayload(obj: any): BleScanPayload {
  return {
    device_code: obj.device_code || obj.anchor_id,
    tag_code: obj.tag_code || obj.mac,
    rssi: obj.rssi,
    timestamp: obj.timestamp,
    uuid: obj.uuid,
    major: obj.major,
    minor: obj.minor,
    tx_power: obj.tx_power,
    uptime: obj.uptime,
    wifi_rssi: obj.wifi_rssi,
  };
}

export function closeMqtt(): void {
  if (client) {
    client.end(true);
    client = null;
  }
}
