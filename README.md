# XRP On-Ledger Settlement Engine

## Build

To build this engine, issue the following command:

```bash
npm install && npm run build && npm link
```

## Configuration

This settlement engine provides for the following configurable settings:

- **LEDGER_SECRET**: The XRP Ledger secret to use to send outgoing payments and corresponding to the XRP account for receiving incoming payments. DEFAULT: `sahVoeg97nuitefnzL9GHjp2Z6kpj`

- **CONNECTOR_URL**: The base HTTP URL that this settlement engine can make API calls to in order to communicate with the Connector account this engine is operating on behalf of. DEFAULT: `http://localhost:7771`

- **ENGINE_PORT**: Port of the server the settlement engine exposes for the connector. DEFAULT: `3000`

- **REDIS_URI**: URI to communicate with Redis. DEFAULT: `127.0.0.1:6379`

## Operation

To run this Settlement Engine, issue the following command:

```bash
LEDGER_SECRET=sahVoeg97nuitefnzL9GHjp2Z6kpj node ./build/run
```

## Roadmap

- [ ] Add integration tests
