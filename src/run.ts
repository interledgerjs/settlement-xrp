import { XrpSettlementEngine, XrpSettlementEngineConfig } from '.'
import * as Redis from 'ioredis'

const LEDGER_ADDRESS =
  process.env.LEDGER_ADDRESS || 'rGCUgMH4omQV1PUuYFoMAnA7esWFhE7ZEV'
const LEDGER_SECRET =
  process.env.LEDGER_SECRET || 'sahVoeg97nuitefnzL9GHjp2Z6kpj'
const LEDGER_SCALE = 6
const CONNECTOR_URL = process.env.CONNECTOR_URL || 'http://localhost:7771' // where the connector settlement api is NOTE, NOT THE ACCOUNTS API OR THE BTP API
const ENGINE_PORT = process.env.ENGINE_PORT || 3000 // Where to listen for connections on
const REDIS_HOST = process.env.REDIS_HOST || 'localhost'
const REDIS_PORT = process.env.REDIS_PORT || 6379 // Where redis is hosted at

const redisClient = new Redis({ host: REDIS_HOST, port: +REDIS_PORT })

const config: XrpSettlementEngineConfig = {
  address: LEDGER_ADDRESS,
  secret: LEDGER_SECRET,
  assetScale: LEDGER_SCALE,
  /** Redis Instance */
  redis: redisClient,
  /** Port the connector runs http api on */
  connectorUrl: CONNECTOR_URL,
  port: +ENGINE_PORT
}

const engine = new XrpSettlementEngine(config)
engine
  .start()
  .then(() => {
    console.log(
      'Listening for incoming XRP payments and polling Redis for accounts that need to be settled'
    )
  })
  .catch(err => console.error(err))
