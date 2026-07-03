import rateLimit from 'express-rate-limit';
import { getRateLimitConfig, isRateLimitEnabled } from '../config.js';

const { windowMs, max } = getRateLimitConfig();

export const apiRateLimiter = rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => !isRateLimitEnabled(),
});
