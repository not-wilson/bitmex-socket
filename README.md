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
stream.authenticate('key', 'secret')

// Subscribe to some tables.
stream.subscribe('order', 'position', 'margin', 'wallet')

// Stock stream events.
stream.on('connect',        () => console.log(`Stream ${stream.id} has connected!`))
stream.on('disconnect',     () => console.log(`Stream ${stream.id} has disconnected!`))
stream.on('auth',           () => console.log(`Stream ${stream.id} has authenticated!`))

// Error Event.
stream.on('error', err => console.error(err))

// Table Events. Subscribe events can hit AFTER partial events.
stream.on('subscribe',      table => console.log(`Stream ${stream.id} has subscribed to table ${table}!`))
stream.on('unsubscribe',    table => console.log(`Stream ${stream.id} has unsubscribed from table ${table}!`))
stream.on('partial',        (table, data, full_reply) => console.log(`Stream ${stream.id} received a PARTIAL for ${table}`))
stream.on('insert',         (table, data, full_reply) => console.log(`Stream ${stream.id} received an INSERT for ${table}`))
stream.on('update',         (table, data, full_reply) => console.log(`Stream ${stream.id} received an UPDATE for ${table}`))
stream.on('update',         (table, data, full_reply) => console.log(`Stream ${stream.id} received a DELETE for ${table}`))
```

If you like my work, please let me know:  
notwilson@protonmail.com  
Find me in the BitMEX trollbox as notwilson

A jesture of notice or a token of appreciation: 
ETH: 0xd9979f482da58b4432d0f52eb456f7dd1f4897e6
BTC: 1HzR3Vyu231E8SsGLUbNYSb92bn6MGLEaV  
LTC: LTBHggmnrMACoB3JAH8rMy9r8hGxum7ZSw  
XRP: rBgnUKAEiFhCRLPoYNPPe3JUWayRjP6Ayg (destination tag: 536785858)