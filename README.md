# XRP On-Ledger Settlement Engine

> Settle Interledger payments using on-ledger XRP transfers

[![NPM Package](https://img.shields.io/npm/v/ilp-settlement-xrp.svg?style=flat-square&logo=npm)](https://npmjs.org/package/ilp-settlement-xrp)
[![CircleCI](https://img.shields.io/circleci/project/github/interledgerjs/settlement-xrp/master.svg?style=flat-square&logo=circleci)](https://circleci.com/gh/interledgerjs/settlement-xrp/master)
[![Codecov](https://img.shields.io/codecov/c/github/interledgerjs/settlement-xrp/master.svg?style=flat-square&logo=codecov)](https://codecov.io/gh/interledgerjs/settlement-xrp)
[![Prettier](https://img.shields.io/badge/code_style-prettier-brightgreen.svg?style=flat-square)](https://prettier.io/)
[![Apache 2.0 License](https://img.shields.io/github/license/interledgerjs/settlement-xrp.svg?style=flat-square)](https://github.com/interledgerjs/settlement-xrp/blob/master/LICENSE)

## Install

```bash
npm i -g ilp-settlement-xrp
```

## Run

```bash
DEBUG=settlement* ilp-settlement-xrp
```

## Configuration

Optionally configure the settlement engine using these environment variables:

- **`LEDGER_SECRET`**: The XRP Ledger secret to send outgoing payments and corresponding to the XRP account for receiving incoming payments.
  - By default, a new [XRP testnet account](https://xrpl.org/xrp-test-net-faucet.html) is automatically generated with 10,000 testnet XRP.
- **`RIPPLED_URI`**: Rippled WebSocket or JSON-RPC endpoint to submit transactions and query network state.
  - Defaults to the Ripple testnet: `wss://s.altnet.rippletest.net:51233`. To operate on mainnet, specify a mainnet validator, such as `wss://s1.ripple.com`.
- **`CONNECTOR_URL`**: The base URL of the connector operating this settlement engine for performing accounting and sending messages.
  - Default: `http://localhost:7771`
- **`ENGINE_PORT`**: Port of the settlement engine server exposed to the connector (e.g. for triggering automated settlements).
  - Default: `3000`
- **`REDIS_URI`**: URI to communicate with Redis, typically in the format `redis://[:PASSWORD@]HOST[:PORT][/DATABASE]`.
  - Default: `127.0.0.1:6379/1` (database index of 1 instead of 0)
  - Note: this settlement engine **must** use a unique Redis database index (or dedicated Redis instance) for security to prevent conflicting with the connector.
- **`DEBUG`**: Pattern for printing debug logs. To view logs, `settlement*` is recommended.
