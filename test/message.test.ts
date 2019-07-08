import 'mocha'
import * as sinon from 'sinon'
import * as Chai from 'chai'
import {XrpSettlementEngine} from '../src'
import axios from 'axios'
import * as RedisIo from 'ioredis'
import {RippleAPI} from 'ripple-lib'
import {getLocal, Mockttp} from 'mockttp'
import {randomBytes} from "crypto"

const assert = Object.assign(Chai.assert, sinon.assert)
const Redis = require('ioredis-mock')

describe('Accounts Messaging', function () {
  let engine: XrpSettlementEngine
  let redis: RedisIo.Redis
  let rippleApi: RippleAPI
  let mockttp: Mockttp
  const ENGINE_PREFIX = 'xrp'

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
      address: 'coolXrpAddress',
      secret: 'supersecretsecret',
      enginePrefix: ENGINE_PREFIX,
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

  describe('Payment Details', function() {
    
    it('Can request payment details from counterparty', async () => {
      const message  = {
        type: 'paymentDetails'
      }

      const rawBytes = Buffer.from(JSON.stringify(message))
      await redis.set(`${ENGINE_PREFIX}:accounts:${dummyAccount.id}`, JSON.stringify(dummyAccount))

      // Needs an ACK system
      const response = await axios.post(`http://localhost:3000/accounts/${dummyAccount.id}/messages`, rawBytes, {
        headers: {
          'content-type': 'application/octet-stream'
        }
      }).catch(error => {throw new Error(error.message)})

      const tag = Number(await redis.get(`${ENGINE_PREFIX}:accountId:${dummyAccount.id}:destinationTag`))

      assert.strictEqual(response.status, 200)
      assert.deepEqual(response.data, {
        xrpAddress: engine.address,
        destinationTag: tag
      })
    })

    it('Returns correct payment details if set already', async () => {
      await redis.set(`xrp:accounts:${dummyAccount.id}`, JSON.stringify(dummyAccount))
      const destinationTag = randomBytes(4).readUInt32BE(0)
      await redis.set(`${ENGINE_PREFIX}:destinationTag:${destinationTag}:accountId`, dummyAccount.id)
      await redis.set(`${ENGINE_PREFIX}:accountId:${dummyAccount.id}:destinationTag`, destinationTag)

      const message  = {
        type: 'paymentDetails'
      }
      const rawBytes = Buffer.from(JSON.stringify(message))

      // Needs an ACK system
      const response = await axios.post(`http://localhost:3000/accounts/${dummyAccount.id}/messages`, rawBytes, {
        headers: {
          'content-type': 'application/octet-stream'
        }
      }).catch(error => {throw new Error(error.message)})

      assert.strictEqual(response.status, 200)
      assert.deepEqual(response.data, {
        xrpAddress: engine.address,
        destinationTag: destinationTag
      })
    })
  })
})
