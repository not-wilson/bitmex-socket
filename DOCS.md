# Usage
`BitmexSocket` can use either `/realtime` or `/realtimemd` depending on your preferences. If you know you're never going to have a need for multiple sockets, you can use the standalone option to connect to `/realtime` and skip a bunch of checks and balances. Using a single socket for `/realtimemd` will work just fine though. The message queue will sort and priortise connection and authentication messages ahead of the rest. Use the messaging queue to save yourself a headache.

# Working Example 1
## Use the message queue.
```javascript
// Separate streams by symbol.
const conf = { limited: true, autoconn: true }  // Use the message queue, connect on object creation.
const xbtusd = new BitmexSocket(null, conf)
const ethusd = new BitmexSocket(xbtusd, conf)   // xbtusd holds the websocket object. This will ignore the limited option.

const { key, secret } = require('../../bitmex-private').main    // My API credentials, get your own.
xbtusd.authenticate(key, secret)
ethusd.authenticate(key, secret)

xbtusd.subscribe('margin', 'position:XBTUSD', 'order:XBTUSD', 'trade:XBTUSD', 'orderBookL2:XBTUSD')
ethusd.subscribe('margin', 'position:ETHUSD', 'order:ETHUSD', 'trade:ETHUSD', 'orderBookL2:ETHUSD')

xbtusd.on('ready', () => console.log("XBTUSD is ready."))   // Won't call until all subscriptions have been responded to from BitMEX.
ethusd.on('ready', () => console.log("ETHUSD is ready."))
```

## Config Options
```javascript
const config = {    // Default values as shown.
    standalone:     false,  // Project should only ever expect a single object.
    autoconn:       false,  // Attempt to connecte as soon as the object is created.
    testnet:        false,   // Connect to testnet instead of mainnet.
    id:             randomBytes(8).toString('hex')  // Override the random 16 character hex string with a custom name.
    limited:        false,  // Use the inbuilt message queue.
    queue_size:     5,      // Number of messages to send at once.
    queue_delay:    5   // In seconds time to wait between message bursts.
}
```
The value of these options can be read with the `socket.opt(o)` function. They cannot be changed after the object is created.

## Single Socket
```javascript
// Define a completely stand-alone socket on /realtime
const socket = new BitmexSocket(null, { standalone: true }) // Not placing the standalone option will assume the socket is just waiting for more to be attached to it.
```
Single sockets handle and operate exactly the same as a multisocket. However, using this will save you some overhead if you never plan on having more than one connection. Attempting to bind a child socket to a standalone does nothing. That is simply not possible without destroying the inital socket and reconnecting again, which defeats the purpose entirely.

## Multiple Sockets
```javascript
// Multi-socket Connection.
const parent    = new BitmexSocket(null, config)        // Creates a socket on /realtimemd
const child     = new BitmexSocket(parent, config)      // Hooks into the parent socket.
const child2    = new BitmexSocket(parent, config)      // ^

// Stand-alone children.
const parent    = new BitmexSocket                                  // Creates a socket on /realtimemd
const child     = new BitmexSocket(master, { standalone: true })    // Creates a socket on /realtime

parent.connect()    // Connects both sockets.
parent.disconnect() // Disconnects both sockets.

// Stand-alone parents.
const parent    = new BitmexSocket(null, { standalone: true })
const child     = new BitmexSocket(master) // The association between the two is compltely ignored.

```
Every socket created without a first param and standalone: true in the config will be treated like a parent multi-socket. If you supply a first param, the child will pass all its messages through it. A standalone child keeps the socket connections completely separated. parent is a `/realtimemd` socket and child is a `/realtime` socket. However, even though they are on separate connections entirely, if the master connection goes offfline/disconnects randomly/intentionally, the child socket will be forced to disconnect as well. Same with connecting. This basically just keeps their connection status somewhat in sync. I honestly struggle to see a use-case, but others are clevererer and it was easy enough to support.
Stand-alone parent is impossible. Any socket that tries to use a standalone as a parent will just ignore the association and become a parent itself.

## Options
`socket.opt(o)` returns the boolean values of the supplied opts on creation:
- `id` string identifier of the object. Any two sockets with the same ID will be sharing the same API key/secret pair. So like, don't do that.
- `autoconn` connect automatically on object creation.
- `standalone` connect to `/realtime` instead of `/realtimemd`.
- `testnet` connect to testnet instead of live server.
- `limited` Use the message queue or send messages directly (handly timing yourself).
- `queue_delay` Time in seconds before sending a burst of messages to BitMEX.
- `queue_size` Number of messages to send every burst.
As well as the internal:
- `disconnected` The socket is disconnected.
- `connecting` The socket is connecting.
- `connected` The socket has connected.
- `ready` The socket is ready.

It also gives access to the `wants` and `needs` arrays for tracking the ready-state on connect/reconnect. I don't recommend messing with those unless you want your object to never call ready. The result for `ready` and `connected` can differ. One can be connected, but not ready. The ready event will fire when all wanted subscriptions have been established.

# Object Breakdown
```javascript
// Purely for the sake of example.
const socket = new BitmexSocket

// Getters/Functions
socket.id           // Identity of the socket. Configurable in opt.id at creation.
socket.opt(o)       // Returns true/false on an option.
socket.connect()    // Connect to BitMEX.
socket.disconnect() // Disconnect from BitMEX. State will be saved, if connect() is called again, socket will attempt to authenticate and subscribe to wanted tables.
socket.send(action) // Send a message to BitMEX. eg: { op: "subscribe", args: ["trade:XBTUSD", "trade:ETHUSD"] } Anything their API docs says you can.
socket.authenticate(key, secret)    // Authenticate the socket.
socket.subscribe(...tables)         // Subscribe to the supplied list of tables.
socket.unsubscribe(...tables)       // Unsubscribe from the supplied list of tables.

// Events
socket.on('connect',        () => {})   // BitMEX has acknowleged this socket exists.
socket.on('disconnect',     () => {})   // The socket connection has been terminated.
socket.on('error',          err => {})  // An error has been emitted for some reason or another. You're gonna want this listener.
socket.on('auth',           () => {})   // The socket has been authenticated.
socket.on('subscribe',      (table, channel) => {}) // Successful subscription. table:channel, channel will be null if top-level table.
socket.on('unsubscribe',    (table, channel) => {}) // Unsubscription successful. ^
socket.on('partial',        (table, data, reply) => {}) // table, data that was changed and reply is the rest of the message from BitMEX.
socket.on('insert',         (table, data, reply) => {}) // ^
socket.on('update',         (table, data, reply) => {}) // ^^
socket.on('delete',         (table, data, reply) => {}) // ^^^
socket.on('ready',          () => {})   // Perform sub / auth requests prior to calling connect(), the object will wait for all partials until calling ready.
```