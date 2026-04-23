const { spawn } = require('child_process')
const io = require('socket.io-client')

const PORT = process.env.TEST_PORT || 4000
const SERVER_CMD = process.env.SERVER_CMD || 'node'
const SERVER_SCRIPT = 'server/index.cjs'

function waitForServerReady(proc, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Server did not become ready in time'))
    }, timeout)

    proc.stdout.on('data', (d) => {
      const s = String(d)
      process.stdout.write(s)
      if (s.includes(`Local   : http://localhost:${PORT}`) || s.includes('Serveur multijoueur')) {
        clearTimeout(timer)
        resolve()
      }
    })
    proc.stderr.on('data', (d) => process.stderr.write(String(d)))
  })
}

function waitForEvent(socket, ev, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for ' + ev)), timeout)
    socket.once(ev, (payload) => { clearTimeout(t); resolve(payload) })
  })
}

async function run() {
  console.log('Starting server...')
  const env = Object.assign({}, process.env, { PORT: String(PORT) })
  const server = spawn(SERVER_CMD, [SERVER_SCRIPT], { env, cwd: process.cwd() })

  server.stdout.setEncoding('utf8')
  server.stderr.setEncoding('utf8')

  try {
    await waitForServerReady(server, 10000)
  } catch (err) {
    console.error('Server failed to start:', err)
    server.kill()
    process.exit(2)
  }

  const url = `http://localhost:${PORT}`
  console.log('Server ready at', url)

  // Create three sockets: host, p2, p3
  const s1 = io(url)
  const s2 = io(url)
  const s3 = io(url)

  function onceConnected(s) {
    return new Promise((res) => s.on('connect', res))
  }
  await Promise.all([onceConnected(s1), onceConnected(s2), onceConnected(s3)])

  // Helper to emit and wait for acknowledgement via server events
  // 1) create room
  s1.emit('room:create', { playerName: 'Host' })
  const roomCreated = await waitForEvent(s1, 'room:created')
  const code = roomCreated.roomCode
  console.log('Room created:', code)

  // 2) join p2 and p3
  s2.emit('room:join', { roomCode: code, playerName: 'P2' })
  await waitForEvent(s2, 'room:joined')
  s3.emit('room:join', { roomCode: code, playerName: 'P3' })
  await waitForEvent(s3, 'room:joined')
  console.log('Players joined')

  // Listen for game:state updates on host
  let lastState = null
  s1.on('game:state', (s) => { lastState = s })

  // 3) start the game (host)
  s1.emit('room:start')
  // wait for a playing state
  await new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('no playing state')), 3000)
    s1.on('game:state', (st) => {
      if (st.phase === 'playing') { clearTimeout(to); res(st) }
    })
  })
  console.log('Game started (playing)')

  // 4) disconnect s2 (simulate network drop)
  console.log('Disconnecting P2')
  s2.disconnect()

  // Wait for server to broadcast paused state
  await new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('no paused state')), 3000)
    s1.on('game:state', (st) => {
      if (st.phase === 'paused') { clearTimeout(to); res(st) }
    })
  })
  console.log('Server paused the game after disconnect')

  // 5) Reconnect P2 by creating a new socket and joining with same name
  const s2b = io(url)
  await onceConnected(s2b)
  s2b.emit('room:join', { roomCode: code, playerName: 'P2' })
  await waitForEvent(s2b, 'room:joined')
  console.log('P2 rejoined')

  // Wait for server to broadcast playing state again
  await new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('no resumed playing state')), 4000)
    s1.on('game:state', (st) => {
      if (st.phase === 'playing') { clearTimeout(to); res(st) }
    })
  })
  console.log('Server resumed the game after reconnect')

  // 6) Disconnect all players to check room preservation
  s1.disconnect(); s2b.disconnect(); s3.disconnect();
  await new Promise(r => setTimeout(r, 400))

  // Connect a new socket and ping the server to check rooms count
  const pinger = io(url)
  await onceConnected(pinger)
  const roomsCount = await new Promise((res) => pinger.emit('ping:server', (data) => res(data.rooms)))
  console.log('Rooms count after all disconnected:', roomsCount)
  if (roomsCount < 1) {
    console.error('Room was removed prematurely')
    server.kill()
    process.exit(3)
  }

  // Clean up
  pinger.disconnect()
  server.kill()
  console.log('Integration test PASSED')
  process.exit(0)
}

run().catch((err) => {
  console.error('Test failed:', err)
  process.exit(1)
})
