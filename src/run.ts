// import { connectRedis } from './store/redis'

// startServer(
//   createEngine({
//     xrpSecret: process.env.LEDGER_SECRET || 'sahVoeg97nuitefnzL9GHjp2Z6kpj',
//     rippledUri: process.env.RIPPLED_URI
//   })
// )
//   .then(() => {
//     console.log('Listening for incoming payments...')
//   })
//   .catch(err => console.error(err))

// // By default, Redis connects to 127.0.0.1:6379
// const store = await connectRedis({
//   uri: process.env.REDIS_URI,
//   host: process.env.REDIS_HOST,
//   port: process.env.REDIS_PORT
//     ? parseInt(process.env.REDIS_PORT, 10)
//     : undefined
// })

// parseInt(process.env.ENGINE_PORT, 10)

// ensure the server is gracefully shutdown when the process exists (move this to "run" ?)
