import axios from 'axios'
import { BigNumber } from 'bignumber.js'
import bodyParser from 'body-parser'
import debug from 'debug'
import express from 'express'
import uuid from 'uuid/v4'
import { createController } from './controllers'
import { isSafeKey, SettlementStore } from './store'
import { fromQuantity, isQuantity, isValidAmount } from './utils/quantity'
import { retryRequest } from './utils/retry'

/**
 * Settlement system -specific functionality that each settlement engine
 * implementation must implement in order to send and receive payments with peers
 */
export interface SettlementEngine {
  /**
   * Setup the given account and perform tasks as a pre-requisite to send settlements
   * - For example, send a message to the peer to exchange ledger identifiers
   *
   * @param accountId Unique account identifier
   */
  setupAccount?(accountId: string): Promise<void>

  /**
   * Send a settlement to the peer for up to the given amount
   * - Since the amount is provided in arbitrary precision, round to the correct
   *   precision first
   * - The leftover, unsettled amount will automatically be tracked and retried later
   *   based on the amount returned
   * - If Promise is rejected, for safety, the full amount will assumed to be settled,
   *   so ensure all rejections are handled accordingly
   *
   * @param accountId Unique account identifier
   * @param amount Maximum amount to settle, in standard unit of asset (arbitrary precision)
   * @return Amount settled, in standard unit of asset (arbitrary precision)
   */
  settle(accountId: string, amount: BigNumber): Promise<BigNumber>

  /**
   * Handle and respond to an incoming message from the given peer
   *
   * @param accountId Unique account identifier
   * @param message Parsed JSON message from peer
   * @return Response message, to be serialized as JSON
   */
  handleMessage?(accountId: string, message: any): Promise<any>

  /**
   * Delete or close the given account
   * - For example, clean up database records associated with the account
   *
   * @param accountId Unique account identifier
   */
  closeAccount?(accountId: string): Promise<void>

  /**
   * Disconnect the settlement engine
   * - For example, gracefully closes connections to the ledger and/or databases
   */
  disconnect?(): Promise<void>
}

/**
 * Callbacks provided to each settlement engine
 */
export interface AccountServices {
  /**
   * Send a message to the given account and return their response
   *
   * @param accountId Unique account identifier to send message to
   * @param message Object to be serialized as JSON
   */
  sendMessage(accountId: string, message: any): Promise<any>

  /**
   * Send a notification to the connector to credit the given incoming settlement
   *
   * @param accountId Unique account identifier (recipient of settlement)
   * @param amount Amount received as an incoming settlement
   * @param settlementId Unique dentifier for this settlement derived from a cryptographically secure source of randomness
   */
  creditSettlement(accountId: string, amount: BigNumber, settlementId?: string): void

  /**
   * Retry failed or queued outgoing settlements
   * - Automatically called after the settlement engine is instantiated
   *
   * @param accountId Unique account identifier
   */
  trySettlement(accountId: string): void
}

/** Connect and instantiate the settlement engine */
export type ConnectSettlementEngine<TEngine extends SettlementEngine> = (
  services: AccountServices
) => Promise<TEngine>

const log = debug('settlement-core')

export interface SettlementServerConfig {
  connectorUrl?: string
  sendMessageUrl?: string
  creditSettlementUrl?: string
  port?: string | number
}

export interface SettlementServer {
  engine: SettlementEngine

  /** TODO document */
  shutdown(): Promise<void>
}

export const startServer = async <TEngine extends SettlementEngine>(
  createEngine: ConnectSettlementEngine<TEngine>,
  store: SettlementStore,
  config: SettlementServerConfig = {}
): Promise<SettlementServer> => {
  const connectorUrl = config.connectorUrl || 'http://localhost:7771'

  const sendMessageUrl = config.sendMessageUrl || connectorUrl
  const creditSettlementUrl = config.creditSettlementUrl || connectorUrl

  const port = config.port ? +config.port : 3000

  // Create the context passed to the settlement engine
  const services: AccountServices = {
    sendMessage: async (accountId, message) => {
      if (!isSafeKey(accountId)) {
        throw new Error(`Failed to send message: Invalid account: account=${accountId}`)
      }

      const accountExists = await store.isExistingAccount(accountId)
      if (!accountExists) {
        throw new Error(`Failed to send message: Account doesn't exist: account=${accountId}`)
      }

      const url = `${sendMessageUrl}/accounts/${accountId}/messages`
      return axios
        .post(url, Buffer.from(JSON.stringify(message)), {
          timeout: 10000,
          headers: {
            'Content-type': 'application/octet-stream'
          }
        })
        .then(response => response.data)
    },

    creditSettlement: async (accountId, amount, settlementId = uuid()) => {
      let details = `amountToCredit=${amount} account=${accountId} settlementId=${settlementId}`

      if (amount.isZero()) {
        return
      }

      if (!isValidAmount(amount)) {
        return log(`Error: Failed to credit settlement, invalid amount: ${details}`)
      }

      if (!isSafeKey(accountId)) {
        return log(`Error: Failed to credit settlement, invalid account: ${details}`)
      }

      const accountExists = await store.isExistingAccount(accountId)
      if (!accountExists) {
        return log(`Error: Failed to credit settlement, account doesn't exist: ${details}`)
      }

      // Load all uncredited settlement amounts from Redis
      const uncreditedAmounts = await store
        .loadAmountToCredit(accountId)
        .then(amount => {
          if (!isValidAmount(amount)) {
            throw new Error('Invalid uncredited amounts, database may be corrupted')
          }

          return amount
        })
        .catch(err => {
          log(`Error: Failed to load uncredited settlement amounts: account=${accountId}`, err)
          return new BigNumber(0)
        })

      if (uncreditedAmounts.isGreaterThan(0)) {
        log(`Loaded uncredited amount of ${uncreditedAmounts} to retry notifying connector`)
      }

      const amountToCredit = amount.plus(uncreditedAmounts)

      // amountToCredit must be positive and finite due to validation on amount & uncreditedAmounts
      // ...so this Quantity should always be valid
      const scale = amountToCredit.decimalPlaces()
      const quantityToCredit = {
        scale,
        amount: amountToCredit.shiftedBy(scale).toFixed(0) // `toFixed` always uses normal (not exponential) notation
      }

      const notifySettlement = () =>
        axios({
          method: 'POST',
          url: `${creditSettlementUrl}/accounts/${accountId}/settlements`,
          data: quantityToCredit,
          timeout: 10000,
          headers: {
            'Idempotency-Key': settlementId
          }
        })

      details = `amountToCredit=${amountToCredit} account=${accountId} settlementId=${settlementId}`
      log(`Notifying connector to credit settlement: ${details}`)

      const amountCredited = await retryRequest(notifySettlement)
        .then(response => {
          if (isQuantity(response.data)) {
            return fromQuantity(response.data)
          }

          log(`Error: Connector failed to process settlement: ${details}`)
          return new BigNumber(0)
        })
        .catch(err => {
          if (err.response && isQuantity(err.response.data)) {
            return fromQuantity(err.response.data)
          }

          log(`Error: Failed to credit incoming settlement: ${details}`, err)
          return new BigNumber(0)
        })

      const leftoverAmount = amountToCredit.minus(amountCredited)
      details = `leftover=${leftoverAmount} credited=${amountCredited} amountToCredit=${amountToCredit} account=${accountId} settlementId=${settlementId}`

      // Protects against saving `NaN` or `Infinity` to the database
      if (!isValidAmount(leftoverAmount)) {
        return log(`Error: Connector credited invalid amount: ${details}`)
      }

      log(`Connector credited incoming settlement: ${details}`)

      // Don't save 0 amounts to the database
      if (leftoverAmount.isZero()) {
        return
      }

      // Refund the leftover amount to retry later
      await store
        .saveAmountToCredit(accountId, leftoverAmount)
        .catch(err =>
          log(`Error: Failed to save uncredited settlement, balances incorrect: ${details}`, err)
        )
    },

    trySettlement: async accountId => {
      let details = `account=${accountId}`

      if (!engine) {
        return log(`Error: Engine must be connected before triggering settlment: ${details}`)
      }

      if (!isSafeKey(accountId)) {
        return log(`Error: Failed to settle, invalid account: ${details}`)
      }

      const amountToSettle = await store
        .loadAmountToSettle(accountId)
        .then(queuedAmount => {
          if (!isValidAmount(queuedAmount)) {
            throw new Error('Invalid queued settlement amounts, database may be corrupted')
          }

          return queuedAmount
        })
        .catch(err => {
          log(`Error: Failed to load amount queued for settlement: ${details}`, err)
          return new BigNumber(0)
        })

      if (amountToSettle.isZero()) {
        return
      }

      const amountSettled = await engine.settle(accountId, amountToSettle).catch(err => {
        log(`Settlement failed: amountToSettle=${amountToSettle} ${details}`, err)
        return amountToSettle // For safety, assume the full settlement was performed
      })

      const leftoverAmount = amountToSettle.minus(amountSettled)
      details = `leftover=${leftoverAmount} settled=${amountSettled} amountToSettle=${amountToSettle} account=${accountId}`

      if (!isValidAmount(amountSettled)) {
        return log(`Error: Invalid settlement outcome: ${details}`)
      }

      // Protects against saving `NaN` or `Infinity` to the database
      if (!isValidAmount(leftoverAmount)) {
        return log(`Error: Settled too much: ${details}`)
      }

      log(`Settlement completed: ${details}`)

      // Don't save 0 amounts to the database
      if (leftoverAmount.isZero()) {
        return
      }

      await store
        .saveAmountToSettle(accountId, leftoverAmount)
        .catch(err =>
          log(`Error: Failed to save unsettled amount, balances incorrect: ${details}`, err)
        )
    }
  }

  const engine = await createEngine(services)

  const {
    validateAccount,
    setupAccount,
    deleteAccount,
    settleAccount,
    handleMessage
  } = createController({
    engine,
    store,
    services
  })

  const app = express()

  app.post('/accounts', bodyParser.json(), setupAccount)
  app.delete('/accounts/:id', validateAccount, deleteAccount)
  app.post('/accounts/:id/settlements', bodyParser.json(), validateAccount, settleAccount)
  app.post('/accounts/:id/messages', bodyParser.raw(), validateAccount, handleMessage)

  // TODO Lookup all accounts with owed settlements and retry them
  // TODO Lookup all accounts with uncredited settlements and retry them

  const server = app.listen(port)
  log('Started settlement engine server')

  return {
    engine,

    async shutdown() {
      await new Promise(resolve => server.close(resolve))

      /**
       * TODO How should awaiting pending settlements be implemented?
       * Could be implemented within individual SEs, *but* that wouldn't work for refunding the leftovers
       */

      if (engine.disconnect) {
        await engine.disconnect()
      }
    }
  }
}
