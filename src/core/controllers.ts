import debug from 'debug'
import { RequestHandler, Dictionary } from 'express-serve-static-core'
import { AccountServices, SettlementEngine } from '.'
import { isSafeKey, SafeKey, SettlementStore } from './store'
import { fromQuantity, isQuantity } from './utils/quantity'
import uuid from 'uuid/v4'
import BigNumber from 'bignumber.js'

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
  setupAccount: RequestHandler
  validateAccount: RequestHandler
  settleAccount: RequestHandler<AccountParams>
  handleMessage: RequestHandler<AccountParams>
  deleteAccount: RequestHandler<AccountParams>
}

export const createController = ({ store, engine, services }: Context): SettlementController => ({
  setupAccount: async (req, res) => {
    const accountId = req.body.id || uuid() // Create account ID if none was provided
    if (!isSafeKey(accountId)) {
      return res.status(400).send('Account ID includes unsafe characters')
    }

    try {
      await store.createAccount(accountId)
    } catch (err) {
      log(`Failed to setup account: account=${accountId}`, err)
      return res.sendStatus(500)
    }

    if (engine.setup) {
      try {
        await engine.setup(accountId) // TODO Is it safe if this is called multiple times?
      } catch (err) {
        log(`Failed to setup account: account=${accountId}`, err)
        return res.sendStatus(500)
      }
    }

    res.status(201).send({
      id: accountId
    })
  },

  validateAccount: async (req, res, next) => {
    const accountId = req.params.id
    if (!isSafeKey(accountId)) {
      return res.status(400).send('Account ID is missing or includes unsafe characters')
    }

    const accountExists = await store.isExistingAccount(accountId)
    return !accountExists ? res.status(404).send(`Account doesn't exist`) : next()
  },

  settleAccount: async (req, res) => {
    const accountId = req.params.id
    let details = `account=${accountId}`

    const idempotencyKey = req.get('Idempotency-Key')
    if (!isSafeKey(idempotencyKey)) {
      log(`Request to settle failed: idempotency key missing or unsafe: ${details}`)
      return res.status(400).send('Idempotency key missing or includes unsafe characters')
    }

    details += ` idempotencyKey=${idempotencyKey}`

    const requestQuantity = req.body
    if (!isQuantity(requestQuantity)) {
      log(`Request to settle failed: invalid quantity: ${details}`)
      return res.status(400).send('Quantity to settle is invalid')
    }

    const amountToQueue = fromQuantity(requestQuantity)
    details += ` amount=${amountToQueue}`

    if (amountToQueue.isZero()) {
      log(`Request to settle failed: amount is 0: ${details}`)
      return res.status(400).send('Amount to settle is 0')
    }

    let amountQueued: BigNumber
    try {
      amountQueued = await store.queueSettlement(accountId, idempotencyKey, amountToQueue)
    } catch (err) {
      log(`Error: Failed to queue settlement: ${details}`, err)
      return res.sendStatus(500)
    }

    // If the cached amount for that idempotency key is not the same... the client likely sent
    // a request with the same idempotency key, but a different amount
    if (!amountToQueue.isEqualTo(amountQueued)) {
      log(
        `Request to settle failed: client reused idempotency key: ${details} previousAmount=${amountQueued}`
      )
      return res.status(400).send('Idempotency key was reused with a different amount')
    }

    // Instead of refunding amounts too precise, track those amounts locally, and always
    // respond that the full amount was queued for settlement
    res.status(201).send(requestQuantity)

    // Attempt to perform a settlement
    services.trySettlement(accountId)
  },

  handleMessage: async (req, res) => {
    const accountId = req.params.id

    if (!engine.handle) {
      log(`Received incoming message that settlement engine cannot handle: account=${accountId}`)
      return res.status(400).send('Settlement engine does not support incoming messages')
    }

    try {
      const response = await engine.handle(accountId, req.body)
      const rawResponse = Buffer.from(JSON.stringify(response))
      res.status(201).send(rawResponse)
    } catch (err) {
      log(`Error while handling message: account=${accountId}`, err)
      res.sendStatus(500)
    }
  },

  deleteAccount: async (req, res) => {
    const accountId = req.params.id

    try {
      if (engine.close) {
        await engine.close(accountId)
      }

      await store.deleteAccount(accountId)
      res.sendStatus(204)
    } catch (err) {
      log(`Failed to delete account: account=${accountId}`, err)
      res.sendStatus(500)
    }
  }
})
