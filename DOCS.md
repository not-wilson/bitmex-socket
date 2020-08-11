# Object Breakdown
## If you've got a handle on this, you'll be fine.
```javascript
// Create the socket.
// If parent_socket is supplied, the socket will piggy-back of it's websocket connection rather than establishing its own unless configured not to.
// parent_socket is just another BitmexSocket that hasn't been set to standlone mode (see options).
const socket = new BitmexSocket(parent_socket = null, options = {})

// Getters/Functions
socket.id           // Identity of the socket. Configurable in opt.id at creation.
socket.ready        // Whether or not the ready() event has been fired. ready event will fire on successful connection (and subs/auth if reconn)
socket.opt(o)       // Returns true/false on an option.
socket.connect()    // Connect to BitMEX. *All* sockets need to call this or have autoconn set manually. Options (save for limited) aren't inherited (*stomach growls*)
socket.disconnect() // Disconnect from BitMEX. State will be saved, if connect() is called again, socket will attempt to authenticate and subscribe to wanted tables.
socket.send(action) // Send a message to BitMEX. eg: { op: "subscribe", args: ["trade:XBTUSD", "trade:ETHUSD"] } Anything their API docs says you can.
socket.authenticate(key, secret)    // Authenticate the socket.
socket.subscribe(...tables)         // Subscribe to the supplied list of tables.
socket.unsubscribe(...tables)       // Unsubscribe from the supplied list of tables.
socket.update(dir, type, data)      // BitMEX REST API. Capable of private call if the socket has authenticated.

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
socket.on('ready',          () => {})   // Only really useful with { limited: true } as a supplied option.
```
- Creating a standlone socket with children is rather pointless and the child will ignore the supplied parent and act as one itself.
- Creating a standalone child with a parent socket is equally as pointless. It will however sync the connection states and needlessly boot the child socket if the parent is disconnected for any reason.

## Options
These are options you can supply to the object on creation and retrieve via `socket.opt()`
```javascript
const options = {   // Default values.
    id:             require('crypto').randomBytes(8).toString('hex'),
    autoconn:       false,
    standalone:     false,
    testnet:        false,
    limited:        false,
    queue_delay:    5,
    queue_size:     5
}
```
- `id` string identifier of the object. Any two sockets with the same ID will be sharing the same API key/secret pair. So like, don't do that.
- `autoconn` connect automatically on object creation.
- `standalone` connect to `/realtime` instead of `/realtimemd`.
- `testnet` connect to testnet instead of live server.
- `limited` Use the message queue or send messages directly (handly timing yourself). Enabling this will save you a bunch of headaches, believe me.
- `queue_delay` Time in seconds before sending a burst of messages to BitMEX.
- `queue_size` Number of messages to send every burst.

These options cannot be set at object creation, but can be retrieved by `socket.opt()`:
- `disconnected` The socket is disconnected.
- `connecting` The socket is connecting.
- `connected` The socket has connected.
- `ready` The socket is ready.

There's also the internal array `wants[]` for table subscriptions the socket is waiting for and `needs[]`, a list of all wanted subscriptions (used on reconnect). The ready event will fire when the `wants[]` array is empty. You're fine to read them, but it's not recommended to edit them as doing so may cause the ready event to not fire.

## Working Example
### Single and ready to mingle.
```javascript
// Just a simple single socket.
const socket = new BitmexSocket(null, { autoconn: true, limited: true, standalone: true })

// limited: true is the only reason this works.
socket.authenticate(key, secret)
socket.subscribe('trade', 'quote', 'margin', 'wallet', 'position', 'order')

// Socket is ready, lets go.
socket.on('subscribe', (table, channel) => console.log(`${socket.id} has subscribed to ${channel ? `${channel} / ` : ''}${table}`))
socket.on('ready', () => console.log(`${socket.id} has finished it's connection.`))
```
Only trading on a single account or just for data purposes, this is probably the quickest method you can use for a single connection.
- standalone will bypass a bunch of checks and balances for the parent/child server config.

## Working Example II
### Return of the Sockets
```javascript
// Create *two* sockets.
const socket    = new BitmexSocket(null, { autoconn: true, limited: true }) // See, not standalone anymore.
const socket2   = new BitmexSocket(socket, { autoconn: true })              // Master is limited, this one will be as well. No changing that.

// Authenticate teh sockets.
socket.authenticate(key1, secret1)
socket2.authenticate(key2, secret2) 

// Yeah I'm lazy.
const sockets = [socket, socket2]
sockets.forEach(socket => {
    socket.on('subscribe', (table, channel) => console.log(`${socket.id} subscribed to ${table}${channel ? `:${channel}` : '' }`))
    socket.on('ready', () => console.log(`${socket.id} has completed its startup process.`))
})
```

## REST Example
### 'Cause I'm just that nice.
```javascript

// This is an unconnected socket.
const socket = new BitmexSocket(null, { autoconn: true, limited: true })

// You'll do this a lot.
socket.authenticate(key, secret)

// Create a market order for 100 LONG on XBTUSD.
socket.upload('order', 'POST', { size: 100, symbol: "XBTUSD" })

// Create a market order for 100 SHORT on XBTUSD.
socket.upload('order', 'POST', { size: -100, symbol: "XBTUSD" })
```

See *BitMEX Interactive REST Explorer* for how to use this properly. All you need to know on this end is:
- If you're only after public table data from the REST API, you don't need to connect the socket. Just creating it and using `socket.upload()` will be fine.
- If you want private access, you must connect the socket and authenticate it (I will probably change the need for this, later).