import 'mocha'
import * as sinon from 'sinon'
import * as Chai from 'chai'
import { XrpSettlementEngine } from '../src/index'
import axios from 'axios'
import * as RedisIo from 'ioredis'
import { RippleAPI } from 'ripple-lib'
const assert = Object.assign(Chai.assert, sinon.assert)
const Redis = require('ioredis-mock')
import { getLocal, Mockttp } from 'mockttp'

describe('Accounts Messaging', function () {
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
    mockttp = getLocal()
    await mockttp.start(7777)

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
    await engine.start()
  })

  afterEach(async () => {
    await mockttp.stop()
    await engine.shutdown()
  })

  describe('Counterparty settlement config information', function() {
    
    it('Can handle receiving config details from counterparty', async () => {
      const configMessage  = {
        type: 'config',
        data: {
          xrpAddress: 'testXrpAddress'
        }
      }
      const rawBytes = Buffer.from(JSON.stringify(configMessage))
      redis.set(`xrp:accounts:${dummyAccount.id}`, JSON.stringify(dummyAccount))

      // Needs an ACK system
      const response = await axios.post(`http://localhost:3000/accounts/${dummyAccount.id}/messages`, rawBytes, {
        headers: {
          'content-type': 'application/octet-stream'
        }
      }).catch(error => {throw new Error(error.message)})

      const accountJson = await redis.get(`xrp:accounts:${dummyAccount.id}`)
      if(accountJson) {
        const account = JSON.parse(accountJson)
        const xrpAddressAccountId = await redis.get(`xrp:xrpAddress:${configMessage.data.xrpAddress}:accountId`)
        assert.deepEqual(account, {
          id: 'testId',
          xrpAddress: 'testXrpAddress'
        })
        assert.equal(xrpAddressAccountId, 'testId')
        assert.strictEqual(response.status, 200)
      } else {
        assert.fail('Could not find account')
      }
    })
  
    it('Throws 404 if account does not exist yet on system', async () => {
      const configMessage  = {
        type: 'config',
        data: {
          xrpAddress: 'testXrpAddress'
        }
      }
      const rawBytes = Buffer.from(JSON.stringify(configMessage))

      const response = await axios.post(`http://localhost:3000/accounts/${dummyAccount.id}/messages`, rawBytes, {
        headers: {
          'content-type': 'application/octet-stream'
        }
      }).catch(error => error.response)
  
      assert.strictEqual(response.status, 404)
    })
  })

  describe('Account setup', function() {
    
    it('Attempts to start sending own config to counterparty one account creation', async () => {
      const mockendpoint = await mockttp.post(`/accounts/${dummyAccount.id}/messages`).thenReply(200, Buffer.from(''))

      const response = await axios.post('http://localhost:3000/accounts', dummyAccount).catch(error => {throw new Error(error.message)})

      await new Promise(resolve => setTimeout(resolve, 20))
      const request = await mockendpoint.getSeenRequests()
      assert.equal(request.length, 1)
      assert.deepEqual(JSON.parse(request[0].body.buffer.toString()), {
        type: 'config',
        data: {
          xrpAddress: 'string'
        }
      })
    })
  })
})
