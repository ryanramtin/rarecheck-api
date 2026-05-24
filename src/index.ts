import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import dotenv from 'dotenv';
import { generalLimiter } from './middleware/rateLimiter.js';
import cardsRouter from './routes/cards.js';
import pricesRouter from './routes/prices.js';
import { startPriceCacheJob } from './jobs/priceCacheJob.js';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// MARK: - Security Middleware
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://cardsignal.app']
    : '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// MARK: - Body Parsing
app.use(compression());
app.use(express.json({
  limit: '8mb',   // base64 images up to ~6MB
  strict: true,
}));

// MARK: - Rate Limiting
app.use('/api', generalLimiter);

// MARK: - Routes
app.use('/api/cards', cardsRouter);
app.use('/api/prices', pricesRouter);

// MARK: - Health Check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// MARK: - 404 Handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// MARK: - Error Handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Never leak stack traces in production
  console.error('[Error]', err);
  res.status(500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error.' : err.message,
  });
});

// MARK: - Start
app.listen(PORT, () => {
  console.log(`[CardSignal API] Running on port ${PORT} (${process.env.NODE_ENV ?? 'development'})`);
  if (process.env.NODE_ENV === 'production') {
    startPriceCacheJob();
  }
});

export default app;
