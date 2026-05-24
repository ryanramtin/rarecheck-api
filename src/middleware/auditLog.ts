import { Request, Response, NextFunction } from 'express';
import { db } from '../db/client.js';

export function auditLog(action: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      await db.query(
        `INSERT INTO audit_logs (user_id, action, resource_id, ip, user_agent, metadata)
         VALUES ($1, $2, $3, $4::inet, $5, $6)`,
        [
          req.userId ?? null,
          action,
          req.params.id ?? null,
          req.ip ?? null,
          req.get('user-agent') ?? null,
          JSON.stringify({ method: req.method, path: req.path }),
        ]
      );
    } catch (err) {
      // Non-blocking — never fail a request because of audit logging
      console.error('[Audit] Failed to write audit log:', err);
    }
    next();
  };
}
