import { startServer } from './core'
import { createEngine } from './index'
import { connectRedis } from './core/store/redis'

async function run() {
  const store = await connectRedis({ uri: 'redis://127.0.0.1:6379/1' })
  await startServer(
    createEngine({
      xrpSecret: 'shr8EK8orddk65ucQPpKiY6NqXzpZ'
    }),
    store,
    {
      port: 3000,
      sendMessageUrl: 'http://localhost:4000',
      creditSettlementUrl: 'http://localhost:3001'
    }
  )

  const store2 = await connectRedis({ uri: 'redis://127.0.0.1:6379/2' })
  await startServer(
    createEngine({
      xrpSecret: 'sh3aCbg2bta4PdnMH8sgj5CEYVa4C'
    }),
    store2,
    {
      port: 4000,
      sendMessageUrl: 'http://localhost:3000',
      creditSettlementUrl: 'http://localhost:4001'
    }
  )

  console.log('Started')
}

run().catch(err => console.error(err))
