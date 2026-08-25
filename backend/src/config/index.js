require('dotenv').config();

module.exports = {
  port: Number(process.env.PORT || 8080),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  refreshExpiresDays: Number(process.env.REFRESH_EXPIRES_DAYS || 30),
  nodeEnv: process.env.NODE_ENV || 'development',
  autoEndDriveIdleMinutes: Number(process.env.AUTO_END_DRIVE_IDLE_MINUTES || 15),
  autoEndDriveMaxSpeedMph: Number(process.env.AUTO_END_DRIVE_MAX_SPEED_MPH || 3)
};
