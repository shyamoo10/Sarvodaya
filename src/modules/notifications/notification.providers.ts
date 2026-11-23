import { env } from '../../config/env';
import { logger } from '../../lib/logger';

/**
 * Delivery side of the notification queue.
 *
 * Every channel is behind an interface, exactly like the OTP SMS stub: the queue,
 * the retries and the database rows are real and tested, and plugging in a real
 * push / SMS / WhatsApp provider later means implementing `NotificationProvider`
 * and nothing else.
 *
 * With no provider key the message is logged instead of sent, so development and
 * staging never message a real customer. With a key set but no implementation the
 * attempt fails loudly, which the queue retries and finally marks FAILED — better
 * than silently pretending a customer was told.
 */

export type NotificationChannelName = 'PUSH' | 'SMS' | 'WHATSAPP';

export type DeliveryTarget = {
  phone: string;
  deviceTokens: string[];
};

export type DeliveryResult = {
  providerMessageId: string;
};

export interface NotificationProvider {
  readonly channel: NotificationChannelName;
  isConfigured(): boolean;
  send(input: {
    title: string;
    body: string;
    target: DeliveryTarget;
  }): Promise<DeliveryResult>;
}

function stubMessage(channel: NotificationChannelName, title: string, to: string): string {
  return `[stub ${channel.toLowerCase()}] ${title} -> ${to}`;
}

class StubProvider implements NotificationProvider {
  constructor(
    readonly channel: NotificationChannelName,
    private readonly key: string,
    private readonly pickTarget: (target: DeliveryTarget) => string,
  ) {}

  isConfigured(): boolean {
    return false;
  }

  async send(input: { title: string; body: string; target: DeliveryTarget }): Promise<DeliveryResult> {
    const to = this.pickTarget(input.target);
    logger.info(
      { channel: this.channel, title: input.title, body: input.body, to },
      stubMessage(this.channel, input.title, to),
    );
    return { providerMessageId: `stub-${this.channel.toLowerCase()}-${Date.now()}` };
  }

  /** Only used to explain a misconfiguration in logs. */
  configuredButUnimplemented(): string {
    return `${this.channel} provider key is set but no ${this.channel} integration is implemented yet (${this.key ? 'key present' : 'no key'})`;
  }
}

/**
 * A key being present means the shop intends real delivery. Until the integration
 * exists the attempt must fail, not be swallowed.
 */
class UnimplementedProvider implements NotificationProvider {
  constructor(readonly channel: NotificationChannelName) {}

  isConfigured(): boolean {
    return true;
  }

  async send(): Promise<DeliveryResult> {
    throw new Error(
      `${this.channel} delivery is configured but not implemented in this build. Implement NotificationProvider to connect the provider.`,
    );
  }
}

function createProvider(
  channel: NotificationChannelName,
  key: string,
  pickTarget: (target: DeliveryTarget) => string = (target) => target.phone,
): NotificationProvider {
  const stub = new StubProvider(channel, key, pickTarget);
  return key ? new UnimplementedProvider(channel) : stub;
}

const providers: Record<NotificationChannelName, NotificationProvider> = {
  PUSH: createProvider('PUSH', env.notifications.pushProviderKey, (target) =>
    target.deviceTokens.join(',') || 'no registered device',
  ),
  SMS: createProvider('SMS', env.notifications.smsProviderKey),
  WHATSAPP: createProvider('WHATSAPP', env.notifications.whatsappProviderKey),
};

export function getProvider(channel: NotificationChannelName): NotificationProvider {
  return providers[channel];
}

export async function deliverNotification(input: {
  channel: NotificationChannelName;
  title: string;
  body: string;
  target: DeliveryTarget;
}): Promise<DeliveryResult> {
  const provider = getProvider(input.channel);
  if (input.channel === 'PUSH' && input.target.deviceTokens.length === 0) {
    throw new Error('No active push token is registered for this account');
  }
  return provider.send(input);
}
