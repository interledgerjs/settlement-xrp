import 'mocha'
import * as sinon from 'sinon'
import * as Chai from 'chai'
import { XrpSettlementEngine } from '../src/index'
import axios from 'axios'
import * as RedisIo from 'ioredis';
import { RippleAPI } from 'ripple-lib'
import { Mockttp, getLocal } from 'mockttp';
const assert = Object.assign(Chai.assert, sinon.assert)
const Redis = require('ioredis-mock');

describe('Accounts', function () {
  let engine: XrpSettlementEngine
  let redis: RedisIo.Redis
  let rippleApi: RippleAPI
  let mockttp: Mockttp

  let dummyAccount = {
    id: 'testId'
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
      connectorUrl: 'http://localhost:7777'
    })
    sinon.stub(engine.app.context, 'configAccount').callsFake(() => Promise.resolve())
    await engine.start()
  })

  afterEach(async () => {
    await engine.shutdown()
  })

  it('can add an account', async () => {
    const response = await axios.post('http://localhost:3000/accounts', dummyAccount).catch(error => {throw new Error(error.message)})

    assert.strictEqual(response.status, 200)
    const account = await redis.get('xrp:accounts:testId')
    if(account) {
      assert.deepEqual(JSON.parse(account), dummyAccount)
    } else {
      throw new Error('account was not created in datastore')
    }
  })

  it('adding an account that already exists does nothing', async () => {
    const existingAccount = {
      ...dummyAccount,
      xrpAddress: 'testXrp'
    }
    redis.set(`xrp:accounts:${existingAccount.id}`, JSON.stringify(existingAccount))

    const response = await axios.post('http://localhost:3000/accounts', dummyAccount).catch(error => {throw new Error(error.message)})

    assert.strictEqual(response.status, 200)
    const account = await redis.get('xrp:accounts:testId')
    if(account) {
      assert.deepEqual(JSON.parse(account), existingAccount)
    } else {
      throw new Error('account was not created in datastore')
    }
  })

  it('adding an account sends a post request to the connector to set thresholds', async () => {
    //TODO:
  })

  it('can get an account', async () => {
    redis.set(`xrp:accounts:${dummyAccount.id}`, JSON.stringify(dummyAccount))

    const response = await axios.get(`http://localhost:3000/accounts/${dummyAccount.id}`).catch(error => {throw new Error(error.message)})
    
    assert.strictEqual(response.status, 200)
    assert.deepEqual(response.data, dummyAccount)
  })

  it('can remove an account', async () => {
    redis.set(`xrp:accounts:${dummyAccount.id}`, JSON.stringify(dummyAccount))

    const response = await axios.delete(`http://localhost:3000/accounts/${dummyAccount.id}`).catch(error => {throw new Error(error.message)})

    assert.strictEqual(response.status, 200)
    const account = await redis.get('xrp:accounts:testId')
    assert.isNull(account)
  })
})
