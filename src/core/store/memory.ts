import { SettlementStore } from '.'
import BigNumber from 'bignumber.js'

interface AccountInfo {
  settlementRequests: Map<string, BigNumber> // idempotencyKey -> amount queued
  queuedSettlements: BigNumber
  uncreditedSettlements: BigNumber
}

export const createMemoryStore = (): SettlementStore => {
  const accounts = new Map<string, AccountInfo>()

  const self: SettlementStore = {
    async createAccount(accountId) {
      return (
        accounts.has(accountId) ||
        !accounts.set(accountId, {
          settlementRequests: new Map(),
          queuedSettlements: new BigNumber(0),
          uncreditedSettlements: new BigNumber(0)
        })
      )
    },

    async isExistingAccount(accountId) {
      return accounts.has(accountId)
    },

    async deleteAccount(accountId) {
      accounts.delete(accountId)
    },

    async queueSettlement(accountId, idempotencyKey, amount) {
      const account = accounts.get(accountId)
      if (!account) {
        throw new Error('Account does not exist')
      }

      const amountQueued = account.settlementRequests.get(idempotencyKey)
      if (amountQueued) {
        return amountQueued
      }

      account.settlementRequests.set(idempotencyKey, amount)
      account.queuedSettlements = account.queuedSettlements.plus(amount)
      return amount
    },

    async loadAmountToSettle(accountId) {
      const account = accounts.get(accountId)
      if (!account) {
        throw new Error('Account does not exist')
      }

      const amount = account.queuedSettlements
      account.queuedSettlements = new BigNumber(0)
      return amount
    },

    async saveAmountToSettle(accountId, amount) {
      const account = accounts.get(accountId)
      if (!account) {
        throw new Error('Account does not exist')
      }

      account.queuedSettlements = account.queuedSettlements.plus(amount)
    },

    async loadAmountToCredit(accountId) {
      const account = accounts.get(accountId)
      if (!account) {
        throw new Error('Account does not exist')
      }

      const amount = account.uncreditedSettlements
      account.uncreditedSettlements = new BigNumber(0)
      return amount
    },

    async saveAmountToCredit(accountId, amount) {
      const account = accounts.get(accountId)
      if (!account) {
        throw new Error('Account does not exist')
      }

      account.uncreditedSettlements = account.uncreditedSettlements.plus(amount)
    }
  }

  return self
}
