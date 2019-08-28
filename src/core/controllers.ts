import debug from 'debug'
import { RequestHandler, Dictionary } from 'express-serve-static-core'
import { AccountServices, SettlementEngine } from '.'
import { isSafeKey, SafeKey, SettlementStore } from './store'
import { fromQuantity, isQuantity } from './utils/quantity'

const log = debug('settlement-core')

export interface Context {
  services: AccountServices
  engine: SettlementEngine
  store: SettlementStore
}

interface AccountParams extends Dictionary<string> {
  id: SafeKey
}

interface SettlementController {
  validateAccount: RequestHandler
  isExistingAccount: RequestHandler<AccountParams>
  setupAccount: RequestHandler<AccountParams>
  settleAccount: RequestHandler<AccountParams>
  handleMessage: RequestHandler<AccountParams>
  deleteAccount: RequestHandler<AccountParams>
}

export const createController = ({ store, engine, services }: Context): SettlementController => ({
  validateAccount: (req, res, next) => {
    return !isSafeKey(req.params.id)
      ? res.status(400).send('Account ID is missing or includes unsafe characters')
      : next()
  },

  isExistingAccount: async (req, res, next) => {
    const accountId = req.params.id
    const accountExists = await store.isExistingAccount(accountId)
    return !accountExists ? res.status(404).send(`Account doesn't exist`) : next()
  },

  setupAccount: async (req, res) => {
    const accountId = req.params.id
    await store.createAccount(accountId)

    if (engine.setup) {
      await engine.setup(accountId)
    }

    res.sendStatus(201)
  },

  settleAccount: async (req, res) => {
    const accountId = req.params.id

    const idempotencyKey = req.get('Idempotency-Key')
    if (!isSafeKey(idempotencyKey)) {
      log('Request to settle failed: invalid idempotency key')
      return res.status(400).send('Idempotency key is missing or includes unsafe characters')
    }

    const requestQuantity = req.body
    if (!isQuantity(requestQuantity)) {
      log('Request to settle failed: invalid quantity')
      return res.status(400).send('Quantity to settle is invalid')
    }

    const amountToQueue = fromQuantity(requestQuantity)
    if (amountToQueue.isZero()) {
      log('Request to settle failed: amount is 0')
      return res.status(400).send('Quantity to settle was 0')
    }

    const amountQueued = await store.queueSettlement(accountId, idempotencyKey, amountToQueue)

    // If the cached amount for that idempotency key is not the same... the client likely sent
    // a request with the same idempotency key, but a different amount
    if (!amountToQueue.isEqualTo(amountQueued)) {
      log('Request to settle failed: client reused idempotency key with a different amount')
      return res.status(400).send('Idempotency key was reused with a different amount')
    }

    // Instead of refunding amounts too precise, track those amounts locally, and always
    // respond that the full amount was queued for settlement
    res.status(201).send(requestQuantity)

    // Attempt to perform a settlement
    services.trySettlement(accountId)
  },

  handleMessage: async (req, res) => {
    if (!engine.handle) {
      return res.status(400).send('Settlement engine does not support incoming messages')
    }

    const accountId = req.params.id
    const message = JSON.parse(req.body.toString())

    const response = await engine.handle(accountId, message)
    const rawResponse = Buffer.from(JSON.stringify(response))
    res.status(201).send(rawResponse)
  },

  deleteAccount: async (req, res) => {
    const accountId = req.params.id

    if (engine.close) {
      await engine.close(accountId)
    }

    await store.deleteAccount(accountId)
    res.sendStatus(204)
  }
})
