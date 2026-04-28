import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';

const RUNTIME_DIR = path.resolve(config.reportsDir, '..');

const MIME_MAP: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

export async function fileRoutes(fastify: FastifyInstance) {
  fastify.get('/serve', async (req: FastifyRequest, reply: FastifyReply) => {
    const rawPath = (req.query as Record<string, string>).path;
    if (!rawPath || typeof rawPath !== 'string') {
      return reply.status(400).send({ error: 'Missing path query parameter' });
    }

    const resolved = path.resolve(rawPath);
    if (!resolved.startsWith(RUNTIME_DIR)) {
      return reply.status(403).send({ error: 'Access denied: path outside runtime directory' });
    }

    if (!fs.existsSync(resolved)) {
      return reply.status(404).send({ error: 'File not found' });
    }

    const ext = path.extname(resolved).toLowerCase();
    const mime = MIME_MAP[ext];
    if (!mime) {
      return reply.status(415).send({ error: `Unsupported file type: ${ext}` });
    }

    const stat = fs.statSync(resolved);
    reply.header('Content-Type', mime);
    reply.header('Content-Length', stat.size);
    reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(path.basename(resolved))}"`);

    const stream = fs.createReadStream(resolved);
    return reply.send(stream);
  });
}
