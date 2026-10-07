import { cleanupExpiredTokens } from '../src/utils/tokenCleanup';
import { logger } from '../src/config/logger';

async function main(): Promise<void> {
  const count = await cleanupExpiredTokens();
  logger.info({ count }, 'expired refresh tokens cleaned up');
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      logger.error({ err }, 'token cleanup failed');
      process.exit(1);
    });
}
