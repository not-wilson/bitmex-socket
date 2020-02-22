# bitmex-socket
Extend websocket object to connect to BitMEX Socket API and emit messages over Javascript.

# Usage
BitmexSocket object accepts 4 parameters for it's creation.  
`BitmexSocket(symbols[], tables[], accounts[], options{})`

Each param can be omitted, but if you don't provide at least one table, the socket won't listen to anything and not provide any data.
If you include symbols, any table that can be limited by symbol will be limited to that symbol on it's own stream. If no symbols are provided, all symbol specific tables will be subscribed to at the top-level under the main stream ID.

The accounts array is a list of objects. `accounts = [{ key: "", secret: "" }, { key: "", secret: "" }]`  
Any private tables included in the tables list will be subscribed to individually under a randomly generated ID for the account stream.

```javascript
const { BitmexSocket } = require('bitmex-socket') // const BitmexSocket = require('bitmex-socket').BitmexSocket
const socket = new BitmexSocket(['XBTUSD', 'ETHUSD', 'XRPUSD'], ['trade', 'quote', 'instrument', 'orderBookL2'], null, null)

// Master socket open and close.
socket.on('open', () => console.log("Bitmex Socket has connected"))
socket.on('close', () => console.log("Bitmex Socket has disconnected"))

// Individual stream connect and disconnect.
socket.on('connect', stream => console.log(`${stream} has connected`))
socket.on('disconnect', stream => console.log(`${stream} has disconnected`))

// Private stream authenticated.
socket.on('auth', stream => console.log(`${stream} has authenticated`))

// Subscribe and unsubscribe.
socket.on('subscribe', (stream, table) => console.log(`${stream} has subscribed to ${table}`))
socket.on('unsubscribe', (stream, table) => console.log(`${stream} has unsubscribed to ${table}`))

// An error has been received on the socket.
socket.on('error', err => console.log(err))

// Catch the raw data from the BitMEX socket stream.
socket.on('partial', data => console.log(data))
socket.on('insert', data => console.log(data))
socket.on('update', data => console.log(data))
socket.on('delete', data => console.log(data))

```

The options menu is just the basic stuff. I've never run into rate-limits no matter how many tables I subscribe to using the default queueSize and queueDelay.
```javascript
// Determine if we want testnet or not.
options.testnet = false

// Initialze the socket on created.
options.init = true

// Size and delay in seconds of the message queue.
options.queueSize   = 5
options.queueDelay  = 5

// Ping delay in seconds.
options.pingDelay = 5

// Handle reconect, delay in seconds.
options.reconnect = true
options.connDelay = 10

// Store a copy of the book within the socket using bitmex-book library.
options.book = false    // npm install bitmex-book
```

Also included in this library is a simple BitMEX REST API function, exported along with the socket object. This function returns a promise of a filled HTTPS request() function, or fails on an error received when attempting to pass it.

Private data can be included by including `{ key: "", secret: "" }` for the account param.
`function BitmexREST(dir, type = 'GET', account = {}, data = {})` Refer to the BitMEX REST API for instructions on available dirs and what data they accept.

```javascript
const { BitmexREST } = require('bitmex-socket') // const BitmexREST = require('bitmex-socket').BitmexREST
BitmexREST('user', 'GET', { key: "", secret: "" }).then(reply => console.log(reply))
```

If you like my work, please let me know:  
notwilson@protonmail.com  
Find me in the BitMEX trollbox as notwilson

A jesture of notice or a token of appreciation:  
ETH: 0xd9979f482da58b4432d0f52eb456f7dd1f4897e6  
BTC: 1HzR3Vyu231E8SsGLUbNYSb92bn6MGLEaV  
LTC: LTBHggmnrMACoB3JAH8rMy9r8hGxum7ZSw  
XRP: rBgnUKAEiFhCRLPoYNPPe3JUWayRjP6Ayg (destination tag: 536785858)