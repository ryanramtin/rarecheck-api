import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { auditLog } from '../middleware/auditLog.js';
import { getPriceHistory } from '../services/pricingService.js';

const router = Router();

// GET /api/prices/:cardId/history
// Requires auth — Pro entitlement enforced by RevenueCat on the iOS side,
// but we validate the JWT to prevent unauthenticated scraping.
router.get(
  '/:cardId/history',
  requireAuth,
  auditLog('prices.history'),
  async (req: Request, res: Response) => {
    const { cardId } = req.params;
    if (!cardId || !/^[\w-]+$/.test(cardId)) {
      res.status(400).json({ error: 'Invalid card ID.' });
      return;
    }

    const history = await getPriceHistory(cardId);
    res.json({ history });
  }
);

export default router;
