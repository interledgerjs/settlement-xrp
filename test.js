const Redis = require('ioredis')

async function run() {
  const client = new Redis()

  await client.watch('foo')

  // await new Promise(r => setTimeout(r, 10000))

  const result = await client
    .multi()
    .set('foo', 'bar')
    .get('foo')
    .exec()
  console.log(result)
}

run().catch(err => console.error(err))
