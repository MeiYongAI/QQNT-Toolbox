'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const silkWasmEntry = require.resolve('silk-wasm');
delete require.cache[silkWasmEntry];
const {
    estimateSilkDurationMs,
    makePcm16Wav
} = require('../src/voice/media');

test('loads voice media helpers without eagerly loading silk-wasm', () => {
    assert.equal(require.cache[silkWasmEntry], undefined);
});

test('does not retain unused voice send waiters or delayed Silk cleanup timers', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'voice-file-sender.js'), 'utf8');

    assert.doesNotMatch(source, /createNativeEventWaiter/);
    assert.doesNotMatch(source, /setTimeout\(\(\) => \{\s*fs\.unlink\(silkPath\)/);
    assert.match(source, /await fs\.unlink\(silkPath\)\.catch/);
});

test('estimates Silk duration from complete frames', () => {
    const makeFrame = payload => {
        const size = Buffer.alloc(2);
        size.writeUInt16LE(payload.length);
        return Buffer.concat([size, payload]);
    };
    const silk = Buffer.concat([
        Buffer.from([0x02]),
        Buffer.from('#!SILK_V3', 'latin1'),
        makeFrame(Buffer.from([1, 2])),
        makeFrame(Buffer.from([3, 4, 5]))
    ]);

    assert.equal(estimateSilkDurationMs(silk), 40);
});

test('writes a valid PCM16 WAV header', () => {
    const pcm = Buffer.from([0, 0, 1, 0]);
    const wav = makePcm16Wav(pcm, 24000, 1);

    assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(wav.subarray(8, 12).toString('ascii'), 'WAVE');
    assert.equal(wav.readUInt32LE(24), 24000);
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt32LE(40), pcm.length);
    assert.deepEqual(wav.subarray(44), pcm);
});
