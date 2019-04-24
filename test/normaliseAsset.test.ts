import 'mocha'
import * as sinon from 'sinon'
import * as Chai from 'chai'
import { normalizeAsset } from '../src/utils/normalizeAsset';
const assert = Object.assign(Chai.assert, sinon.assert)

describe('Normalize Asset', function () {

    it('converts from low scale to higher scale', async () => {
        const convertedValue = normalizeAsset(2, 6, 100n)
        assert.strictEqual(convertedValue, 1000000n)
    })

    it('converts from high scale to lower scale', async () => {
        const convertedValue = normalizeAsset(6, 2, 1000000n)
        assert.strictEqual(convertedValue, 100n)
    })
})
