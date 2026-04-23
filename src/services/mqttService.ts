import mqtt from 'mqtt';
import { config } from '../utils/config';
import { processBleScan, recordDeviceHeartbeat } from './bleService';

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
    client!.subscribe([config.mqttBleTopic, config.mqttHeartbeatTopic], (err) => {
      if (err) {
        console.error('[MQTT] Subscribe error:', err);
      } else {
        console.log(`[MQTT] Subscribed to ${config.mqttBleTopic}, ${config.mqttHeartbeatTopic}`);
      }
    });
  });

  client.on('message', async (topic, message) => {
    try {
      const payload = JSON.parse(message.toString());
      if (topic === config.mqttBleTopic) {
        await handleBleEvent(payload);
      } else if (topic === config.mqttHeartbeatTopic) {
        await handleDeviceHeartbeat(payload);
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

async function handleBleEvent(payload: unknown): Promise<void> {
  if (!isBleScanPayload(payload)) {
    console.warn('[MQTT] Invalid BLE event payload');
    return;
  }
  await processBleScan(payload);
}

async function handleDeviceHeartbeat(payload: unknown): Promise<void> {
  if (!isHeartbeatPayload(payload)) {
    console.warn('[MQTT] Invalid heartbeat payload');
    return;
  }
  await recordDeviceHeartbeat(payload.device_code);
}

function isBleScanPayload(obj: unknown): obj is { device_code: string; tag_code: string; rssi: number } {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'device_code' in obj &&
    'tag_code' in obj &&
    'rssi' in obj &&
    typeof (obj as any).device_code === 'string' &&
    typeof (obj as any).tag_code === 'string' &&
    typeof (obj as any).rssi === 'number'
  );
}

function isHeartbeatPayload(obj: unknown): obj is { device_code: string } {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'device_code' in obj &&
    typeof (obj as any).device_code === 'string'
  );
}

export function closeMqtt(): void {
  if (client) {
    client.end(true);
    client = null;
  }
}
