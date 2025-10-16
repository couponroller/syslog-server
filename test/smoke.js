"use strict";

const assert = require("assert");
const dgram = require("dgram");
const net = require("net");
const SyslogServer = require("../index");

async function sendUdp(port, message) {
    return new Promise((resolve, reject) => {
        const socket = dgram.createSocket("udp4");
        socket.send(Buffer.from(message), port, "127.0.0.1", (err) => {
            socket.close();
            if (err) reject(err);
            else resolve();
        });
    });
}

async function sendTcp(port, message) {
    return new Promise((resolve, reject) => {
        const client = net.createConnection({ port, host: "127.0.0.1" }, () => {
            client.end(message);
        });

        client.on("error", reject);
        client.on("close", resolve);
    });
}

function getUdpPort(server) {
    if (server.udpSocket && typeof server.udpSocket.address === "function") {
        return server.udpSocket.address().port;
    }
    throw new Error("UDP socket not bound");
}

function getTcpPort(server) {
    if (server.tcpServer && typeof server.tcpServer.address === "function") {
        const addr = server.tcpServer.address();
        if (addr && typeof addr === "object") {
            return addr.port;
        }
    }
    throw new Error("TCP server not bound");
}

async function main() {
    const server = new SyslogServer();
    const messages = [];

    server.on("message", (msg) => {
        messages.push(msg);
    });

    await server.start({
        port: 0,
        udp: { enabled: true, recvBufferSize: 16 * 1024 * 1024 },
        tcp: { enabled: true, port: 0 }
    });

    const udpPort = getUdpPort(server);
    const tcpPort = getTcpPort(server);

    await sendUdp(udpPort, "udp-message");
    await sendTcp(tcpPort, "tcp-message\n");

    await new Promise((resolve) => setTimeout(resolve, 200));

    assert.strictEqual(messages.length, 2, "Expected to receive two messages");
    const protocols = new Set(messages.map((msg) => (msg.protocol || "").toString().toLowerCase()));
    assert.ok(
        protocols.has("udp") || protocols.has("udp4") || protocols.has("ipv4"),
        "Missing UDP message"
    );
    assert.ok(protocols.has("tcp") || protocols.has("tcp4"), "Missing TCP message");

    await server.stop();
}

main()
    .then(() => {
        // eslint-disable-next-line no-console
        console.log("Smoke test passed");
    })
    .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(err);
        process.exitCode = 1;
    });
