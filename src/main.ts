import { appConfig } from './config';
import { PterodactylClient } from './pterodactylClient';
import { SyncService } from './syncService';
import { UdmClient } from './udmClient';

async function bootstrap(): Promise<void> {
  const config = appConfig;

  console.log('[bootstrap] Initialising services');

  const pterodactylClient = new PterodactylClient(
    config.pterodactyl.url,
    config.pterodactyl.apiKey,
  );

  const udmClient = new UdmClient(
    config.udm.url,
    config.udm.username,
    config.udm.password,
    config.udm.site,
    config.udm.allowSelfSigned,
  );

  const syncService = new SyncService(config, pterodactylClient, udmClient);

  const gracefulShutdown = () => {
    console.log('[bootstrap] Shutting down');
    syncService.stop();
    process.exit(0);
  };

  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);

  syncService.start();
  console.log('[bootstrap] Sync service started');
}

bootstrap().catch((error) => {
  console.error('[bootstrap] Fatal error:', error);
  process.exit(1);
});
