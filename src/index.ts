import * as Koa from 'koa'
import * as Router from 'koa-router'
import * as bodyParser from 'koa-bodyparser'
import { Redis } from 'ioredis'
import { RippleAPI } from 'ripple-lib'
import { Server } from 'net'
import { create as createAccount, show as showAccount, destroy as destroyAccount } from './controllers/accountsController'
import axios from 'axios'
import { BigNumber } from 'bignumber.js'
import Debug from 'debug'
import { create as createAccountMessage } from './controllers/accountsMessagesController'
import { create as createAccountSettlement } from './controllers/accountsSettlementController'
const debug = Debug('xrp-settlement-engine')
import { Account } from './models/account'

const DEFAULT_SETTLEMENT_ENGINE_PREFIX = 'xrp'
const DEFAULT_MIN_DROPS_TO_SETTLE = 10000

/**
 *
 */
export interface XrpSettlementEngineConfig {
  /** Ledger address */
  address: string,
  /** Ledger Secret */
  secret: string,
  /** Ledger Asset Scale */
  assetScale: number,
  /** Prefix for scoping storage in redis */
  enginePrefix?: string,
  /** Redis Instance */
  redis: Redis

  /** Port to run http api on */
  port?: number,
  connectorUrl: string,

  /** rippledURl and Client (Makes testing easier by mocking rippled) */
  rippledClient?: RippleAPI,
  rippledUri?: string,
  minDropsToSettle?: number
}

export class XrpSettlementEngine {
  app: Koa
  router: Router
  server: Server
  redis: Redis
  rippleClient: RippleAPI
  minDropsToSettle: number

  enginePrefix: string
  address: string
  secret: string
  assetScale: number

  port: number
  connectorUrl: string

  constructor (config: XrpSettlementEngineConfig) {
    this.app = new Koa()
    this.app.use(async (ctx, next) => {
      if (ctx.path.includes('messages')) ctx.disableBodyParser = true
      await next()
    })
    this.app.use(bodyParser())

    this.address = config.address
    this.secret = config.secret
    this.assetScale = config.assetScale

    this.redis = config.redis
    this.enginePrefix = config.enginePrefix ? config.enginePrefix : DEFAULT_SETTLEMENT_ENGINE_PREFIX
    this.port = config.port ? config.port : 3000
    this.connectorUrl = config.connectorUrl
    this.rippleClient = config.rippledClient ? config.rippledClient : new RippleAPI({
      server: config.rippledUri || 'wss://s.altnet.rippletest.net:51233'
    })
    this.minDropsToSettle = config.minDropsToSettle || DEFAULT_MIN_DROPS_TO_SETTLE

    // Add redis to context
    this.app.context.redis = this.redis
    this.app.context.settlement_prefix = DEFAULT_SETTLEMENT_ENGINE_PREFIX
    this.app.context.configAccount = this.configAccount.bind(this)
    this.app.context.settleAccount = this.settleAccount.bind(this)

    this.router = new Router()
    this.setupRoutes()

    this.app.use(this.router.routes())
  }

  public async start () {
    this.server = this.app.listen(this.port)
    await this.rippleClient.connect()
    await this.subscribeToTransactions()
  }

  public async shutdown () {
    await Promise.all([
      this.server.close(),
      this.rippleClient.disconnect()
    ])
  }

  private setupRoutes () {
    this.router.post('/accounts', (ctx) => createAccount(ctx, this.redis))
    this.router.get('/accounts/:id', (ctx) => showAccount(ctx, this.redis))
    this.router.delete('/accounts/:id', (ctx) => destroyAccount(ctx, this.redis))

    // Account Messages
    this.router.post('/accounts/:id/messages', this.findAccountMiddleware, createAccountMessage)

    // Account Settlements
    this.router.post('/accounts/:id/settlement', this.findAccountMiddleware , createAccountSettlement)
  }

  private async subscribeToTransactions () {
    this.rippleClient.connection.on('transaction', this.handleTransaction.bind(this))
    await this.rippleClient.request('subscribe', {
      accounts: [this.address]
    })
  }

  /** Should be triggered based on  */
  async settleAccount (account: Account, drops: string) {
    debug(`Attempting to send ${drops} XRP drops to account: ${account.id} (XRP address: ${account.xrpAddress})`)
    try {
      const payment = await this.rippleClient.preparePayment(this.address, {
        source: {
          address: this.address,
          amount: {
            value: '' + drops,
            currency: 'drops'
          }
        },
        destination: {
          address: account.xrpAddress || '',
          minAmount: {
            value: '' + drops,
            currency: 'drops'
          }
        }
      }, {
          // TODO add max fee
        maxLedgerVersionOffset: 5
      })
      const { signedTransaction } = this.rippleClient.sign(payment.txJSON, this.secret)
      const result = await this.rippleClient.submit(signedTransaction)
      if (result.resultCode === 'tesSUCCESS') {
        debug(`Sent ${drops} drop payment to account: ${account} (xrpAddress: ${account.xrpAddress})`)
      }
    } catch (err) {
      console.error(`Error preparing and submitting payment to rippled. Settlement to account: ${account} (xrpAddress: ${account.xrpAddress}) for ${drops} drops failed:`, err)
    }
  }

  async findAccountMiddleware (ctx: Koa.Context, next: () => Promise<any>) {
    const account = await ctx.redis.get(`${ctx.settlement_prefix}:accounts:${ctx.params.id}`)
    if (account) {
      ctx.account = JSON.parse(account)
    } else {
      ctx.throw(404)
    }
    await next()
  }

  async configAccount (accountId: string) {
    const url = `${this.connectorUrl}\\accounts\\${accountId}\\messages`
    const message = {
      type: 'config',
      data: {
        xrpAddress: this.address
      }
    }
    await axios.post(url, Buffer.from(JSON.stringify(message)), {
      timeout: 10000,
      headers: {
        'Content-type': 'application/octet-stream'
      }
    }).then(response => {
      console.log('Config successful for account:\t', accountId)
      // TODO add logic to set the account to ready state
    }).catch(error => {
      console.log('Error attempting to send account config, attemping again in 5000ms', error)
      // need to add retry logic and store the underlaying setTimeout to be able to cancel it
      const retryTimeout = setTimeout(() => this.configAccount(accountId), 5000)

      retryTimeout.unref()
    })
  }

  async notifySettlement (accountId: string, amount: string) {
    const url = `${this.connectorUrl}\\accounts\\${accountId}\\settlement`
    const message = {
      amount,
      scale: 6
    }
    await axios.post(url, message, {
      timeout: 10000
    }).then(response => {
      // TODO add logic to set the account to ready state
    }).catch(error => {
      console.log('error notifying settlement', error)
      // need to add retry logic and store the underlaying setTimeout to be able to cancel it

    })
  }

  /**
   * Handle incoming transaction from the ledger
   */
  private async handleTransaction (tx: any) {
    if (!tx.validated || tx.meta.TransactionResult !== 'tesSUCCESS' || tx.transaction.TransactionType !== 'Payment' || tx.transaction.Destination !== this.address) {
      return
    }
    console.log('validated')

    // Parse amount received from transaction
    let drops
    try {
      if (tx.meta.delivered_amount) {
        drops = new BigNumber(tx.meta.delivered_amount)
      } else {
        drops = new BigNumber(tx.transaction.Amount)
      }
    } catch (err) {
      console.error('Error parsing amount received from transaction: ', tx)
      return
    }

    const fromAddress = tx.transaction.Account
    console.log(`Got incoming XRP payment for ${drops} drops from XRP address: ${fromAddress}`)

    try {
      // TODO: Determine who the balance came from
      const accountId = await this.redis.get(`${DEFAULT_SETTLEMENT_ENGINE_PREFIX}:xrpAddress:${fromAddress}:accountId`)
      const accountJSON = await this.redis.get(`${DEFAULT_SETTLEMENT_ENGINE_PREFIX}:accounts:${accountId}`)
      if (accountJSON) {
        const account = JSON.parse(accountJSON)
        await this.notifySettlement(account.id, drops.toString())
        debug(`Credited account: ${account} for incoming settlement, balance is now: ${drops.toString()}`)
      }
    } catch (err) {
      if (err.message.includes('No account associated')) {
        debug(`No account associated with address: ${fromAddress}, adding ${drops} to that address' unclaimed balance`)
      } else {
        debug('Error crediting account: ', err)
        console.warn('Got incoming payment from an unknown account: ', JSON.stringify(tx))
      }
    }
  }
}
