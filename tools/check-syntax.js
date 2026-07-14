'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const sourceDir = path.join(rootDir, 'src');

function collectJavaScriptFiles(directory, results = []) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            collectJavaScriptFiles(entryPath, results);
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            results.push(entryPath);
        }
    }
    return results;
}

const files = collectJavaScriptFiles(sourceDir).sort();
for (const filePath of files) {
    const result = spawnSync(process.execPath, ['--check', filePath], {
        cwd: rootDir,
        stdio: 'inherit'
    });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        process.exit(result.status || 1);
    }
}

process.stdout.write(`Checked ${files.length} JavaScript files.\n`);
