import 'mocha'
import * as sinon from 'sinon'
import * as Chai from 'chai'
import { normalizeAsset } from '../src/utils/normalizeAsset';
import { SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION } from 'constants';
const assert = Object.assign(Chai.assert, sinon.assert)

describe('Normalize Asset', function () {

    it('converts from low scale to higher scale', async () => {
        const convertedValue = normalizeAsset(2, 6, 100)
        assert.strictEqual(convertedValue, 1000000)
    })

    it('converts from high scale to lower scale', async () => {
        const convertedValue = normalizeAsset(6, 2, 1000000)
        assert.strictEqual(convertedValue, 100)
    })

    it('converts from high scale to lower scale', async () => {
        const convertedValue = normalizeAsset(6, 2, 1000000)
        assert.strictEqual(convertedValue, 100)
    })

})
