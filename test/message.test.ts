import 'mocha'
import * as sinon from 'sinon'
import * as Chai from 'chai'
import { XrpSettlementEngine } from '../src/index'
import axios from 'axios'
import * as RedisIo from 'ioredis';
import { RippleAPI } from 'ripple-lib'
const assert = Object.assign(Chai.assert, sinon.assert)
const Redis = require('ioredis-mock');

describe('Accounts', function () {
  let engine: XrpSettlementEngine
  let redis: RedisIo.Redis
  let rippleApi: RippleAPI

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
      connectorUrl: 'http://localhost:3001'
    })
    await engine.start()
  })

  afterEach(async () => {
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
  
      assert.strictEqual(response.status, 200)
    })
  
    it('test', async () => {
      
    })
  })
})
