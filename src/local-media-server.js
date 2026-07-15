'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const CONTENT_TYPES = Object.freeze({
    '.apng': 'image/apng',
    '.bmp': 'image/bmp',
    '.gif': 'image/gif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.m4v': 'video/mp4',
    '.mov': 'video/quicktime',
    '.mp4': 'video/mp4',
    '.ogv': 'video/ogg',
    '.webm': 'video/webm'
});

function parseByteRange(value, size) {
    const match = /^bytes=(\d*)-(\d*)$/i.exec(String(value || '').trim());
    if (!match || size <= 0) {
        return null;
    }
    let start;
    let end;
    if (!match[1]) {
        const suffixLength = Number(match[2]);
        if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
            return null;
        }
        start = Math.max(size - suffixLength, 0);
        end = size - 1;
    } else {
        start = Number(match[1]);
        end = match[2] ? Number(match[2]) : size - 1;
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
        return null;
    }
    return { start, end: Math.min(end, size - 1) };
}

function createLocalMediaServer() {
    const entries = new Map();
    const pathTokens = new Map();
    let server = null;
    let startPromise = null;

    async function handleRequest(request, response) {
        const token = new URL(request.url || '/', 'http://127.0.0.1').pathname.split('/')[1];
        const filePath = entries.get(token);
        if (!filePath || !['GET', 'HEAD'].includes(request.method || 'GET')) {
            response.writeHead(404).end();
            return;
        }
        let stat;
        try {
            stat = await fs.promises.stat(filePath);
        } catch {
            response.writeHead(404).end();
            return;
        }
        if (!stat.isFile() || stat.size <= 0) {
            response.writeHead(404).end();
            return;
        }
        const rangeHeader = request.headers.range;
        const range = rangeHeader ? parseByteRange(rangeHeader, stat.size) : null;
        if (rangeHeader && !range) {
            response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end();
            return;
        }
        const start = range?.start || 0;
        const end = range?.end ?? stat.size - 1;
        const headers = {
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'private, max-age=300',
            'Content-Length': end - start + 1,
            'Content-Type': CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
            'Cross-Origin-Resource-Policy': 'cross-origin'
        };
        if (range) {
            headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
        }
        response.writeHead(range ? 206 : 200, headers);
        if (request.method === 'HEAD') {
            response.end();
            return;
        }
        const stream = fs.createReadStream(filePath, { start, end });
        stream.on('error', () => response.destroy());
        stream.pipe(response);
    }

    async function start() {
        if (server?.listening) {
            return server.address().port;
        }
        if (!startPromise) {
            startPromise = new Promise((resolve, reject) => {
                server = http.createServer((request, response) => {
                    handleRequest(request, response).catch(() => {
                        if (!response.headersSent) {
                            response.writeHead(500);
                        }
                        response.end();
                    });
                });
                server.once('error', reject);
                server.listen(0, '127.0.0.1', () => {
                    server.unref();
                    resolve(server.address().port);
                });
            }).catch(error => {
                startPromise = null;
                server = null;
                throw error;
            });
        }
        return await startPromise;
    }

    async function getUrl(filePath) {
        const normalizedPath = path.resolve(String(filePath || ''));
        let token = pathTokens.get(normalizedPath);
        if (!token) {
            token = crypto.randomBytes(18).toString('hex');
            pathTokens.set(normalizedPath, token);
            entries.set(token, normalizedPath);
        }
        const port = await start();
        return `http://127.0.0.1:${port}/${token}/${encodeURIComponent(path.basename(normalizedPath))}`;
    }

    function close() {
        server?.close();
        server = null;
        startPromise = null;
        entries.clear();
        pathTokens.clear();
    }

    return Object.freeze({ close, getUrl });
}

module.exports = {
    createLocalMediaServer,
    parseByteRange
};
