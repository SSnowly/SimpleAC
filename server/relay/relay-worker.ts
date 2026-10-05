import { parentPort, workerData } from 'node:worker_threads';
import Turn from 'node-turn';

// Runs in its own thread: a TURN relay that forwards the encrypted video between a watched player's game and the
// staff member's panel, so neither side needs to learn the other's address. It sees only encrypted packets.

export interface RelayWorkerConfig {
  port: number;
  minPort: number;
  maxPort: number;
  publicIp: string;
}

export type RelayCommand =
  | { type: 'add'; username: string; password: string }
  | { type: 'remove'; username: string }
  | { type: 'stop' };

const config = workerData as RelayWorkerConfig;
const post = (message: Record<string, unknown>): void => parentPort?.postMessage(message);

try {
  const server = new Turn({
    authMech: 'long-term',
    credentials: {},
    realm: 'simpleac',
    listeningIps: ['0.0.0.0'],
    listeningPort: config.port,
    minPort: config.minPort,
    maxPort: config.maxPort,
    // The address clients are told to send relayed packets to. Behind NAT or a proxy this must be the public one.
    externalIps: config.publicIp,
    debugLevel: 'ERROR',
    log: (message: unknown) => post({ type: 'log', message: String(message).slice(0, 300) }),
  });
  server.start();
  post({ type: 'ready' });

  parentPort?.on('message', (command: RelayCommand) => {
    if (command.type === 'add') server.addUser(command.username, command.password);
    else if (command.type === 'remove') server.removeUser(command.username);
    else if (command.type === 'stop') server.stop();
  });
} catch (error) {
  post({
    type: 'error',
    message: error instanceof Error ? error.message : 'the relay could not start',
  });
}
