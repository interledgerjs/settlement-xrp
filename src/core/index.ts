import axios from 'axios'
import { BigNumber } from 'bignumber.js'
import bodyParser from 'body-parser'
import debug from 'debug'
import express from 'express'
import { promisify } from 'util'
import { v4 as uuid } from 'uuid'
import {
  Context,
  deleteAccount,
  handleMessage,
  settleAccount,
  setupAccount,
  validateAccount
} from './controllers'
import { SettlementStore } from './store'
import { convertFromQuantity, convertToQuantity, isQuantity, retryRequest } from './utils'

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
  setup?(accountId: string): Promise<void>

  /**
   * Send a settlement to the peer for up to the given amount
   * - Since the amount is provided in arbitrary precision, round to the correct
   *   precision first
   * - The leftover, unsettled amount will automatically be tracked and retried later
   *   based on the amount returned
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
  handle?(accountId: string, message: any): Promise<any>

  /**
   * Delete or close the given account
   * - For example, clean up database records associated with the account
   *
   * @param accountId Unique account identifier
   */
  close?(accountId: string): Promise<void>

  /**
   * Disconnects the settlement engine
   * - For example, gracefully closes connections to the ledger and/or databases
   */
  disconnect?(): Promise<void>
}

// TODO add other docs here

/**
 * Callbacks provided to each settlement engine
 */
export interface AccountServices {
  sendMessage(accountId: string, message: any): Promise<any>

  creditSettlement(accountId: string, amount: BigNumber, settlementId?: string): void

  trySettlement(accountId: string, settle: (amount: BigNumber) => Promise<BigNumber>): void
}

export type ConnectSettlementEngine = (services: AccountServices) => Promise<SettlementEngine>

const log = debug('settlement-core')

export interface SettlementServerConfig {
  connectorUrl?: string
  sendMessageUrl?: string
  creditSettlementUrl?: string
  port?: number
}

export interface SettlementServer {
  shutdown(): Promise<void>
}

export const startServer = async (
  createEngine: ConnectSettlementEngine,
  store: SettlementStore,
  config: SettlementServerConfig
): Promise<SettlementServer> => {
  const connectorUrl = config.connectorUrl || 'http://localhost:7771'

  const sendMessageUrl = config.sendMessageUrl || connectorUrl
  const creditSettlementUrl = config.creditSettlementUrl || connectorUrl

  const port = config.port || 3000

  // Store reference to pending incoming/outgoing settlement tasks to prevent money
  // from being lost during shutdown
  let pendingIncomingSettlement = Promise.resolve()
  let pendingOutgoingSettlement = Promise.resolve()

  // TODO Add background task to clear idempotency keys? Or should that be a DB responsibility?

  // Create the context passed to the settlement engine
  const services: AccountServices = {
    sendMessage: async (accountId, message) => {
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

    // TODO Should this save the outgoing idempotency key to the DB with request state so it may be retried (and not lost)?

    creditSettlement: (accountId, amount, settlementId) => {
      pendingIncomingSettlement = pendingIncomingSettlement.finally(async () => {
        const accountExists = await store.isExistingAccount(accountId)
        if (!accountExists) {
          // TODO Should it log here?
          return
        }

        // Load all uncredited settlement amounts from Redis
        const uncreditedAmounts = await store.loadAmountToCredit(accountId).catch(err => {
          log(`Error: Failed to load uncredited incoming settlements to retry:`, err)
          return new BigNumber(0)
        })

        // TODO ^ should that add a log on success, too?

        const amountToCredit = amount.plus(uncreditedAmounts)
        const quantityToCredit = convertToQuantity(amountToCredit)

        const idempotencyKey = settlementId || uuid()
        const details = `account=${accountId} id=${idempotencyKey} amount=${amountToCredit}`

        // TODO Add "sending notification log here?"

        const notifySettlement = () =>
          axios.post(`${creditSettlementUrl}/accounts/${accountId}/settlements`, {
            data: quantityToCredit,
            timeout: 10000,
            headers: {
              'Idempotency-Key': idempotencyKey
            }
          })

        const amountCredited = await retryRequest(notifySettlement)
          .then(response => {
            if (isQuantity(response.data)) {
              return convertFromQuantity(response.data)
            }

            log(`Error: Connector failed to process settlement: ${details}`)
            return new BigNumber(0)
          })
          .catch(err => {
            if (err.response && isQuantity(err.response.data)) {
              return convertFromQuantity(err.response.data)
            }

            log(`Error: Failed to credit incoming settlement: ${details}`, err)
            return new BigNumber(0)
          })

        const leftoverAmount = amountToCredit.minus(amountCredited)
        if (leftoverAmount.isLessThan(0)) {
          return log(`Error: Connector credited too much: ${details} credited=${amountCredited}`)
        } else if (leftoverAmount.isZero()) {
          return log(`Connector credited full settlement: ${details}`)
        }

        // Refund the leftover amount
        await store
          .saveAmountToCredit(accountId, leftoverAmount)
          .then(() =>
            log(`Saved uncredited incoming settlement: ${details} leftover=${leftoverAmount}`)
          )
          .catch(err =>
            log(`Error: Failed to save uncredited settlement, balances incorrect: ${details}`, err)
          )
      })
    },

    trySettlement: (accountId: string, settle: (amount: BigNumber) => Promise<BigNumber>) => {
      pendingOutgoingSettlement = pendingOutgoingSettlement.finally(async () => {
        const amountToSettle = await store.loadAmountToSettle(accountId) // TODO catch errors -- handle weird things
        const amountSettled = await settle(amountToSettle).catch((err: Error) => {
          log(
            `Error performing outgoing settlement for account ${accountId} for ${amountToSettle}, balances incorrect:`,
            err
          ) // TODO simplify this log
          return amountToSettle // For safety, assume a settlement for the full amount was performed
        })

        const unsettledAmount = amountToSettle.minus(amountSettled)
        if (unsettledAmount.isLessThanOrEqualTo(0)) {
          // TODO Log that the SE implementation f-ed up
          return
        }

        await store
          .saveAmountToSettle(accountId, unsettledAmount)
          .catch((err: Error) =>
            log(
              `Failed to save failed outgoing settlements for account ${accountId} of ${unsettledAmount}, balances are out-of-sync:`,
              err
            )
          )
      })
    }
  }

  const engine = await createEngine(services)

  const context: Context = {
    engine,
    store,
    services
  }

  const app = express()

  app.put('/accounts/:id', setupAccount(context))
  app.delete('/accounts/:id', deleteAccount(context))

  app.post(
    '/accounts/:id/settlements',
    bodyParser.json(),
    validateAccount(context),
    settleAccount(context)
  )

  app.post(
    '/accounts/:id/messages',
    bodyParser.raw(),
    validateAccount(context),
    handleMessage(context)
  )

  const server = app.listen(port)

  return {
    async shutdown() {
      await promisify(server.close)()

      await pendingIncomingSettlement
      await pendingOutgoingSettlement // TODO What if settlement takes a long time...? (Timeout?)

      // TODO await pending message handlers, too?

      if (engine.disconnect) {
        await engine.disconnect()
      }
    }
  }
}
