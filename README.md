# libp2p-websocket-star

[![](https://img.shields.io/badge/made%20by-mkg20001-blue.svg?style=flat-square)](http://ipn.io)
[![Build Status](https://travis-ci.org/mkg20001/js-libp2p-websocket-star.svg?style=flat-square)](https://travis-ci.org/mkg20001/js-libp2p-websocket-star)

![](https://raw.githubusercontent.com/libp2p/interface-connection/master/img/badge.png)
![](https://raw.githubusercontent.com/libp2p/interface-transport/master/img/badge.png)

> libp2p-webrtc-star without webrtc. Just plain socket.io.

## Description

`libp2p-websocket-star` is one of the Websocket transports available for libp2p. `libp2p-websocket-star` incorporates both a transport and a discovery service that is facilitated by the signalling server, also part of this module.

**Note:** This module uses [pull-streams](https://pull-stream.github.io) for all stream based interfaces.

## Usage

### Installation

```bash
> npm install libp2p-websocket-star
```

### API

[![](https://raw.githubusercontent.com/libp2p/interface-transport/master/img/badge.png)](https://github.com/libp2p/interface-transport)

Currently websocket-star uses the /libp2p-webrtc-star/ address prefix as we don't have our own just yet.

### Example

```JavaScript
const libp2p = require("libp2p")
const Id = require("peer-id")
const Info = require("peer-info")
const multiaddr = require("multiaddr")
const pull = require('pull-stream')

const WSStar = require('libp2p-websocket-star')
const ws = new WSStar()
const modules = {
  transports: [
    ws
  ],
  discovery: [
    ws.discovery
  ]
}

Id.create((err, id) => {
  if (err) throw err

  const peerInfo = new Info(id)
  peerInfo.multiaddrs.add(multiaddr("/libp2p-webrtc-star/dns4/your-server/ws/"))
  const swarm = new libp2p(modules, peerInfo)

  swarm.handle("/test/1.0.0", (protocol, conn) => {
    pull(
      pull.values(['hello from the other side']),
      conn
    )
  })

  swarm.start(err => {
    if (err) throw err
    swarm.dial(peerInfo, "/ipfs/ping/1.0.0", (err, conn) => {
      if (err) throw err
      pull(
        pull.values([]),
        conn,
        pull.log()
      )
    })
  })
})
```

Outputs:
```
hello from the other side
```

### Signalling server

`libp2p-webrtc-star` comes with its own signalling server, used for peers to handshake their signalling data and establish a connection. You can install it in your machine by installing the module globally:

```bash
> npm install --global libp2p-webrtc-star
```

This will expose a `star-sig` cli tool. To spawn a server do:

```bash
> star-signal --port=9090 --host=127.0.0.1
```

Defaults:

- `port` - 13579
- `host` - '0.0.0.0'

### This module uses `pull-streams`

We expose a streaming interface based on `pull-streams`, rather then on the Node.js core streams implementation (aka Node.js streams). `pull-streams` offers us a better mechanism for error handling and flow control guarantees. If you would like to know more about why we did this, see the discussion at this [issue](https://github.com/ipfs/js-ipfs/issues/362).

You can learn more about pull-streams at:

- [The history of Node.js streams, nodebp April 2014](https://www.youtube.com/watch?v=g5ewQEuXjsQ)
- [The history of streams, 2016](http://dominictarr.com/post/145135293917/history-of-streams)
- [pull-streams, the simple streaming primitive](http://dominictarr.com/post/149248845122/pull-streams-pull-streams-are-a-very-simple)
- [pull-streams documentation](https://pull-stream.github.io/)

#### Converting `pull-streams` to Node.js Streams

If you are a Node.js streams user, you can convert a pull-stream to a Node.js stream using the module [`pull-stream-to-stream`](https://github.com/pull-stream/pull-stream-to-stream), giving you an instance of a Node.js stream that is linked to the pull-stream. For example:

```JavaScript
const pullToStream = require('pull-stream-to-stream')

const nodeStreamInstance = pullToStream(pullStreamInstance)
// nodeStreamInstance is an instance of a Node.js Stream
```

To learn more about this utility, visit https://pull-stream.github.io/#pull-stream-to-stream.
