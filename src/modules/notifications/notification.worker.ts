import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import { processDueNotifications } from './notification.service';

/**
 * Background sender for the notification queue.
 *
 * The queue lives in the database, so nothing is lost when the API restarts and
 * several instances can run the worker side by side: rows are claimed with
 * `FOR UPDATE SKIP LOCKED`. Started from `index.ts` only; the tests call
 * `processDueNotifications` directly so they never wait on a timer.
 */
export function startNotificationWorker(): { stop: () => void } {
  if (!env.notifications.enabled) {
    logger.info('Notifications are switched off (NOTIFICATIONS_ENABLED=false)');
    return { stop: () => undefined };
  }

  let running = false;
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    try {
      const result = await processDueNotifications();
      if (result.sent > 0 || result.retrying > 0 || result.failed > 0) {
        logger.info(result, 'Notification queue run');
      }
    } catch (error) {
      logger.error({ err: error }, 'Notification worker run failed');
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), env.notifications.pollIntervalMs);
  timer.unref();
  // Send anything left over from the previous boot straight away.
  void tick();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
