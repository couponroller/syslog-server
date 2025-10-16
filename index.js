"use strict";

const dgram = require("dgram");
const net = require("net");
const EventEmitter = require("events");

const DEFAULT_OPTIONS = {
    port: 514,
    address: "0.0.0.0",
    exclusive: true,
    recvBufferSize: 16 * 1024 * 1024,
    udp: {
        enabled: true,
        recvBufferSize: 16 * 1024 * 1024
    },
    tcp: {
        enabled: false,
        port: 514,
        address: "0.0.0.0",
        allowHalfOpen: false,
        keepAlive: true,
        keepAliveDelay: 60_000,
        recvBufferSize: 16 * 1024 * 1024
    }
};

class SyslogServer extends EventEmitter {

    constructor() {
        super();
        this.udpSocket = null;
        this.tcpServer = null;
        this.tcpSockets = new Set();
    }

    start(options = { port: 514, address: "0.0.0.0", exclusive: true }, cb) {
        const mergedOptions = normalizeOptions(options);

        return new Promise((resolve, reject) => {
            if (this.isRunning()) {
                const errorObj = createErrorObject(null, "NodeJS Syslog Server is already running!");
                if (cb) cb(errorObj, this);
                return reject(errorObj);
            }

            const startupTasks = [];

            if (mergedOptions.udp.enabled) {
                startupTasks.push(this.#startUdp(mergedOptions));
            }

            if (mergedOptions.tcp.enabled) {
                startupTasks.push(this.#startTcp(mergedOptions));
            }

            if (startupTasks.length === 0) {
                const errorObj = createErrorObject(null, "At least one transport (UDP/TCP) must be enabled.");
                if (cb) cb(errorObj, this);
                return reject(errorObj);
            }

            Promise.all(startupTasks)
                .then(() => {
                    this.emit("start", this);
                    if (cb) cb(null, this);
                    resolve(this);
                })
                .catch((err) => {
                    this.stop().catch(() => undefined).finally(() => {
                        const errorObj = createErrorObject(err, "NodeJS Syslog Server failed to start!");
                        if (cb) cb(errorObj, this);
                        reject(errorObj);
                    });
                });
        });
    }

    stop(cb) {
        return new Promise((resolve, reject) => {
            if (!this.isRunning()) {
                const errorObj = createErrorObject(null, "NodeJS Syslog Server is not running!");
                if (cb) cb(errorObj, this);
                return reject(errorObj);
            }

            const shutdownTasks = [];

            if (this.udpSocket) {
                shutdownTasks.push(new Promise((resolveUdp) => {
                    this.udpSocket.close(() => {
                        this.udpSocket = null;
                        resolveUdp();
                    });
                }));
            }

            if (this.tcpServer) {
                shutdownTasks.push(new Promise((resolveTcp) => {
                    for (const socket of this.tcpSockets) {
                        socket.destroy();
                    }
                    this.tcpSockets.clear();
                    this.tcpServer.close(() => {
                        this.tcpServer = null;
                        resolveTcp();
                    });
                }));
            }

            Promise.all(shutdownTasks)
                .then(() => {
                    this.emit("stop");
                    if (cb) cb(null, this);
                    resolve(this);
                })
                .catch((err) => {
                    const errorObj = createErrorObject(err, "Failed to stop NodeJS Syslog Server!");
                    if (cb) cb(errorObj, this);
                    reject(errorObj);
                });
        });
    }

    isRunning() {
        return this.udpSocket !== null || this.tcpServer !== null;
    }

    #startUdp(options) {
        return new Promise((resolve, reject) => {
            this.udpSocket = dgram.createSocket("udp4");
            const socket = this.udpSocket;

            try {
                const size = options.udp.recvBufferSize ?? options.recvBufferSize;
                if (typeof socket.setRecvBufferSize === "function" && size) {
                    socket.setRecvBufferSize(size);
                }
            } catch (err) {
                this.emit("warn", createErrorObject(err, "Failed to set UDP receive buffer size."));
            }

            socket.on("error", (err) => {
                this.emit("error", err);
                reject(err);
            });

            socket.on("message", (msg, remote) => {
                const message = {
                    date: new Date(),
                    host: remote.address,
                    message: msg.toString("utf8"),
                    protocol: remote.family || "udp"
                };
                this.emit("message", message);
            });

            socket.on("close", () => {
                this.emit("udp-close");
            });

            socket.bind(
                {
                    port: options.port,
                    address: options.address,
                    exclusive: options.exclusive
                },
                (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                }
            );
        });
    }

    #startTcp(options) {
        return new Promise((resolve, reject) => {
            const tcpOptions = options.tcp;
            const server = net.createServer({ allowHalfOpen: tcpOptions.allowHalfOpen }, (socket) => {
                this.tcpSockets.add(socket);

                if (tcpOptions.keepAlive) {
                    socket.setKeepAlive(true, tcpOptions.keepAliveDelay);
                }

                if (typeof socket.setNoDelay === "function") {
                    socket.setNoDelay(true);
                }

                try {
                    const size = tcpOptions.recvBufferSize ?? options.recvBufferSize;
                    if (typeof socket.setRecvBufferSize === "function" && size) {
                        socket.setRecvBufferSize(size);
                    }
                } catch (err) {
                    this.emit("warn", createErrorObject(err, "Failed to set TCP receive buffer size."));
                }

                let buffer = "";

                socket.on("data", (chunk) => {
                    buffer += chunk.toString("utf8");
                    buffer = buffer.replace(/\r\n/g, "\n");
                    const lines = buffer.split("\n");
                    buffer = lines.pop() ?? "";

                    for (const line of lines) {
                        if (line.length === 0) continue;
                        const message = {
                            date: new Date(),
                            host: socket.remoteAddress,
                            message: line,
                            protocol: socket.remoteFamily || "tcp"
                        };
                        this.emit("message", message);
                    }
                });

                socket.on("end", () => {
                    if (buffer.length > 0) {
                        const message = {
                            date: new Date(),
                            host: socket.remoteAddress,
                            message: buffer,
                            protocol: socket.remoteFamily || "tcp"
                        };
                        this.emit("message", message);
                        buffer = "";
                    }
                    socket.destroy();
                });

                socket.on("close", () => {
                    this.tcpSockets.delete(socket);
                });

                socket.on("error", (err) => {
                    this.emit("error", err);
                    this.tcpSockets.delete(socket);
                    socket.destroy();
                });
            });

            this.tcpServer = server;

            server.on("error", (err) => {
                this.emit("error", err);
                reject(err);
            });

            server.listen(
                {
                    port: tcpOptions.port,
                    host: tcpOptions.address,
                    exclusive: options.exclusive
                },
                () => {
                    resolve();
                }
            );
        });
    }
}

function normalizeOptions(options = {}) {
    const merged = {
        ...DEFAULT_OPTIONS,
        ...options,
        udp: {
            ...DEFAULT_OPTIONS.udp,
            ...(options.udp || {})
        },
        tcp: {
            ...DEFAULT_OPTIONS.tcp,
            ...(options.tcp || {})
        }
    };

    // Backwards compatibility for legacy signature
    if (typeof options.port === "number" && merged.tcp.port === DEFAULT_OPTIONS.tcp.port) {
        merged.tcp.port = options.port;
    }
    if (typeof options.address === "string" && merged.tcp.address === DEFAULT_OPTIONS.tcp.address) {
        merged.tcp.address = options.address;
    }

    return merged;
}

function createErrorObject(err, message) {
    return {
        date: new Date(),
        error: err,
        message: message
    };
}

module.exports = SyslogServer;
