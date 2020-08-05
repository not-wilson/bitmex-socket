// Node Requirements.
const EventEmitter  = require('events').EventEmitter
const randomBytes   = require('crypto').randomBytes
const createHmac    = require('crypto').createHmac

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
            tables:         []
        }
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
        this.socket.command(this, { type: 1 })

        // Send auth/subscription requests for any tables we already want.
        if(secureContext[this.id])      this.authenticate(secureContext[this.id].key, secureContext[this.id].secret)
        if(this[s.state].tables.length) this.socket.command(this, { action: { op: "subscribe", args: this[s.state].tables } })
    }

    // Disconnect from main socket. unclean = don't send unsubscribes for tables, just drop connection.
    disconnect() { 
        // Cancel function if not connected.
        if(!this[s.state].connected) return

        // Send disconnect request.
        this.socket.command(this, { type: 2 }) 
    }

    // Upgrade stream to a private stream.
    authenticate(key, secret) {
        // Convert a JS timestamp to a Unix timestamp and add a minute.
        const expires = Math.floor(new Date().getTime() / 1000) + 60

        // Send an authenticate request.
        this.socket.command(this, { action: { op: "authKeyExpires", args: [key, expires, createHmac('sha256', secret).update('GET/realtime' + expires).digest('hex')] }})

        // Add the key and secret for use later.
        if(!secureContext[this.id]) secureContext[this.id] = { key, secret }
    }

    // Subscribe to a table.
    subscribe(...tables) {
        // Send the subscription request to BitMEX.
        this.socket.command(this, { action: { op: "subscribe", args: tables } })
    }

    // Unsubscribe from a table.
    unsubscribe(...tables) {
        // Send the unsub request.
        this.socket.command(this, { action: { op: "unsubscribe", args: tables } })  
    }

    // Parse a reply from the main socket.
    reply(type, reply) {

        // Standard communications.
        if(!type) {
        
            // A welcome / Successful connection message from BitMEX.
            if(reply.info && reply.version && reply.timestamp && reply.docs) {
                // Apply the connected state.
                this[s.state].connected = true
                
                // Emit a connect event.
                this.emit('connect')
            }

            // This stream has been successfully authenticated.
            else if(reply.success && reply.request.op === "authKeyExpires") {
                // Apply authenticated state.
                this[s.state].authenticated = true

                // Emit the auth event.
                this.emit('auth')
            }

            // A successful subscription event.
            else if(reply.success && reply.subscribe) {
                // Add the table to the list.
                this[s.state].tables.push(reply.subscribe)

                // Emit the subscription.
                this.emit('subscribe', reply.subscribe)
            }

            // A successful unsubscription event.
            else if(reply.success && reply.unsubscribe) {
                // Remove table from list.
                const index = this[s.state].tables.findIndex(val => val === reply.unsubscribe)
                this[s.state].tables.splice(index, 1)

                // Emit the unsubscription.
                this.emit('unsubscribe', reply.unsubscribe)
            }

            // An error has been detected.
            else if(reply.status && reply.error) {
                // Create an Error object.
                const error = new Error(reply.error)
                error.status = reply.status

                // Emit the error.
                this.emit('error', error)
            }

            // Emit the table events?
            else if(reply.table && reply.action) {
                // Break out the data to send it as a separate parameter.
                const data = reply.data
                delete reply.data

                // Emit the event as the action, with table and data. Add the modified reply (less data) to the end in case we want keys or attributes from partial.
                this.emit(reply.action, reply.table, reply.data, reply)
            }

            // Fire off any unknown replies as errors so I'll know about them soon enough.
            else this.emit('error', new Error('Unknown reply from BitmexStream'), reply)
        }

        // This stream has been disconnected.
        else {
            // Still have yet to figure out why they send the DC message twice.
            if(this[s.state].connected) {
                // Update connection status.
                this[s.state].connected = false

                // Disconnect the object.
                this.emit('disconnect')
            }
        }
    }
}

// Export module.
module.exports = BitmexStream