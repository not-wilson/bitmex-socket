# bitmex-socket
All-in-one solution to handling connection and data send/receive to BitMEX.

If you like my work, please let me know:  
notwilson@protonmail.com  
Find me in the BitMEX trollbox as notwilson

A jesture of notice or a token of appreciation: 
- ETH: 0xd9979f482da58b4432d0f52eb456f7dd1f4897e6
- BTC: 1HzR3Vyu231E8SsGLUbNYSb92bn6MGLEaV  
- LTC: LTBHggmnrMACoB3JAH8rMy9r8hGxum7ZSw  
- XRP: rBgnUKAEiFhCRLPoYNPPe3JUWayRjP6Ayg (destination tag: 536785858)

# Changelog
## 3.X
- 3.0.0
    - Added DOCS.md
    - *Another* Complete rewrite. Five minutes into a bot and the flaws of the last one were apparent.

## 2.X
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