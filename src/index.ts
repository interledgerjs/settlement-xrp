import * as Koa from 'koa';
import * as Router from 'koa-router';
import * as bodyParser from 'koa-bodyparser';
import { Redis } from 'ioredis'
import { RippleAPI } from 'ripple-lib'
import { Server } from 'net';
import { createOrUpdate as createOrUpdateAccount, show as showAccount, destroy as destroyAccount } from './controllers/accountsController'
import { create as createThreshold } from './controllers/accountsThresholdController';
import axios from 'axios'

import Debug from 'debug'
import { normalizeAsset } from './utils/normalizeAsset';
const debug = Debug('xrp-settlement-engine')

const DEFAULT_SETTLEMENT_ENGINE_PREFIX = 'xrp'
const DEFAULT_MIN_DROPS_TO_SETTLE = 10000

const THRESHOLD_PERCENTAGES = [0,10,20,30,40,50,60,70,80,90,100]

export type Threshold = {
  name: string,
  value: number
}

export type ThresholdAlert = {
  threshold: string,
  currentBalance: number,
  previousBalance: number
  timestamp: number
}

export type Account = {
  id: string,
  ledgerAddress: string,
  scale: number,
  minimumBalance?: number,
  maximumBalance: number,
  settlementThreshold?: number
}

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

  constructor(config: XrpSettlementEngineConfig) {
    this.app = new Koa()
    this.app.use(bodyParser())
    this.router = new Router()
    this.setupRoutes()
    this.bindStoragePrefix()
    this.app.use(this.router.routes())

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
  }

  public async start() {
    this.server = await this.app.listen(this.port)
    await this.rippleClient.connect()
    await this.subscribeToTransactions()
  }

  public async shutdown() {
    await Promise.all([
      this.server.close(),
      this.rippleClient.disconnect()
    ])
  }

  private setupRoutes() {
    this.router.put('/accounts', (ctx) => createOrUpdateAccount(ctx, this.redis))
    this.router.get('/accounts/:id', (ctx) => showAccount(ctx, this.redis))
    this.router.delete('/accounts/:id', (ctx) => destroyAccount(ctx, this.redis))

    this.router.post('/accounts/:id/alerts', 
    async (ctx, next) => {
      //Get the account and bind to ctx
      const account =  await this.redis.get(`${ctx.settlement_prefix}:accounts:${ctx.params.id}`)
      if(account) {
        ctx.account = JSON.parse(account)
      } else {
        ctx.throw(404)
      }
      await next()
    },
    (ctx) => createThreshold(ctx, this.redis, this.handleThresholdAlert.bind(this)))
  }

  private bindStoragePrefix() {
    this.app.use(async (ctx, next) => {
      ctx.settlement_prefix = DEFAULT_SETTLEMENT_ENGINE_PREFIX
      await next()
    })
  }

  private async subscribeToTransactions() {
    this.rippleClient.connection.on('transaction', this.handleTransaction.bind(this))
    await this.rippleClient.request('subscribe', {
      accounts: [this.address]
    })
  }

  async  handleThresholdAlert(account: Account, alert: ThresholdAlert) {
    //Need a way to determine settlement threshold alogrithmically
    const deltaBalance = alert.currentBalance - alert.previousBalance

    // Only trigger settlement for negative trending alerts
    // Currently only settles to zero
    if(deltaBalance < 0 && Math.abs(alert.currentBalance) >= this.minDropsToSettle) {
      const amountToSettle = Math.abs(alert.currentBalance)
      await this.settle(account, amountToSettle)
    } else {
      debug('No settlement required for threshold alert')
    }
  }

  /** Should be triggered based on  */
  async settle(account: Account, drops: number) {
    debug(`Attempting to send ${drops} XRP drops to account: ${account.id} (XRP address: ${account.ledgerAddress})`)
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
          address: account.ledgerAddress,
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
        debug(`Sent ${drops} drop payment to account: ${account} (xrpAddress: ${account.ledgerAddress})`)
        await this.updateBalance(account, drops)
      }
    } catch (err) {
      console.error(`Error preparing and submitting payment to rippled. Settlement to account: ${account} (xrpAddress: ${account.ledgerAddress}) for ${drops} drops failed:`, err)
    }
  }

  /**
   * Handle incoming transaction from the ledger
   */
  private async handleTransaction(tx: any) {
    if (!tx.validated || tx.engine_result !== 'tesSUCCESS' || tx.transaction.TransactionType !== 'Payment' || tx.transaction.Destination !== this.address) {
      return
    }

    // Parse amount received from transaction
    let drops
    try {
      if (tx.meta.delivered_amount) {
        drops = parseInt(tx.meta.delivered_amount, 10)
      } else {
        drops = parseInt(tx.transaction.Amount, 10)
      }
    } catch (err) {
      console.error('Error parsing amount received from transaction: ', tx)
      return
    }

    const fromAddress = tx.transaction.Account
    debug(`Got incoming XRP payment for ${drops} drops from XRP address: ${fromAddress}`)

    try {
      //TODO: Determine who the balance came from
      const accountId = await this.redis.get(`${DEFAULT_SETTLEMENT_ENGINE_PREFIX}:ledgeraddress_accountid:${fromAddress}`)
      const accountJSON = await this.redis.get(`${DEFAULT_SETTLEMENT_ENGINE_PREFIX}:accounts:${accountId}`)
      if(accountJSON) {
        const account = JSON.parse(accountJSON)
        await this.updateBalance(account, drops)
        // debug(`Credited account: ${account} for incoming settlement, balance is now: ${newBalance}`)
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

  /**
   * Notify the connector that the balance has been updated
   * NOTE! This needs to send an update in the normalized assetScale for the account
   * TODO: Possible retry logic required
   */
  async updateBalance(account: Account, drops: number) {
    
    //Normalize the drops of the ledger into the accounts scale
    const amount = normalizeAsset(this.assetScale, account.scale, drops)
    
    const url = `${this.connectorUrl}\\${account}\\updateBalance`
    return axios.post(url, {
      amount: amount
    })
  }

  /**
   * 
   * @param account Account to register the threshold alerts on
   */
  async registerThresholdOnConnector(account: Account) {
    const url = `${this.connectorUrl}\\${account}\\thresholds`

    for (let i in THRESHOLD_PERCENTAGES) {
      const percentage = THRESHOLD_PERCENTAGES[i]
      const operatingRange = []
    }
  }
}