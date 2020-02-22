// Requirements.
const WebSocket             = require('ws')
//const BitmexBook            = require('./BitmexBook.js')
const { createHmac }        = require('crypto')
const { Agent, request }    = require('https')

// Break-down BitMEX tables.
const TABLES = {
    private:    ['order', 'position', 'execution', 'affiliate', 'privateNotifications', 'transact', 'margin', 'wallet'],
    token:      ['order', 'position', 'execution', 'funding', 'instrument', 'liquidation', 'orderBookL2_25', 'orderBookL2', 'orderBook10', 'quote', 'quoteBin1m', 'quoteBin5m', 'quoteBin1h', 'quoteBin1d', 'settlement', 'trade', 'tradeBin1m', 'tradeBin5m', 'tradeBin1h', 'tradeBin1d'],
}

// Genreate a random string identifier.
String.generate = () => Math.random().toString(36).substring(2)

// BitMEX Socket Handler.
class BitmexSocket extends WebSocket {
    constructor(symbols = [], tables = [], accounts = [], options = {}) {
        // Ensure constructor vars are accurate.
        if(!symbols)    symbols = []
        if(!tables)     tables = []
        if(!accounts)   accounts = []

        // Build options menu.
        const vars = Object.keys(options || {})

        // Determine if we want testnet or not.
        if(!vars.includes('testnet')) options.testnet = false

        // Initialze the socket on created.
        if(!vars.includes('init')) options.init = true

        // Size and delay in seconds of the message queue.
        if(!vars.includes('queueSize'))  options.queueSize   = 5
        if(!vars.includes('queueDelay')) options.queueDelay  = 5

        // Ping delay in seconds.
        if(!vars.includes('pingDelay')) options.pingDelay = 5

        // Handle reconect.
        if(!vars.includes('reconnect')) options.reconnect = true
        if(!vars.includes('connDelay')) options.connDelay = 10

        // Store a copy of the book within the socket using bitmex-book library.
        if(!vars.includes('book')) options.book = false

        console.log(options)

        // Force symbol API compliance.
        for(let i = 0; i < symbols.length; i++) symbols[i] = symbols[i].toUpperCase()

        // Connect to BitMEX.
        super(`wss://${options.testnet ? 'testnet' : 'www'}.bitmex.com/realtimemd`)

        // Bind constructor options to object.
        this.symbols    = symbols
        this.tables     = tables
        this.accounts   = accounts
        this.options    = options

        // Initialize if required.
        if(options.init) this.init()
    }

    init() {
        // Create a localized book to pass back to local clients.
        this.id     = String.generate()
        this.book   = !this.options.book ? null : new (require('bitmex-book'))

        // Handle round-trip ping-pong.
        const ping = {
            timer: null,
            stop:   () => { if(ping.timer) clearTimeout(ping.timer) },
            init:   () => { ping.stop(); ping.timer = setTimeout(() => this.send("ping"), 1000 * this.options.pingDelay) }
        }

        // Handle the message queue to prevent rate limiting.
        const queue = {
            timeout:    null,
            requests:   [],
            delay:      this.options.queueDelay,
            size:       this.options.queueSize,
            
            // Initialze the loop.
            init:   () => { if(!queue.timeout) queue.timeout = setInterval(queue.loop, 1000 * queue.delay) },
            stop:   () => { if(queue.timeout) clearInterval(queue.timeout) },

            // Parse and add new request to queue.
            add: (...cmds) => {
                // Accept an array instead of params.
                if(cmds.length === 1 && Array.isArray(cmds[0])) cmds = cmds[0]

                // Loop the new requests and add them to the queue.
                for(let i = 0; i < cmds.length; i++) {
                    const data = [cmds[i].type || 0, this.id, cmds[i].id || this.id]
                    if(cmds[i].action) data.push(cmds[i].action)
                    queue.requests.push(JSON.stringify(data))
                }
            },

            // Process the loop.
            loop: () => {
                if(queue.requests.length) {
                    const chunk = queue.requests.splice(0, queue.requests.length > queue.size ? queue.size : queue.requests.length)
                    for(let i = 0; i < chunk.length; i++) this.send(chunk[i])
                }
            }
        }

        // Build the table/symbol/account connections as required.
        const subs = {
            // Do public token subscriptions.
            symbol: symbol => {
                
                // Register stream for the symbol.
                queue.add({ id: symbol, type: 1 })

                // Subscribe to required public tables. TODO: Send all subscription tables in a single command.
                for(let i = 0; i < this.tables.length; i++) {
                    if(TABLES.token.includes(this.tables[i]) && !TABLES.private.includes(this.tables[i])) queue.add({ id: symbol, action: { op: "subscribe", args: `${this.tables[i]}:${symbol}` } })
                }
            },

            account: account => {
                // Give account stream an ID.
                account.id = String.generate()

                // Identify the stream on the socket.
                queue.add({ id: account.id, type: 1 })

                // Authenticate the stream.
                const expires = Math.floor(new Date().getTime() / 1000) + 60
                queue.add({ id: account.id, action: { op: "authKeyExpires", args: [account.key, expires, createHmac('sha256', account.secret).update('GET/realtime' + expires).digest('hex')] }})

                // Search for any private tables to add.
                for(let i = 0; i < this.tables.length; i++) {
                    if(TABLES.private.includes(this.tables[i])) {
                        // Token specific table.
                        if(TABLES.token.includes(this.tables[i])) {
                            if(this.symbols.length) for(let u = 0; u < this.symbols.length; u++) queue.add({ id: account.id, action: { op: "subscribe", args: `${this.tables[i]}:${this.symbols[u]}`} })
                            else queue.add({ id: account.id, action: { op: "subscribe", args: this.tables[i] } })
                        }

                        // Top level table.
                        else queue.add({ id: account.id, action: { op: "subscribe", args: this.tables[i] } })
                    }
                }
            },

            // Subscribe to any tables that aren't covered above.
            tables: table => {
                // We don't do private tables here.
                if(TABLES.private.includes(table)) return
                
                // Subscribe to public tables.
                else if(!TABLES.token.includes(table) || (TABLES.token.includes(table) && !this.symbols.length)) queue.add({ action: { op: "subscribe", args: table } })
            }
        }

        // Handle BitMEX connection/disconnection.
        this.on('open', () => {
            
            // Send main socket connection packet.
            queue.add({ type: 1 })

            // Add accounts to the connection queue.
            for(let i = 0; i < this.accounts.length; i++)   subs.account(this.accounts[i])
            for(let i = 0; i < this.symbols.length; i++)    subs.symbol(this.symbols[i])
            for(let i = 0; i < this.tables.length; i++)     subs.tables(this.tables[i])

            // Initiate the packet loops.
            ping.init()
            queue.init()
        })

        this.on('close', () => { if(this.options.reconnect) setTimeout(this.init, 1000 * this.options.connDelay) })

        // Handle received errors.
        this.on('error', err => {})

        // Emit HTTP Errors as normal errors.
        this.on('unexpected-response', (req, res) => {
            const data = []
            res.on('data', d => data.push(d))
            res.on('end', () => this.emit('error', Buffer.concat(data)))
        })

        // Handle replies from BitMEX.
        this.on('message', message => {
            // Handle ping-pong.
            if(message === "pong") return ping.init()
            else ping.init()

            // Parse the received message.
            message = JSON.parse(message)
            const type      = message[0]    // Message type received from BitMEX.
            const id        = message[1]    // ID of this object.
            const stream    = message[2]    // ID of the stream.
            const reply     = message[3]    // Response from BitMEX.

            switch(type) {

                // Standard response from BitMEX.
                case 0: {

                    // Stream has successfully connected.
                    if(reply.timestamp && reply.version) { 
                        this.emit('connect', stream) 
                    }

                    // Stream has successfully (un)subscribed.
                    else if(reply.success && (reply.subscribe || reply.unsubscribe)) { 
                        this.emit(reply.subscribe ? 'subscribe' : 'unsubscribe', stream, reply.subscribe || reply.unsubscribe) 
                    }

                    // Stream has successfully authenticated.
                    else if(reply.success && reply.authKeyExpires) { 
                        this.emit('auth', stream) 
                    }

                    // Stream has received an error.
                    else if(reply.status) {
                        // Emit the error as normal with stream that generated it.
                        this.emit('error', reply, stream)

                        // Take any necessary actions?
                        switch(reply.status) {
                            // API Error.
                            case 400: break

                            // Authentication Error.
                            case 401: break

                            // Forbidden (Banned) Error.
                            case 403: break

                            // Rate-Limit Error.
                            case 429: break
                        }
                    }

                    // Send the data to the book to process.
                    else if(reply.action) {
                        // Bind stream to data and emit the change.
                        reply.stream = stream
                        this.emit(reply.action, reply)

                        // Parse the change.
                        if(this.options.book) {
                            switch(reply.action) {
                                case 'partial': this.book.partial(reply);   break
                                case 'insert':  this.book.insert(reply);    break
                                case 'update':  this.book.update(reply);    break
                                case 'delete':  this.book.delete(reply);    break
                                default: throw new Error(`Unknown action '${reply.action}' sent by BitMEX. API is outdated.`)
                            }
                        }
                    }
                    break
                }

                // Stream connects, not used on this end of the API.
                case 1: break

                // Remove all data with that Stream ID from the book.
                case 2: {
                    if(this.options.book) this.book.flush(stream)
                    this.emit('disconnect', stream)
                    break
                }

                // Throw an outdated error if packet type is unknown.
                default: throw new Error('Unknown packet-type received from BitMEX. API is outdated.')
            }
        })
    }
}

// Create an Agent to use for REST API.
const agent = new Agent({ keepAlive: true })

// Bridge to the REST API.
function BitmexREST(dir, type = 'GET', account = {}, data = {}) {
    return new Promise((accept, reject) => {
        // Build request options.
        const options = {
            hostname: 'www.bitmex.com',
            port:       443,
            path:       `/api/v1/${dir}`,
            method:     type,
            agent:      agent,
            headers: {
                'Content-Type':     'application/json',
                'Content-Length':   data ? Buffer.byteLength(data) : 0,
            }
        }

        // Public channels will reject if any one of these is present and/or the signature is invalid.
        if(account.key && account.secret) {
            const expires                       = Math.floor(new Date().getTime() / 1000) + 60
            options.headers['api-expires']      = expires
            options.headers['api-key']          = account.key
            options.headers['api-signature']    = createHmac('sha256', account.secret).update(`${type}${options.path}${expires}${data ? data : ''}`).digest('hex')
        }

        // Finish request.
        const req = request(options, res => {
            const result = []
            res.on('data', data => result.push(data))
            res.on('end', () => {
                try         { accept(JSON.parse(Buffer.concat(result).toString())) }    // Everything went as expected.
                catch(e)    { reject(Buffer.concat(result).toString()) }                // Data received isn't JSON. HTML error it is.
            })
        })

        // Reject the promise on received error.
        req.on('error', reject)

        // Send the data down the stream.
        if(data) req.write(data)

        // Finalise the request.
        req.end()
    })
}

// Export all BitMEX functionality.
module.exports = { BitmexSocket, BitmexREST }