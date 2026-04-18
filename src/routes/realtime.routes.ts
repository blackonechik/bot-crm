import { Router } from 'express';
import { authenticateLiveToken, subscribeLiveClient } from '../services/realtime.service';

const router = Router();

router.get('/stream', async (req, res) => {
  const token = String(req.query.token ?? '');
  if (!token || !(await authenticateLiveToken(token))) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true, timestamp: new Date().toISOString() })}\n\n`);

  subscribeLiveClient(res);
});

export default router;
