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
import { EventEmitter } from 'events';

describe('Accounts Settlement', function () {
  let engine: XrpSettlementEngine
  let redis: RedisIo.Redis
  let rippleApi: RippleAPI
  let mockttp: Mockttp
  let eventEmitter: EventEmitter

  let dummyAccount = {
    id: 'testId',
    xrpAddress: 'rMmTCjGFRWPz8S2zAUUoNVSQHxtRQD4eCx'
  }

  let transaction = {
    engine_result: 'tesSUCCESS',
    engine_result_code: 0,
    engine_result_message:
      'The transaction was applied. Only final in a validated ledger.',
    ledger_hash:
      '22B91B33054AFC5E56248CEC4C094990C771BEF694F3BC73A582B3BE7D6B3A87',
    ledger_index: 19969015,
    meta:
    {
      AffectedNodes: [[Object], [Object]],
      TransactionIndex: 1,
      TransactionResult: 'tesSUCCESS',
      delivered_amount: '1000000'
    },
    status: 'closed',
    transaction:
    {
      Account: dummyAccount.xrpAddress,
      Amount: '1000000',
      Destination: 'r3kmLJN5D28dHuH8vZNUZpMC43pEHpaocV',
      Fee: '12',
      Flags: 2147483648,
      LastLedgerSequence: 19969017,
      Memos: [[Object]],
      Sequence: 6,
      SigningPubKey:
        '03D9C20FF1ACF714D2E4CBD05C6FDC74B43BAD4FBED2C75B8E4EC3C225510D20BC',
      TransactionType: 'Payment',
      TxnSignature:
        '3045022100DEAD4352BE7F2D3A5C7E690EEB51858C4BBDBE3E4DA453D1807500E48DB3C790022079AFFE756E4EDEFB9D033F8FBC8B4D078AD9552FD5F8F807861F39B32A1CCFEC',
      date: 613056822,
      hash:
        '57C3FB183A2A5602D922288FD6F372188E2584B6740640EED664B4B1C1918B2B'
    },
    type: 'transaction',
    validated: true
  }

  beforeEach(async () => {
    redis = new Redis()
    rippleApi = new RippleAPI()
    mockttp = getLocal()
    await mockttp.start(7777)
    eventEmitter = new EventEmitter()

    sinon.stub(rippleApi, 'connect').callsFake(() => Promise.resolve())
    sinon.stub(rippleApi, 'disconnect').callsFake(() => Promise.resolve())
    sinon.stub(rippleApi, 'request').callsFake(() => Promise.resolve())

    engine = new XrpSettlementEngine({
      address: 'r3kmLJN5D28dHuH8vZNUZpMC43pEHpaocV',
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

  describe('Incoming Settlements from ledger', function() {
    
    it('Notifies connector of incoming settlement', async () => {
      const mockendpoint = await mockttp.post(`/accounts/${dummyAccount.id}/settlement`).thenReply(200)
      await redis.set(`xrp:accounts:${dummyAccount.id}`, JSON.stringify(dummyAccount))
      await redis.set(`xrp:xrpAddress:${dummyAccount.xrpAddress}:accountId`, dummyAccount.id)

      rippleApi.connection.emit('transaction', transaction)
      await new Promise(resolve => setTimeout(resolve, 50))

      const requests = await mockendpoint.getSeenRequests()
      assert.strictEqual(requests.length, 1)
      const request = requests[0]
      assert.deepEqual(request.body.json, {
        amount: '1000000',
        scale: 6
      })

    })
  })

  describe('Outgoing Settlements from connector', function() {
    
    it('Attempts to start sending own config to counterparty one account creation', async () => {
      await redis.set(`xrp:accounts:${dummyAccount.id}`, JSON.stringify(dummyAccount))
      await redis.set(`xrp:xrpAddress:${dummyAccount.xrpAddress}:accountId`, dummyAccount.id)

      const response = await axios.post(`http://localhost:3000/accounts/${dummyAccount.id}/settlement`, {
        amount: '5000000000',
        scale: 9
      })

      assert.strictEqual(response.status, 200)
    })
  })
})
