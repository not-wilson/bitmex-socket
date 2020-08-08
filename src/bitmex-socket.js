// Node Reqs.
const EventEmitter  = require('events').EventEmitter
const Agent         = require('https').Agent
const request       = require('https').request
const randomBytes   = require('crypto').randomBytes
const createHmac    = require('crypto').createHmac


// NPM Reqs.
const WebSocket     = require('ws')

// Object Symbols / Privates.
const s = { 
    id:         Symbol('id'), 
    parent:     Symbol('parent'),
    opts:       Symbol('opts'),
    kids:       Symbol('kids'),
    socket:     Symbol('socket'),
    status:     Symbol('status'),
    queue:      Symbol('queue')
}

// Store key/secret pairs outside of the object.
const secureContext = {}

// Handle either single or multiple connections via BitMEX.
class BitmexSocket extends EventEmitter {
    constructor(parent = null, opts = {}) {
        super()

        // Create an object ID.
        this[s.id]      = randomBytes(8).toString('hex')
        this[s.opts]    = {}    // Options store, populated below.

        // Opts are things you can set. States are set by the lib. Both are returned under BitmexSocket.opt()
        this[s.status]  = {
            // Connection Status.
            disconnected:   true,
            connecting:     false,
            connected:      false,
            ready:          false,
            authenticated:  false,

            // Save-State
            wants:  [],
            needs:  [],

            // REST API.
            agent:  new Agent({ keepAlive: true })
        }

        // Do object options.
        config_options(this, opts)
        build_queue(this)   // Add the message queue if wanted.

        // Configure for Standalone.
        if(this.opt('standalone')) return void config_for_standalone(this, parent)

        // Configure for child.
        if(parent)  return void config_for_child(this, parent)

        // Configure for parent.
        else return void config_for_parent(this)
    }

    // Getters.
    get id() { return this[s.id] }

    // Check the value of an option.
    opt(o) { return this[s.opts][o] || this[s.status][o] || false }

    // Break-out connect/disconnect functions..
    connect() { socket_connect(this) }

    // Disconnect from BitMEX.
    disconnect() { socket_close(this) }

    // Send messages back to BitMEX.
    send(action) { socket_send(this, action) }

    // Authenticate the socket.
    authenticate(key, secret) {
        // No key/secret pair.
        if(!key || !secret) return void this.emit('error', new Error(`Cannot read key/secret pair.`))

        // Add the key/secret pair to secureContext for reference later.
        secureContext[this.id] = { key, secret }

        // Convert a JS timestamp to a Unix timestamp and add a minute.
        const expires = Math.floor(new Date().getTime() / 1000) + 60

        // Send an authenticate request if connected, otherwise add key/secret to the secureInfo and wait for connect() call.
        this.send({ op: "authKeyExpires", args: [key, expires, createHmac('sha256', secret).update('GET/realtime' + expires).digest('hex')] })
    }

    // Subscribe to tables.
    subscribe(...tables) {
        const goodo = []
        tables.forEach(table => { 
            if(!this.opt('needs').includes(table)) { this.opt('needs').push(table) } 
            if(!this.opt('wants').includes(table)) { this.opt('wants').push(table); goodo.push(table) }
        })

        this.send({ op: "subscribe", args: goodo })
    }

    // Unsubscribe from tables.
    unsubscribe(...tables) {
        tables.forEach(table => { 
            if(this.opt('needs').includes(table)) this.opt('needs').splice(this.opts('needs').indexOf(table), 1) 
            if(this.opt('wants').includes(table)) this.opt('wants').splice(this.opts('wants').indexOf(table), 1) 
        })

        this.send({ op: "unsubscribe", args: tables })
    }

    // Send data along the REST API.
    upload(path, type = 'GET', data = {}) {
        // Stringify the JSON data.
        if(data) data = JSON.stringify(data)

        // Return a promise for a result.
        return new Promise((accept, reject) => {
            // Build request options.
            const options = {
                hostname: 'www.bitmex.com',
                port:       443,
                path:       `/api/v1/${path}`,
                method:     type,
                agent:      this[s.state].agent,
                headers: {
                    'Content-Type':     'application/json',
                    'Content-Length':   data ? Buffer.byteLength(data) : 0,
                }
            }

            // Public channels will reject if any one of these is present and/or the signature is invalid.
            const context = secureContext[this.id]
            if(context) {
                const expires                       = Math.floor(new Date().getTime() / 1000) + 60
                options.headers['api-expires']      = expires
                options.headers['api-key']          = context.key
                options.headers['api-signature']    = createHmac('sha256', context.secret).update(`${type}${options.path}${expires}${data ? data : ''}`).digest('hex')
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
}

// Export the socket.
module.exports = BitmexSocket

// Configure the default options for the object.
function config_options(bitmex, opts) {
    // Load supplied options and compare to default.
    const vars = Object.keys(opts)

    // Don't add event listeners for child streams. Connect to /realtime instead of /realtimemd?
    if(!vars.includes('standalone')) opts.standalone = false

    // Don't include testnet.
    if(!vars.includes('testnet')) opts.testnet = false

    // Automatically send a connection message upon creation.
    if(!vars.includes('autoconn')) opts.autoconn = false

    // Use the message queue to handle sending messages.
    if(!vars.includes('limited')) opts.limited = false

    // Set the time limit between message bursts.
    if(!vars.includes('queue_delay')) opts.queue_delay = 5

    // Number of messages to send in a burst.
    if(!vars.includes('queue_size')) opts.queue_size = 5

    // Replace the random string identifier if wanted.
    if(vars.includes('id')) bitmex[s.id] = opts.id

    // Bind the options.
    bitmex[s.opts] = opts
}

function build_queue(bitmex) {
    // We use the parents queue if they have one.
    if(bitmex[s.parent]) return

    // Process requests via queue to avoid rate-limit.
    bitmex[s.queue] = {
        timeout:    null,
        requests:   [],
        delay:      bitmex.opt('queue_delay')  || 5,  // Seconds.
        size:       bitmex.opt('queue_size')   || 5,  // Commands to send at once. I've never received a rate limit on these settings regardless of how many connections I make and destroy.

        // Initialze the loop.
        init:   () => { if(!bitmex[s.queue].timeout) bitmex[s.queue].timeout = setInterval(bitmex[s.queue].loop, 1000 * bitmex[s.queue].delay) },
        stop:   () => { if(bitmex[s.queue].timeout) clearInterval(bitmex[s.queue].timeout) },

        // Parse and add new request to queue.
        add: (...cmds) => {
            // Add commands to array.
            cmds.forEach(cmd => bitmex[s.queue].requests.push(cmd))

            // Order the commands or we'll be here all day.
            bitmex[s.queue].requests.sort((first, second) => {
                // Connection messages first.
                if(first[0] > second[0]) return -1

                // Put auth messages ahead of subscriptions.
                if(first[3]) {
                    if(!second[3]) return 1
                    if(second[3] && first[3] === "authKeyExpires" && second[3] !== "authKeyExpires") return -1
                    if(second[3] && first[3] === "authKeyExpires" && second[3] === "authKeyExpires") return 0
                }
            })
        },

        // Process the loop.
        loop: () => {
            if(bitmex[s.queue].requests.length) {
                const chunk = bitmex[s.queue].requests.splice(0, bitmex[s.queue].requests.length > bitmex[s.queue].size ? bitmex[s.queue].size : bitmex[s.queue].requests.length)
                for(let i = 0; i < chunk.length; i++) bitmex[s.socket].send(JSON.stringify(chunk[i]))
            }
        }
    }
}

// Configure object to be a parent stream.
function config_for_parent(bitmex) {
    // Add a kids store.
    bitmex[s.kids] = {}

    // Add circular ref for easier messaging.
    bitmex[s.kids][bitmex.id] = bitmex

    // Everything is fine. Connect to BitMEX.
    if(bitmex.opt('autoconn')) bitmex.connect()
}

// Configure object to be a child stream.
function config_for_child(bitmex, parent) {
    // It's not out of reason that like vice-versa, standalone child, I could just config_for_parent() and have the stream connection states sync.
    //if(parent.opt('standalone')) throw new Error(`BitmexSocket.constructor() standalone servers cannot be parents.`)
    if(parent.opt('standalone')) return void config_for_parent(bitmex)

    // Add this object to the parent.
    parent[s.kids][bitmex.id] = bitmex

    // Add a parent reference to this.
    bitmex[s.parent] = parent

    // Everything is fine. Connect to BitMEX.
    if(bitmex.opt('autoconn')) bitmex.connect()
}

// Configure for standalone.
function config_for_standalone(bitmex, parent = null) {
    // Add stand-alone to parent list of kids. Does nothing but syncs connection states. Both will connect when master does.
    if(parent) parent[s.kids][bitmex.id] = bitmex
}

// Handle a BitmexSocket.connect()
function socket_connect(bitmex) {
    // Don't allow double connects.
    if(bitmex.opt('connecting') || bitmex.opt('connected')) return

    // Upgrade connection status.
    bitmex[s.status].disconnected   = false
    bitmex[s.status].connecting     = true

    // Child Stream. Send connection request.
    if(bitmex[s.parent]) return void socket_open(bitmex)

    // Create socket object.
    const socket = new WebSocket(`wss://${bitmex.opt('testnet') ? 'testnet' : 'www'}.bitmex.com/${bitmex.opt('standalone') ? 'realtime' : 'realtimemd'}`) 
    
    // Forward these to handler functions.
    socket.on('open',   () => { socket_open(bitmex); bitmex[s.queue].init() })
    socket.on('close',  () => { socket_close(bitmex, true); bitmex[s.queue].stop() })
    socket.on('message', message => socket_message(bitmex, message))

    // Forward error events up an object.
    socket.on('error', err => this.emit('error', err))

    // Process unexpected responses and pass them up an object as well.
    socket.on('unexpected-response', (req, res) => {
        const data = []
        res.on('data', d => data.push(d))
        res.on('end', () => this.emit('error', Buffer.from(data).toString()))
    })

    // Bind socket to bitmex object.
    bitmex[s.socket] = socket
}

// Connected to bitmex from websocket.
function socket_open(bitmex, from_server = false) {
    // Ignore for connected clients.
    if(bitmex.opt('connected')) return
    
    // Standalone server, wait for response from BitMEX.
    if(bitmex.opt('standalone') && !from_server) return

    // Not a standalone server, request a connection.
    if(!bitmex.opt('standalone') && !from_server) return void bitmex.send({ type: 1 })

    // Set the default states.
    bitmex[s.status].connecting    = false
    bitmex[s.status].connected     = true

    // Check if stream can authenticate.
    const ctxt = secureContext[bitmex.id]
    if(ctxt) bitmex.authenticate(ctxt.key, ctxt.secret)

    // Subscribe to wanted channels.
    if(bitmex[s.status].needs.length) bitmex.subscribe(...bitmex[s.status].needs)

    // Emit a connect event.
    bitmex.emit('connect')
}

// Disconnected from BitMEX via websocket.
function socket_close(bitmex, from_server = false) {
    // Ignore for disconnected clients.
    if(bitmex.opt('disconnected')) return

    // Terminate socket for stand-alone sockets and if master server closes.
    if(!bitmex[s.parent] && !from_server) return void bitmex[s.socket].terminate()

    // Send disconnection request.
    if(!bitmex.opt('standalone') && !from_server) return void bitmex.send({ type: 2 })

    // Send DC commands to all kids.
    if(bitmex[s.kids] && from_server) {
        Object.keys(bitmex[s.kids]).forEach(key => {
            if(key !== bitmex.id) socket_close(bitmex[s.kids][key], !bitmex[s.kids][key].opt('standalone'))
        })
    }
    
    // Update status.
    bitmex[s.status].authenticated  = false
    bitmex[s.status].connected      = false
    bitmex[s.status].connecting     = false
    bitmex[s.status].disconnected   = true
    bitmex[s.status].ready          = false
    bitmex[s.status].wants          = []

    // Emit disconnect message.
    bitmex.emit('disconnect')
}

// Receive messages from BitMEX.
function socket_message(bitmex, message) {
    // Parse the message.
    message = JSON.parse(message)

    // Forward message for standalone.
    if(bitmex.opt('standalone')) receive_message(bitmex, message)

    // Parse message for parent.
    else {
        const type      = message[0]    // Parent ID is message[1]. But we added parent to kid, so stream ID will work for parent too =D
        const stream    = message[2]
        const reply     = message[3]

        // Send message to appropriate object.
        switch(type) {
            case 0:     return void receive_message(bitmex[s.kids][stream], reply)
            case 2:     return void socket_close(bitmex[s.kids][stream], true)
            default:    return void this.emit('error', new Error(`Unexpected packet-type received from BitMEX. Packet type: '${type}'`))
        }
    }
}

// Handle received messages.
function receive_message(bitmex, reply) {
    // A welcome / Successful connection message from BitMEX.
    if(reply.info && reply.version && reply.timestamp && reply.docs) return void socket_open(bitmex, true)

    // This stream has been successfully authenticated.
    else if(reply.success && reply.request.op === "authKeyExpires") {
        // Apply authenticated state.
        bitmex[s.status].authenticated = true

        // Emit the auth event.
        return void bitmex.emit('auth')
    }

    // A successful subscription event.
    else if(reply.success && reply.subscribe) {
        // If symbol specific, emit the table and symbol separately.
        if(reply.subscribe.includes(':')) {
            const tab   = reply.subscribe.substring(0, reply.subscribe.indexOf(':'))
            const strm  = reply.subscribe.substring(reply.subscribe.indexOf(':') + 1)
            bitmex.emit('subscribe', tab, strm)

        // Emit the subscription event.
        } else bitmex.emit('subscribe', reply.subscribe)

        // Remove table from wanted list.
        if(bitmex.opt('wants').includes(reply.subscribe)) bitmex.opt('wants').splice(bitmex.opt('wants').indexOf(reply.subscribe), 1) 

        // Do a simple ready-check.
        if(!bitmex.opt('wants').length && !bitmex.opt('ready')) {
            bitmex[s.status].ready = true
            bitmex.emit('ready')
        }
    }

    // A successful unsubscription event.
    else if(reply.success && reply.unsubscribe) {
        // Remove table from needs list.
        bitmex.opt('needs').splice(bitmex.opt('needs').findIndex(reply.unsubscribe), 1)

        // If symbol specific, emit the table and symbol separately.
        if(reply.unsubscribe.includes(':')) {
            const tab   = reply.unsubscribe.substring(0, reply.unsubscribe.indexOf(':'))
            const strm  = reply.unsubscribe.substring(reply.unsubscribe.indexOf(':') + 1)
            return void bitmex.emit('unsubscribe', tab, strm)

        // Emit the subscription event.
        } else return void bitmex.emit('unsubscribe', reply.unsubscribe)
    }

    // An error has been detected.
    else if(reply.status && reply.error) {
        // Skip the already-authenticated error. They send an authentication success packet just prior to it.
        if(reply.status === 400 && reply.error.includes('already') && reply.error.includes('authenticated')) return

        // Create an Error object.
        const error     = new Error(reply.error)
        error.status    = reply.status

        // Emit the error.
        return void bitmex.emit('error', error)
    }

    // Emit the table events?
    else if(reply.table && reply.action) {
        // Break out the data to send it as a separate parameter.
        const data = reply.data
        delete reply.data

        // Emit the event as the action, with table and data. Add the modified reply (less data) to the end in case we want keys or attributes from partial.
        return void bitmex.emit(reply.action, reply.table, data, reply)
    }

    // Fire off any unknown replies as errors so I'll know about them soon enough.
    else return void bitmex.emit('error', new Error('Unknown reply from BitmexStream'), reply)
}

// Send messages back up to BitMEX.
function socket_send(bitmex, action) {
    // Standalone, send command directly to BitMEX.
    if(bitmex.opt('standalone')) return void bitmex[s.socket].send(JSON.stringify(action))

    // Child stream, add the ID and ask the parent to send it.
    if(bitmex[s.parent]) {
        action.id = bitmex.id
        return void bitmex[s.parent].send(action)
    }
    
    // Parent stream. Build deafult reply.
    const type      = action.type   || 0
    const parent    = bitmex.id
    const child     = action.id     || bitmex.id

    // Delete the extracted data points.
    if(action.type) delete action.type
    if(action.id)   delete action.id

    // Build reply object.
    const reply  = [type, parent, child]

    // Add action if it still exists.
    if(Object.keys(action).length) reply.push(action)

    // Add message to message queue.
    if(bitmex.opt('limited')) bitmex[s.queue].add(reply)

    // Send message directly to BitMEX.
    else bitmex[s.socket].send(JSON.stringify(reply))
}