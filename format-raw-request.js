function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      resolve(data);
    });
    process.stdin.on('error', reject);
  });
}

async function main() {
  const raw = await readStdin();
  const normalized = raw.replace(/\r\n/g, '\n').trim();

  if (!normalized) {
    console.error('Paste the raw request into stdin.');
    process.exit(1);
  }

  const encoded = Buffer.from(normalized, 'utf8').toString('base64');
  process.stdout.write(encoded);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
