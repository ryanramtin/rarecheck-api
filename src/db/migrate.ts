import { readFileSync } from 'fs';
import { join } from 'path';
import pool from './client.js';

async function migrate() {
  const client = await pool.connect();
  try {
    // Create migrations tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    const migrations = ['001_initial.sql'];

    for (const filename of migrations) {
      const version = filename.replace('.sql', '');
      const already = await client.query(
        'SELECT 1 FROM schema_migrations WHERE version = $1',
        [version]
      );
      if (already.rows.length > 0) {
        console.log(`[Migrate] Skipping ${version} (already applied)`);
        continue;
      }

      const sql = readFileSync(join(__dirname, 'migrations', filename), 'utf8');
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      await client.query('COMMIT');
      console.log(`[Migrate] Applied ${version}`);
    }
    console.log('[Migrate] All migrations complete');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migrate] Failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
