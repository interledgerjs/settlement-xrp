import test from 'ava'
import axios from 'axios'
import getPort from 'get-port'
import { getLocal } from 'mockttp'
import { v4 as uuid } from 'uuid'
import { createEngine } from '.'
import { startServer } from './core'
import { connectRedis } from './core/store/redis'

// TODO Add separate setup

test('Sends and receives XRP settlements on testnet', async t => {
  t.plan(2)

  const accountId = uuid()

  const portA = await getPort()
  const portB = await getPort()

  // Generate new XRP accounts on testnet
  const generateAccount = () =>
    axios
      .post('https://faucet.altnet.rippletest.net/accounts')
      .then(({ data }: any) => data.account.secret)
  const [secretA, secretB] = await Promise.all([generateAccount(), generateAccount()])

  // Start sender engine
  const storeA = await connectRedis({ uri: 'redis://127.0.0.1:6379/1' })
  await startServer(
    createEngine({
      xrpSecret: secretA
    }),
    storeA,
    {
      port: portA,
      sendMessageUrl: `http://localhost:${portB}` // POST messages directly to the other instance
    }
  )

  // Start connector mock for handling incoming settlement requests
  const connectorMock = getLocal()
  await connectorMock.start()

  // Start recipient engine
  const storeB = await connectRedis({ uri: 'redis://127.0.0.1:6379/2' })
  await startServer(
    createEngine({
      xrpSecret: secretB
    }),
    storeB,
    {
      port: portB,
      sendMessageUrl: `http://localhost:${portA}`,
      creditSettlementUrl: connectorMock.urlFor('')
    }
  )

  // Create reciprocal accounts
  await Promise.all([
    axios.put(`http://localhost:${portA}/accounts/${accountId}`),
    axios.put(`http://localhost:${portB}/accounts/${accountId}`)
  ])

  // Create mock connector endpoint to say "credited the full incoming settlement"
  const creditSettlementEndpoint = await connectorMock
    .post(`/accounts/${accountId}/settlements`)
    .withJsonBody({
      amount: '234',
      scale: 5
    })
    .thenJson(201, {
      amount: '2340000',
      scale: 9
    })

  // Send settlement
  const { status } = await axios({
    method: 'POST',
    url: `http://localhost:${portA}/accounts/${accountId}/settlements`,
    data: {
      amount: '2340000', // Send 2,340 drops of XRP
      scale: 9
    },
    headers: {
      'Idempotency-Key': uuid()
    }
  })
  t.is(status, 201)

  // TODO Is there a cleaner way to do this?
  while (true) {
    const requests = await creditSettlementEndpoint.getSeenRequests()
    if (requests.length > 0) {
      t.is(requests.length, 1)
      break
    }

    await new Promise(resolve => setTimeout(resolve, 100))
  }
})

test.after(() => {
  // TODO Add graceful teardown
})
