import BigNumber from 'bignumber.js'
import {
  createEngine,
  XrpSettlementEngine,
  isPaymentDetails,
  generateTestnetAccount,
  secretToAddress
} from '.'

test.concurrent(
  'Sends and receives XRP settlements on testnet',
  async () => {
    // Setup the context so they each send messages to each other
    const contextA = {
      creditSettlement: jest.fn(),
      trySettlement: jest.fn(),
      sendMessage: (accountId: string, message: any) => engineB.handleMessage(accountId, message)
    }
    const contextB = {
      creditSettlement: jest.fn(),
      trySettlement: jest.fn(),
      sendMessage: jest.fn()
    }

    const [engineA, engineB] = await Promise.all([
      createEngine()(contextA),
      createEngine()(contextB)
    ])

    const accountId = 'alice'

    // Send settlement for some amount of units
    const amountSettled = await engineA.settle(accountId, new BigNumber(378.1234567))
    expect(amountSettled).toStrictEqual(new BigNumber(378.123456)) // Ensure settlement doesn't include amount too precise

    while (true) {
      if (contextB.creditSettlement.mock.calls.length < 1) {
        await new Promise(r => setTimeout(r, 100))
        continue
      }

      expect(contextB.creditSettlement.mock.calls.length).toBe(1)
      expect(contextB.creditSettlement.mock.calls[0][0]).toBe(accountId)

      // Core settlement engine guarantee: amount one instance settles is the amount the recipient instance credits
      expect(contextB.creditSettlement.mock.calls[0][1]).toStrictEqual(amountSettled)

      break
    }

    await Promise.all([engineA.disconnect(), engineB.disconnect()])
  },
  20000
)

test.concurrent('Generates new payment details for each settlement request', async () => {
  let engineA: XrpSettlementEngine
  let engineB: XrpSettlementEngine

  // Generate a new pair of credentials
  const [secretA, secretB] = await Promise.all([generateTestnetAccount(), generateTestnetAccount()])
  const addressB = secretToAddress(secretB)

  const contextA = {
    creditSettlement: jest.fn(),
    trySettlement: jest.fn(),
    sendMessage: jest.fn((accountId, message) => engineB.handleMessage(accountId, message))
  }
  const contextB = {
    creditSettlement: jest.fn(),
    trySettlement: jest.fn(),
    sendMessage: jest.fn()
  }

  engineA = await createEngine({ xrpSecret: secretA })(contextA)
  engineB = await createEngine({ xrpSecret: secretB })(contextB)

  const accountId = 'bob'

  // Ensure each settlement request uses new payment details
  await engineA.settle(accountId, new BigNumber(0.100037))
  expect(contextA.sendMessage.mock.calls.length).toBe(1)
  expect(contextA.sendMessage.mock.calls[0][0]).toBe(accountId)
  expect(contextA.sendMessage.mock.calls[0][1]).toStrictEqual({
    type: 'paymentDetails'
  })

  await engineA.settle(accountId, new BigNumber(2))
  expect(contextA.sendMessage.mock.calls.length).toBe(2)
  expect(contextA.sendMessage.mock.calls[1][0]).toBe(accountId)
  expect(contextA.sendMessage.mock.calls[1][1]).toStrictEqual({
    type: 'paymentDetails'
  })

  expect(contextA.sendMessage.mock.results.length).toBe(2)
  expect(contextA.sendMessage.mock.results[0].type).toBe('return')
  expect(contextA.sendMessage.mock.results[1].type).toBe('return')

  const paymentsDetails1 = await contextA.sendMessage.mock.results[0].value
  const paymentsDetails2 = await contextA.sendMessage.mock.results[1].value

  // Ensure the returned payment details are the correct schema
  expect(isPaymentDetails(paymentsDetails1)).toBe(true)
  expect(isPaymentDetails(paymentsDetails2)).toBe(true)

  // Ensure a new destination tag was generated for the 2nd request
  expect(paymentsDetails1.destinationTag).not.toBe(paymentsDetails2.destinationTag)

  // Ensure the same, correct XRP address was returned for each request
  expect(paymentsDetails1.xrpAddress).toBe(addressB)
  expect(paymentsDetails2.xrpAddress).toBe(addressB)

  await Promise.all([engineA.disconnect(), engineB.disconnect()])
})

test.concurrent(
  'Settlement fails if payment details are invalid',
  async () => {
    let engineA: XrpSettlementEngine
    let engineB: XrpSettlementEngine

    const contextA = {
      creditSettlement: jest.fn(),
      trySettlement: jest.fn(),
      sendMessage: jest.fn().mockResolvedValue({
        destinationTag: 'foo'
      })
    }
    const contextB = {
      creditSettlement: jest.fn(),
      trySettlement: jest.fn(),
      sendMessage: jest.fn()
    }

    engineA = await createEngine()(contextA)
    engineB = await createEngine()(contextB)

    const accountId = 'charlie'
    const amountToSettle = new BigNumber(345.138493)
    const amountSettled = await engineA.settle(accountId, amountToSettle)

    expect(amountSettled).toStrictEqual(new BigNumber(0))

    // Ensure the peer didn't credit any incoming settlement
    await new Promise(resolve => setTimeout(resolve, 7000))
    expect(contextB.creditSettlement.mock.calls.length).toBe(0)

    await Promise.all([engineA.disconnect(), engineB.disconnect()])
  },
  20000
)

test.concurrent(
  'Settlement fails if payment details cannot be fetched',
  async () => {
    let engineA: XrpSettlementEngine
    let engineB: XrpSettlementEngine

    const contextA = {
      creditSettlement: jest.fn(),
      trySettlement: jest.fn(),
      sendMessage: jest.fn().mockRejectedValue(new Error('Failed to fetch details'))
    }
    const contextB = {
      creditSettlement: jest.fn(),
      trySettlement: jest.fn(),
      sendMessage: jest.fn()
    }

    engineA = await createEngine()(contextA)
    engineB = await createEngine()(contextB)

    const accountId = 'dave'
    const amountToSettle = new BigNumber(345.138493)
    const amountSettled = await engineA.settle(accountId, amountToSettle)

    expect(amountSettled).toStrictEqual(new BigNumber(0))

    // Ensure the peer didn't credit any incoming settlement
    await new Promise(resolve => setTimeout(resolve, 7000))
    expect(contextB.creditSettlement.mock.calls.length).toBe(0)

    await Promise.all([engineA.disconnect(), engineB.disconnect()])
  },
  20000
)

test.todo('Incoming payment tags are purged after 5 minutes')

test.todo('Each payment is only credited to one account')

test.todo('Payments without a destination tag are rejected')

test.todo('Non-XRP trustline payments are not credited as incoming settlements')
