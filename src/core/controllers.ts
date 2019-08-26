import { RequestHandler } from 'express'
import { isQuantity, convertFromQuantity, convertToQuantity, isDatabaseSafe } from './utils'
import { AccountServices, SettlementEngine } from '.'
import { SettlementStore } from './store'

export interface Context {
  services: AccountServices
  engine: SettlementEngine
  store: SettlementStore
}

export const validateAccount = ({ store }: Context): RequestHandler => async (req, res, next) => {
  const accountId = req.params.id
  if (!isDatabaseSafe(accountId)) {
    return res.sendStatus(400)
  }

  const accountExists = await store.isExistingAccount(accountId)
  if (!accountExists) {
    return res.sendStatus(404)
  }

  return next()
}

export const setupAccount = ({ store, engine }: Context): RequestHandler => async (req, res) => {
  // TODO Validate the account ID
  const accountId = req.params.id
  await store.createAccount(accountId)

  if (engine.setup) {
    await engine.setup(accountId)
  }

  res.sendStatus(201)
}

export const settleAccount = ({ store, engine, services }: Context): RequestHandler => async (
  req,
  res
) => {
  const accountId = req.params.id

  // TODO Is there a way to validate this? (Can I type the RequestHandler params? I think so!)
  if (!accountId) {
    return res.sendStatus(400)
  }

  const idempotencyKey = req.get('Idempotency-Key')
  if (!isDatabaseSafe(idempotencyKey)) {
    return res.sendStatus(400)
  }

  const requestQuantity = req.body
  if (!isQuantity(requestQuantity)) {
    return res.sendStatus(400)
  }

  const amountToQueue = convertFromQuantity(requestQuantity)
  const amountQueued = await store.queueSettlement(accountId, idempotencyKey, amountToQueue)

  const responseQuantity = convertToQuantity(amountQueued)
  if (!isQuantity(responseQuantity)) {
    return res.sendStatus(500)
  }

  // TODO Just error immediately if the amount queued for settlement > amount in request? (400 error?)

  res.status(201).send(responseQuantity)

  // Attempt to perform a settlement
  services.trySettlement(accountId, amount => engine.settle(accountId, amount))
}

export const handleMessage = ({ engine }: Context): RequestHandler => async (req, res) => {
  if (!engine.handle) {
    return res.sendStatus(400)
  }

  const accountId = req.params.id
  const message = JSON.parse(req.body.toString())

  const response = await engine.handle(accountId, message)
  const rawResponse = Buffer.from(JSON.stringify(response))
  res.status(201).send(rawResponse)
}

export const deleteAccount = ({ store, engine }: Context): RequestHandler => async (req, res) => {
  const accountId = req.params.id

  if (engine.close) {
    await engine.close(accountId)
  }

  await store.deleteAccount(accountId)
  res.sendStatus(204)
}
