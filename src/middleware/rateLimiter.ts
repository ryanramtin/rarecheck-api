import rateLimit from 'express-rate-limit';

const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000; // 1 minute

// General API rate limit
export const generalLimiter = rateLimit({
  windowMs,
  max: Number(process.env.RATE_LIMIT_MAX_GENERAL) || 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
  keyGenerator: (req) => req.ip ?? 'unknown',
});

// Tighter limit for the expensive identify endpoint
export const identifyLimiter = rateLimit({
  windowMs,
  max: Number(process.env.RATE_LIMIT_MAX_IDENTIFY) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Card scan rate limit reached. Try again in a minute.' },
  keyGenerator: (req) => req.userId ?? req.ip ?? 'unknown',
});
