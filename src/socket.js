// Node Requirements.
const EventEmitter  = require('events').EventEmitter

// Internal Libs.
const BitmexStream = require('./stream')

// NPM Includes
const WebSocket     = require('ws')

// Object symbols.
const s = {
    socket:     Symbol('socket'), 
    streams:    Symbol('streams'), 
    queue:      Symbol('queue'),
    state:      Symbol('state')
}

// Bitmex Socket.
class BitmexSocket extends EventEmitter {
    constructor(opts = {}) {
        super()

        // State of the object.
        this[s.state] = {
            connected:  false,  // If the main object is connected.
            connects:   0,      // How many times we've used this object to connect (n - 1 = disconnects really)
        }

        // Ping-Pong timer to keep connections alive.
        const ping = {
            tool:       null,
            start:      () => { ping.stop(); ping.tool = setTimeout(() => this[s.socket].send("ping"), 5000) },
            stop:       () => { clearTimeout(ping.tool); ping.tool = null },
            restart:    () => { ping.stop(); ping.start() }
        }

        // Process requests via queue to avoid rate-limit.
        this[s.queue] = {
            timeout:    null,
            requests:   [],
            delay:      opts.queue_delay  || 5,  // Seconds.
            size:       opts.queue_size   || 5,  // Commands to send at once. I've never received a rate limit on these settings regardless of how many connections I make and destroy.

            // Initialze the loop.
            init:   () => { if(!this[s.queue].timeout) this[s.queue].timeout = setInterval(this[s.queue].loop, 1000 * this[s.queue].delay) },
            stop:   () => { if(this[s.queue].timeout) clearInterval(this[s.queue].timeout) },

            // Parse and add new request to queue.
            add: (...cmds) => {
                // Accept an array instead of params.
                if(cmds.length === 1 && Array.isArray(cmds[0])) cmds = cmds[0]

                // Loop the new requests and add them to the queue.
                for(let i = 0; i < cmds.length; i++) {
                    const data = [cmds[i].type || 0, 'main', cmds[i].id || 'main']
                    if(cmds[i].action) data.push(cmds[i].action)
                    this[s.queue].requests.push(JSON.stringify(data))
                }
            },

            // Process the loop.
            loop: () => {
                if(this[s.queue].requests.length) {
                    const chunk = this[s.queue].requests.splice(0, this[s.queue].requests.length > this[s.queue].size ? this[s.queue].size : this[s.queue].requests.length)
                    for(let i = 0; i < chunk.length; i++) this[s.socket].send(chunk[i])
                }
            }
        }

        // Connect to BitMEX.
        this[s.socket] = new WebSocket(`wss://www.bitmex.com/realtimemd`)

        // Connection to bitmex established.
        this[s.socket].on('open', () => {
            // Start the command queue.
            this[s.queue].init()

            // Start ping-pong request.
            ping.start()
        })

        // Connection to BitMEX has closed.
        this[s.socket].on('close', () => {
            // Halt the command queue
            this[s.queue].stop()

            // Stop pinging.
            ping.stop()

            // Re-build command-queue for connection.
            this[s.queue].add({ type: 1 })

            // Streams handle their own subscriptions and junk now. =D
            this[s.streams].forEach(stream => stream.connect())

            // Emit a disconnect message.
            this.emit('disconnect')
        })

        // Received an error from BitMEX.
        this[s.socket].on('error', err => this.emit('error', new Error(err)))

        // Received an unexpected response from BitMIX.
        this[s.socket].on('unexpected-response', (req,res) => {
            const reply = []
            res.on('data', data => reply.push(data))
            res.on('end', () => this.emit('error', new Error(Buffer.from(reply))))
        })

        // Received a message from BitMEX.
        this[s.socket].on('message', message => {
            // Re-start ping-pong.
            ping.restart()

            // Don't parse a pong, mate.
            if(message === "pong") return

            // Parse message.
            message         = JSON.parse(message)
            const type      = message[0]    // Message type received from BitMEX.
            const id        = message[1]    // ID of this object.
            const stream    = message[2]    // ID of the stream.
            const reply     = message[3]    // Response from BitMEX.

            // Notify of an event that shouldn't happen.
            if(type === 1 || type > 2) return void this.emit('error', new Error(`Received unexpected packet type: ${type}`))

            // This is a message for the main master.
            if(id === stream) {
                // A welcome / Successful connection message from BitMEX.
                if(reply.info && reply.version && reply.timestamp && reply.docs) {
                    // Apply connected state.
                    this[s.state].connected = true
                    this[s.state].connects++

                    // Emit a connect event.
                    this.emit('connect')
                }
            }

            // Pass the message to the Stream to handle.
            else this[s.streams][stream].reply(type, reply)
        })

        // Object store for streams we've created.
        this[s.streams] = {}

        // Add connection request to the queue.
        this[s.queue].add({ type: 1 })
    }

    // Object Getters
    get connected()     { return this[s.state].connected }
    get reconnects()    { return this[s.state].connects === 0 ? 0 : this[s.state].connects-- }

    // Create a new Stream.
    new_stream(disconnected = false) {
        // Create a new Stream object.
        const stream = new BitmexStream(this)

        // Bind it to the main object.
        this[s.streams][stream.id] = stream

        // If not flagged as disconnected, send a connection request.
        if(!disconnected) stream.connect()

        // Return the stream object.
        return stream
    }

    // Add a command to the message queue.
    command(stream, cmd) {
        // This was easier than forgetting to add the stream id every time. 
        cmd.id = stream.id

        // Add the command to the queue.
        this[s.queue].add(cmd) 
    }
}

// Export the Object.
module.exports = BitmexSocket