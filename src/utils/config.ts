import dotenv from 'dotenv';
dotenv.config();

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL || '',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpirySeconds: parseInt(process.env.JWT_EXPIRY_SECONDS || '3600', 10),
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-me',
  jwtRefreshExpirySeconds: parseInt(process.env.JWT_REFRESH_EXPIRY_SECONDS || '604800', 10),
  fileStorageBackend: process.env.FILE_STORAGE_BACKEND || 'local',
  fileStoragePath: process.env.FILE_STORAGE_PATH || './storage',
  bleConflictWindowSeconds: parseInt(process.env.BLE_CONFLICT_WINDOW_SECONDS || '5', 10),
  bleMissingThresholdMinutes: parseInt(process.env.BLE_MISSING_THRESHOLD_MINUTES || '10', 10),
  bleDeviceOfflineThresholdMinutes: parseInt(process.env.BLE_DEVICE_OFFLINE_THRESHOLD_MINUTES || '2', 10),
  bleHeartbeatIntervalSeconds: parseInt(process.env.BLE_HEARTBEAT_INTERVAL_SECONDS || '30', 10),
  missingJobIntervalSeconds: parseInt(process.env.MISSING_JOB_INTERVAL_SECONDS || '60', 10),
  mqttUrl: process.env.MQTT_URL || 'mqtt://localhost:1883',
  mqttBleTopic: process.env.MQTT_BLE_TOPIC || 'ble/events',
  wsPort: parseInt(process.env.WS_PORT || '3001', 10),

  // ONLYOFFICE Document Server
  officeDocServerUrl: process.env.OFFICE_DOC_SERVER_URL || 'http://localhost:8080',
  officeJwtSecret: process.env.OFFICE_JWT_SECRET || 'office-secret-change-me',
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  frontendUrl: (process.env.FRONTEND_URL || 'http://localhost:5173').split(',').map(s => s.trim()),
  get corsOrigins(): (string | RegExp)[] {
    return [
      ...this.frontendUrl,
      // Always allow localhost variants for dev convenience
      /^http:\/\/localhost(:\d+)?$/,
      /^http:\/\/127\.0\.0\.1(:\d+)?$/,
    ];
  },
};
