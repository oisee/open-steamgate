// Run on the Docker host (or a --network host test-client container).
// Discovery is advisory; Compose's actual bind remains the final authority.
import {createServer} from 'node:net';
import {randomInt} from 'node:crypto';

export const instancePorts = n => [30, 32, 33, 80, 443].map(prefix => Number(`${prefix}${n}`));
export async function available(ports) {
  const held = [];
  try {
    for (const port of ports) {
      const server = createServer();
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen({host: '0.0.0.0', port, exclusive: true}, resolve);
      });
      held.push(server);
    }
    return true;
  } catch (error) {
    if (error.code === 'EADDRINUSE' || error.code === 'EACCES') return false;
    throw error;
  } finally {
    await Promise.all(held.map(server => new Promise(resolve => server.close(resolve))));
  }
}

export async function chooseInstance(check = available, start = randomInt(40)) {
  for (let offset = 0; offset < 40; offset++) {
    const instance = 50 + (start + offset) % 40;
    if (await check(instancePorts(instance))) return String(instance);
  }
  throw new Error('No free OSD instance in 50–89 (30nn/32nn/33nn/80nn/443nn); no containers started');
}

if (process.argv[1]?.endsWith('/free-instance.mjs')) {
  try { console.log(await chooseInstance()); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
