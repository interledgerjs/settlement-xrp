import axios from 'axios'
import { startServer, ConnectSettlementEngine } from '.'
import { createMemoryStore } from './store/memory'
import BigNumber from 'bignumber.js'
import uuid from 'uuid/v4'
import getPort from 'get-port'

// TODO Should these tests use the Redis DB rather than memory?

/**
 * Startup a settlement engine server with mock settlement, a memory store,
 * and return a function to send settlement requests to it
 */
const prepareSettlementEngine = async () => {
  const port = await getPort()
  const accountId = uuid()

  const settleMock = jest.fn()
  settleMock.mockImplementation(async (accountId: string, amount: BigNumber) => amount)

  const createEngine: ConnectSettlementEngine = async () => ({
    settle: settleMock
  })

  const { shutdown } = await startServer(createEngine, createMemoryStore(), {
    port
  })

  await axios.post(`http://localhost:${port}/accounts`, {
    id: accountId
  })

  const sendSettlementRequest = (
    quantity: {
      amount: string
      scale: number
    },
    idempotencyKey = uuid()
  ) =>
    axios({
      url: `http://localhost:${port}/accounts/${accountId}/settlements`,
      method: 'POST',
      data: quantity,
      headers: {
        'Idempotency-Key': idempotencyKey
      }
    })

  return { sendSettlementRequest, settleMock, shutdown }
}

describe('Send settlement', () => {
  test('Triggers settlement for given amount', async () => {
    const { settleMock, sendSettlementRequest, shutdown } = await prepareSettlementEngine()

    const quantity = {
      amount: '468200000',
      scale: 8
    }
    const response = await sendSettlementRequest(quantity)
    expect(response.data).toStrictEqual(quantity) // The entire amount should be queued for settlement
    expect(response.status).toBe(201)

    expect(settleMock.mock.calls.length).toBe(1)
    expect(settleMock.mock.calls[0][1]).toStrictEqual(new BigNumber('4.682'))

    await shutdown()
  })

  test('Same idempotency key only queues one settlement', async () => {
    const { settleMock, sendSettlementRequest, shutdown } = await prepareSettlementEngine()

    const quantity = {
      amount: '468200000',
      scale: 8
    }
    const idempotencyKey = uuid()

    await sendSettlementRequest(quantity, idempotencyKey)

    const response = await sendSettlementRequest(quantity, idempotencyKey)
    expect(response.data).toStrictEqual(quantity)
    expect(response.status).toBe(201)

    expect(settleMock.mock.calls.length).toBe(1)
    expect(settleMock.mock.calls[0][1]).toStrictEqual(new BigNumber('4.682'))

    await shutdown()
  })

  test('Same idempotency key with different amount fails', async () => {
    const { settleMock, sendSettlementRequest, shutdown } = await prepareSettlementEngine()

    const idempotencyKey = uuid()

    const quantity1 = {
      amount: '999',
      scale: 4
    }
    await sendSettlementRequest(quantity1, idempotencyKey)

    const quantity2 = {
      amount: '37843894895',
      scale: 4
    }
    await expect(sendSettlementRequest(quantity2, idempotencyKey)).rejects.toHaveProperty(
      'response.status',
      400
    )

    expect(settleMock.mock.calls.length).toBe(1)
    expect(settleMock.mock.calls[0][1]).toStrictEqual(new BigNumber('0.0999'))

    await shutdown()
  })

  test('Retries unsettled amount after subsequent settlements are triggered', async () => {
    const { settleMock, sendSettlementRequest, shutdown } = await prepareSettlementEngine()

    // Request to settle 3.6, but only settle 1.207
    settleMock.mockResolvedValueOnce(new BigNumber(1.207))
    await sendSettlementRequest({
      amount: '3600',
      scale: 3
    })

    expect(settleMock.mock.calls.length).toBe(1)
    expect(settleMock.mock.calls[0][1]).toStrictEqual(new BigNumber('3.6'))

    // Request to settle 4.9001
    await sendSettlementRequest({
      amount: '490010000',
      scale: 8
    })

    // Second settlement: 4.9001 new amount + 2.393 unsettled leftover = 7.2931
    expect(settleMock.mock.calls.length).toBe(2)
    expect(settleMock.mock.calls[1][1]).toStrictEqual(new BigNumber('7.2931'))

    await shutdown() // TODO How to shutdown even if test fails?
  })

  test('Safely handles many simultaneous settlement requests', async () => {
    const { settleMock, sendSettlementRequest, shutdown } = await prepareSettlementEngine()

    // Settle 1 unit x 100 times
    const requests = Array(100)
      .fill(null)
      .map(() =>
        sendSettlementRequest({
          amount: '1',
          scale: 0
        })
      )
    await Promise.all(requests)

    expect(settleMock.mock.calls.length).toBe(100)

    const totalSettled = settleMock.mock.calls
      .map(([accountId, amount]) => amount)
      .reduce((total, amount) => amount.plus(total), 0)
    expect(totalSettled).toStrictEqual(new BigNumber('100'))

    await shutdown()
  })
})

describe('Credit incoming settlements', () => {
  // test('Triggers notification of settlement for given amount', async () => {
  //   let engine: any
  //   engine.creditSettlement(5) // => got notification for 5 units
  //   // TODO
  // })
  // test.todo('Retries requests with exponential backofff')
  // test.todo('After')
})
