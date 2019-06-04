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
    "id": 6,
    "status": "success",
    "type": "response",
    "result": {
      "Account": dummyAccount.xrpAddress,
      "Amount": "1000000",
      "Destination": 'string',
      "Fee": "10",
      "Flags": 2147483648,
      "Sequence": 2,
      "SigningPubKey": "03AB40A0490F9B7ED8DF29D246BF2D6269820A0EE7742ACDD457BEA7C7D0931EDB",
      "TransactionType": "Payment",
      "TxnSignature": "3045022100D64A32A506B86E880480CCB846EFA3F9665C9B11FDCA35D7124F53C486CC1D0402206EC8663308D91C928D1FDA498C3A2F8DD105211B9D90F4ECFD75172BAE733340",
      "date": 455224610,
      "hash": "33EA42FC7A06F062A7B843AF4DC7C0AB00D6644DFDF4C5D354A87C035813D321",
      "inLedger": 7013674,
      "ledger_index": 7013674,
      "meta": {
        "AffectedNodes": [
          {
            "ModifiedNode": {
              "FinalFields": {
                "Account": "rf1BiGeXwwQoi8Z2ueFYTEXSwuJYfV2Jpn",
                "Balance": "99999980",
                "Flags": 0,
                "OwnerCount": 0,
                "Sequence": 3
              },
              "LedgerEntryType": "AccountRoot",
              "LedgerIndex": "13F1A95D7AAB7108D5CE7EEAF504B2894B8C674E6D68499076441C4837282BF8",
              "PreviousFields": {
                "Balance": "99999990",
                "Sequence": 2
              },
              "PreviousTxnID": "7BF105CFE4EFE78ADB63FE4E03A851440551FE189FD4B51CAAD9279C9F534F0E",
              "PreviousTxnLgrSeq": 6979192
            }
          },
          {
            "ModifiedNode": {
              "FinalFields": {
                "Balance": {
                  "currency": "USD",
                  "issuer": "rrrrrrrrrrrrrrrrrrrrBZbvji",
                  "value": "2"
                },
                "Flags": 65536,
                "HighLimit": {
                  "currency": "USD",
                  "issuer": "rf1BiGeXwwQoi8Z2ueFYTEXSwuJYfV2Jpn",
                  "value": "0"
                },
                "HighNode": "0000000000000000",
                "LowLimit": {
                  "currency": "USD",
                  "issuer": "ra5nK24KXen9AHvsdFTKHSANinZseWnPcX",
                  "value": "100"
                },
                "LowNode": "0000000000000000"
              },
              "LedgerEntryType": "RippleState",
              "LedgerIndex": "96D2F43BA7AE7193EC59E5E7DDB26A9D786AB1F7C580E030E7D2FF5233DA01E9",
              "PreviousFields": {
                "Balance": {
                  "currency": "USD",
                  "issuer": "rrrrrrrrrrrrrrrrrrrrBZbvji",
                  "value": "1"
                }
              },
              "PreviousTxnID": "7BF105CFE4EFE78ADB63FE4E03A851440551FE189FD4B51CAAD9279C9F534F0E",
              "PreviousTxnLgrSeq": 6979192
            }
          }
        ],
        "TransactionIndex": 0,
        "TransactionResult": "tesSUCCESS"
      },
      "validated": true
    }
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
