import { XrpSettlementEngine, XrpSettlementEngineConfig } from '.'
import * as Redis from 'ioredis'

const LEDGER_ADDRESS = process.env.LEDGER_ADDRESS || 'rGCUgMH4omQV1PUuYFoMAnA7esWFhE7ZEV'
const LEDGER_SECRET = process.env.LEDGER_SECRET || 'sahVoeg97nuitefnzL9GHjp2Z6kpj'
const LEDGER_SCALE = 6
const CONNECTOR_URL = process.env.CONNECTOR_URL || ''


const redisClient = new Redis()

const config: XrpSettlementEngineConfig = {
    address: LEDGER_ADDRESS,
    secret: LEDGER_SECRET,
    assetScale: LEDGER_SCALE, 
    /** Redis Instance */
    redis: redisClient,
    /** Port to run http api on */
    connectorUrl: CONNECTOR_URL,
}

const engine = new XrpSettlementEngine(config)
engine.start().then(() => {
    console.log('Listening for incoming XRP payments and polling Redis for accounts that need to be settled')
}).catch((err) => console.error(err))