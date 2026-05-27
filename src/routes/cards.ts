import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { optionalAuth } from '../middleware/auth.js';
import { identifyLimiter } from '../middleware/rateLimiter.js';
import { auditLog } from '../middleware/auditLog.js';
import { identifyCard } from '../services/identificationService.js';
import { getCurrentPrice } from '../services/pricingService.js';
import { db } from '../db/client.js';

const router = Router();

// POST /api/cards/identify
const identifySchema = Joi.object({
  image: Joi.string().base64().max(6_971_000).required(), // ~5MB base64 max
  userId: Joi.string().uuid().optional(),
  ocrHints: Joi.object({
    name: Joi.string().max(100).optional(),
    collectorNumber: Joi.string().max(10).optional(),
    setCode: Joi.string().max(6).optional(),
    rawText: Joi.string().max(2000).optional(),
  }).optional(),
});

router.post(
  '/identify',
  identifyLimiter,
  optionalAuth,
  auditLog('cards.identify'),
  async (req: Request, res: Response) => {
    const start = Date.now();

    const { error, value } = identifySchema.validate(req.body);
    if (error) {
      res.status(400).json({ error: error.details[0].message });
      return;
    }

    // Merge OCR hints into identification
    const matches = await identifyCard(value.image, value.ocrHints);

    // If OCR hints provided by iOS client, boost confidence for exact matches
    if (value.ocrHints?.name) {
      for (const match of matches) {
        const nameLower = match.name.toLowerCase();
        const hintLower = value.ocrHints.name.toLowerCase();
        if (nameLower === hintLower) match.confidence = Math.min(match.confidence + 0.25, 1.0);
        if (value.ocrHints.collectorNumber && match.collectorNumber === value.ocrHints.collectorNumber) {
          match.confidence = Math.min(match.confidence + 0.15, 1.0);
        }
      }
      matches.sort((a, b) => b.confidence - a.confidence);
    }

    res.json({
      matches: matches.slice(0, 3),
      processingTimeMs: Date.now() - start,
    });
  }
);

// GET /api/cards/:id
router.get(
  '/:id',
  optionalAuth,
  auditLog('cards.get'),
  async (req: Request, res: Response) => {
    const cardId = req.params.id;
    if (!cardId || !/^[\w-]+$/.test(cardId)) {
      res.status(400).json({ error: 'Invalid card ID.' });
      return;
    }

    const result = await db.query<{
      id: string; name: string; set_name: string; set_code: string;
      collector_number: string; rarity: string; image_url: string;
    }>(
      `SELECT id, name, set_name, set_code, collector_number, rarity,
              COALESCE(NULLIF(image_url_hires, ''), image_url) AS image_url
       FROM cards WHERE id = $1`,
      [cardId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Card not found.' });
      return;
    }

    const row = result.rows[0];
    const price = await getCurrentPrice(cardId);

    res.json({
      card: {
        id: row.id,
        name: row.name,
        setName: row.set_name,
        setCode: row.set_code,
        collectorNumber: row.collector_number,
        rarity: row.rarity,
        imageUrl: row.image_url,
        confidence: 1.0,
        price: price ?? { low: 0, mid: 0, high: 0, market: 0, currency: 'USD', updatedAt: new Date().toISOString() },
      },
    });
  }
);

export default router;
