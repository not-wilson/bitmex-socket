// Node Requirements.
const EventEmitter  = require('events').EventEmitter
const randomBytes   = require('crypto').randomBytes
const createHmac    = require('crypto').createHmac
const Agent         = require('https').Agent
const request       = require('https').request

// Object symbols.
const s = {
    id:         Symbol('id'),
    socket:     Symbol('socket'),
    tables:     Symbol('tables'),
    state:      Symbol('state')
}

// Retain key/secret independent of Stream objects.
const secureContext = {}

// BitmexStream Object.
class BitmexStream extends EventEmitter {
    constructor(socket) {
        super()

        // Create a random ID for the object.
        this[s.id] = randomBytes(8).toString('hex')

        // Bind socket object to this object.
        this[s.socket] = socket

        // Store the current state of the object.
        this[s.state] = {
            connected:      false,
            authenticated:  false,
            tables:         [],
            agent:          new Agent({ keeyAlive: true })
        }

        // Receive messages from the master socket.
        this.on('_download', (type, reply) => download(this, type, reply))
    }

    // Object Getters.
    get id()        { return this[s.id] }
    get socket()    { return this[s.socket] }
    get auth()      { return this[s.state].authenticated }
    get connected() { return this[s.state].connected }

    // Connect to main socket.
    connect() {
        // Cancel function if already connected.
        if(this[s.state].connected) return

        // Send a connect packet up the stream.
        this.emit('_upload', { type: 1 })

        // Send auth/subscription requests for any tables we already want.
        if(secureContext[this.id])      this.authenticate(secureContext[this.id].key, secureContext[this.id].secret)
        if(this[s.state].tables.length) this.emit('_upload', { op: "subscribe", args: this[s.state].tables })
    }

    // Disconnect from main socket. unclean = don't send unsubscribes for tables, just drop connection.
    disconnect() { 
        // Cancel function if not connected.
        if(!this[s.state].connected) return

        // Send disconnect request.
        this.emit('_upload', { type: 2 })
    }

    // Upgrade stream to a private stream.
    authenticate(key, secret, force = false) {
        // Convert a JS timestamp to a Unix timestamp and add a minute.
        const expires = Math.floor(new Date().getTime() / 1000) + 60

        // Send an authenticate request if connected, otherwise add key/secret to the secureInfo and wait for connect() call.
        if(this[s.state].connected || force) this.emit('_upload', { op: "authKeyExpires", args: [key, expires, createHmac('sha256', secret).update('GET/realtime' + expires).digest('hex')] })

        // Add the key and secret for use later.
        if(!secureContext[this.id]) secureContext[this.id] = { key, secret }
    }

    // Subscribe to a table.
    subscribe(...tables) {
        // Send the subscription request to BitMEX.
        this.emit('_upload', { op: "subscribe", args: tables })
    }

    // Unsubscribe from a table.
    unsubscribe(...tables) {
        // Send the unsub request.
        this.emit('_upload', { op: "unsubscribe", args: tables })
    }

    // Send data along the REST API.
    send(path, type = 'GET', data = {}) {
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

// Export module.
module.exports = BitmexStream

// Handle messages from master socket.
function download(stream, type, reply) {
    // Standard communications.
    if(!type) {
        // A welcome / Successful connection message from BitMEX.
        if(reply.info && reply.version && reply.timestamp && reply.docs) {
            // Apply the connected state.
            stream[s.state].connected = true
            
            // Emit a connect event.
            stream.emit('connect')
        }

        // This stream has been successfully authenticated.
        else if(reply.success && reply.request.op === "authKeyExpires") {
            // Apply authenticated state.
            stream[s.state].authenticated = true

            // Emit the auth event.
            stream.emit('auth')
        }

        // A successful subscription event.
        else if(reply.success && reply.subscribe) {
            // Add the table to the list.
            stream[s.state].tables.push(reply.subscribe)

            // If symbol specific, emit the table and symbol separately.
            if(reply.subscribe.includes(':')) {
                const tab   = reply.subscribe.substring(0, reply.subscribe.indexOf(':'))
                const strm  = reply.subscribe.substring(reply.subscribe.indexOf(':') + 1)
                stream.emit('subscribe', tab, strm)

            // Emit the subscription event.
            } else stream.emit('subscribe', reply.subscribe)
        }

        // A successful unsubscription event.
        else if(reply.success && reply.unsubscribe) {
            // Remove table from list.
            const index = stream[s.state].tables.findIndex(val => val === reply.unsubscribe)
            stream[s.state].tables.splice(index, 1)

            // If symbol specific, emit the table and symbol separately.
            if(reply.unsubscribe.includes(':')) {
                const tab   = reply.unsubscribe.substring(0, reply.unsubscribe.indexOf(':'))
                const strm  = reply.unsubscribe.substring(reply.unsubscribe.indexOf(':') + 1)
                stream.emit('unsubscribe', tab, strm)

            // Emit the subscription event.
            } else stream.emit('unsubscribe', reply.unsubscribe)
        }

        // An error has been detected.
        else if(reply.status && reply.error) {
            // Create an Error object.
            const error = new Error(reply.error)
            error.status = reply.status

            // Emit the error.
            stream.emit('error', error)
        }

        // Emit the table events?
        else if(reply.table && reply.action) {
            // Break out the data to send it as a separate parameter.
            const data = reply.data
            delete reply.data

            // Emit the event as the action, with table and data. Add the modified reply (less data) to the end in case we want keys or attributes from partial.
            stream.emit(reply.action, reply.table, data, reply)
        }

        // Fire off any unknown replies as errors so I'll know about them soon enough.
        else stream.emit('error', new Error('Unknown reply from BitmexStream'), reply)
    }

    // This stream has been disconnected.
    else {
        // Still have yet to figure out why they send the DC message twice.
        if(stream[s.state].connected) {
            // Update connection status.
            stream[s.state].connected = false

            // Disconnect the object.
            stream.emit('disconnect')
        }
    }
}