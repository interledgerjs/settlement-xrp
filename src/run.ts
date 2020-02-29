import { startServer, createRedisStore } from 'ilp-settlement-core'
import { createEngine } from '.'

async function run() {
  const connectEngine = createEngine({
    xrpSecret: process.env.XRP_SECRET,
    rippledUri: process.env.RIPPLED_URI
  })

  const connectStore = createRedisStore(connectEngine, {
    uri: process.env.REDIS_URI,
    db: 1 // URI will override this
  })

  const { shutdown } = await startServer(connectStore, {
    connectorUrl: process.env.CONNECTOR_URL,
    port: process.env.ENGINE_PORT
  })

  const handleClose = async () => {
    await shutdown()
    process.exit(0)
  }

  process.on('SIGINT', handleClose)
  process.on('SIGTERM', handleClose)
}

run().catch(err => console.error(err))
