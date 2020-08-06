# bitmex-socket
A simple bitmex socket connection handler.

## Usage
```javascript
const BitmexSocket = require('.')

// Create a socket. Require how you want.
const socket = new BitmexSocket

// Standard socket events.
socket.on('connect', () => console.log(`Main socket has connected!`))
socket.on('disconnect', () => console.log(`Main socket has disconnected!`))
socket.on('error', err => console.error(err))

// Create a stream object.
const stream = socket.new_stream()

// Authenticate the stream object.
stream.authenticate('key', 'secret', true)  // Force the authenticate message into the message queue even though stream hasn't connected yet.

// Subscribe to some tables.
stream.subscribe('order', 'position', 'margin', 'wallet')

// Stock stream events.
stream.on('connect',        () => console.log(`Stream ${stream.id} has connected!`))
stream.on('disconnect',     () => console.log(`Stream ${stream.id} has disconnected!`))
stream.on('auth',           () => console.log(`Stream ${stream.id} has authenticated!`))

// Error Event.
stream.on('error', err => console.error(err))

// Table Events. Subscribe events can hit AFTER partial events.
stream.on('subscribe',      (table, channel) => console.log(`Stream ${stream.id} has subscribed to table ${table}${channel ? `:${channel}` : ''}!`))
stream.on('unsubscribe',    (table, channel) => console.log(`Stream ${stream.id} has unsubscribed from table ${table}${channel ? `:${channel}` : ''}!`))
stream.on('partial',        (table, data, full_reply) => console.log(`Stream ${stream.id} received a PARTIAL for ${table}`))
stream.on('insert',         (table, data, full_reply) => console.log(`Stream ${stream.id} received an INSERT for ${table}`))
stream.on('update',         (table, data, full_reply) => console.log(`Stream ${stream.id} received an UPDATE for ${table}`))
stream.on('delete',         (table, data, full_reply) => console.log(`Stream ${stream.id} received a DELETE for ${table}`))

// The stream can also use the REST API. Streams with proper auth credentials may do private things.
stream.send('order', 'POST', { orderQty: 1, symbol: "XBTUSD", side: "Buy" }).then(result => console.log(result)).catch(err => console.error(err))

// If you just only wanted to use the rest API. The master socket object will be connected to BitMEX doing this however.
const stream = socket.new_stream(true) // No connect.
stream.authenticate('key', 'secret') // Adds the key/secret to a secureContext object.

// Stream can now do REST API calls including private if key/secret is valud. If the stream isn't authenticated, it's limited to only public rest API calls.
stream.send('order', 'POST', { orderQty: 1, symbol: "XBTUSD", side: "Sell" }).then(result => console.log(result)).catch(err => console.error(err))

// The socket is rate-limited on our end at 5 request bursts every 5 seconds. So 5 requests, 5 seconds repeat.
// You can alter the rate limits of the message queue on socket creation. Delay is in seconds.
// I have never been rate-limited on the BitMEX end using this queue method and the default selected times.
const new_socket = new BitmexSocket({ queue_size: 5, queue_delay: 5 })

// Streams can be created without the automatic connection over the socket.
const disconnected_stream = new_socket.new_stream(true)
disconnected_stream.authenticate('key', 'secret')
disconnected_stream.subscribe('table', 'table', 'table')
disconnected_stream.connect() // Will attempt to connect, authenticated and subscribe.

// Unsubscribe from tables.
disconnected_stream.unsubscribe('table', 'table')

// A socket can be disconnected manually via disconnect(), if connected manually after, the socket will attempt to authenticate (if needed) and subscribe
// to any channels it was subscribed to priror to disconnect().
disconnected_stream.connect()
disconnected_stream.disconnect()

```

If you like my work, please let me know:  
notwilson@protonmail.com  
Find me in the BitMEX trollbox as notwilson

A jesture of notice or a token of appreciation: 
- ETH: 0xd9979f482da58b4432d0f52eb456f7dd1f4897e6
- BTC: 1HzR3Vyu231E8SsGLUbNYSb92bn6MGLEaV  
- LTC: LTBHggmnrMACoB3JAH8rMy9r8hGxum7ZSw  
- XRP: rBgnUKAEiFhCRLPoYNPPe3JUWayRjP6Ayg (destination tag: 536785858)

## Changelog
- 2.1.0
    - Added full object breakdown for the objects this library exports.
    - Removed `stream.reply()` and `socket.command()` in lieu of internal event messages `_download` and `_upload`. `stream.on('_download', type, reply)` for all raw messages received on the socket. To send commands back `stream.emit('_upload', { })` with the object being a valid message to BitMEX. `{ op: "subscribe", args: "trade" }` for example. To change the message type, add a type item to the object. `{ type: 2 }` sends an empty dc message.
    - Subscriptions to specific channels (`trade:XBTUSD`) now emit their events under the global table and emit a second param for the channel. `stream.on('subscribe', (table, channel) => {})` If channel is omitted, it's the global table `subscribe(table)`, otherwise it's a specific one `subscribe(table:symbol)`.
    - Added REST API to BitmexStream object. `stream.send(dir, type = 'GET', data = {})`. Streams that have authenticated on the socket may also perform private REST functions such as making new orders or whatever other permissions the API key allows.
- 2.0.2
    - Fixed bug in `stream.on('partial|insert|update|delete', (table, data, row) => {})`: data was sending wrong data object.
    - Added force param to `stream.authenticate(key, secret, force = false)`: stream.authenticate() won't add the authenticate message to socket queue if stream isn't already connected unless force is true. It will however add the supplied key/secret to the secureContext for authentication later if connect() is called manually.
    - Added changelog.
- 2.0.1
    - Added ping/pong back for main socket.
    - Improved docs somewhat with examples on disconnect() and connect()
- 2.0.0
    - Complete rewrite and simplification of base library.

## Object Breakdown
```javascript
// BitmexSocket Getters.
BitmexSocket.connected  // Boolean | True if connected, false if disconnected.
BitmexSocket.reconnects // Integer | Amount of times websocket has reconnected to BitMEX during it's life.

// BitmexSocket Functions.
BitmexSocket.add_stream(disconnected = false)   // returns BitmexStream object. If disconnected is true, the stream won't attempt to connect itself.

// BitmexSocket Events.
BitmexSocket.on('connect',      () => {})       // Connected and welcomed by BitMEX.
BitmexSocket.on('disconnect',   () => {})       // Disconnected from BitMEX entirely.
BitmexSocket.on('error',        err => {})      // An error or unexpected-response has been received.

// BitmexStream Getters.
BitmexStream.id         // Returns the ID of the stream.
BitmexStream.socket     // Returns the parent BitmexSocket object.
BitmexStream.auth       // Boolean | True if authenticated, false if not.
BitmexStream.connected  // Boolean |  True if connected, false if not.

// BitmexStream Functions.
BitmexStream.connect()  // Perform connection actions (includiung authenticate and subscribe if wanted)
BitmexStream.disconnect()   // Disconnect the stream.
BitmexStream.authenticate(key, secret, force = false)   // Open access to private tables for a specific account.
BitmexStream.subscribe(...tables)   // Subscribe to a list of tables.
BitmexStream.unsubscribe(...tables) // Unsubscribe from a list of tables.
BitmexStream.send(dir, type, data)  // Send data via the REST API.

// BitmexStream Events.
BitmexStream.on('connect',      () => {})   // Connected and Welcomed by Bitmex.
BitmexStream.on('disconnect',   () => {})   // Stream has disconnected from Bitmex.
BitmexStream.on('auth',         () => {})   // Stream has authenticated.
BitmexStream.on('subscribe',    (table, channel) => {}) // Stream has subscribed to a table or table:channel
BitmexStream.on('unsubscribe',  (table, channel) => {}) // Stream has unsubscribed from a table or table:channel
BitmexStream.on('partial',      (table, data, reply) => {}) // Stream has received a partial for table, with data. The rest of the message is in reply.
BitmexStream.on('insert',       (table, data, reply) => {}) // See above
BitmexStream.on('update',       (table, data, reply) => {}) // See above above
BitmexStream.on('delete',       (table, data, reply) => {}) // See above above above.
BitmexStream.on('_update',      obj => {})  // Send an update to the BitmexSocket to process and forward to Bitmex. Add type:2 etc to change the Bitmex socket message type.
BitmexStream.on('_download',    (type, reply) => {})    // Receive a message from Bitmex via BitmexSocket.
BitmexStream.on('error',        err => {})  // Received an error from BitMEX.
```