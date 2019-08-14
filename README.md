XRP On Ledger Settlement engine as per the proposed [Settlement RFC](https://github.com/interledger/rfcs/pull/536).

Note the RFC has yet to be merged and thus the implementation could change to meet the spec at a later date. 

## Build the Engine
To build this engine, issue the following command:

```bash
npm install && npm run build && npm link
```

## Configuration
This settlement engine provides for the following configurable settings:

* **LEDGER_ADDRESS**: The XRP Ledger address that this settlement engine will listen to for incoming payments (i.e., payments made by a counterparty to the Connector account this engine is operating on behalf of). Generate a test address and secret using the [XRPL Test Faucet](https://xrpl.org/xrp-test-net-faucet.html). DEFAULT: `rGCUgMH4omQV1PUuYFoMAnA7esWFhE7ZEV`

* **LEDGER_SECRET**: The XRP Ledger secret that this settlement engine will listen to for incoming payments (i.e., payments made by a counterparty to the Connector account this engine is operating on behalf of). DEFAULT: `sahVoeg97nuitefnzL9GHjp2Z6kpj`

* **CONNECTOR_URL**: The base HTTP URL that this settlement engine can make API calls to in order to communicate with the Connector account this engine is operating on behalf of. DEFAULT: `http://localhost:7771`

* **ENGINE_PORT**: The port that this settlement engine should bind to. DEFAULT: `3000`

* **REDIS_HOST**: The host that this settlement engine should use when attempting to communicate with Redis. DEFAULT: `localhost`

* **REDIS_PORT**: The port that this settlement engine should use when attempting to communicate with Redis. DEFAULT: `6379`

## Operation
To run this Settlement Engine, issue the following command:

```bash
LEDGER_ADDRESS=rGCUgMH4omQV1PUuYFoMAnA7esWFhE7ZEV LEDGER_SECRET=sahVoeg97nuitefnzL9GHjp2Z6kpj node ./build/run
```

### TODO
* [ ] Add logic to persist incoming settlements and requests to settle to ensure they are executed at a later time.
* [ ] Update README
* [ ] Dockerize the SE
* [ ] Add integration tests
