"use strict"

const debug = require('debug')
const log = debug('libp2p:websocket-star')
const multiaddr = require('multiaddr')
const mafmt = require('mafmt')
const io = require('socket.io-client')
const sp = require("socket.io-pull-stream")
const uuid = require("uuid")
const EE = require('events').EventEmitter
const PeerId = require('peer-id')
const PeerInfo = require('peer-info')
const Connection = require('interface-connection').Connection
const once = require('once')
const setImmediate = require('async/setImmediate')
const utils = require('./utils')
const cleanUrlSIO = utils.cleanUrlSIO
const crypto = require("libp2p-crypto")

const noop = once(() => {})

const sioOptions = {
  transports: ['websocket'],
  'force new connection': true
}

class Listener extends EE {
  constructor(options) {
    super()
    this.id = options.id
    this.canCrypto = !!options.id
    this.handler = options.handler || noop
    this.listeners_list = options.listeners || {}
  }
  //"private" functions
  up(cb) {
    cb = cb ? once(cb) : noop
    if (this.io) return cb()
    log('Dialing to Signalling Server on: ' + this.server)
    const _io = this.io = io.connect(this.server, sioOptions)
    sp(_io)
    _io.once("error", cb)
    _io.once("connect_error", cb)
    _io.once("connect", cb)
    const proto = new utils.Protocol(log)
    proto.addRequest("ws-peer", ["multiaddr"], (socket, peer) => {
      if (this.id) {
        if (!this.ma) return
        this.emit("peer", this.ma.decapsulate("ipfs").encapsulate("ipfs/" + peer.split("ipfs/").pop()).toString())
      } else return this.emit("peer", peer)
    })
    proto.addRequest("ss-incomming", ["string", "multiaddr", "function"], this.incommingDial.bind(this))
    proto.handleSocket(_io)
  }
  down() {
    if (!this.io) return
    this.io.disconnect()
    this.emit("close")
    delete this.io
  }
  cryptoChallenge(cb) {
    if (!this.io) return cb(new Error("Not connected"))
    this.io.emit('ss-join', this.ma.toString(), this.canCrypto ? crypto.keys.marshalPublicKey(this.id.pubKey).toString("hex") : "", (err, sig) => {
      if (err) {
        cb(new Error(err))
      } else {
        if (sig) {
          if (!this.canCrypto) {
            this.down()
            cb(new Error("Can't sign cryptoChallenge: No id provided"))
          } else {
            this.id.privKey.sign(Buffer.from(sig), (err, signature) => {
              if (err) cb(err)
              this.signature = signature.toString("hex")
              this.join(cb)
            })
          }
        } else {
          this.signature = "_"
          cb()
        }
      }
    })
  }
  crypto(cb) {
    cb = cb ? once(cb) : noop
    if (!this.io) return cb(new Error("Not connected"))
    if (this.signature) {
      this.join((err, need_new_challenge) => {
        if (need_new_challenge) return this.cryptoChallenge(cb)
        else return cb(err)
      })
    } else {
      this.cryptoChallenge(cb)
    }
  }
  join(cb) {
    this.io.emit('ss-join', this.ma.toString(), this.signature, cb)
  }
  incommingDial(socket, dialId, dialFrom, cb) {
    log("recieved dial from", dialFrom, dialId)
    const ma = multiaddr(dialFrom)
    const source = this.io.createSource(dialId + ".dialer")
    const sink = this.io.createSink(dialId + ".listener")

    cb(null)
    const conn = new Connection({
      sink,
      source
    }, {
      getObservedAddrs: cb => cb(null, [ma])
    })
    this.emit("connection", conn)
    this.handler(conn)
  }
  //public functions
  listen(ma, cb) {
    this.ma = ma
    this.server = cleanUrlSIO(ma)
    this.listeners_list[this.server] = this
    cb = cb ? once(cb) : noop
    const final = err => {
      if (err) {
        log(err)
        this.down()
        this.emit("error", err)
        this.emit("close")
      } else self.emit("listening")
      cb(err)
    }
    const self = this

    self.up(err => {
      if (err) return final(err)
      self.crypto(err => {
        if (err) return final(err)
        self.io.on("reconnect", self.crypto.bind(this, err => {
          if (err) {
            log("reconnect error", err)
            self.emit("error", err)
          }
        }))
        final()
      })
    })
  }
  getAddrs(callback) {
    setImmediate(() => callback(null, this.ma ? [this.ma] : []))
  }
  close(callback) {
    callback = callback ? once(callback) : noop

    this.down()

    callback()
  }
  //called from transport
  dial(ma, options, callback) {
    if (typeof options === 'function') {
      callback = options
      options = {}
    }

    const _ma = multiaddr(ma)

    const conn = new Connection(null)

    const dialId = uuid()

    callback = callback ? once(callback) : noop

    let io = this.io

    if (!io) return callback(new Error("No signaling connection available for dialing"))

    const sink = io.createSink(dialId + ".dialer")

    log("dialing %s (id %s)", ma, dialId)

    //"multiaddr", "multiaddr", "string", "function" - dialFrom, dialTo, dialId, cb
    io.emit("ss-dial", this.ma.toString(), ma.toString(), dialId, err => {
      if (err) return callback(new Error(err))
      log("dialing %s (id %s) successfully completed", ma, dialId)
      const source = io.createSource(dialId + ".listener")
      conn.setInnerConn({
        sink,
        source
      }, {
        getObservedAddrs: cb => cb(null, [_ma])
      })
      callback(null, conn)
    })

    return conn
  }
}

class WebsocketStar {
  constructor(options) {
    options = options || {}

    this.id = options.id

    this.discovery = new EE()
    this.discovery.start = (callback) => {
      setImmediate(callback)
    }
    this.discovery.stop = (callback) => {
      setImmediate(callback)
    }

    this.listeners_list = {}
    this._peerDiscovered = this._peerDiscovered.bind(this)
  }

  lazySetId(id) {
    if (!id) return
    this.id = id
    this.canCrypto = true
  }

  dial(ma, options, callback) {
    if (typeof options === 'function') {
      callback = options
      options = {}
    }
    const listener = this.listeners_list[cleanUrlSIO(ma)]
    if (!listener) {
      callback(new Error("No listener for this server"))
      return new Connection()
    }
    return listener.dial(ma, options, callback)
  }

  createListener(options, handler) {
    if (typeof options === 'function') {
      handler = options
      options = {}
    }

    const listener = new Listener({
      id: this.id,
      handler,
      listeners: this.listeners_list
    })

    listener.on("peer", this._peerDiscovered)

    return listener
  }

  filter(multiaddrs) {
    if (!Array.isArray(multiaddrs))
      multiaddrs = [multiaddrs]
    return multiaddrs.filter((ma) => mafmt.WebSocketStar.matches(ma))
  }

  _peerDiscovered(maStr) {
    log('Peer Discovered:', maStr)
    const peerIdStr = maStr.split('/ipfs/').pop()
    const peerId = PeerId.createFromB58String(peerIdStr)
    const peerInfo = new PeerInfo(peerId)
    peerInfo.multiaddrs.add(multiaddr(maStr))
    this.discovery.emit('peer', peerInfo)
  }
}
module.exports = WebsocketStar
