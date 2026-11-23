import { env } from '../../config/env';
import { logger } from '../../lib/logger';

/**
 * Pluggable SMS delivery. Step 1 ships a stub that logs the message; plugging in
 * MSG91 / Twilio / Fast2SMS later means implementing this interface and swapping
 * the exported instance — no route or service changes required.
 */
export interface SmsSender {
  sendOtp(phone: string, otp: string): Promise<void>;
}

class LoggingSmsSender implements SmsSender {
  async sendOtp(phone: string, otp: string): Promise<void> {
    if (env.isProduction) {
      logger.warn(
        { phone },
        'No SMS provider configured: OTP was generated but not delivered. Configure a real SmsSender before going live.',
      );
      return;
    }
    logger.info({ phone, otp }, `[stub sms] OTP for ${phone} is ${otp}`);
  }
}

export const smsSender: SmsSender = new LoggingSmsSender();
