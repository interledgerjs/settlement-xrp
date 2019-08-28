import anyTest, { TestInterface } from 'ava'
// import mockttp from 'mockttp'
import { startServer, SettlementServer, ConnectSettlementEngine } from '..'
// import { connectRedis } from '../store/redis'
// import Redis from 'ioredis'
import sinon, { SinonSpy } from 'sinon'
import axios, { AxiosError } from 'axios'
import { SettlementStore } from '../store'
import { v4 as uuid } from 'uuid'
import getPort from 'get-port'

// const RedisMock = require('ioredis-mock') // TODO Add types for this!

// const mockServer = mockttp.getLocal()

const test = anyTest as TestInterface<{
  server: SettlementServer
  setupSpy: SinonSpy
  settleSpy: SinonSpy
  createAccountSpy: SinonSpy
  port: number
}>

test.beforeEach(async t => {
  // const store = await connectRedis({
  //   client: new RedisMock() as Redis.Redis
  // })

  const createAccountSpy = sinon.spy()

  const store = ({
    createAccount: createAccountSpy
  } as unknown) as SettlementStore

  const setupSpy = sinon.spy()
  const settleSpy = sinon.spy()

  const engineStub: ConnectSettlementEngine = async () => ({
    setup: setupSpy,
    settle: settleSpy
  })

  const port = await getPort()
  const server = await startServer(engineStub, store, { port })

  t.context = {
    port,
    server,
    setupSpy,
    settleSpy,
    createAccountSpy
  }
})

test.afterEach(async t => {
  await t.context.server.shutdown()
})

test('Server -> Create new account -> Sets up the account', async t => {
  const accountId = uuid()
  const { status } = await axios.put(`http://localhost:${t.context.port}/accounts/${accountId}`)

  t.true(t.context.createAccountSpy.calledOnceWith(accountId))
  t.true(t.context.setupSpy.calledOnceWith(accountId))
  t.is(status, 201)
})

test.skip('Server -> Create new account -> Fails with duplicate account ID', async t => {
  const accountId = 'alice'

  const { status } = await axios.put(`http://localhost:${t.context.port}/accounts/${accountId}`)

  t.true(t.context.createAccountSpy.notCalled) // TODO Create account *is* called, it just throws
  t.true(t.context.setupSpy.notCalled)
  t.is(status, 400)
})

test('Server -> Create new account -> Fails with invalid account ID', async t => {
  const { response } = await t.throwsAsync<AxiosError>(
    axios.put(`http://localhost:${t.context.port}/accounts/alice:foo:bar`)
  )

  t.true(t.context.createAccountSpy.notCalled)
  t.true(t.context.setupSpy.notCalled)
  t.is(response!.status, 400)
})

// TODO Should this be under delete instead?
test.todo('Server -> Create new account -> Re-creates account after deletion')

// test('Server -> Send settlement -> TODO', async t => {
//   const accountId = uuid()

//   await axios.put(`http://localhost:${t.context.port}/accounts/${accountId}`)

//   const { data, status } = await axios.post(
//     `http://localhost:${t.context.port}/accounts/${accountId}/settlements`,
//     {}
//   )

//   // t.set
// })

/**
 * What integration tests do I want? (use mock settlement engine implementation)
 *
 * TODO The goal is to test the HTTP API, and *not* any internal SE implementation
 *
 * TODO (What about testing behavior based on that internal SE implementation? e.g., refunding failed settlements?) (How would that be tested?)
 *
 * Create new account
 * - Correct response code
 * - Calls "setup" spy on SE implementation (should this await?)
 * - Test with invalid account ID
 * - Try to create the same account (should fail?)
 * - Should succeed after creating, deleting, then creating the same account
 *
 * Perform a settlement (use mock SE implementation + spies)
 *
 * 200 + engine.settle *should be called*
 * - Reasonable quantity/amount/scale
 * - Reasonable quantity/amount with a 0 scale
 *
 * TODO Anything testing effects of an engine.settle return value/refunding failed is an entirely different test!
 *
 * TODO How to test atomicity/race conditions?
 */
