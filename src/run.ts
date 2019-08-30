import { connectRedis } from './core/store/redis'
import { startServer } from './core'
import { createEngine } from '.'

async function run() {
  const engine = createEngine({
    xrpSecret: process.env.LEDGER_SECRET,
    rippledUri: process.env.RIPPLED_URI
  })

  const store = await connectRedis({
    uri: process.env.REDIS_URI,
    db: 1
  })

  const { shutdown } = await startServer(engine, store, {
    connectorUrl: process.env.CONNECTOR_URL,
    port: process.env.ENGINE_PORT
  })

  process.on('SIGINT', async () => {
    await shutdown()

    if (store.disconnect) {
      await store.disconnect()
    }
  })
}

run().catch(err => console.error(err))
