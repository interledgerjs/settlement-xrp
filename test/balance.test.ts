import 'mocha'
import * as sinon from 'sinon'
import * as Chai from 'chai'
import { XrpSettlementEngine, Account } from '../src/index'
import axios from 'axios'
import * as RedisIo from 'ioredis';
import { RippleAPI } from 'ripple-lib'
const assert = Object.assign(Chai.assert, sinon.assert)
const Redis = require('ioredis-mock');

describe('Balance', function () {
  let engine: XrpSettlementEngine
  let redis: RedisIo.Redis
  let rippleApi: RippleAPI

  let dummyAccount: Account = {
    id: 'testId',
    ledgerAddress: 'rnp.address',
    scale: 6,
    minimumBalance: '0',
    maximumBalance: '100',
    settlementThreshold: '50'
  }

  beforeEach(async () => {
    redis = new Redis()
    rippleApi = new RippleAPI()

    sinon.stub(rippleApi, 'connect').callsFake(() => Promise.resolve())
    sinon.stub(rippleApi, 'disconnect').callsFake(() => Promise.resolve())
    sinon.stub(rippleApi, 'request').callsFake(() => Promise.resolve())

    engine = new XrpSettlementEngine({
      address: 'string',
      secret: 'string',
      assetScale: 6,
      redis,
      rippledClient: rippleApi,
      connectorUrl: 'http://localhost:3001'
    })
    await redis.set(`xrp:accounts:${dummyAccount.id}`, JSON.stringify(dummyAccount))
    await redis.set(`xrp:ledgeraddress_account:${dummyAccount.ledgerAddress}`, dummyAccount.id)
    await engine.start()
  })

  afterEach(async () => {
   await engine.shutdown()
  })

  it('can handle an incoming balance update', async () => {
    const balanceUpdate = {
      balance: 100,
      timestamp: Date.now()
    }
    const response = await axios.post('http://localhost:3000/accounts/testId/balance', balanceUpdate).catch(error => {throw new Error(error.message)})

    assert.strictEqual(response.status, 200)
  })

  it('Balance update that crosses threshold triggers a settlement', async () => {
    const balanceUpdate = {
      balance: '49',
      timestamp: Date.now()
    }
    const stub = sinon.stub(engine, 'settle').callsFake(async (account: Account, drops: string) => {
      return Promise.resolve()
    })
    const response = await axios.post('http://localhost:3000/accounts/testId/balance', balanceUpdate).catch(error => {throw new Error(error.message)})

    sinon.assert.calledOnce(stub)
    assert.strictEqual(response.status, 200)
  })

  it('Threshold alert that does not cross settlement threshold does not trigger a settlement', async () => {
    const balanceUpdate = {
      balance: '51',
      timestamp: Date.now()
    }
    const stub = sinon.stub(engine, 'settle')
    const response = await axios.post('http://localhost:3000/accounts/testId/balance', balanceUpdate).catch(error => {throw new Error(error.message)})

    sinon.assert.notCalled(stub)
    assert.strictEqual(response.status, 200)
  })

  it('Threshold alert for account that doesnt exist throws a 404', async () => {
    const threshold = {
        threshold: 'test',
        timestamp: Date.now(),
        previousBalance: 0,
        currentBalance: 20
    }

    const response = await axios.post('http://localhost:3000/accounts/noaccountId/balance', threshold).catch(error => {
      return error.response
    })

    assert.strictEqual(response.status, 404)
  })
})
