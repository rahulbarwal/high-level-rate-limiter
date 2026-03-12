import { createClientFromEnv } from './redis/redisClient';
import { ConfigCache } from './config/configCache';
import { getConfigFromDB } from './config/configStore';
import { rateLimitConfigCacheMissTotal } from './metrics/metrics';
import { createAbuseDetectors } from './abuse/index';
import { createApp } from './app';
import { logger } from './logger';
import { GlobalLimiter, GLOBAL_LIMIT_RPS } from './globalLimiter/globalLimiter';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

const redisClient = createClientFromEnv();

const configCache = new ConfigCache({
  getConfig: getConfigFromDB,
  onCacheMiss: () => rateLimitConfigCacheMissTotal.inc(),
});

const { spikeDetector } = createAbuseDetectors();

const globalLimiter = new GlobalLimiter({
  globalLimitRps: GLOBAL_LIMIT_RPS,
  redisClient,
});

const app = createApp({ redisClient, configCache, spikeDetector, globalLimiter });

const redisMode = process.env.REDIS_SENTINELS ? 'sentinel' : 'standalone';

app.listen(PORT, () => {
  logger.info({
    event: 'server_started',
    port: PORT,
    redisMode,
    timestamp: new Date().toISOString(),
  });
});
