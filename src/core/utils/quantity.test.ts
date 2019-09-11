import { isQuantity, isValidAmount, fromQuantity, Quantity } from './quantity'
import BigNumber from 'bignumber.js'

describe('#fromQuantity', () => {
  test('Correctly converts to decimals', () => {
    expect(
      fromQuantity({
        amount: '4',
        scale: 3
      } as Quantity)
    ).toStrictEqual(new BigNumber(0.004))

    expect(
      fromQuantity({
        amount: '2387493254398563574732428183413479237',
        scale: 255
      } as Quantity)
    ).toStrictEqual(
      new BigNumber(
        '0.000000000000000000000000000000000000000000000000000' +
          '00000000000000000000000000000000000000000000000000000' +
          '00000000000000000000000000000000000000000000000000000' +
          '00000000000000000000000000000000000000000000000000000' +
          '000000002387493254398563574732428183413479237'
      )
    )
  })

  test('Correctly converts to rational numbers greater than 1', () => {
    expect(
      fromQuantity({
        amount: '478',
        scale: 0
      } as Quantity)
    ).toStrictEqual(new BigNumber('478'))

    expect(
      fromQuantity({
        amount: '468298498328921232438908568999396',
        scale: 18
      } as Quantity)
    ).toStrictEqual(new BigNumber('468298498328921.232438908568999396'))
  })
})

const IS_QUANTITY_POSITIVES = [
  {
    message: 'True with small amount and scale',
    input: {
      amount: '3',
      scale: 4
    }
  },
  {
    message: 'True with large amount and scale',
    input: {
      amount: '2387493254398563574732428183413479237',
      scale: 255
    }
  },
  {
    message: 'True if scale is 0',
    input: {
      amount: '47820000',
      scale: 0
    }
  },
  {
    message: 'True if amount is 0',
    input: {
      amount: '0',
      scale: 7
    }
  }
]

describe('#isQuantity', () => {
  IS_QUANTITY_POSITIVES.forEach(({ input, message }) =>
    test(message, () => expect(isQuantity(input)).toBe(true))
  )
})

const IS_QUANTITY_NEGATIVES = [
  {
    message: 'False if null',
    input: null
  },
  {
    message: 'False if undefined',
    input: undefined
  },
  {
    message: 'False if empty object',
    input: {}
  },
  {
    message: 'False if missing scale',
    input: { amount: '48' }
  },
  {
    message: 'False if scale is negative',
    input: { amount: '500', scale: -50 }
  },
  {
    message: 'False if scale is a string',
    input: { amount: '500', scale: '2' }
  },
  {
    message: 'False if scale is greater than 255',
    input: { amount: '500', scale: 256 }
  },
  {
    message: 'False if scale is not an integer',
    input: { amount: '500', scale: 2.3839 }
  },
  {
    message: 'False if scale is Infinity',
    input: { amount: '500', scale: Infinity }
  },
  {
    message: 'False if scale is NaN',
    input: { amount: '6783', scale: NaN }
  },
  {
    message: 'False if missing amount',
    input: { scale: 3 }
  },
  {
    message: 'False if amount has non-numeric characters',
    input: { amount: '123foobar456', scale: 8 }
  },
  {
    message: 'False if amount is negative',
    input: { amount: '-500', scale: 2 }
  },
  {
    message: 'False if amount is negative zero',
    input: { amount: '-0', scale: 2 }
  },
  {
    message: 'False if amount is a decimal',
    input: { amount: '100.04', scale: 2 }
  },
  {
    message: 'False if amount has trailing zeroes',
    input: { amount: '789423.0', scale: 1 }
  },
  {
    message: 'False if amount is a number',
    input: { amount: 300, scale: 2 }
  },
  {
    message: 'False if amount is NaN',
    input: { amount: 'NaN', scale: 2 }
  },
  {
    message: 'False if amount is Infinity',
    input: { amount: 'Infinity', scale: 2 }
  },
  {
    message: 'False if amount has exponent',
    input: { amount: '3e2', scale: 3 }
  }
]

describe('#isQuantity', () => {
  IS_QUANTITY_NEGATIVES.forEach(({ input, message }) =>
    test(message, () => expect(isQuantity(input)).toBe(false))
  )
})

describe('#isValidAmount', () => {
  test('True for very large positive numbers', () => {
    expect(isValidAmount(new BigNumber('134839842444364732'))).toBe(true)
  })

  test('True for very small positive numbers', () => {
    expect(isValidAmount(new BigNumber('32.23843824832838489999999e-150'))).toBe(true)
  })

  test('True for positive 0', () => {
    expect(isValidAmount(new BigNumber(0))).toBe(true)
  })

  test('True for negative 0', () => {
    expect(isValidAmount(new BigNumber('-0'))).toBe(true)
  })

  test('False for Infinity', () => {
    expect(isValidAmount(new BigNumber(Infinity))).toBe(false)
  })

  test('False for NaN', () => {
    expect(isValidAmount(new BigNumber(NaN))).toBe(false)
  })

  test('False for negative numbers', () => {
    expect(isValidAmount(new BigNumber('-3248'))).toBe(false)
  })
})
