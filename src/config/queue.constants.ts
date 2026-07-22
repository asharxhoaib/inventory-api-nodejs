export const QUEUE_NAMES = {
  ALERTS: 'alerts',
  REPORTS: 'reports',
} as const;

export const JOB_NAMES = {
  LOW_STOCK_SCAN: 'low-stock-scan',
  EXPIRY_SCAN: 'expiry-scan',
  GENERATE_REPORT: 'generate-report',
} as const;

export const REPEATABLE_JOB_IDS = {
  LOW_STOCK: 'repeat:low-stock',
  EXPIRY: 'repeat:expiry',
} as const;
