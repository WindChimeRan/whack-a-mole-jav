import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(output);
for (const name of ['index.html', 'app.js', 'metal-client.js', 'style.css']) {
  await copyFile(join(root, name), join(output, name));
}
console.log(`Static site ready in ${output}`);
