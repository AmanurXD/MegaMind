const fs = require('fs');
const path = require('path');
const readline = require('readline');

const END_MARKER = 'END_RAW_REQUEST';

function printUsage() {
    console.error('Usage: npm run encode-request -- raw-request.txt');
    console.error('   or: npm run encode-request');
    console.error(`       Paste the raw request, then type ${END_MARKER} on its own line.`);
    console.error('   or: type raw-request.txt | node tools/encode-raw-request.js');
    process.exit(1);
}

function encode(rawRequest) {
    rawRequest = rawRequest.replace(/^\uFEFF/, '');

    if (!rawRequest.trim()) {
        console.error('Input raw request is empty.');
        process.exit(1);
    }

    process.stdout.write(`${Buffer.from(rawRequest, 'utf8').toString('base64')}\n`);
}

function readInteractivePaste() {
    return new Promise((resolve) => {
        const lines = [];
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: true
        });

        console.error('Paste your full raw request below.');
        console.error(`When finished, type ${END_MARKER} on a new line and press Enter.`);
        console.error('');

        rl.on('line', (line) => {
            if (line.trim() === END_MARKER) {
                rl.close();
                resolve(lines.join('\n'));
                return;
            }

            lines.push(line);
        });

        rl.on('close', () => {
            resolve(lines.join('\n'));
        });
    });
}

async function main() {
    const inputFile = process.argv[2];

    if (inputFile === '-h' || inputFile === '--help') {
        printUsage();
    }

    if (inputFile) {
        const inputPath = path.resolve(process.cwd(), inputFile);

        if (!fs.existsSync(inputPath)) {
            console.error(`Input file not found: ${inputPath}`);
            process.exit(1);
        }

        encode(fs.readFileSync(inputPath, 'utf8'));
        return;
    }

    if (process.stdin.isTTY) {
        encode(await readInteractivePaste());
        return;
    }

    encode(fs.readFileSync(0, 'utf8'));
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
