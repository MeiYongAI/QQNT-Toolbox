'use strict';

const fs = require('fs').promises;
const path = require('path');

function validateAccountDirectory(rootDirectory, accountDirectory) {
    const root = path.resolve(rootDirectory);
    const account = path.resolve(accountDirectory);
    if (path.dirname(account) !== root) {
        throw new Error('Invalid recall cache directory.');
    }
    return { root, account };
}

async function clearRecallAccountCache({
    rootDirectory,
    accountDirectory,
    cachePath,
    state
}) {
    const { account } = validateAccountDirectory(rootDirectory, accountDirectory);
    if (!state || path.dirname(path.resolve(cachePath)) !== account) {
        throw new Error('Invalid recall cache directory.');
    }

    state.generation = Math.max(0, Number(state.generation) || 0) + 1;
    state.liveMessages?.clear();
    state.recalledMessages?.clear();
    state.persistedIds?.clear();
    state.imageDownloads?.clear();
    await state.staging?.clear();
    state.staging?.close();

    await fs.rm(account, { recursive: true, force: true });
    await fs.mkdir(account, { recursive: true });
    await fs.writeFile(cachePath, Buffer.alloc(0));
    return {
        success: true,
        generation: state.generation
    };
}

module.exports = {
    clearRecallAccountCache,
    validateAccountDirectory
};
