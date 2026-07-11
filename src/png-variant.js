const crypto = require('crypto');
const zlib = require('zlib');

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = Array.from({ length: 256 }, (_value, index) => {
    let crc = index;
    for (let bit = 0; bit < 8; bit++) {
        crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
    return crc >>> 0;
});

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
    const typeBuffer = Buffer.from(type, 'ascii');
    const chunk = Buffer.allocUnsafe(data.length + 12);
    chunk.writeUInt32BE(data.length, 0);
    typeBuffer.copy(chunk, 4);
    data.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), data.length + 8);
    return chunk;
}

function parseChunks(png) {
    if (png.length < PNG_SIGNATURE.length || !png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
        throw new Error('Invalid PNG signature.');
    }
    const chunks = [];
    let offset = PNG_SIGNATURE.length;
    while (offset + 12 <= png.length) {
        const length = png.readUInt32BE(offset);
        const end = offset + length + 12;
        if (end > png.length) {
            throw new Error('Invalid PNG chunk length.');
        }
        const type = png.toString('ascii', offset + 4, offset + 8);
        chunks.push({
            type,
            data: png.subarray(offset + 8, offset + 8 + length),
            raw: png.subarray(offset, end)
        });
        offset = end;
        if (type === 'IEND') {
            break;
        }
    }
    if (!chunks.some(chunk => chunk.type === 'IEND') || offset !== png.length) {
        throw new Error('Incomplete PNG data.');
    }
    return chunks;
}

function randomizePngEncoding(value) {
    const png = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const chunks = parseChunks(png);
    const originalIdat = Buffer.concat(
        chunks.filter(chunk => chunk.type === 'IDAT').map(chunk => chunk.data)
    );
    if (!originalIdat.length) {
        throw new Error('PNG contains no image data.');
    }
    const scanlines = zlib.inflateSync(originalIdat);
    const strategies = [
        zlib.constants.Z_DEFAULT_STRATEGY,
        zlib.constants.Z_FILTERED,
        zlib.constants.Z_RLE
    ];
    const encoded = zlib.deflateSync(scanlines, {
        level: crypto.randomInt(1, 10),
        strategy: strategies[crypto.randomInt(0, strategies.length)]
    });
    const split = encoded.length > 1 ? crypto.randomInt(1, encoded.length) : encoded.length;
    const encodedParts = split < encoded.length
        ? [encoded.subarray(0, split), encoded.subarray(split)]
        : [encoded];
    const nonceChunk = createChunk('qtBx', crypto.randomBytes(16));
    const output = [PNG_SIGNATURE];
    let wroteImageData = false;
    for (const chunk of chunks) {
        if (chunk.type !== 'IDAT') {
            output.push(chunk.raw);
            continue;
        }
        if (wroteImageData) {
            continue;
        }
        wroteImageData = true;
        output.push(nonceChunk, ...encodedParts.map(data => createChunk('IDAT', data)));
    }
    return Buffer.concat(output);
}

module.exports = {
    randomizePngEncoding
};
