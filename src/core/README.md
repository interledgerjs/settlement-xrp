# Settlement Core

> ### Framework for building Interledger settlement engines in JavaScript

## Design Goals

- **Isomorphic**. JavaScript settlement engines should operate seamlessly across Node.js, desktop & mobile browsers, and Electron apps.
- **Interoperable**. Settlement engines should fully support each next-generation connector, including [Interledger.rs](https://github.com/interledger-rs/interledger-rs), [Rafiki](https://github.com/interledgerjs/rafiki), and the [Java connector](https://github.com/sappenin/java-ilpv4-connector/).
- **Accessible**. Provide the essential primitives to quickly develop safe, reliable settlement engine implementations.
- **Modular**. TODO
- **Scalable**. Support standalone clients all the way up to high-volume, low-latency service providers.

## Prerequisites

Before building a settlement engine, [please read the Settlement Engine RFC](https://github.com/interledger/rfcs/blob/76c717604ee8d51d8f61a9bc2cb92ba135738f09/0000-settlement-engines/0000-settlement-engines.md).

## API

### Building a settlement engine

TODO Add some docs here to explain how to do this

TODO Update RFC link after publish

TODO 🚨that this is beta and subject to change

Settlement engines have to primary responsibilities:

1. Defining a `settle` function that given some amount, asynchronously performs a settlement, and returns the amount that was sent.
2. Listening for incoming settlements, and invoking a `creditSettlement` callback with the amount received.

All interaction with the connector, accounting, and balances are handled by `settlement-core`.

TODO Include annotated settlement engine interface

TODO Include annotated account services

TODO Explain more about what the core lib does and doesn't do

```js
export const connectEngine = async ({ sendMessage, creditSettlement }) => {
  // Do async tasks to connect engine

  return {
    setupAccount(accountId) {
      // A new account was created, so perform any setup tasks
      // Might need to communicate with peer settlement engine using `sendMessage`
    },

    handleMessage(accountId, message) {
      // Process an incoming message from the peer and return a response to them
    },

    settle(accountId, amount) {
      // Perform a settlement for the given amount
    }
  }
}
```

Settlement engines may optionally require an admin API for manual management or other services (database, pub-sub)

TODO Explain BigNumbers

TODO Explain config as a higher order function

### Interfacing with a connector

Settlement engines may define scripts to run an HTTP server to interact with a connector, like so:

```js
import { connectEngine } from '.'
import { startServer, connectRedis } from 'settlement-core'

async function run() {
  const store = await connectRedis()
  await startServer(connectEngine, store)
}

run().catch(err => console.error(err))
```

Individual settlement engines may implement their own configuration options.
