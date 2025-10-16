# SyslogServer

NodeJS Syslog Server providing UDP and optional TCP listeners.

### Quickstart

###### Installation
```shell
$ npm install syslog-server
```

###### Usage
```javascript
const SyslogServer = require("syslog-server");
const server = new SyslogServer();

server.on("message", (value) => {
    console.log(value.date);     // the date/time the message was received
    console.log(value.host);     // the IP address of the host that sent the message
    console.log(value.protocol); // the version of the IP protocol ("IPv4" or "IPv6")
    console.log(value.message);  // the syslog message
});

server.start({
    port: 5514,
    udp: { enabled: true, recvBufferSize: 16 * 1024 * 1024 },
    tcp: { enabled: true, port: 5514 }
});
```

### Functions

###### .start([options], [callback])

- **options** <Object> - Optional - The options passed to the server. Supports the following properties:
    - port [Number] - Optional - Defaults to 514 (shared by UDP and TCP unless overridden).
    - address [String] - Optional - Defaults to "0.0.0.0".
    - exclusive [Boolean] - Optional - Defaults to true.
    - udp [Object] - Optional - `{ enabled: true, recvBufferSize: 16MB }` by default. Disable by setting `enabled: false` or override `recvBufferSize`.
    - tcp [Object] - Optional - `{ enabled: false, port: options.port, address: options.address, allowHalfOpen: false, keepAlive: true, keepAliveDelay: 60000, recvBufferSize: 16MB }`. Set `enabled: true` to accept TCP syslog; override values as needed.

    For more information on the UDP options object, check NodeJS official [API documentation](https://nodejs.org/api/dgram.html#dgram_socket_bind_options_callback). TCP options map to NodeJS [`net.createServer`](https://nodejs.org/api/net.html#netcreateserveroptions-connectionlistener).

- **callback** [Function] - Optional - Callback function called once the server starts, receives an error object as argument should it fail.

The start function returns a Promise.

###### .stop([callback])

- **callback** [Function] - Optional - Callback function called once the server socket is closed, receives an error object as argument should it fail.

The stop function returns a Promise. It shuts down both UDP and TCP listeners (if enabled).

###### .isRunning()

The isRunning function is a synchronous function that returns a boolean value, if the server is ready to receive syslog messages or not.

### Events

- **start** - fired once the server is ready to receive syslog messages
- **stop** - fired once the server is shutdown
- **error** - fired whenever an error occur, an error object is passed to the handler function
- **message** - fired once the server receives a syslog message
- **warn** - emitted when non-fatal issues occur (e.g., failing to raise socket buffer sizes)

### Testing

The project ships with a lightweight smoke test covering both UDP and TCP listeners. Run it with:

```bash
npm test
```

The test suite is verified against Node.js 22.x; older LTS releases (>=16) are also supported.
