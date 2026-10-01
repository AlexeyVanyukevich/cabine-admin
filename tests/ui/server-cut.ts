import { createServer as createHttpServer } from 'node:http'
import { connect, createServer, type Server, type Socket } from 'node:net'

export interface ServerCut {
  stop: () => Promise<void>
}

/**
 * Stands between the browser and the server so a journey can make the server unreachable while
 * the browser still believes it is online — a captive portal, a signal too weak to carry a
 * request. Cut, it stops listening, so a new connection is refused exactly as a stopped server
 * refuses it, and it drops every open one, because a kept-alive connection would otherwise go
 * on carrying requests as though nothing had happened.
 *
 * `context.setOffline` is not a substitute: in WebKit it fails a navigation outright, before
 * the service worker can answer it, so a cold reload with the network cut cannot be tested
 * with it at all.
 *
 * The specs run in their own processes, so they reach the switch over HTTP on `controlPort`.
 */
export async function startServerCut(options: {
  port: number
  targetPort: number
  controlPort: number
}): Promise<ServerCut> {
  const open = new Set<Socket>()

  const proxy = createServer((client) => {
    const upstream = connect(options.targetPort, '127.0.0.1')
    open.add(client)
    open.add(upstream)
    const drop = () => {
      client.destroy()
      upstream.destroy()
      open.delete(client)
      open.delete(upstream)
    }
    client.on('error', drop).on('close', drop)
    upstream.on('error', drop).on('close', drop)
    client.pipe(upstream).pipe(client)
  })

  const listen = () => listenOn(proxy, options.port)
  let cut = false

  const control = createHttpServer((request, response) => {
    const action = request.url
    void (async () => {
      if (action === '/cut' && !cut) {
        cut = true
        const closed = closeServer(proxy)
        for (const socket of open) socket.destroy()
        open.clear()
        await closed
      } else if (action === '/restore' && cut) {
        cut = false
        await listen()
      } else if (action !== '/cut' && action !== '/restore') {
        response.writeHead(404).end()
        return
      }
      response.writeHead(204).end()
    })()
  })

  await listen()
  await listenOn(control, options.controlPort)

  return {
    stop: async () => {
      for (const socket of open) socket.destroy()
      await Promise.all([cut ? Promise.resolve() : closeServer(proxy), closeServer(control)])
    },
  }
}

function listenOn(server: Server | ReturnType<typeof createHttpServer>, port: number) {
  return new Promise<void>((done, fail) => {
    server.once('error', fail)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', fail)
      done()
    })
  })
}

function closeServer(server: Server | ReturnType<typeof createHttpServer>) {
  return new Promise<void>((done) => server.close(() => done()))
}
