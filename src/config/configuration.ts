export interface AppConfig {
  nodeEnv: string;
  port: number;
  apiPrefix: string;
  database: { url: string };
  redis: { host: string; port: number; password?: string };
  business: {
    expiryAlertThresholdDays: number;
    lowStockCron: string;
    expiryCron: string;
    defaultValuationMethod: 'FIFO' | 'WEIGHTED_AVERAGE';
  };
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  apiPrefix: process.env.API_PREFIX ?? 'api/v1',
  database: {
    url: process.env.DATABASE_URL ?? '',
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  business: {
    expiryAlertThresholdDays: parseInt(
      process.env.EXPIRY_ALERT_THRESHOLD_DAYS ?? '30',
      10,
    ),
    lowStockCron: process.env.LOW_STOCK_CRON ?? '0 * * * *',
    expiryCron: process.env.EXPIRY_CRON ?? '0 6 * * *',
    defaultValuationMethod:
      (process.env.DEFAULT_VALUATION_METHOD as
        | 'FIFO'
        | 'WEIGHTED_AVERAGE') ?? 'WEIGHTED_AVERAGE',
  },
});
